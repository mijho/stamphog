import { expect, test } from "bun:test";
import { sleep } from "bun";
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { eventInbox } from "../schema";
import {
  enqueueSlackEvent,
  getFailedSlackEvents,
  processSlackEvent,
  recoverInterruptedSlackEvents,
  startSlackEventWorker,
} from "./inbox";

function enqueue(db: ReturnType<typeof createDb>, eventId: string) {
  const envelope = {
    type: "event_callback",
    event_id: eventId,
    team_id: "T123",
    event_time: 1_700_000_000,
    event: { type: "unhandled_test_event" },
  };
  return enqueueSlackEvent(db, {
    envelope,
    rawBody: JSON.stringify(envelope),
    receivedAt: 1000,
  });
}

test("marks a successfully dispatched inbox event complete", async () => {
  const db = createDb(":memory:");
  enqueue(db, "Ev-success");

  const result = await processSlackEvent(db, "Ev-success", "xoxb-test", {
    now: () => 1000,
    dispatch: async () => Response.json({ ok: true }),
  });

  const stored = db.select().from(eventInbox).get();
  expect(result).toEqual({ processed: true, status: "completed" });
  expect(stored?.status).toBe("completed");
  expect(stored?.attemptCount).toBe(1);
  expect(stored?.processedAt).toBe(1000);
});

test("keeps a failed event pending with retry state", async () => {
  const db = createDb(":memory:");
  enqueue(db, "Ev-failed-once");

  const first = await processSlackEvent(db, "Ev-failed-once", "xoxb-test", {
    now: () => 1000,
    dispatch: async () => {
      throw new Error("temporary Slack API failure");
    },
  });
  const afterFailure = db.select().from(eventInbox).get();
  const second = await processSlackEvent(db, "Ev-failed-once", "xoxb-test", {
    now: () => 2000,
    dispatch: async () => Response.json({ ok: true }),
  });
  const afterRetry = db.select().from(eventInbox).get();

  expect(first).toEqual({ processed: false, status: "pending" });
  expect(afterFailure?.attemptCount).toBe(1);
  expect(afterFailure?.availableAt).toBe(2000);
  expect(afterFailure?.lastError).toBe("temporary Slack API failure");
  expect(second).toEqual({ processed: true, status: "completed" });
  expect(afterRetry?.attemptCount).toBe(2);
  expect(afterRetry?.status).toBe("completed");
});

test("recovers events interrupted while processing", () => {
  const db = createDb(":memory:");
  enqueue(db, "Ev-interrupted");
  db.update(eventInbox)
    .set({ status: "processing" })
    .where(eq(eventInbox.eventId, "Ev-interrupted"))
    .run();

  const recovered = recoverInterruptedSlackEvents(db, 5000);
  const stored = db.select().from(eventInbox).get();

  expect(recovered).toBe(1);
  expect(stored?.status).toBe("pending");
  expect(stored?.availableAt).toBe(5000);
});

test("moves exhausted events to an inspectable failed state", async () => {
  const db = createDb(":memory:");
  enqueue(db, "Ev-permanent-failure");
  let now = 1000;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await processSlackEvent(db, "Ev-permanent-failure", "xoxb-test", {
      now: () => now,
      dispatch: async () => {
        throw new Error("permanent failure");
      },
    });
    now += 60_000;
  }

  const [failed] = getFailedSlackEvents(db);
  expect(failed).toMatchObject({
    eventId: "Ev-permanent-failure",
    teamId: "T123",
    eventType: "unhandled_test_event",
    attemptCount: 5,
    lastError: "permanent failure",
  });
  expect("payload" in (failed ?? {})).toBe(false);
});

test("the worker recovers and processes interrupted events", async () => {
  const db = createDb(":memory:");
  enqueue(db, "Ev-worker-recovery");
  db.update(eventInbox)
    .set({ status: "processing" })
    .where(eq(eventInbox.eventId, "Ev-worker-recovery"))
    .run();

  const stopWorker = startSlackEventWorker(db, "xoxb-test", 5);
  await sleep(25);
  stopWorker();

  const stored = db.select().from(eventInbox).get();
  expect(stored?.status).toBe("completed");
  expect(stored?.attemptCount).toBe(1);
});
