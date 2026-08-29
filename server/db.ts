import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { serverEnv } from "./env";
import * as schema from "./schema";

export type AppDb = BunSQLiteDatabase<typeof schema> & { $client: Database };

const MIGRATIONS_FOLDER = "./drizzle";
const LEGACY_SCHEMA = {
  actors: ["actor_id", "display_name", "image_url", "updated_at"],
  requests: [
    "id",
    "requester_id",
    "channel_id",
    "message_ref",
    "occurred_at",
    "pr_url",
    "dedupe_key",
    "created_at",
  ],
  stamp_events: [
    "id",
    "giver_id",
    "requester_id",
    "stamp_count",
    "occurred_at",
    "source",
    "channel_id",
    "pr_url",
    "dedupe_key",
    "created_at",
  ],
} as const;

function adoptLegacySchema(sqlite: Database, path: string) {
  const tableRows = sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    )
    .all();
  const tableNames = new Set(tableRows.map(({ name }) => name));
  if (tableNames.has("__drizzle_migrations")) {
    return;
  }

  const legacyTableNames = Object.keys(LEGACY_SCHEMA) as Array<
    keyof typeof LEGACY_SCHEMA
  >;
  const presentLegacyTables = legacyTableNames.filter((name) =>
    tableNames.has(name)
  );
  if (presentLegacyTables.length === 0) {
    return;
  }
  if (presentLegacyTables.length !== legacyTableNames.length) {
    throw new Error(
      `Refusing to migrate an incomplete unmanaged database; found ${presentLegacyTables.join(", ")}`
    );
  }

  for (const tableName of legacyTableNames) {
    const columns = sqlite
      .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
      .all()
      .map(({ name }) => name);
    const expectedColumns = LEGACY_SCHEMA[tableName];
    if (columns.join(",") !== expectedColumns.join(",")) {
      throw new Error(
        `Refusing to adopt unmanaged table ${tableName}; its columns do not match StampHog's legacy schema`
      );
    }
  }

  const [initialMigration] = readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  });
  if (!initialMigration) {
    throw new Error("The initial Drizzle migration is missing");
  }

  if (path !== ":memory:") {
    const backupPath = `${path}.pre-drizzle-${Date.now()}.bak`;
    writeFileSync(backupPath, sqlite.serialize());
    console.info(`backed up legacy database to ${backupPath}`);
  }

  sqlite.transaction(() => {
    sqlite.run(`
      CREATE TABLE __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at NUMERIC
      )
    `);
    sqlite.run(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      [initialMigration.hash, initialMigration.folderMillis]
    );
  })();
}

export function createDb(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  if (path !== ":memory:") {
    sqlite.run("PRAGMA journal_mode = WAL");
  }
  sqlite.run("PRAGMA busy_timeout = 5000");
  adoptLegacySchema(sqlite, path);

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let singleton: AppDb | undefined;

export function getDb() {
  if (!singleton) {
    singleton = createDb(serverEnv.databasePath);
  }
  return singleton;
}
