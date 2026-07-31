/**
 * Saved meals — "my usual breakfast", logged in one tap.
 *
 * The reason this exists, stated plainly: roughly three quarters of people who
 * abandon a food diary say it was too time-consuming, and the time goes on
 * re-entering meals they have entered many times before. Frequent foods and
 * copy-day each cover part of that, but neither captures a *combination*. This
 * does, and it is the cheapest large reduction in logging time the app can make.
 *
 * Items hold nutrients **per 100 g** plus a portion, rather than the eaten
 * vector that `journal_entry_items` stores. A saved meal is a template, not a
 * record, so logging one is a straight hand-off to `logMeal` — no conversion,
 * and therefore no conversion to get wrong.
 */

import type { FoodSource, MealSlot, NutrientVector } from '@daylish/core';
import { nutrientsForGrams, scaleNutrients, sumNutrients } from '@daylish/core';

import { sqlite } from '@/db/client.ts';
import { nowIso } from '@/lib/dates.ts';
import { newId } from '@/lib/ids.ts';
import { getDayEntries, logMeal } from '@/data/journal.ts';


/** Queue a row for the sync worker. Must be called inside the caller's transaction. */
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

export interface SavedMealItemInput {
  readonly foodItemId: string | null;
  readonly displayName: string;
  readonly grams: number;
  readonly portionLabel?: string | null;
  /** Per 100 g. */
  readonly per100g: NutrientVector;
  readonly source: FoodSource;
  readonly confidence: number;
}

export interface SavedMealSummary {
  readonly id: string;
  readonly name: string;
  readonly mealSlot: MealSlot | null;
  readonly useCount: number;
  readonly itemCount: number;
  /** Totals for the whole meal at its saved portions. */
  readonly energyKcal: number;
  readonly proteinG: number;
}

export interface SavedMealDetail extends SavedMealSummary {
  readonly items: readonly (SavedMealItemInput & { id: string })[];
}

/**
 * Create a saved meal from a set of foods.
 *
 * Rejects an empty meal rather than storing one: a saved meal with nothing in it
 * would log nothing, and would sit in the list looking like a bug.
 */
export function createSavedMeal(input: {
  userId: string;
  name: string;
  mealSlot?: MealSlot | null;
  items: readonly SavedMealItemInput[];
}): string {
  const name = input.name.trim();
  if (name.length === 0) throw new RangeError('createSavedMeal: name must not be empty');
  if (input.items.length === 0) throw new RangeError('createSavedMeal: a meal needs at least one food');

  const id = newId();
  const timestamp = nowIso();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `INSERT INTO saved_meals (id, user_id, name, meal_slot, use_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [id, input.userId, name, input.mealSlot ?? null, timestamp, timestamp],
    );
    enqueue('saved_meals', id, 'insert', { id, user_id: input.userId, name });

    input.items.forEach((item, index) => {
      const itemId = newId();
      sqlite.runSync(
        `INSERT INTO saved_meal_items
           (id, saved_meal_id, food_item_id, display_name, grams, portion_label, nutrients,
            confidence, source, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          id,
          item.foodItemId,
          item.displayName,
          item.grams,
          item.portionLabel ?? null,
          JSON.stringify(item.per100g),
          item.confidence,
          item.source,
          index,
          timestamp,
          timestamp,
        ],
      );
      enqueue('saved_meal_items', itemId, 'insert', { id: itemId, saved_meal_id: id });
    });

    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }

  return id;
}

/**
 * Save a meal already in the journal.
 *
 * This is the path people will actually use — you log breakfast, decide you eat
 * it every weekday, and keep it. The stored vectors are for the amount eaten, so
 * they are converted back to a per-100 g basis here, the same round trip
 * `copyDay` makes.
 */
export function saveMealFromEntry(userId: string, entryId: string, name: string): string {
  const row = sqlite.getFirstSync<{ local_date: string; meal_slot: MealSlot }>(
    'SELECT local_date, meal_slot FROM journal_entries WHERE id = ? AND deleted_at IS NULL',
    [entryId],
  );
  if (!row) throw new Error(`saveMealFromEntry: no such entry ${entryId}`);

  const entry = getDayEntries(userId, row.local_date).find((e) => e.id === entryId);
  if (!entry) throw new Error(`saveMealFromEntry: entry ${entryId} is not this user's`);

  return createSavedMeal({
    userId,
    name,
    mealSlot: entry.mealSlot,
    items: entry.items.map((item) => ({
      foodItemId: null,
      displayName: item.displayName,
      grams: item.grams,
      portionLabel: item.portionLabel,
      // Stored per portion; a template holds the per-100 g basis. Same round
      // trip `copyDay` makes, and the same factor of 100 to get wrong.
      per100g: item.grams > 0 ? scaleNutrients(item.nutrients, 100 / item.grams) : item.nutrients,
      source: item.source,
      confidence: item.confidence,
    })),
  });
}

/** Saved meals, most-used first. Ties break on most recently used. */
export function listSavedMeals(userId: string, mealSlot?: MealSlot): SavedMealSummary[] {
  const meals = sqlite.getAllSync<{
    id: string;
    name: string;
    meal_slot: MealSlot | null;
    use_count: number;
  }>(
    `SELECT id, name, meal_slot, use_count
       FROM saved_meals
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY ${mealSlot ? '(meal_slot = ?) DESC,' : ''} use_count DESC, last_used_at DESC, created_at DESC`,
    mealSlot ? [userId, mealSlot] : [userId],
  );

  if (meals.length === 0) return [];

  const placeholders = meals.map(() => '?').join(',');
  const items = sqlite.getAllSync<{
    saved_meal_id: string;
    grams: number;
    nutrients: string;
  }>(
    `SELECT saved_meal_id, grams, nutrients FROM saved_meal_items
      WHERE saved_meal_id IN (${placeholders}) AND deleted_at IS NULL`,
    meals.map((m) => m.id),
  );

  const byMeal = new Map<string, { count: number; vectors: NutrientVector[] }>();
  for (const item of items) {
    const scaled = nutrientsForGrams(JSON.parse(item.nutrients) as NutrientVector, item.grams);
    const bucket = byMeal.get(item.saved_meal_id) ?? { count: 0, vectors: [] };
    bucket.count += 1;
    bucket.vectors.push(scaled);
    byMeal.set(item.saved_meal_id, bucket);
  }

  return meals.map((meal) => {
    const bucket = byMeal.get(meal.id) ?? { count: 0, vectors: [] };
    const totals = sumNutrients(bucket.vectors).totals;
    return {
      id: meal.id,
      name: meal.name,
      mealSlot: meal.meal_slot,
      useCount: meal.use_count,
      itemCount: bucket.count,
      energyKcal: totals.energyKcal ?? 0,
      proteinG: totals.proteinG ?? 0,
    };
  });
}

export function getSavedMeal(savedMealId: string): SavedMealDetail | null {
  const meal = sqlite.getFirstSync<{
    id: string;
    name: string;
    meal_slot: MealSlot | null;
    use_count: number;
  }>(
    'SELECT id, name, meal_slot, use_count FROM saved_meals WHERE id = ? AND deleted_at IS NULL',
    [savedMealId],
  );
  if (!meal) return null;

  const rows = sqlite.getAllSync<{
    id: string;
    food_item_id: string | null;
    display_name: string;
    grams: number;
    portion_label: string | null;
    nutrients: string;
    confidence: number;
    source: FoodSource;
  }>(
    `SELECT id, food_item_id, display_name, grams, portion_label, nutrients, confidence, source
       FROM saved_meal_items
      WHERE saved_meal_id = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC`,
    [savedMealId],
  );

  const items = rows.map((row) => ({
    id: row.id,
    foodItemId: row.food_item_id,
    displayName: row.display_name,
    grams: row.grams,
    portionLabel: row.portion_label,
    per100g: JSON.parse(row.nutrients) as NutrientVector,
    source: row.source,
    confidence: row.confidence,
  }));

  const totals = sumNutrients(items.map((i) => nutrientsForGrams(i.per100g, i.grams))).totals;

  return {
    id: meal.id,
    name: meal.name,
    mealSlot: meal.meal_slot,
    useCount: meal.use_count,
    itemCount: items.length,
    energyKcal: totals.energyKcal ?? 0,
    proteinG: totals.proteinG ?? 0,
    items,
  };
}

/**
 * Log a saved meal into the journal.
 *
 * Writes a normal journal entry — nothing downstream needs to know the foods
 * came from a template, so the ring, the ribbon, Ideas and the export all keep
 * working without a special case.
 */
export function logSavedMeal(
  userId: string,
  savedMealId: string,
  options: { mealSlot?: MealSlot; loggedAt?: Date } = {},
): string {
  const meal = getSavedMeal(savedMealId);
  if (!meal) throw new Error(`logSavedMeal: no such saved meal ${savedMealId}`);

  const entryId = logMeal({
    userId,
    mealSlot: options.mealSlot ?? meal.mealSlot ?? 'snack',
    logMethod: 'saved_meal',
    loggedAt: options.loggedAt,
    items: meal.items.map((item) => ({
      foodItemId: item.foodItemId,
      displayName: item.displayName,
      grams: item.grams,
      portionLabel: item.portionLabel,
      per100g: item.per100g,
      source: item.source,
      confidence: item.confidence,
    })),
  });

  const timestamp = nowIso();
  sqlite.runSync(
    'UPDATE saved_meals SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?',
    [timestamp, timestamp, savedMealId],
  );

  return entryId;
}

/** Soft-delete a saved meal. Meals already logged from it are untouched. */
export function deleteSavedMeal(savedMealId: string): void {
  const timestamp = nowIso();
  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync('UPDATE saved_meals SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      timestamp,
      timestamp,
      savedMealId,
    ]);
    sqlite.runSync(
      'UPDATE saved_meal_items SET deleted_at = ?, updated_at = ? WHERE saved_meal_id = ?',
      [timestamp, timestamp, savedMealId],
    );
    enqueue('saved_meals', savedMealId, 'delete', { id: savedMealId, deleted_at: timestamp });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}
