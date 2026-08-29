import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createDb } from "../db";
import { eventInbox } from "../schema";
import { handleSlackStamps } from "./http";

const SIGNING_SECRET = "test-signing-secret";

function slackRequest(
  body: string,
  options: {
    timestamp?: number;
    signature?: string;
    includeSignatureHeaders?: boolean;
    retryNum?: string;
    retryReason?: string;
  } = {}
) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const computedSignature = `v0=${createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  const headers = new Headers({ "content-type": "application/json" });

  if (options.includeSignatureHeaders !== false) {
    headers.set("x-slack-request-timestamp", String(timestamp));
    headers.set("x-slack-signature", options.signature ?? computedSignature);
  }
  if (options.retryNum) {
    headers.set("x-slack-retry-num", options.retryNum);
  }
  if (options.retryReason) {
    headers.set("x-slack-retry-reason", options.retryReason);
  }

  return new Request("http://localhost/slack/stamps", {
    method: "POST",
    headers,
    body,
  });
}

test("returns a challenge only for a valid Slack signature", async () => {
  const body = JSON.stringify({
    type: "url_verification",
    challenge: "verified-challenge",
  });

  const response = await handleSlackStamps(slackRequest(body), {
    signingSecret: SIGNING_SECRET,
  });

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("verified-challenge");
});

test("rejects an invalid URL-verification signature", async () => {
  const body = JSON.stringify({
    type: "url_verification",
    challenge: "must-not-be-returned",
  });

  const response = await handleSlackStamps(
    slackRequest(body, { signature: "v0=invalid" }),
    { signingSecret: SIGNING_SECRET }
  );

  expect(response.status).toBe(401);
  expect(await response.text()).toBe("invalid slack signature");
});

test("authenticates the raw body before parsing JSON", async () => {
  const response = await handleSlackStamps(
    slackRequest("not-json", { includeSignatureHeaders: false }),
    { signingSecret: SIGNING_SECRET }
  );

  expect(response.status).toBe(401);
  expect(await response.text()).toBe("missing slack signature headers");
});

test("rejects malformed JSON after its signature is verified", async () => {
  const response = await handleSlackStamps(slackRequest("not-json"), {
    signingSecret: SIGNING_SECRET,
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("invalid json body");
});

test("rejects a stale signed request", async () => {
  const body = JSON.stringify({ type: "event_callback", event: {} });
  const response = await handleSlackStamps(
    slackRequest(body, { timestamp: Math.floor(Date.now() / 1000) - 301 }),
    { signingSecret: SIGNING_SECRET }
  );

  expect(response.status).toBe(401);
  expect(await response.text()).toBe("stale slack request");
});

test("persists an event before scheduling background processing", async () => {
  const db = createDb(":memory:");
  const body = JSON.stringify({
    type: "event_callback",
    event_id: "Ev-persisted",
    team_id: "T123",
    event_time: 1_700_000_000,
    event: { type: "message" },
  });
  const scheduledEventIds: string[] = [];

  const response = await handleSlackStamps(slackRequest(body), {
    signingSecret: SIGNING_SECRET,
    botToken: "xoxb-test",
    db,
    scheduleProcessing: (_db, eventId) => {
      expect(db.select().from(eventInbox).get()?.eventId).toBe(eventId);
      scheduledEventIds.push(eventId);
    },
  });

  const stored = db.select().from(eventInbox).get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    queued: true,
    duplicateSkipped: false,
  });
  expect(scheduledEventIds).toEqual(["Ev-persisted"]);
  expect(stored?.teamId).toBe("T123");
  expect(stored?.payload).toBe(body);
  expect(stored?.slackEventTime).toBe(1_700_000_000_000);
  expect(stored?.status).toBe("pending");
});

test("returns the acknowledgement without awaiting processing", async () => {
  const db = createDb(":memory:");
  const body = JSON.stringify({
    type: "event_callback",
    event_id: "Ev-fast-ack",
    team_id: "T123",
    event: { type: "message" },
  });

  const response = await handleSlackStamps(slackRequest(body), {
    signingSecret: SIGNING_SECRET,
    botToken: "xoxb-test",
    db,
    scheduleProcessing: async () => new Promise(() => undefined),
  });

  expect(response.status).toBe(200);
  expect(db.select().from(eventInbox).get()?.status).toBe("pending");
});

test("deduplicates Slack retries and retains their metadata", async () => {
  const db = createDb(":memory:");
  const body = JSON.stringify({
    type: "event_callback",
    event_id: "Ev-retry",
    team_id: "T123",
    event: { type: "message" },
  });
  let scheduledCount = 0;
  const options = {
    signingSecret: SIGNING_SECRET,
    botToken: "xoxb-test",
    db,
    scheduleProcessing: () => {
      scheduledCount += 1;
    },
  };

  await handleSlackStamps(slackRequest(body), options);
  const retryResponse = await handleSlackStamps(
    slackRequest(body, { retryNum: "1", retryReason: "http_timeout" }),
    options
  );

  const rows = db.select().from(eventInbox).all();
  expect(await retryResponse.json()).toEqual({
    ok: true,
    queued: true,
    duplicateSkipped: true,
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.retryNum).toBe(1);
  expect(rows[0]?.retryReason).toBe("http_timeout");
  expect(scheduledCount).toBe(1);
});
