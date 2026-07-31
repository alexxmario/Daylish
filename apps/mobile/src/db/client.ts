/**
 * On-device database.
 *
 * SQLite is the source of truth. Every read the UI performs hits this database
 * and nothing else, which is what makes the journal work with no network — the
 * single most important property in the product brief.
 */

import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { MIGRATIONS } from '@daylish/db';
import * as schema from '@daylish/db/schema';

export const DATABASE_NAME = 'daylish.db';

const sqlite = SQLite.openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };

/**
 * Apply any migrations this device has not seen.
 *
 * Deliberately hand-rolled rather than using Drizzle's Expo migrator: the ledger
 * is a plain table we can inspect from the debugger, and the whole thing runs in
 * one transaction so a failure part-way through cannot leave a half-migrated
 * database behind.
 */
export function runMigrations(): { applied: string[]; alreadyCurrent: number } {
  sqlite.execSync('PRAGMA foreign_keys = ON;');
  sqlite.execSync(
    `CREATE TABLE IF NOT EXISTS _daylish_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     );`,
  );

  const done = new Set(
    sqlite
      .getAllSync<{ name: string }>('SELECT name FROM _daylish_migrations')
      .map((row) => row.name),
  );

  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (done.has(migration.name)) continue;

    sqlite.execSync('BEGIN');
    try {
      for (const statement of migration.statements) {
        sqlite.execSync(statement);
      }
      sqlite.runSync('INSERT INTO _daylish_migrations (name, applied_at) VALUES (?, ?)', [
        migration.name,
        new Date().toISOString(),
      ]);
      sqlite.execSync('COMMIT');
      applied.push(migration.name);
    } catch (error) {
      sqlite.execSync('ROLLBACK');
      throw new Error(
        `Migration ${migration.name} failed and was rolled back: ${String(error)}`,
      );
    }
  }

  return { applied, alreadyCurrent: done.size };
}
