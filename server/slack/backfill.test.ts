import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { backfillRuns } from "../schema";
import { type BackfillDeps, runSlackBackfill } from "./backfill";
import type { SlackHistoryMessage } from "./client";

const PR_URL = "https://github.com/mijho/stamphog/pull/1";

function message(ts: string, overrides: Partial<SlackHistoryMessage> = {}) {
  return {
    ts,
    user: "U-requester",
    text: PR_URL,
    ...overrides,
  } as SlackHistoryMessage;
}

function page(messages: SlackHistoryMessage[], nextCursor = "") {
  return {
    ok: true,
    messages,
    nextCursor,
    ratelimited: false,
  };
}

const noopSleep = async () => undefined;

function makeDeps(overrides: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    botToken: "xoxb-test",
    fetchPage: async () => page([]),
    fetchUserSummary: async ({ slackUserId }) => ({
      slackUserId,
      displayName: slackUserId,
      imageUrl: "https://example.com/avatar.png",
    }),
    sleep: noopSleep,
    now: () => Date.now(),
    ...overrides,
  };
}

test("persists an auditable completed backfill run with counters", async () => {
  const db = createDb(":memory:");
  const deps = makeDeps({
    fetchPage: async () => page([message("1700000001.000")]),
  });

  const summary = await runSlackBackfill(db, { channelId: "C1" }, deps);

  const run = db
    .select()
    .from(backfillRuns)
    .where(eq(backfillRuns.channelId, "C1"))
    .get();
  expect(run?.status).toBe("completed");
  expect(run?.scannedMessages).toBe(summary.scannedMessages);
  expect(run?.createdRequests).toBe(1);
  expect(summary.createdRequests).toBe(1);
});

test("retries on Slack rate limiting then succeeds", async () => {
  const db = createDb(":memory:");
  const sleeps: number[] = [];
  let calls = 0;
  const deps = makeDeps({
    fetchPage: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          error: "ratelimited",
          messages: [],
          nextCursor: "",
          ratelimited: true,
          retryAfterSeconds: 2,
        };
      }
      return page([message("1700000001.000")]);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const summary = await runSlackBackfill(db, { channelId: "C1" }, deps);

  expect(calls).toBe(2);
  expect(sleeps).toEqual([2000]);
  expect(summary.createdRequests).toBe(1);
});

test("gives up after exhausting rate-limit retries and marks run failed", async () => {
  const db = createDb(":memory:");
  let _calls = 0;
  const deps = makeDeps({
    fetchPage: async () => {
      _calls += 1;
      return {
        ok: false,
        error: "ratelimited",
        messages: [],
        nextCursor: "",
        ratelimited: true,
        retryAfterSeconds: 1,
      };
    },
    sleep: noopSleep,
  });

  await expect(runSlackBackfill(db, { channelId: "C1" }, deps)).rejects.toThrow(
    "rate limited"
  );

  const run = db
    .select()
    .from(backfillRuns)
    .where(eq(backfillRuns.channelId, "C1"))
    .get();
  expect(run?.status).toBe("failed");
  expect(run?.lastError).toContain("rate limited");
});

test("resumes from a persisted cursor after an interrupted run", async () => {
  const db = createDb(":memory:");

  const firstRunDeps = makeDeps({
    fetchPage: async ({ cursor }) => {
      if (cursor) {
        throw new Error("boom");
      }
      const messages = Array.from({ length: 200 }, (_, i) =>
        message(`170000000${i}.000`)
      );
      return page(messages, "c1");
    },
  });

  await expect(
    runSlackBackfill(db, { channelId: "C1" }, firstRunDeps)
  ).rejects.toThrow("boom");

  const interruptedRun = db
    .select()
    .from(backfillRuns)
    .where(eq(backfillRuns.channelId, "C1"))
    .get();
  expect(interruptedRun?.status).toBe("failed");
  expect(interruptedRun?.cursor).toBe("c1");
  expect(interruptedRun?.scannedMessages).toBe(200);

  const resumedCursors: Array<string | undefined> = [];
  const secondRunDeps = makeDeps({
    fetchPage: async ({ cursor }) => {
      resumedCursors.push(cursor);
      return page([]);
    },
  });

  const summary = await runSlackBackfill(
    db,
    { channelId: "C1" },
    secondRunDeps
  );

  expect(resumedCursors).toEqual(["c1"]);
  const completedRun = db
    .select()
    .from(backfillRuns)
    .where(eq(backfillRuns.channelId, "C1"))
    .get();
  expect(completedRun?.status).toBe("completed");
  expect(completedRun?.scannedMessages).toBe(200);
  expect(summary.createdRequests).toBe(200);
});
