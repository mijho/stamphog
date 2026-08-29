import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const actors = sqliteTable("actors", {
  actorId: text("actor_id").primaryKey(),
  displayName: text("display_name").notNull(),
  imageUrl: text("image_url"),
  updatedAt: integer("updated_at").notNull(),
});

export const eventInbox = sqliteTable(
  "event_inbox",
  {
    eventId: text("event_id").primaryKey(),
    teamId: text("team_id"),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(),
    slackEventTime: integer("slack_event_time"),
    retryNum: integer("retry_num"),
    retryReason: text("retry_reason"),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: integer("available_at").notNull(),
    receivedAt: integer("received_at").notNull(),
    processedAt: integer("processed_at"),
    lastError: text("last_error"),
  },
  (table) => [
    index("event_inbox_status_available_at").on(
      table.status,
      table.availableAt
    ),
    index("event_inbox_received_at").on(table.receivedAt),
  ]
);

export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    requesterId: text("requester_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageRef: text("message_ref").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    prUrl: text("pr_url").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("requests_occurred_at").on(table.occurredAt)]
);

export const stampEvents = sqliteTable(
  "stamp_events",
  {
    id: text("id").primaryKey(),
    giverId: text("giver_id").notNull(),
    requesterId: text("requester_id").notNull(),
    stampCount: integer("stamp_count").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    timestampSource: text("timestamp_source").notNull().default("slack_event"),
    ingestedAt: integer("ingested_at").notNull(),
    source: text("source").notNull(),
    channelId: text("channel_id"),
    prUrl: text("pr_url"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("stamp_events_occurred_at").on(table.occurredAt)]
);

export const backfillRuns = sqliteTable("backfill_runs", {
  channelId: text("channel_id").primaryKey(),
  status: text("status").notNull().default("running"),
  oldestTs: text("oldest_ts").notNull(),
  cursor: text("cursor"),
  scannedMessages: integer("scanned_messages").notNull().default(0),
  qualifyingMessages: integer("qualifying_messages").notNull().default(0),
  createdEvents: integer("created_events").notNull().default(0),
  duplicateEvents: integer("duplicate_events").notNull().default(0),
  createdRequests: integer("created_requests").notNull().default(0),
  duplicateRequests: integer("duplicate_requests").notNull().default(0),
  skippedSelfReactions: integer("skipped_self_reactions").notNull().default(0),
  skippedMissingUrl: integer("skipped_missing_url").notNull().default(0),
  skippedMissingAuthor: integer("skipped_missing_author").notNull().default(0),
  skippedNoReactions: integer("skipped_no_reactions").notNull().default(0),
  skippedNoTrackedReactions: integer("skipped_no_tracked_reactions")
    .notNull()
    .default(0),
  messagesWithAnyReaction: integer("messages_with_any_reaction")
    .notNull()
    .default(0),
  messagesWithTrackedReaction: integer("messages_with_tracked_reaction")
    .notNull()
    .default(0),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
  lastError: text("last_error"),
});
