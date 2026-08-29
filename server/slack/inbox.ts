import { and, asc, eq, lte } from "drizzle-orm";
import type { AppDb } from "../db";
import { redact } from "../redact";
import { eventInbox } from "../schema";
import { handleSlackMessageEvent, handleSlackReactionEvent } from "./handlers";
import type {
  SlackEventEnvelope,
  SlackMessageEvent,
  SlackReactionEvent,
} from "./types";

const MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000;

type InboxStatus = "pending" | "processing" | "completed" | "failed";

export interface EnqueueSlackEventArgs {
  envelope: SlackEventEnvelope;
  rawBody: string;
  retryNum?: string | null;
  retryReason?: string | null;
  receivedAt?: number;
}

export interface ProcessSlackEventOptions {
  now?: () => number;
  dispatch?: typeof dispatchSlackEvent;
}

function parseOptionalInteger(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function enqueueSlackEvent(db: AppDb, args: EnqueueSlackEventArgs) {
  const eventId = args.envelope.event_id;
  if (!eventId) {
    throw new Error("missing Slack event_id");
  }

  const receivedAt = args.receivedAt ?? Date.now();
  const retryNum = parseOptionalInteger(args.retryNum);
  const slackEventTime =
    typeof args.envelope.event_time === "number"
      ? args.envelope.event_time * 1000
      : null;
  const result = db.$client.run(
    `INSERT OR IGNORE INTO event_inbox (
      event_id, team_id, event_type, payload, slack_event_time,
      retry_num, retry_reason, status, attempt_count, available_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [
      eventId,
      args.envelope.team_id ?? null,
      args.envelope.event?.type ?? "unknown",
      args.rawBody,
      slackEventTime,
      retryNum ?? null,
      args.retryReason ?? null,
      receivedAt,
      receivedAt,
    ]
  );

  const inserted = result.changes > 0;
  if (!inserted && (retryNum !== undefined || args.retryReason)) {
    db.update(eventInbox)
      .set({ retryNum, retryReason: args.retryReason ?? undefined })
      .where(eq(eventInbox.eventId, eventId))
      .run();
  }

  return { eventId, inserted, duplicateSkipped: !inserted };
}

async function dispatchSlackEvent(
  db: AppDb,
  envelope: SlackEventEnvelope,
  botToken: string
) {
  const eventType = envelope.event?.type;
  if (eventType === "message") {
    return handleSlackMessageEvent(
      db,
      envelope.event as SlackMessageEvent,
      botToken
    );
  }
  if (eventType === "reaction_added" || eventType === "reaction_removed") {
    return handleSlackReactionEvent(
      db,
      envelope.event as SlackReactionEvent,
      botToken
    );
  }
  return Response.json({
    ok: true,
    ignored: true,
    reason: "event_not_handled",
  });
}

function retryDelayMs(attemptCount: number) {
  return RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1);
}

export async function processSlackEvent(
  db: AppDb,
  eventId: string,
  botToken: string,
  options: ProcessSlackEventOptions = {}
) {
  const now = options.now ?? Date.now;
  const currentTime = now();
  const existing = db
    .select()
    .from(eventInbox)
    .where(eq(eventInbox.eventId, eventId))
    .get();

  if (!existing) {
    return { processed: false, status: "missing" as const };
  }

  const nextAttemptCount = existing.attemptCount + 1;
  const claimed = db.$client.run(
    `UPDATE event_inbox
      SET status = 'processing', attempt_count = ?, last_error = NULL
      WHERE event_id = ? AND status = 'pending' AND available_at <= ?`,
    [nextAttemptCount, eventId, currentTime]
  );

  if (claimed.changes === 0) {
    return { processed: false, status: existing.status };
  }

  try {
    const envelope = JSON.parse(existing.payload) as SlackEventEnvelope;
    const response = await (options.dispatch ?? dispatchSlackEvent)(
      db,
      envelope,
      botToken
    );
    if (!response.ok) {
      throw new Error(`Slack event handler returned HTTP ${response.status}`);
    }

    db.update(eventInbox)
      .set({
        status: "completed" satisfies InboxStatus,
        processedAt: now(),
        lastError: null,
      })
      .where(eq(eventInbox.eventId, eventId))
      .run();
    return { processed: true, status: "completed" as const };
  } catch (error) {
    const permanentlyFailed = nextAttemptCount >= MAX_ATTEMPTS;
    const failureTime = now();
    db.update(eventInbox)
      .set({
        status: (permanentlyFailed
          ? "failed"
          : "pending") satisfies InboxStatus,
        availableAt: permanentlyFailed
          ? failureTime
          : failureTime + retryDelayMs(nextAttemptCount),
        lastError: error instanceof Error ? error.message : "unknown error",
      })
      .where(eq(eventInbox.eventId, eventId))
      .run();
    return {
      processed: false,
      status: permanentlyFailed ? ("failed" as const) : ("pending" as const),
    };
  }
}

export function recoverInterruptedSlackEvents(db: AppDb, now = Date.now()) {
  return db.$client.run(
    "UPDATE event_inbox SET status = 'pending', available_at = ? WHERE status = 'processing'",
    [now]
  ).changes;
}

export async function processAvailableSlackEvents(
  db: AppDb,
  botToken: string,
  limit = 10
) {
  const available = db
    .select({ eventId: eventInbox.eventId })
    .from(eventInbox)
    .where(
      and(
        eq(eventInbox.status, "pending"),
        lte(eventInbox.availableAt, Date.now())
      )
    )
    .orderBy(asc(eventInbox.receivedAt))
    .limit(limit)
    .all();

  for (const { eventId } of available) {
    await processSlackEvent(db, eventId, botToken);
  }
  return available.length;
}

export function getFailedSlackEvents(db: AppDb, limit = 50) {
  return db
    .select({
      eventId: eventInbox.eventId,
      teamId: eventInbox.teamId,
      eventType: eventInbox.eventType,
      retryNum: eventInbox.retryNum,
      retryReason: eventInbox.retryReason,
      attemptCount: eventInbox.attemptCount,
      receivedAt: eventInbox.receivedAt,
      lastError: eventInbox.lastError,
    })
    .from(eventInbox)
    .where(eq(eventInbox.status, "failed"))
    .orderBy(asc(eventInbox.receivedAt))
    .limit(Math.max(1, Math.min(limit, 100)))
    .all();
}

export function scheduleSlackEventProcessing(
  db: AppDb,
  eventId: string,
  botToken: string
) {
  setTimeout(() => {
    processSlackEvent(db, eventId, botToken).catch((error) => {
      console.error(
        "stamphog slack event processing failed",
        redact({
          eventId,
          error: error instanceof Error ? error.message : "unknown error",
        })
      );
    });
  }, 0);
}

export function startSlackEventWorker(
  db: AppDb,
  botToken: string,
  intervalMs = 1000
) {
  recoverInterruptedSlackEvents(db);
  let running = false;
  const drain = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await processAvailableSlackEvents(db, botToken);
    } finally {
      running = false;
    }
  };

  const logDrainError = (error: unknown) => {
    console.error(
      "stamphog slack inbox drain failed",
      redact({
        error: error instanceof Error ? error.message : "unknown error",
      })
    );
  };
  drain().catch(logDrainError);
  const timer = setInterval(() => {
    drain().catch(logDrainError);
  }, intervalMs);
  return () => clearInterval(timer);
}
