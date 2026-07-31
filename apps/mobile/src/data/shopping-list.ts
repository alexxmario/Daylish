/**
 * The shopping list.
 *
 * Holds recipes; the lines you read in the shop are computed on every read by
 * {@link buildShoppingList} in `@daylish/core`. That keeps the two impossible to
 * disagree — there is no stored copy of a line to go stale when you change the
 * portions or drop a recipe.
 *
 * Reading the whole list means loading every ingredient of every recipe on it.
 * At the handful of recipes a week's cooking involves that is a few dozen rows,
 * and it buys a list that is always right.
 */

import {
  buildShoppingList,
  shoppingItemKey,
  type ShoppingLine,
  type ShoppingSource,
} from '@daylish/core';

import { sqlite } from '@/db/client.ts';
import { nowIso } from '@/lib/dates.ts';
import { newId } from '@/lib/ids.ts';


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

/** Thrown when a free account tries to put a second recipe on the list. */
export class ShoppingListLimitError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(
      limit === 1
        ? 'A free shopping list holds one recipe at a time.'
        : `A free shopping list holds ${limit} recipes at a time.`,
    );
    this.name = 'ShoppingListLimitError';
    this.limit = limit;
  }
}

export interface ShoppingListRecipe {
  readonly id: string;
  readonly recipeId: string;
  readonly title: string;
  /** Portions to cook. */
  readonly servings: number;
  /** What the recipe as written yields, for the portion stepper's baseline. */
  readonly recipeServings: number;
}

export interface ShoppingList {
  readonly recipes: readonly ShoppingListRecipe[];
  readonly lines: readonly (ShoppingLine & { readonly checked: boolean })[];
  /** Lines still to buy. The number worth putting on a badge. */
  readonly remaining: number;
}

/** The recipes on the list, oldest first — the order they were added in. */
export function listShoppingRecipes(userId: string): ShoppingListRecipe[] {
  return sqlite
    .getAllSync<{
      id: string;
      recipe_id: string;
      title: string;
      servings: number;
      recipe_servings: number;
    }>(
      `SELECT s.id, s.recipe_id, s.servings, r.title, r.servings AS recipe_servings
         FROM shopping_list_recipes s
         JOIN recipes r ON r.id = s.recipe_id
        WHERE s.user_id = ? AND s.deleted_at IS NULL
        ORDER BY s.created_at ASC`,
      [userId],
    )
    .map((row) => ({
      id: row.id,
      recipeId: row.recipe_id,
      title: row.title,
      servings: row.servings,
      recipeServings: row.recipe_servings,
    }));
}

/** Whether a recipe is already on the list, for the button's state. */
export function isOnShoppingList(userId: string, recipeId: string): boolean {
  const row = sqlite.getFirstSync<{ id: string }>(
    `SELECT id FROM shopping_list_recipes
      WHERE user_id = ? AND recipe_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [userId, recipeId],
  );
  return row !== null && row !== undefined;
}

/**
 * Put a recipe on the list, or change how many portions of it you want.
 *
 * Adding something already on the list updates the portions rather than
 * creating a second entry — "add" from a recipe screen means "I am cooking
 * this", and cooking it for six after saying four is a correction, not a second
 * dinner.
 */
export function addToShoppingList(
  userId: string,
  recipeId: string,
  servings: number,
  options: { readonly maxRecipes?: number | null } = {},
): void {
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new RangeError(`addToShoppingList: servings must be > 0, got ${servings}`);
  }

  const timestamp = nowIso();
  const existing = sqlite.getFirstSync<{ id: string }>(
    `SELECT id FROM shopping_list_recipes
      WHERE user_id = ? AND recipe_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [userId, recipeId],
  );

  /*
    The limit is checked here rather than only in the UI.

    Combining several recipes into one list is the paid part — a single recipe's
    ingredients are already on its own screen, so one at a time is genuinely
    useful and genuinely not the feature. Enforcing it in the repository means
    every path that adds a recipe is covered by the same rule, including ones
    written later by someone who has forgotten there is one.

    Changing the portions of a recipe already on the list is always allowed: it
    is a correction to something they have, not a new addition.
  */
  const { maxRecipes = null } = options;
  if (!existing && maxRecipes !== null) {
    const count = listShoppingRecipes(userId).length;
    if (count >= maxRecipes) {
      throw new ShoppingListLimitError(maxRecipes);
    }
  }

  sqlite.execSync('BEGIN');
  try {
    if (existing) {
      sqlite.runSync(
        'UPDATE shopping_list_recipes SET servings = ?, updated_at = ? WHERE id = ?',
        [servings, timestamp, existing.id],
      );
      enqueue('shopping_list_recipes', existing.id, 'update', { id: existing.id, servings });
    } else {
      const id = newId();
      sqlite.runSync(
        `INSERT INTO shopping_list_recipes (id, user_id, recipe_id, servings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, userId, recipeId, servings, timestamp, timestamp],
      );
      enqueue('shopping_list_recipes', id, 'insert', {
        id,
        user_id: userId,
        recipe_id: recipeId,
        servings,
      });
    }
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

/**
 * Take a recipe off the list.
 *
 * Ticked-off items are deliberately left alone. Removing one recipe of four
 * does not un-buy the garlic, and clearing the ticks would make the shopper
 * walk the aisles again for things already in the basket.
 */
export function removeFromShoppingList(userId: string, recipeId: string): void {
  const timestamp = nowIso();
  const rows = sqlite.getAllSync<{ id: string }>(
    `SELECT id FROM shopping_list_recipes
      WHERE user_id = ? AND recipe_id = ? AND deleted_at IS NULL`,
    [userId, recipeId],
  );
  if (rows.length === 0) return;

  sqlite.execSync('BEGIN');
  try {
    for (const row of rows) {
      sqlite.runSync(
        'UPDATE shopping_list_recipes SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [timestamp, timestamp, row.id],
      );
      enqueue('shopping_list_recipes', row.id, 'delete', { id: row.id, deleted_at: timestamp });
    }
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

/** Tick an item off, or put it back. Returns the state it ended in. */
export function toggleShoppingItem(userId: string, itemKey: string): boolean {
  const key = shoppingItemKey(itemKey);
  const timestamp = nowIso();

  const existing = sqlite.getFirstSync<{ id: string }>(
    `SELECT id FROM shopping_list_checks
      WHERE user_id = ? AND item_key = ? AND deleted_at IS NULL
      LIMIT 1`,
    [userId, key],
  );

  sqlite.execSync('BEGIN');
  try {
    if (existing) {
      sqlite.runSync(
        'UPDATE shopping_list_checks SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [timestamp, timestamp, existing.id],
      );
      enqueue('shopping_list_checks', existing.id, 'delete', {
        id: existing.id,
        deleted_at: timestamp,
      });
      sqlite.execSync('COMMIT');
      return false;
    }

    const id = newId();
    sqlite.runSync(
      `INSERT INTO shopping_list_checks (id, user_id, item_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, key, timestamp, timestamp],
    );
    enqueue('shopping_list_checks', id, 'insert', { id, user_id: userId, item_key: key });
    sqlite.execSync('COMMIT');
    return true;
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

/** Everything on the list, with the ingredients combined and ticks applied. */
export function getShoppingList(userId: string): ShoppingList {
  const recipes = listShoppingRecipes(userId);
  if (recipes.length === 0) return { recipes: [], lines: [], remaining: 0 };

  const placeholders = recipes.map(() => '?').join(', ');
  const ingredients = sqlite.getAllSync<{
    recipe_id: string;
    name: string;
    grams: number;
    display_quantity: string;
    optional: number;
  }>(
    `SELECT recipe_id, name, grams, display_quantity, optional
       FROM recipe_ingredients
      WHERE recipe_id IN (${placeholders})
      ORDER BY sort_order ASC`,
    recipes.map((r) => r.recipeId),
  );

  const byRecipe = new Map<string, ShoppingSource['ingredients'][number][]>();
  for (const row of ingredients) {
    const list = byRecipe.get(row.recipe_id) ?? [];
    list.push({
      name: row.name,
      grams: row.grams,
      displayQuantity: row.display_quantity,
      optional: row.optional === 1,
    });
    byRecipe.set(row.recipe_id, list);
  }

  const lines = buildShoppingList(
    recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      title: recipe.title,
      servings: recipe.servings,
      recipeServings: recipe.recipeServings,
      ingredients: byRecipe.get(recipe.recipeId) ?? [],
    })),
  );

  const checked = new Set(
    sqlite
      .getAllSync<{ item_key: string }>(
        `SELECT item_key FROM shopping_list_checks
          WHERE user_id = ? AND deleted_at IS NULL`,
        [userId],
      )
      .map((row) => row.item_key),
  );

  const withChecks = lines.map((line) => ({ ...line, checked: checked.has(line.key) }));

  return {
    recipes,
    lines: withChecks,
    remaining: withChecks.filter((line) => !line.checked).length,
  };
}

/**
 * Empty the list once the shopping is done.
 *
 * Clears the ticks as well as the recipes. A half-ticked list left over from
 * last week is worse than no list — you cannot tell which ticks were this trip.
 */
export function clearShoppingList(userId: string): void {
  const timestamp = nowIso();

  sqlite.execSync('BEGIN');
  try {
    for (const table of ['shopping_list_recipes', 'shopping_list_checks']) {
      const rows = sqlite.getAllSync<{ id: string }>(
        `SELECT id FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`,
        [userId],
      );
      for (const row of rows) {
        sqlite.runSync(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
          timestamp,
          timestamp,
          row.id,
        ]);
        enqueue(table, row.id, 'delete', { id: row.id, deleted_at: timestamp });
      }
    }
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}
