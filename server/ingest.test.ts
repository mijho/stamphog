import assert from "node:assert/strict";
import { test } from "node:test";
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

  assert.equal(first.duplicateSkipped, false);
  assert.equal(second.duplicateSkipped, true);
  assert.equal(second.requestId, first.requestId);

  const events = getRecentEvents(db, {});
  const request = events.find((event) => event.type === "request");
  assert.equal(request?.prUrl, "https://github.com/mijho/stamphog/pull/2");
});

test("reaction ingest does not double-count", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  const first = ingestSampleStamp(db);
  const second = ingestSampleStamp(db);

  assert.equal(first.duplicateSkipped, false);
  assert.equal(second.duplicateSkipped, true);

  const leaderboard = getLeaderboard(db, {});
  assert.equal(leaderboard.totals.stamps, 1);
  assert.equal(leaderboard.givers[0]?.stampsGiven, 1);
});

test("reaction remove deletes by dedupe key", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  ingestSampleStamp(db);

  const removed = removeReactionStamp(db, {
    dedupeKey: "slack:reaction:C1:111.001:white_check_mark:U_GIVER",
    giverId: "U_GIVER",
    requesterId: "U_REQ",
    reaction: "white_check_mark",
    source: "slack:reaction:white_check_mark",
    channelId: "C1",
  });

  assert.equal(removed.removed, 1);
  assert.equal(removed.strategy, "by_dedupe_key");
  assert.equal(getLeaderboard(db, {}).totals.stamps, 0);
});

test("reaction remove falls back when dedupe key is missing", () => {
  const db = createDb(":memory:");
  ingestSampleRequest(db);
  ingestSampleStamp(db);

  const removed = removeReactionStamp(db, {
    dedupeKey: "slack:reaction:missing",
    giverId: "U_GIVER",
    requesterId: "U_REQ",
    reaction: "white_check_mark",
    source: "slack:reaction:white_check_mark",
    channelId: "C1",
  });

  assert.equal(removed.removed, 1);
  assert.equal(removed.strategy, "fallback_scan");
  assert.equal(getLeaderboard(db, {}).totals.stamps, 0);
});
