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
    source: text("source").notNull(),
    channelId: text("channel_id"),
    prUrl: text("pr_url"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("stamp_events_occurred_at").on(table.occurredAt)]
);
