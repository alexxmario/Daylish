/**
 * Local data reset.
 *
 * Daylish keeps everything on the device and works before sign-in, so there is
 * no session to end — "starting over" means emptying the database rather than
 * logging out. This is what the destructive action in the You tab calls, and
 * what a real GDPR delete will call once accounts exist.
 *
 * Deliberately empties tables rather than deleting the database file: the file
 * is open and mapped while the app runs, and removing it out from under an open
 * connection leaves the app pointing at a handle that no longer exists.
 */

import { sqlite } from '@/db/client.ts';

/**
 * Every table holding user data, child-first.
 *
 * Order matters because foreign keys are enforced. Rather than rely on getting
 * it right, the delete runs with foreign keys disabled inside a transaction —
 * but the order is kept correct anyway so the list stays readable and so a
 * future partial reset can reuse it.
 */
const USER_TABLES = [
  'journal_entry_items',
  'journal_entries',
  'saved_meal_items',
  'saved_meals',
  'shopping_list_checks',
  'shopping_list_recipes',
  'meal_plan_slots',
  'meal_plans',
  'recipe_interactions',
  'pantry_items',
  'mood_entries',
  'fasting_sessions',
  'water_logs',
  'weight_entries',
  'user_goals',
  'sync_outbox',
  'sync_state',
  'users',
] as const;

/**
 * Tables holding shared reference data rather than anything personal.
 * Kept by default — wiping the food cache would force every barcode the user
 * has ever scanned to be re-fetched over the network for no benefit.
 */
const CACHE_TABLES = ['food_portions', 'food_items', 'recipe_steps', 'recipe_ingredients', 'recipes'] as const;

export interface ResetOptions {
  /** Also clear the cached food and recipe library. Off by default. */
  includeCachedFoods?: boolean;
}

export interface ResetResult {
  readonly tablesCleared: number;
  readonly rowsDeleted: number;
}

/**
 * Empty the local database.
 *
 * After this the app is in its first-launch state: `getOrCreateLocalUser` will
 * mint a new user with no `onboardedAt`, and the router sends the user back
 * through onboarding.
 */
export function resetLocalData(options: ResetOptions = {}): ResetResult {
  const tables = options.includeCachedFoods
    ? [...USER_TABLES, ...CACHE_TABLES]
    : [...USER_TABLES];

  let rowsDeleted = 0;

  // Foreign keys off for the duration: the delete order is correct, but a
  // partially-applied wipe caused by one bad ordering would be worse than the
  // constraint is worth here. The whole thing is one transaction regardless.
  sqlite.execSync('PRAGMA foreign_keys = OFF;');
  sqlite.execSync('BEGIN');
  try {
    for (const table of tables) {
      const result = sqlite.runSync(`DELETE FROM ${table}`);
      rowsDeleted += result.changes ?? 0;
    }
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  } finally {
    sqlite.execSync('PRAGMA foreign_keys = ON;');
  }

  return { tablesCleared: tables.length, rowsDeleted };
}

/**
 * Send the user back through onboarding without discarding anything.
 *
 * Clears the completion flag and the goal history, so the questions run again
 * and produce fresh targets, but every logged meal and weigh-in survives. This
 * is the one to reach for when the answers were wrong, not the data.
 */
export function restartOnboarding(userId: string): void {
  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync('UPDATE users SET onboarded_at = NULL WHERE id = ?', [userId]);
    sqlite.runSync('DELETE FROM user_goals WHERE user_id = ?', [userId]);
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}
