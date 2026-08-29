import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { handleSlackStamps } from "./http";

const SIGNING_SECRET = "test-signing-secret";

function slackRequest(
  body: string,
  options: {
    timestamp?: number;
    signature?: string;
    includeSignatureHeaders?: boolean;
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
