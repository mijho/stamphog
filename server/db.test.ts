import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { createDb } from "./db";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite migrations", () => {
  test("adopts and backs up the legacy unmanaged schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "stamphog-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "legacy.db");
    const initialSql = readFileSync(
      new URL("../drizzle/0000_initial.sql", import.meta.url),
      "utf8"
    );

    const legacyDb = new Database(databasePath);
    legacyDb.exec(initialSql);
    legacyDb.run(
      "INSERT INTO actors (actor_id, display_name, updated_at) VALUES (?, ?, ?)",
      ["U123", "Legacy User", 1]
    );
    legacyDb.close();

    const migratedDb = createDb(databasePath);
    const actor = migratedDb.$client
      .query<{ display_name: string }, []>(
        "SELECT display_name FROM actors WHERE actor_id = 'U123'"
      )
      .get();
    const migrationCount = migratedDb.$client
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM __drizzle_migrations"
      )
      .get();
    migratedDb.$client.close();

    const backupFiles = readdirSync(directory).filter((file) =>
      file.includes(".pre-drizzle-")
    );
    expect(actor?.display_name).toBe("Legacy User");
    expect(migrationCount?.count).toBe(
      readMigrationFiles({ migrationsFolder: "./drizzle" }).length
    );
    expect(backupFiles).toHaveLength(1);
  });
});
