import { eq } from "drizzle-orm";
import { TIMESTAMP_SOURCES } from "../../src/lib/event-time";
import {
  buildReactionDedupeKey,
  buildRequestDedupeKey,
  extractQualifyingReviewUrl,
  getStampEmojiSet,
  isSelfStamp,
  normalizeEmoji,
} from "../../src/lib/slack-rules";
import type { AppDb } from "../db";
import { serverEnv } from "../env";
import { ingestReactionStamp, ingestRequestMessage } from "../ingest";
import { backfillRuns as backfillRunsTable } from "../schema";
import {
  fetchSlackHistoryPage,
  fetchSlackUserSummary,
  type SlackHistoryMessage,
  type SlackHistoryPage,
  type SlackUserSummary,
} from "./client";

const DEFAULT_MAX_MESSAGES = 5000;
const MAX_BACKFILL_MESSAGES = 50_000;
const BACKFILL_WINDOW_DAYS = 90;
const PAGE_SIZE = 200;
const MAX_RATE_LIMIT_RETRIES = 3;

export interface BackfillArgs {
  channelId: string;
  oldestTs?: string;
  maxMessages?: number;
}

export interface BackfillDeps {
  botToken?: string;
  fetchPage: (args: {
    botToken: string;
    channelId: string;
    cursor?: string;
    oldestTs?: string;
  }) => Promise<SlackHistoryPage>;
  fetchUserSummary: (args: {
    botToken: string;
    slackUserId: string;
  }) => Promise<SlackUserSummary>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

type CountMap = Map<string, number>;

interface BackfillState {
  scannedMessages: number;
  qualifyingMessages: number;
  createdEvents: number;
  duplicateEvents: number;
  createdRequests: number;
  duplicateRequests: number;
  skippedSelfReactions: number;
  skippedMissingUrl: number;
  skippedMissingAuthor: number;
  skippedNoReactions: number;
  skippedNoTrackedReactions: number;
  messagesWithAnyReaction: number;
  messagesWithTrackedReaction: number;
  allReactionNames: CountMap;
  trackedReactionNames: CountMap;
  untrackedReactionNames: CountMap;
  qualifyingUrlHosts: CountMap;
}

interface RuntimeContext {
  db: AppDb;
  channelId: string;
  trackedStampEmojis: Set<string>;
  state: BackfillState;
  getUserSummary: (slackUserId: string) => Promise<SlackUserSummary>;
}

function createBackfillState(): BackfillState {
  return {
    scannedMessages: 0,
    qualifyingMessages: 0,
    createdEvents: 0,
    duplicateEvents: 0,
    createdRequests: 0,
    duplicateRequests: 0,
    skippedSelfReactions: 0,
    skippedMissingUrl: 0,
    skippedMissingAuthor: 0,
    skippedNoReactions: 0,
    skippedNoTrackedReactions: 0,
    messagesWithAnyReaction: 0,
    messagesWithTrackedReaction: 0,
    allReactionNames: new Map(),
    trackedReactionNames: new Map(),
    untrackedReactionNames: new Map(),
    qualifyingUrlHosts: new Map(),
  };
}

const SCALAR_KEYS: Array<keyof Omit<BackfillState, CountMapKey>> = [
  "scannedMessages",
  "qualifyingMessages",
  "createdEvents",
  "duplicateEvents",
  "createdRequests",
  "duplicateRequests",
  "skippedSelfReactions",
  "skippedMissingUrl",
  "skippedMissingAuthor",
  "skippedNoReactions",
  "skippedNoTrackedReactions",
  "messagesWithAnyReaction",
  "messagesWithTrackedReaction",
];

type CountMapKey =
  | "allReactionNames"
  | "trackedReactionNames"
  | "untrackedReactionNames"
  | "qualifyingUrlHosts";

function incrementCount(
  counterMap: CountMap,
  key: string | undefined,
  amount = 1
) {
  if (!key) {
    return;
  }
  counterMap.set(key, (counterMap.get(key) ?? 0) + amount);
}

function topCounts(counterMap: CountMap, limit = 20) {
  return Array.from(counterMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function toOccurredAtMs(timestamp: string | undefined) {
  if (!timestamp) {
    return undefined;
  }
  const parsed = Number(timestamp);
  return Number.isFinite(parsed) ? Math.floor(parsed * 1000) : undefined;
}

function boundedMaxMessages(maxMessages: number | undefined) {
  return Math.max(
    1,
    Math.min(
      MAX_BACKFILL_MESSAGES,
      Math.floor(maxMessages ?? DEFAULT_MAX_MESSAGES)
    )
  );
}

function effectiveOldestTs(userOldestTs: string | undefined, now: number) {
  const cutoffMs = now - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoffTs = String(Math.floor(cutoffMs / 1000));
  if (!userOldestTs) {
    return cutoffTs;
  }
  const requested = Number(userOldestTs);
  const cutoff = Number(cutoffTs);
  if (!Number.isFinite(requested) || requested < cutoff) {
    return cutoffTs;
  }
  return userOldestTs;
}

function buildSummary(args: {
  state: BackfillState;
  channelId: string;
  trackedStampEmojis: Set<string>;
}) {
  return {
    channelId: args.channelId,
    scannedMessages: args.state.scannedMessages,
    qualifyingMessages: args.state.qualifyingMessages,
    createdEvents: args.state.createdEvents,
    duplicateEvents: args.state.duplicateEvents,
    createdRequests: args.state.createdRequests,
    duplicateRequests: args.state.duplicateRequests,
    skippedSelfReactions: args.state.skippedSelfReactions,
    skippedMissingUrl: args.state.skippedMissingUrl,
    skippedMissingAuthor: args.state.skippedMissingAuthor,
    skippedNoReactions: args.state.skippedNoReactions,
    skippedNoTrackedReactions: args.state.skippedNoTrackedReactions,
    messagesWithAnyReaction: args.state.messagesWithAnyReaction,
    messagesWithTrackedReaction: args.state.messagesWithTrackedReaction,
    topAllReactionNames: topCounts(args.state.allReactionNames),
    topTrackedReactionNames: topCounts(args.state.trackedReactionNames),
    topUntrackedReactionNames: topCounts(args.state.untrackedReactionNames),
    qualifyingUrlHosts: topCounts(args.state.qualifyingUrlHosts),
    trackedEmojiSet: Array.from(args.trackedStampEmojis.values()).sort(),
  };
}

async function ingestRequestForMessage(
  runtime: RuntimeContext,
  message: SlackHistoryMessage,
  requesterId: string,
  qualifyingUrl: string,
  messageRef: string
) {
  const requester = await runtime.getUserSummary(requesterId);
  const requestResult = ingestRequestMessage(runtime.db, {
    requesterId,
    requesterDisplayName: requester.displayName,
    requesterImageUrl: requester.imageUrl,
    channelId: runtime.channelId,
    messageRef,
    occurredAt: toOccurredAtMs(message.ts),
    prUrl: qualifyingUrl,
    dedupeKey: buildRequestDedupeKey({
      channelId: runtime.channelId,
      messageTs: messageRef,
    }),
  });

  if (requestResult.duplicateSkipped) {
    runtime.state.duplicateRequests += 1;
  } else {
    runtime.state.createdRequests += 1;
  }
}

async function ingestTrackedReactionUsers(args: {
  runtime: RuntimeContext;
  requesterId: string;
  messageRef: string;
  occurredAt: number | undefined;
  reactionName: string;
  qualifyingUrl: string;
  giverIds: string[];
}) {
  for (const giverId of args.giverIds) {
    if (isSelfStamp(giverId, args.requesterId)) {
      args.runtime.state.skippedSelfReactions += 1;
      continue;
    }

    const [giver, requesterSummary] = await Promise.all([
      args.runtime.getUserSummary(giverId),
      args.runtime.getUserSummary(args.requesterId),
    ]);

    const result = ingestReactionStamp(args.runtime.db, {
      giverId,
      requesterId: args.requesterId,
      giverDisplayName: giver.displayName,
      requesterDisplayName: requesterSummary.displayName,
      giverImageUrl: giver.imageUrl,
      requesterImageUrl: requesterSummary.imageUrl,
      reaction: args.reactionName,
      source: `slack:reaction:${args.reactionName}`,
      occurredAt: args.occurredAt,
      timestampSource: TIMESTAMP_SOURCES.messageTimeApproximation,
      channelId: args.runtime.channelId,
      prUrl: args.qualifyingUrl,
      dedupeKey: buildReactionDedupeKey({
        channelId: args.runtime.channelId,
        messageTs: args.messageRef,
        reaction: args.reactionName,
        giverSlackId: giverId,
      }),
    });

    if (result.duplicateSkipped) {
      args.runtime.state.duplicateEvents += 1;
    } else {
      args.runtime.state.createdEvents += 1;
    }
  }
}

async function processMessageReactions(args: {
  runtime: RuntimeContext;
  requesterId: string;
  message: SlackHistoryMessage;
  messageRef: string;
  qualifyingUrl: string;
}) {
  const reactions = args.message.reactions ?? [];
  if (reactions.length === 0) {
    args.runtime.state.skippedNoReactions += 1;
    return false;
  }

  args.runtime.state.messagesWithAnyReaction += 1;
  const occurredAt = toOccurredAtMs(args.message.ts);
  let matchedTrackedReaction = false;

  for (const reaction of reactions) {
    const reactionName = normalizeEmoji(reaction.name ?? "");
    incrementCount(args.runtime.state.allReactionNames, reactionName);

    if (!args.runtime.trackedStampEmojis.has(reactionName)) {
      incrementCount(args.runtime.state.untrackedReactionNames, reactionName);
      continue;
    }

    matchedTrackedReaction = true;
    incrementCount(args.runtime.state.trackedReactionNames, reactionName);

    await ingestTrackedReactionUsers({
      runtime: args.runtime,
      requesterId: args.requesterId,
      messageRef: args.messageRef,
      occurredAt,
      reactionName,
      qualifyingUrl: args.qualifyingUrl,
      giverIds: reaction.users ?? [],
    });
  }

  return matchedTrackedReaction;
}

async function processMessage(
  runtime: RuntimeContext,
  message: SlackHistoryMessage
) {
  runtime.state.scannedMessages += 1;

  const requesterId = message.user;
  if (!requesterId) {
    runtime.state.skippedMissingAuthor += 1;
    return;
  }

  const messageRef = message.ts ?? "0";
  const qualifyingUrl = extractQualifyingReviewUrl(message.text);
  if (!qualifyingUrl) {
    runtime.state.skippedMissingUrl += 1;
    return;
  }

  incrementCount(
    runtime.state.qualifyingUrlHosts,
    new URL(qualifyingUrl).hostname
  );

  await ingestRequestForMessage(
    runtime,
    message,
    requesterId,
    qualifyingUrl,
    messageRef
  );

  const matchedTrackedReaction = await processMessageReactions({
    runtime,
    requesterId,
    message,
    messageRef,
    qualifyingUrl,
  });

  if (matchedTrackedReaction) {
    runtime.state.qualifyingMessages += 1;
    runtime.state.messagesWithTrackedReaction += 1;
  } else {
    runtime.state.skippedNoTrackedReactions += 1;
  }
}

function persistRun(db: AppDb, run: BackfillRunRecord, cursor?: string) {
  const now = Date.now();
  const scalarValues = {} as Record<string, unknown>;
  for (const key of SCALAR_KEYS) {
    scalarValues[key] = run.state[key];
  }
  db.insert(backfillRunsTable)
    .values({
      channelId: run.channelId,
      status: "running",
      oldestTs: run.oldestTs,
      cursor: cursor ?? null,
      startedAt: run.startedAt,
      updatedAt: now,
      completedAt: null,
      lastError: null,
      ...scalarValues,
    })
    .onConflictDoUpdate({
      target: backfillRunsTable.channelId,
      set: {
        status: "running",
        cursor: cursor ?? null,
        updatedAt: now,
        completedAt: null,
        lastError: null,
        ...scalarValues,
      },
    })
    .run();
}

function resetRun(db: AppDb, run: BackfillRunRecord) {
  const now = Date.now();
  const zeroedScalars = {} as Record<string, unknown>;
  for (const key of SCALAR_KEYS) {
    zeroedScalars[key] = 0;
  }
  db.insert(backfillRunsTable)
    .values({
      channelId: run.channelId,
      status: "running",
      oldestTs: run.oldestTs,
      cursor: null,
      startedAt: run.startedAt,
      updatedAt: now,
      completedAt: null,
      lastError: null,
      ...zeroedScalars,
    })
    .onConflictDoUpdate({
      target: backfillRunsTable.channelId,
      set: {
        status: "running",
        oldestTs: run.oldestTs,
        startedAt: run.startedAt,
        cursor: null,
        updatedAt: now,
        completedAt: null,
        lastError: null,
        ...zeroedScalars,
      },
    })
    .run();
}

function completeRun(db: AppDb, run: BackfillRunRecord) {
  const now = Date.now();
  const scalarValues = {} as Record<string, unknown>;
  for (const key of SCALAR_KEYS) {
    scalarValues[key] = run.state[key];
  }
  db.update(backfillRunsTable)
    .set({
      status: "completed",
      updatedAt: now,
      completedAt: now,
      lastError: null,
      ...scalarValues,
    })
    .where(eq(backfillRunsTable.channelId, run.channelId))
    .run();
}

function failRun(db: AppDb, run: BackfillRunRecord, error: string) {
  db.update(backfillRunsTable)
    .set({
      status: "failed",
      updatedAt: Date.now(),
      lastError: error,
    })
    .where(eq(backfillRunsTable.channelId, run.channelId))
    .run();
}

interface BackfillRunRecord {
  channelId: string;
  oldestTs: string;
  startedAt: number;
  state: BackfillState;
  cursor: string | undefined;
}

const DEFAULT_DEPS: BackfillDeps = {
  fetchPage: fetchSlackHistoryPage,
  fetchUserSummary: fetchSlackUserSummary,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export async function runSlackBackfill(
  db: AppDb,
  args: BackfillArgs,
  deps: BackfillDeps = DEFAULT_DEPS
) {
  const botToken = deps.botToken ?? serverEnv.slackBotToken;
  if (!botToken) {
    throw new Error("missing SLACK_BOT_TOKEN");
  }

  const maxMessages = boundedMaxMessages(args.maxMessages);
  const trackedStampEmojis = getStampEmojiSet();

  const existingRun = db
    .select()
    .from(backfillRunsTable)
    .where(eq(backfillRunsTable.channelId, args.channelId))
    .get();

  const resuming = getResuming(existingRun);
  const oldestTs = getResumeOldestTs({
    resuming,
    existingRun,
    userOldestTs: args.oldestTs,
    now: deps.now(),
  });
  let cursor = resuming ? (existingRun?.cursor ?? undefined) : undefined;

  const state = getResumeState({ resuming, existingRun });

  const run: BackfillRunRecord = {
    channelId: args.channelId,
    oldestTs,
    startedAt: resuming ? (existingRun?.startedAt ?? deps.now()) : deps.now(),
    state,
    cursor,
  };
  if (resuming) {
    persistRun(db, run, cursor);
  } else {
    resetRun(db, run);
  }

  const userCache = new Map<string, SlackUserSummary>();
  const getUserSummary = async (slackUserId: string) => {
    const cached = userCache.get(slackUserId);
    if (cached) {
      return cached;
    }
    const summary = await deps.fetchUserSummary({
      botToken,
      slackUserId,
    });
    userCache.set(slackUserId, summary);
    return summary;
  };

  const runtime: RuntimeContext = {
    db,
    channelId: args.channelId,
    trackedStampEmojis,
    state,
    getUserSummary,
  };

  try {
    while (state.scannedMessages < maxMessages) {
      const page = await fetchPageWithRetry(deps, {
        botToken,
        channelId: args.channelId,
        cursor,
        oldestTs,
      });

      if (page.messages.length === 0) {
        break;
      }

      await processMessageBatch(runtime, page.messages, maxMessages);

      persistRun(db, run, page.nextCursor || cursor);
      if (!page.nextCursor || page.messages.length < PAGE_SIZE) {
        break;
      }
      cursor = page.nextCursor;
    }

    completeRun(db, run);
  } catch (error) {
    failRun(db, run, error instanceof Error ? error.message : "unknown error");
    throw error;
  }

  const summary = buildSummary({
    state,
    channelId: args.channelId,
    trackedStampEmojis,
  });

  console.log("stamphog backfill summary", JSON.stringify(summary));
  return {
    ...summary,
    requestedOldestTs: args.oldestTs ?? null,
    appliedOldestTs: oldestTs,
    backfillWindowDays: BACKFILL_WINDOW_DAYS,
  };
}

function seedStateFromRun(run: {
  scannedMessages: number;
  qualifyingMessages: number;
  createdEvents: number;
  duplicateEvents: number;
  createdRequests: number;
  duplicateRequests: number;
  skippedSelfReactions: number;
  skippedMissingUrl: number;
  skippedMissingAuthor: number;
  skippedNoReactions: number;
  skippedNoTrackedReactions: number;
  messagesWithAnyReaction: number;
  messagesWithTrackedReaction: number;
}): BackfillState {
  const state = createBackfillState();
  for (const key of SCALAR_KEYS) {
    (state as unknown as Record<string, unknown>)[key] = run[key];
  }
  return state;
}

async function fetchPageWithRetry(
  deps: BackfillDeps,
  args: {
    botToken: string;
    channelId: string;
    cursor?: string;
    oldestTs?: string;
  }
) {
  let lastRetryDelay = 0;
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const page = await deps.fetchPage(args);
    if (page.ok) {
      return page;
    }
    if (!page.ratelimited) {
      throw new Error(
        `slack history fetch failed: ${page.error ?? "unknown_error"}`
      );
    }
    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      throw new Error("slack history fetch rate limited; giving up");
    }
    lastRetryDelay = (page.retryAfterSeconds ?? 1) * 1000;
    await deps.sleep(lastRetryDelay);
  }
  throw new Error("unreachable");
}

function getResuming(
  existingRun: BackfillRunRow | undefined
): existingRun is BackfillRunRow {
  return Boolean(existingRun && existingRun.status !== "completed");
}

function getResumeOldestTs(args: {
  resuming: boolean;
  existingRun: BackfillRunRow | undefined;
  userOldestTs: string | undefined;
  now: number;
}) {
  if (args.resuming && args.existingRun) {
    return args.existingRun.oldestTs;
  }
  return effectiveOldestTs(args.userOldestTs, args.now);
}

function getResumeState(args: {
  resuming: boolean;
  existingRun: BackfillRunRow | undefined;
}) {
  if (args.resuming && args.existingRun) {
    return seedStateFromRun(args.existingRun);
  }
  return createBackfillState();
}

async function processMessageBatch(
  runtime: RuntimeContext,
  messages: SlackHistoryMessage[],
  maxMessages: number
) {
  for (const message of messages) {
    if (runtime.state.scannedMessages >= maxMessages) {
      break;
    }
    await processMessage(runtime, message);
  }
}

type BackfillRunRow = typeof backfillRunsTable.$inferSelect;
