/**
 * Journal repository.
 *
 * The only module that writes journal rows. Two invariants it owns:
 *
 *   - Nutrients are written through `withNutrients`, so the denormalised macro
 *     columns and the JSON vector never disagree.
 *   - Every mutation enqueues a `sync_outbox` row in the *same* transaction as
 *     the write, so a crash cannot leave a saved-but-never-synced entry.
 */

import {
  nutrientsForGrams,
  scaleNutrients,
  sumNutrients,
  type FoodSource,
  type LogMethod,
  type MealSlot,
  type NutrientVector,
} from '@daylish/core';
import { withNutrients } from '@daylish/db';

import { sqlite } from '@/db/client.ts';
import { nowIso, toLocalDate } from '@/lib/dates.ts';
import { newId } from '@/lib/ids.ts';


/** Queue a row for the sync worker. Must be called inside the caller's transaction. */
function enqueue(tableName: string, rowId: string, operation: 'insert' | 'update' | 'delete', payload: Record<string, unknown>) {
  sqlite.runSync(
    `INSERT INTO sync_outbox (id, table_name, row_id, operation, payload, queued_at, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [newId(), tableName, rowId, operation, JSON.stringify(payload), nowIso()],
  );
}

export interface LoggedItemInput {
  /** Null for a quick-add, where the user typed macros directly. */
  foodItemId: string | null;
  recipeId?: string | null;
  displayName: string;
  grams: number;
  portionLabel?: string | null;
  portionCount?: number | null;
  /** Per 100 g. Scaled to `grams` here so callers cannot forget. */
  per100g: NutrientVector;
  source: FoodSource;
  confidence: number;
}

export interface LogMealInput {
  userId: string;
  mealSlot: MealSlot;
  logMethod: LogMethod;
  items: readonly LoggedItemInput[];
  note?: string | null;
  loggedAt?: Date;
}

/**
 * Write a meal and its items.
 *
 * Returns the new entry id. The whole thing is one transaction: either the
 * entry, all its items and all the outbox rows land, or none of them do.
 */
export function logMeal(input: LogMealInput): string {
  const instant = input.loggedAt ?? new Date();
  const entryId = newId();
  const loggedAt = instant.toISOString();
  const localDate = toLocalDate(instant);
  const timestamp = nowIso();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `INSERT INTO journal_entries
         (id, user_id, logged_at, local_date, meal_slot, log_method, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entryId, input.userId, loggedAt, localDate, input.mealSlot, input.logMethod, input.note ?? null, timestamp, timestamp],
    );
    enqueue('journal_entries', entryId, 'insert', {
      id: entryId,
      user_id: input.userId,
      logged_at: loggedAt,
      local_date: localDate,
      meal_slot: input.mealSlot,
      log_method: input.logMethod,
    });

    input.items.forEach((item, index) => {
      const itemId = newId();
      // Scale from per-100g here — callers pass the food's stored vector, never
      // a pre-scaled one, so the conversion happens in exactly one place.
      const nutrients = nutrientsForGrams(item.per100g, item.grams);
      const columns = withNutrients(nutrients);

      sqlite.runSync(
        `INSERT INTO journal_entry_items
           (id, entry_id, food_item_id, recipe_id, display_name, grams, portion_label, portion_count,
            nutrients, energy_kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
            confidence, source, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          entryId,
          item.foodItemId,
          item.recipeId ?? null,
          item.displayName,
          item.grams,
          item.portionLabel ?? null,
          item.portionCount ?? null,
          JSON.stringify(nutrients),
          columns.energyKcal,
          columns.proteinG,
          columns.carbsG,
          columns.fatG,
          columns.fiberG,
          columns.sugarG,
          columns.satFatG,
          columns.sodiumMg,
          item.confidence,
          item.source,
          index,
          timestamp,
          timestamp,
        ],
      );
      enqueue('journal_entry_items', itemId, 'insert', { id: itemId, entry_id: entryId });
    });

    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }

  return entryId;
}

export interface DayEntryItem {
  id: string;
  displayName: string;
  grams: number;
  portionLabel: string | null;
  nutrients: NutrientVector;
  source: FoodSource;
  confidence: number;
}

export interface DayEntry {
  id: string;
  loggedAt: string;
  mealSlot: MealSlot;
  logMethod: LogMethod;
  note: string | null;
  items: DayEntryItem[];
  totals: NutrientVector;
}

export interface DayTotals {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

/**
 * A day's totals in one indexed aggregate.
 *
 * This is why the macro columns are denormalised — the ring re-reads on every
 * write, so it must not deserialise a JSON blob per row to do it.
 */
export function getDayTotals(userId: string, localDate: string): DayTotals {
  const row = sqlite.getFirstSync<{
    kcal: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
  }>(
    `SELECT
       SUM(i.energy_kcal) AS kcal,
       SUM(i.protein_g)   AS protein,
       SUM(i.carbs_g)     AS carbs,
       SUM(i.fat_g)       AS fat,
       SUM(i.fiber_g)     AS fiber
     FROM journal_entry_items i
     JOIN journal_entries e ON e.id = i.entry_id
     WHERE e.user_id = ? AND e.local_date = ? AND e.deleted_at IS NULL AND i.deleted_at IS NULL`,
    [userId, localDate],
  );

  return {
    energyKcal: row?.kcal ?? 0,
    proteinG: row?.protein ?? 0,
    carbsG: row?.carbs ?? 0,
    fatG: row?.fat ?? 0,
    fiberG: row?.fiber ?? 0,
  };
}

/** Every entry for a day, newest last, with its items attached. */
export function getDayEntries(userId: string, localDate: string): DayEntry[] {
  const entries = sqlite.getAllSync<{
    id: string;
    logged_at: string;
    meal_slot: MealSlot;
    log_method: LogMethod;
    note: string | null;
  }>(
    `SELECT id, logged_at, meal_slot, log_method, note
     FROM journal_entries
     WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL
     ORDER BY logged_at ASC`,
    [userId, localDate],
  );

  if (entries.length === 0) return [];

  const placeholders = entries.map(() => '?').join(',');
  const items = sqlite.getAllSync<{
    id: string;
    entry_id: string;
    display_name: string;
    grams: number;
    portion_label: string | null;
    nutrients: string;
    source: FoodSource;
    confidence: number;
  }>(
    `SELECT id, entry_id, display_name, grams, portion_label, nutrients, source, confidence
     FROM journal_entry_items
     WHERE entry_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY sort_order ASC`,
    entries.map((e) => e.id),
  );

  const byEntry = new Map<string, DayEntryItem[]>();
  for (const item of items) {
    const parsed: DayEntryItem = {
      id: item.id,
      displayName: item.display_name,
      grams: item.grams,
      portionLabel: item.portion_label,
      nutrients: JSON.parse(item.nutrients) as NutrientVector,
      source: item.source,
      confidence: item.confidence,
    };
    const list = byEntry.get(item.entry_id);
    if (list) list.push(parsed);
    else byEntry.set(item.entry_id, [parsed]);
  }

  return entries.map((entry) => {
    const entryItems = byEntry.get(entry.id) ?? [];
    return {
      id: entry.id,
      loggedAt: entry.logged_at,
      mealSlot: entry.meal_slot,
      logMethod: entry.log_method,
      note: entry.note,
      items: entryItems,
      totals: sumNutrients(entryItems.map((i) => i.nutrients)).totals,
    };
  });
}

export interface EditableItem {
  readonly id: string;
  readonly entryId: string;
  readonly displayName: string;
  readonly grams: number;
  readonly portionLabel: string | null;
  /** Per 100 g, so a new portion can be costed without re-fetching the food. */
  readonly per100g: NutrientVector;
  readonly source: FoodSource;
  readonly confidence: number;
  readonly mealSlot: MealSlot;
  readonly loggedAt: string;
  /** True when this is the only item left on its entry. */
  readonly isOnlyItem: boolean;
}

/** One logged item, with enough context for the edit screen to re-cost it. */
export function getEntryItem(itemId: string): EditableItem | null {
  const row = sqlite.getFirstSync<{
    id: string;
    entry_id: string;
    display_name: string;
    grams: number;
    portion_label: string | null;
    nutrients: string;
    source: FoodSource;
    confidence: number;
    meal_slot: MealSlot;
    logged_at: string;
    sibling_count: number;
  }>(
    `SELECT i.id, i.entry_id, i.display_name, i.grams, i.portion_label, i.nutrients,
            i.source, i.confidence, e.meal_slot, e.logged_at,
            (SELECT COUNT(*) FROM journal_entry_items s
              WHERE s.entry_id = i.entry_id AND s.deleted_at IS NULL) AS sibling_count
     FROM journal_entry_items i
     JOIN journal_entries e ON e.id = i.entry_id
     WHERE i.id = ? AND i.deleted_at IS NULL AND e.deleted_at IS NULL`,
    [itemId],
  );

  if (!row || row.grams <= 0) return null;

  return {
    id: row.id,
    entryId: row.entry_id,
    displayName: row.display_name,
    grams: row.grams,
    portionLabel: row.portion_label,
    // Stored for the amount eaten; the editor re-scales from a per-100 g basis.
    per100g: scaleNutrients(JSON.parse(row.nutrients) as NutrientVector, 100 / row.grams),
    source: row.source,
    confidence: row.confidence,
    mealSlot: row.meal_slot,
    loggedAt: row.logged_at,
    isOnlyItem: row.sibling_count <= 1,
  };
}

/**
 * Correct the portion on a logged item.
 *
 * The most common correction there is, and until now the only way to make it was
 * to delete the entry and log it again — which loses the original time and, on a
 * multi-item meal, the rest of the meal with it.
 *
 * Nutrition is recomputed from the per-100 g basis rather than scaled from the
 * current values, so repeated edits cannot drift: going 150 → 200 → 150 lands
 * back on exactly the original numbers.
 */
export function updateEntryItemGrams(itemId: string, grams: number): void {
  if (!Number.isFinite(grams) || grams <= 0) {
    throw new RangeError(`updateEntryItemGrams: grams must be > 0, got ${grams}`);
  }

  const current = getEntryItem(itemId);
  if (!current) throw new Error(`updateEntryItemGrams: no such item ${itemId}`);

  const nutrients = nutrientsForGrams(current.per100g, grams);
  const columns = withNutrients(nutrients);
  const timestamp = nowIso();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `UPDATE journal_entry_items
          SET grams = ?, nutrients = ?, energy_kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
              fiber_g = ?, sugar_g = ?, sat_fat_g = ?, sodium_mg = ?, updated_at = ?
        WHERE id = ?`,
      [
        grams,
        JSON.stringify(nutrients),
        columns.energyKcal,
        columns.proteinG,
        columns.carbsG,
        columns.fatG,
        columns.fiberG,
        columns.sugarG,
        columns.satFatG,
        columns.sodiumMg,
        timestamp,
        itemId,
      ],
    );
    // The parent entry is touched too, so a sync peer sees the meal as changed
    // rather than having to infer it from a child row.
    sqlite.runSync('UPDATE journal_entries SET updated_at = ? WHERE id = ?', [
      timestamp,
      current.entryId,
    ]);
    enqueue('journal_entry_items', itemId, 'update', {
      id: itemId,
      entry_id: current.entryId,
      grams,
      updated_at: timestamp,
    });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

/**
 * Soft-delete a single item.
 *
 * Removing the last item would leave an entry with no food in it, which reads as
 * a bug on the journal, so that case removes the whole entry instead.
 */
export function deleteEntryItem(itemId: string): void {
  const current = getEntryItem(itemId);
  if (!current) return;

  if (current.isOnlyItem) {
    deleteEntry(current.entryId);
    return;
  }

  const timestamp = nowIso();
  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync('UPDATE journal_entry_items SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      timestamp,
      timestamp,
      itemId,
    ]);
    sqlite.runSync('UPDATE journal_entries SET updated_at = ? WHERE id = ?', [
      timestamp,
      current.entryId,
    ]);
    enqueue('journal_entry_items', itemId, 'delete', { id: itemId, deleted_at: timestamp });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

/** Soft-delete an entry and its items, so the deletion can sync. */
export function deleteEntry(entryId: string): void {
  const timestamp = nowIso();
  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync('UPDATE journal_entries SET deleted_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, entryId]);
    sqlite.runSync('UPDATE journal_entry_items SET deleted_at = ?, updated_at = ? WHERE entry_id = ?', [timestamp, timestamp, entryId]);
    enqueue('journal_entries', entryId, 'delete', { id: entryId, deleted_at: timestamp });
    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }
}

/**
 * Copy a previous day's meals onto a target date — the fastest logging path
 * there is for anyone who eats similarly day to day.
 */
export function copyDay(userId: string, fromDate: string, toDate: string): number {
  const source = getDayEntries(userId, fromDate);
  if (source.length === 0) return 0;

  const target = new Date(`${toDate}T12:00:00`);

  for (const entry of source) {
    const original = new Date(entry.loggedAt);
    const loggedAt = new Date(target);
    loggedAt.setHours(original.getHours(), original.getMinutes(), 0, 0);

    logMeal({
      userId,
      mealSlot: entry.mealSlot,
      logMethod: 'copy',
      loggedAt,
      items: entry.items.map((item) => ({
        foodItemId: null,
        displayName: item.displayName,
        grams: item.grams,
        portionLabel: item.portionLabel,
        // Stored vectors are for the amount eaten, but `logMeal` expects a
        // per-100 g basis and rescales it. Convert back by 100/grams.
        per100g: item.grams > 0 ? scaleNutrients(item.nutrients, 100 / item.grams) : item.nutrients,
        source: item.source,
        confidence: item.confidence,
      })),
    });
  }

  return source.length;
}

/** Recent and frequent foods, for the search screen's zero-state. */
export function getFrequentFoods(userId: string, limit = 12) {
  return sqlite.getAllSync<{
    display_name: string;
    food_item_id: string | null;
    grams: number;
    uses: number;
  }>(
    `SELECT i.display_name, i.food_item_id, i.grams, COUNT(*) AS uses
     FROM journal_entry_items i
     JOIN journal_entries e ON e.id = i.entry_id
     WHERE e.user_id = ? AND i.deleted_at IS NULL
     GROUP BY i.display_name, i.food_item_id
     ORDER BY uses DESC, MAX(e.logged_at) DESC
     LIMIT ?`,
    [userId, limit],
  );
}

/**
 * Which meal slots already have something in them today.
 *
 * Drives reminder scheduling: a notification for a meal that is already logged
 * is the fastest way to have someone switch notifications off for good.
 */
export function loggedSlotsToday(userId: string, localDate: string): MealSlot[] {
  const rows = sqlite.getAllSync<{ meal_slot: MealSlot }>(
    `SELECT DISTINCT meal_slot FROM journal_entries
      WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL`,
    [userId, localDate],
  );
  return rows.map((row) => row.meal_slot);
}

export interface FoodHistoryRow {
  readonly key: string;
  readonly displayName: string;
  readonly foodItemId: string | null;
  /** Per 100 g, recovered from the stored vector and the amount that was eaten. */
  readonly per100g: NutrientVector;
  readonly typicalGrams: number;
  readonly uses: number;
  readonly usesInSlot: number;
  readonly usesToday: number;
  readonly source: FoodSource;
  readonly confidence: number;
}

/**
 * Everything this person has eaten, aggregated per food, with enough nutrition
 * to rank it. This is what `rankFoods` consumes.
 *
 * The bare `i.nutrients`, `i.grams`, `i.source` and `i.confidence` columns are
 * taken from the most recently logged row of each group — SQLite guarantees that
 * bare columns come from the row matching a single `MAX()` in the same select,
 * which is why the aggregate is in the select list rather than only the ORDER BY.
 * That matters here: the vector and the grams it was computed for have to come
 * from the *same* row, or the per-100 g conversion below is wrong.
 */
export function getFoodHistory(
  userId: string,
  options: { mealSlot: MealSlot; localDate: string; limit?: number },
): FoodHistoryRow[] {
  const rows = sqlite.getAllSync<{
    display_name: string;
    food_item_id: string | null;
    nutrients: string;
    grams: number;
    source: FoodSource;
    confidence: number;
    avg_grams: number;
    uses: number;
    uses_in_slot: number;
    uses_today: number;
  }>(
    `SELECT
       i.display_name, i.food_item_id, i.nutrients, i.grams, i.source, i.confidence,
       AVG(i.grams) AS avg_grams,
       COUNT(*)     AS uses,
       SUM(CASE WHEN e.meal_slot  = ? THEN 1 ELSE 0 END) AS uses_in_slot,
       SUM(CASE WHEN e.local_date = ? THEN 1 ELSE 0 END) AS uses_today,
       MAX(e.logged_at) AS last_logged
     FROM journal_entry_items i
     JOIN journal_entries e ON e.id = i.entry_id
     WHERE e.user_id = ? AND e.deleted_at IS NULL AND i.deleted_at IS NULL AND i.grams > 0
     GROUP BY i.display_name, i.food_item_id
     ORDER BY uses DESC, last_logged DESC
     LIMIT ?`,
    [options.mealSlot, options.localDate, userId, options.limit ?? 40],
  );

  return rows.map((row) => ({
    key: `${row.display_name}::${row.food_item_id ?? ''}`,
    displayName: row.display_name,
    foodItemId: row.food_item_id,
    // Stored vectors are for the amount eaten; the ranker works per 100 g.
    per100g: scaleNutrients(JSON.parse(row.nutrients) as NutrientVector, 100 / row.grams),
    typicalGrams: Math.round(row.avg_grams),
    uses: row.uses,
    usesInSlot: row.uses_in_slot,
    usesToday: row.uses_today,
    source: row.source,
    confidence: row.confidence,
  }));
}

/**
 * Full nutrient totals for a day, including micronutrients.
 *
 * Separate from `getDayTotals`, which reads the denormalised macro columns for
 * speed. This one deserialises every item's vector, so it is only called when
 * the detailed panel is actually open — the ring must never pay for it.
 */
export function getDayNutrients(userId: string, localDate: string) {
  const rows = sqlite.getAllSync<{ nutrients: string }>(
    `SELECT i.nutrients
     FROM journal_entry_items i
     JOIN journal_entries e ON e.id = i.entry_id
     WHERE e.user_id = ? AND e.local_date = ? AND e.deleted_at IS NULL AND i.deleted_at IS NULL`,
    [userId, localDate],
  );
  return sumNutrients(rows.map((r) => JSON.parse(r.nutrients) as NutrientVector));
}
