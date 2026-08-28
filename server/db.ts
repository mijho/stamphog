import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDb = BetterSQLite3Database<typeof schema>;

const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS actors (
  actor_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  image_url TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_ref TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_occurred_at ON requests (occurred_at);
CREATE TABLE IF NOT EXISTS stamp_events (
  id TEXT PRIMARY KEY,
  giver_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  stamp_count INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  channel_id TEXT,
  pr_url TEXT,
  dedupe_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stamp_events_occurred_at ON stamp_events (occurred_at);
`;

export function createDb(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.exec(MIGRATE_SQL);
  return drizzle(sqlite, { schema });
}

let singleton: AppDb | undefined;

export function getDb() {
  if (!singleton) {
    singleton = createDb(process.env.DATABASE_PATH ?? "./data/stamphog.db");
  }
  return singleton;
}
