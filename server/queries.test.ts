import { expect, test } from "bun:test";
import { type AppDb, createDb } from "./db";
import { ingestReactionStamp, ingestRequestMessage } from "./ingest";
import { getLeaderboard, getRecentEvents } from "./queries";

const DAY_MS = 24 * 60 * 60 * 1000;

function seedRequest(db: AppDb, occurredAt: number, dedupeKey: string) {
  return ingestRequestMessage(db, {
    requesterId: "U_REQ",
    requesterDisplayName: "Requester",
    channelId: "C1",
    messageRef: dedupeKey,
    occurredAt,
    prUrl: "https://github.com/mijho/stamphog/pull/1",
    dedupeKey: `slack:request:C1:${dedupeKey}`,
  });
}

function seedStamp(db: AppDb, occurredAt: number, dedupeKey: string) {
  return ingestReactionStamp(db, {
    giverId: "U_GIVER",
    requesterId: "U_REQ",
    giverDisplayName: "Giver",
    requesterDisplayName: "Requester",
    reaction: "white_check_mark",
    source: "slack:reaction:white_check_mark",
    channelId: "C1",
    occurredAt,
    prUrl: "https://github.com/mijho/stamphog/pull/1",
    dedupeKey: `slack:reaction:C1:${dedupeKey}:white_check_mark:U_GIVER`,
  });
}

test("leaderboard windowDays excludes stamps before the window", () => {
  const db = createDb(":memory:");
  const now = Date.now();
  seedStamp(db, now, "recent");
  seedStamp(db, now - 365 * DAY_MS, "ancient");

  const windowed = getLeaderboard(db, { windowDays: 30 });
  expect(windowed.totals.stamps).toBe(1);
  expect(windowed.totals.events).toBe(1);

  const unfiltered = getLeaderboard(db, {});
  expect(unfiltered.totals.stamps).toBe(2);
  expect(unfiltered.totals.events).toBe(2);
});

test("leaderboard windowDays excludes requests before the window", () => {
  const db = createDb(":memory:");
  const now = Date.now();
  seedRequest(db, now, "recent");
  seedRequest(db, now - 365 * DAY_MS, "ancient");

  const windowed = getLeaderboard(db, { windowDays: 30 });
  expect(windowed.totals.requests).toBe(1);

  const unfiltered = getLeaderboard(db, {});
  expect(unfiltered.totals.requests).toBe(2);
});

test("recent events respect the leaderboard query window", () => {
  const db = createDb(":memory:");
  const now = Date.now();
  seedStamp(db, now, "recent");
  seedRequest(db, now - 365 * DAY_MS, "ancient");

  const unfiltered = getRecentEvents(db, {});
  expect(unfiltered.some((event) => event.type === "request")).toBe(true);

  const filtered = recentEventsInWindow(db, 30);
  expect(filtered.every((event) => event.occurredAt >= now - 31 * DAY_MS)).toBe(
    true
  );
  expect(filtered.some((event) => event.type === "request")).toBe(false);
});

test("recent events are capped by the requested limit and ordered newest-first", () => {
  const db = createDb(":memory:");
  const now = Date.now();
  for (let i = 0; i < 5; i += 1) {
    seedStamp(db, now - i * 1000, `s${i}`);
  }

  const limited = getRecentEvents(db, { limit: 2 });
  expect(limited).toHaveLength(2);
  expect(limited[0]?.occurredAt).toBeGreaterThan(limited[1]?.occurredAt ?? 0);
});

function recentEventsInWindow(db: AppDb, windowDays: number) {
  const since = Date.now() - windowDays * DAY_MS;
  const events = getRecentEvents(db, {});
  return events.filter((event) => event.occurredAt >= since);
}
