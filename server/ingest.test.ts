import { expect, test } from "bun:test";
import { TIMESTAMP_SOURCES } from "../src/lib/event-time";
import { type AppDb, createDb } from "./db";
import {
  type IngestReactionArgs,
  type IngestRequestArgs,
  ingestReactionStamp,
  ingestRequestMessage,
  removeReactionStamp,
} from "./ingest";
import { getLeaderboard, getRecentEvents } from "./queries";

function ingestSampleRequest(
  db: AppDb,
  overrides?: Partial<IngestRequestArgs>
) {
  return ingestRequestMessage(db, {
    requesterId: "U_REQ",
    requesterDisplayName: "Requester",
    channelId: "C1",
    messageRef: "111.001",
    prUrl: "https://github.com/mijho/stamphog/pull/1",
    dedupeKey: "slack:request:C1:111.001",
    ...overrides,
  });
}

function ingestSampleStamp(db: AppDb, overrides?: Partial<IngestReactionArgs>) {
  return ingestReactionStamp(db, {
    giverId: "U_GIVER",
    requesterId: "U_REQ",
    giverDisplayName: "Giver",
    requesterDisplayName: "Requester",
    reaction: "white_check_mark",
    source: "slack:reaction:white_check_mark",
    channelId: "C1",
    prUrl: "https://github.com/mijho/stamphog/pull/1",
    dedupeKey: "slack:reaction:C1:111.001:white_check_mark:U_GIVER",
    ...overrides,
  });
}

test("request ingest is idempotent and updates prUrl", () => {
  const db = createDb(":memory:");
  const first = ingestSampleRequest(db);
  const second = ingestSampleRequest(db, {
    prUrl: "https://github.com/mijho/stamphog/pull/2",
  });

  expect(first.duplicateSkipped).toBe(false);
  expect(second.duplicateSkipped).toBe(true);
  expect(second.requestId).toBe(first.requestId);

  const events = getRecentEvents(db, {});
  const request = events.find((event) => event.type === "request");
  expect(request?.prUrl).toBe("https://github.com/mijho/stamphog/pull/2");
});

test("reaction ingest does not double-count", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  const first = ingestSampleStamp(db);
  const second = ingestSampleStamp(db);

  expect(first.duplicateSkipped).toBe(false);
  expect(second.duplicateSkipped).toBe(true);

  const leaderboard = getLeaderboard(db, {});
  expect(leaderboard.totals.stamps).toBe(1);
  expect(leaderboard.givers[0]?.stampsGiven).toBe(1);
});

test("reaction remove deletes by dedupe key", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  ingestSampleStamp(db);

  const removed = removeReactionStamp(db, {
    dedupeKey: "slack:reaction:C1:111.001:white_check_mark:U_GIVER",
  });

  expect(removed.removed).toBe(1);
  expect(removed.strategy).toBe("by_dedupe_key");
  expect(getLeaderboard(db, {}).totals.stamps).toBe(0);

  const repeated = removeReactionStamp(db, {
    dedupeKey: "slack:reaction:C1:111.001:white_check_mark:U_GIVER",
  });
  expect(repeated.removed).toBe(0);
  expect(repeated.strategy).toBe("not_found");
  expect(getLeaderboard(db, {}).totals.stamps).toBe(0);
});

test("reaction remove does not delete stamps from another message", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  ingestSampleStamp(db);
  ingestSampleStamp(db, {
    dedupeKey: "slack:reaction:C1:222.002:white_check_mark:U_GIVER",
  });

  const removed = removeReactionStamp(db, {
    dedupeKey: "slack:reaction:missing",
  });

  expect(removed.removed).toBe(0);
  expect(removed.strategy).toBe("not_found");
  expect(getLeaderboard(db, {}).totals.stamps).toBe(2);
});

test("live stamps store slack event time separately from ingest time", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  ingestSampleStamp(db, {
    occurredAt: 1_700_000_000_000,
    ingestedAt: 1_700_000_100_000,
    timestampSource: TIMESTAMP_SOURCES.slackEvent,
  });

  const stamp = getRecentEvents(db, {}).find((event) => event.type === "stamp");
  expect(stamp).toMatchObject({
    type: "stamp",
    occurredAt: 1_700_000_000_000,
    timestampSource: TIMESTAMP_SOURCES.slackEvent,
    ingestedAt: 1_700_000_100_000,
  });
});

test("backfilled stamps disclose message-time approximation", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  ingestSampleStamp(db, {
    occurredAt: 1_699_000_000_000,
    ingestedAt: 1_700_000_100_000,
    timestampSource: TIMESTAMP_SOURCES.messageTimeApproximation,
  });

  const stamp = getRecentEvents(db, {}).find((event) => event.type === "stamp");
  expect(stamp).toMatchObject({
    type: "stamp",
    occurredAt: 1_699_000_000_000,
    timestampSource: TIMESTAMP_SOURCES.messageTimeApproximation,
    ingestedAt: 1_700_000_100_000,
  });
});
