/**
 * What a person has done with a recipe: saved it, or cooked it.
 *
 * The library is 496 dishes and the Meals screen can now narrow it a dozen
 * ways. Both of those make finding the right dish easy and finding it *again*
 * hard — a browse funnel with no way to keep what you found sends people back
 * through the same filters every week. This is the bookmark at the end of it.
 *
 * Two kinds, stored in one table because they are the same fact about the same
 * pair — this person, that recipe — and separating them would mean two queries
 * everywhere both are wanted:
 *
 *   `saved`   at most one live row per pair. A toggle, soft-deleted when turned
 *             off so the sync layer sees the removal rather than a gap.
 *   `cooked`  one row per cook, appended and never removed. That makes it a
 *             history rather than a flag, which is what lets "you cooked this
 *             three times" and the affinity signal in Ideas both come from it.
 *
 * Nothing here writes nutrition. Cooking a recipe logs a meal through
 * `logRecipeAsMeal`; this only records that it happened.
 */

import { sqlite } from '@/db/client.ts';
import { nowIso } from '@/lib/dates.ts';
import { newId } from '@/lib/ids.ts';

export type RecipeInteractionKind = 'saved' | 'cooked';


/** Queue a row for the sync worker. Mirrors the helper in the other repositories. */
function enqueue(
  tableName: string,
  rowId: string,
  operation: 'insert' | 'update' | 'delete',
  payload: Record<string, unknown>,
) {
  sqlite.runSync(
    `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, queued_at, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [newId(), tableName, rowId, operation, JSON.stringify(payload), nowIso()],
  );
}

export function isRecipeSaved(userId: string, recipeId: string): boolean {
  const row = sqlite.getFirstSync<{ id: string }>(
    `SELECT id FROM recipe_interactions
      WHERE user_id = ? AND recipe_id = ? AND kind = 'saved' AND deleted_at IS NULL
      LIMIT 1`,
    [userId, recipeId],
  );
  return row !== null && row !== undefined;
}

/**
 * Turn saving on or off, returning the state it ended in.
 *
 * Returning the new state rather than nothing keeps the caller from having to
 * re-read to find out what its own tap did, which is the kind of round trip that
 * makes a toggle feel late.
 */
export function toggleRecipeSaved(userId: string, recipeId: string): boolean {
  const timestamp = nowIso();

  const existing = sqlite.getFirstSync<{ id: string }>(
    `SELECT id FROM recipe_interactions
      WHERE user_id = ? AND recipe_id = ? AND kind = 'saved' AND deleted_at IS NULL
      LIMIT 1`,
    [userId, recipeId],
  );

  if (existing) {
    sqlite.execSync('BEGIN');
    try {
      sqlite.runSync(
        'UPDATE recipe_interactions SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [timestamp, timestamp, existing.id],
      );
      enqueue('recipe_interactions', existing.id, 'delete', {
        id: existing.id,
        deleted_at: timestamp,
      });
      sqlite.execSync('COMMIT');
    } catch (error) {
      sqlite.execSync('ROLLBACK');
      throw error;
    }
    return false;
  }

  const id = newId();
  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `INSERT INTO recipe_interactions (id, user_id, recipe_id, kind, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, 'saved', ?, ?, ?)`,
      [id, userId, recipeId, timestamp, timestamp, timestamp],
    );
    enqueue('recipe_interactions', id, 'insert', {
      id,
      user_id: userId,
      recipe_id: recipeId,
      kind: 'saved',
    });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
  return true;
}

/** Every saved recipe id. The Meals filter turns this into a list of dishes. */
export function listSavedRecipeIds(userId: string): string[] {
  return sqlite
    .getAllSync<{ recipe_id: string }>(
      `SELECT recipe_id FROM recipe_interactions
        WHERE user_id = ? AND kind = 'saved' AND deleted_at IS NULL
        ORDER BY occurred_at DESC`,
      [userId],
    )
    .map((row) => row.recipe_id);
}

/**
 * Record that a recipe was actually cooked.
 *
 * Appended rather than upserted, so cooking the same thing weekly builds a
 * count instead of overwriting a date. Called from the log path, because
 * logging a recipe is the only evidence the app has that anyone cooked it.
 */
export function recordRecipeCooked(userId: string, recipeId: string): void {
  const id = newId();
  const timestamp = nowIso();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `INSERT INTO recipe_interactions (id, user_id, recipe_id, kind, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, 'cooked', ?, ?, ?)`,
      [id, userId, recipeId, timestamp, timestamp, timestamp],
    );
    enqueue('recipe_interactions', id, 'insert', {
      id,
      user_id: userId,
      recipe_id: recipeId,
      kind: 'cooked',
    });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

/** How many times each recipe has been cooked. Empty when nothing has been. */
export function recipeCookCounts(userId: string): Record<string, number> {
  const rows = sqlite.getAllSync<{ recipe_id: string; uses: number }>(
    `SELECT recipe_id, COUNT(*) AS uses FROM recipe_interactions
      WHERE user_id = ? AND kind = 'cooked' AND deleted_at IS NULL
      GROUP BY recipe_id`,
    [userId],
  );

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.recipe_id] = row.uses;
  return counts;
}

/**
 * Saving is an intention; cooking is a habit.
 *
 * So one cook must outweigh one save, and it is worth saying in constants
 * rather than leaving it to two literals several lines apart — the first
 * version of this had them the wrong way round and read perfectly well.
 */
const SAVED_WEIGHT = 0.25;
const COOKED_WEIGHT = 0.4;

/**
 * The affinity signal Ideas ranks with, on the 0–1 scale `rankRecipes` expects.
 *
 * Cooking something repeatedly should keep raising it without ever running away
 * with the ranking, so the total is capped rather than allowed to compound.
 */
export function recipeAffinity(userId: string): Record<string, number> {
  const affinity: Record<string, number> = {};

  for (const recipeId of listSavedRecipeIds(userId)) {
    affinity[recipeId] = SAVED_WEIGHT;
  }

  for (const [recipeId, uses] of Object.entries(recipeCookCounts(userId))) {
    affinity[recipeId] = Math.min(1, (affinity[recipeId] ?? 0) + COOKED_WEIGHT * uses);
  }

  return affinity;
}
