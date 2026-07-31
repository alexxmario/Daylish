/**
 * Local side of accounts.
 *
 * Signing in is now required, but the diary still lives in on-device SQLite —
 * there is no sync yet. That makes two rules non-negotiable:
 *
 *   1. **Signing out never deletes anything.** With no server copy, a wipe on
 *      sign-out would destroy the only copy of a person's diary. Rows stay,
 *      scoped to their user id, and come back when that account signs in again.
 *   2. **Two accounts on one device never see each other's food.** Every query
 *      in the app is already scoped by `user_id`; this module is what guarantees
 *      each account gets its own id and keeps it.
 *
 * A local row is "anonymous" while `email` is null. That is the marker for data
 * created before this device ever signed in, and it is what makes adoption
 * possible without a schema change.
 *
 * Deliberately free of Supabase imports: this is all local bookkeeping, so the
 * runtime smoke test can execute it without mocking a network client.
 */

import { sqlite } from '@/db/client.ts';
import { deviceTimezone } from '@/lib/dates.ts';

/**
 * Every table keyed directly to a user, for adoption and deletion.
 *
 * **Adding a table with a `user_id` means adding it here.** A table left off
 * this list fails twice over: its rows are not adopted, so work done before
 * signing in is orphaned under the anonymous id; and they are not deleted, so
 * "delete my account" leaves personal data on the device. Child tables keyed to
 * a parent rather than to the user (`saved_meal_items`, `meal_plan_slots`) are
 * reached through their parent and are not listed.
 */
const USER_SCOPED_TABLES = [
  'user_goals',
  'journal_entries',
  'water_logs',
  'weight_entries',
  'mood_entries',
  'fasting_sessions',
  'recipe_interactions',
  'saved_meals',
  'shopping_list_recipes',
  'shopping_list_checks',
  'pantry_items',
  'meal_plans',
] as const;

export interface LocalDataSummary {
  readonly journalEntries: number;
  readonly weighIns: number;
  /** True when there is anything a person would be upset to lose. */
  readonly hasData: boolean;
}

/** What is sitting on this device under a given user id. */
export function summariseLocalData(userId: string): LocalDataSummary {
  const entries = sqlite.getFirstSync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = ? AND deleted_at IS NULL',
    [userId],
  );
  const weighIns = sqlite.getFirstSync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM weight_entries WHERE user_id = ?',
    [userId],
  );

  const journalEntries = entries?.c ?? 0;
  const weights = weighIns?.c ?? 0;
  return { journalEntries, weighIns: weights, hasData: journalEntries + weights > 0 };
}

/** The pre-account user, if this device has one. Null once it has been adopted. */
export function findAnonymousUserId(): string | null {
  const row = sqlite.getFirstSync<{ id: string }>(
    'SELECT id FROM users WHERE email IS NULL ORDER BY created_at ASC LIMIT 1',
  );
  return row?.id ?? null;
}

export function userExists(userId: string): boolean {
  return sqlite.getFirstSync<{ id: string }>('SELECT id FROM users WHERE id = ?', [userId]) !== null;
}

/**
 * Re-point an anonymous user's whole diary at their new account id.
 *
 * Done by rewriting the primary key rather than copying rows: every child table
 * keeps its own ids, so entries, items and their sync-outbox history stay
 * intact and nothing is duplicated.
 *
 * Foreign keys are disabled for the duration. The updates are ordered parent-last
 * anyway, but a half-applied identity change would be far worse than the
 * constraint is worth, and the whole thing is one transaction regardless.
 */
export function adoptAnonymousData(fromUserId: string, toUserId: string, email: string): void {
  if (fromUserId === toUserId) return;

  sqlite.execSync('PRAGMA foreign_keys = OFF;');
  sqlite.execSync('BEGIN');
  try {
    for (const table of USER_SCOPED_TABLES) {
      sqlite.runSync(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`, [toUserId, fromUserId]);
    }
    sqlite.runSync('UPDATE users SET id = ?, email = ?, updated_at = ? WHERE id = ?', [
      toUserId,
      email,
      new Date().toISOString(),
      fromUserId,
    ]);
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  } finally {
    sqlite.execSync('PRAGMA foreign_keys = ON;');
  }
}

export interface SignInOutcome {
  readonly userId: string;
  /** True when a pre-account diary was moved onto this account. */
  readonly adopted: boolean;
  readonly adoptedSummary: LocalDataSummary | null;
}

/**
 * Make sure the signed-in account has a local user row, and decide what happens
 * to anything already on the device.
 *
 * The three cases, in the order they are checked:
 *
 *   1. **This account has been here before** — its row exists, so use it. This is
 *      every launch after the first, and every sign-out and back in.
 *   2. **An anonymous diary is present** — adopt it. Someone who used the app
 *      before this build, or before creating their account, keeps their history
 *      and their onboarding answers.
 *   3. **Neither** — mint a fresh row. A second account on a shared device lands
 *      here, and correctly gets nothing of the first account's food.
 */
export function ensureAccountUser(authUserId: string, email: string): SignInOutcome {
  if (userExists(authUserId)) {
    // Keep the address current: people change it, and it is the marker that
    // distinguishes an account row from an anonymous one.
    sqlite.runSync('UPDATE users SET email = ?, updated_at = ? WHERE id = ?', [
      email,
      new Date().toISOString(),
      authUserId,
    ]);
    return { userId: authUserId, adopted: false, adoptedSummary: null };
  }

  const anonymousId = findAnonymousUserId();
  if (anonymousId) {
    const summary = summariseLocalData(anonymousId);
    adoptAnonymousData(anonymousId, authUserId, email);
    return { userId: authUserId, adopted: true, adoptedSummary: summary };
  }

  const timestamp = new Date().toISOString();
  sqlite.runSync(
    `INSERT INTO users (id, email, sex, activity_level, cooking_skill, allergens,
       disliked_ingredients, equipment, currency, max_prep_minutes, detailed_nutrition,
       timezone, created_at, updated_at)
     VALUES (?, ?, 'unspecified', 'moderate', 'comfortable', '[]', '[]', '[]', 'EUR', 45, 0, ?, ?, ?)`,
    [authUserId, email, deviceTimezone(), timestamp, timestamp],
  );
  return { userId: authUserId, adopted: false, adoptedSummary: null };
}

/**
 * Erase one account's data from this device, leaving any other account's alone.
 *
 * This is the local half of account deletion. The other half — removing the auth
 * record itself — needs privileges no client holds, and lives in the
 * `delete-account` Edge Function.
 *
 * Children are removed before parents, and the shared food cache is untouched:
 * it holds public reference data from USDA and Open Food Facts, nothing personal.
 */
export function deleteAccountData(userId: string): { rowsDeleted: number } {
  let rowsDeleted = 0;

  sqlite.execSync('PRAGMA foreign_keys = OFF;');
  sqlite.execSync('BEGIN');
  try {
    const run = (sql: string, params: string[]) => {
      rowsDeleted += sqlite.runSync(sql, params).changes ?? 0;
    };

    run(
      `DELETE FROM journal_entry_items
        WHERE entry_id IN (SELECT id FROM journal_entries WHERE user_id = ?)`,
      [userId],
    );
    run(
      `DELETE FROM meal_plan_slots
        WHERE plan_id IN (SELECT id FROM meal_plans WHERE user_id = ?)`,
      [userId],
    );
    for (const table of USER_SCOPED_TABLES) {
      run(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    }
    run('DELETE FROM users WHERE id = ?', [userId]);

    // The outbox is keyed by table and row rather than by user, so anything
    // still queued would push rows for a user that no longer exists. With no
    // sync worker yet there is nothing to lose by clearing it outright.
    run('DELETE FROM sync_outbox', []);

    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  } finally {
    sqlite.execSync('PRAGMA foreign_keys = ON;');
  }

  return { rowsDeleted };
}
