/**
 * Data export.
 *
 * Daylish keeps everything on one device and has no account, which makes this
 * the only way a year of logs survives a lost phone. That makes it a safety
 * feature rather than a compliance checkbox, and it is why the export is
 * complete enough to reconstruct the diary rather than a summary of it.
 *
 * Deliberately free of native imports. Building the bundle is pure SQLite, so
 * the runtime smoke test can prove the payload is correct and complete; writing
 * it to disk and handing it to the share sheet is the screen's job.
 *
 * The rule for what belongs here: **anything the account deletion removes.** If
 * the app will destroy a table on request it should be able to hand it over on
 * request, and pairing the two lists is what stops the export quietly falling
 * behind the schema — saved meals were missing from both for exactly that
 * reason. See `USER_SCOPED_TABLES` in `account.ts`.
 *
 * What is not here, and why:
 *
 *   - The cached food and recipe libraries. That is public reference data,
 *     re-fetchable on demand, and including it would inflate the file by orders
 *     of magnitude with nothing personal in it. What a person *did* with a
 *     recipe — kept it, cooked it, put it on a list — is exported, by id and
 *     title, so it can be matched back to the library.
 *   - The weekly budget. No screen has ever collected it, so the column is
 *     always null; exporting it advertised a field that does not exist.
 *   - `sync_outbox` and `sync_state`. Internal plumbing for a queue that means
 *     nothing outside this install.
 *   - Progress photos. They have never been written to the database or left the
 *     device, so there is nothing to export.
 */

import type { NutrientVector } from '@daylish/core';

import { sqlite } from '@/db/client.ts';

/** Identifies the payload to anything reading it later, including a future importer. */
export const EXPORT_FORMAT = 'daylish.export';

/**
 * Bumped whenever the shape below changes in a way a reader must notice.
 *
 * 2 — added saved meals, kept recipes and the shopping list; dropped the weekly
 *     budget, which no screen ever collected and which was therefore always
 *     null.
 */
export const EXPORT_VERSION = 2;

export interface ExportCounts {
  readonly journalEntries: number;
  readonly loggedItems: number;
  readonly weighIns: number;
  readonly waterLogs: number;
  readonly fastingSessions: number;
  readonly moodEntries: number;
  readonly goals: number;
  readonly savedMeals: number;
  readonly keptRecipes: number;
}

export interface ExportBundle {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: typeof EXPORT_VERSION;
  readonly exportedAt: string;
  /** Totals the person can check against what the app shows them. */
  readonly counts: ExportCounts;
  readonly profile: Record<string, unknown> | null;
  readonly goals: readonly Record<string, unknown>[];
  readonly journal: readonly Record<string, unknown>[];
  readonly weighIns: readonly Record<string, unknown>[];
  readonly water: readonly Record<string, unknown>[];
  readonly fasting: readonly Record<string, unknown>[];
  readonly mood: readonly Record<string, unknown>[];
  /** "My usual breakfast" and the foods in it. */
  readonly savedMeals: readonly Record<string, unknown>[];
  /** Recipes saved or cooked, with the library's own id so they can be found again. */
  readonly keptRecipes: readonly Record<string, unknown>[];
  readonly shoppingList: readonly Record<string, unknown>[];
}

/** Parses a JSON column, falling back rather than failing the whole export. */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Gather everything belonging to one user.
 *
 * Columns are listed explicitly rather than selected with `*`: the export is a
 * format other software may read, so it should change when someone decides it
 * changes, not silently whenever a column is added to the schema.
 */
export function buildExport(userId: string, now: Date = new Date()): ExportBundle {
  const profileRow = sqlite.getFirstSync<Record<string, unknown>>(
    `SELECT id, email, display_name, sex, birth_date, height_cm, activity_level, cooking_skill,
            allergens, disliked_ingredients, equipment, currency,
            max_prep_minutes, detailed_nutrition, timezone, onboarded_at, created_at, updated_at
       FROM users WHERE id = ?`,
    [userId],
  );

  const profile = profileRow
    ? {
        ...profileRow,
        // Stored as JSON text; exported as real arrays so the file is not a
        // string containing a string.
        allergens: parseJson(profileRow.allergens as string | null, [] as unknown[]),
        disliked_ingredients: parseJson(profileRow.disliked_ingredients as string | null, [] as unknown[]),
        equipment: parseJson(profileRow.equipment as string | null, [] as unknown[]),
        detailed_nutrition: Boolean(profileRow.detailed_nutrition),
      }
    : null;

  const goals = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, effective_from, goal, diet_style, rate_kg_per_week, energy_kcal, protein_g,
            carbs_g, fat_g, fiber_g, estimated_expenditure_kcal, estimate_confidence, reason,
            created_at
       FROM user_goals WHERE user_id = ? ORDER BY effective_from ASC`,
    [userId],
  );

  const entries = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, logged_at, local_date, meal_slot, log_method, note, created_at
       FROM journal_entries
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY logged_at ASC`,
    [userId],
  );

  const items = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT i.id, i.entry_id, i.display_name, i.grams, i.portion_label, i.portion_count,
            i.nutrients, i.source, i.confidence, i.sort_order
       FROM journal_entry_items i
       JOIN journal_entries e ON e.id = i.entry_id
      WHERE e.user_id = ? AND e.deleted_at IS NULL AND i.deleted_at IS NULL
      ORDER BY i.sort_order ASC`,
    [userId],
  );

  const itemsByEntry = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const { entry_id: entryId, nutrients, ...rest } = item;
    const parsed = {
      ...rest,
      // The full vector, not just the macros — the point of the export is that
      // nothing is lost, including the micronutrients the app can already show.
      nutrients: parseJson(nutrients as string | null, {} as NutrientVector),
    };
    const list = itemsByEntry.get(entryId as string);
    if (list) list.push(parsed);
    else itemsByEntry.set(entryId as string, [parsed]);
  }

  const journal = entries.map((entry) => ({
    ...entry,
    items: itemsByEntry.get(entry.id as string) ?? [],
  }));

  const weighIns = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, local_date, weight_kg, body_fat_percent, source, created_at
       FROM weight_entries WHERE user_id = ? ORDER BY local_date ASC`,
    [userId],
  );

  const water = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, logged_at, local_date, millilitres
       FROM water_logs WHERE user_id = ? ORDER BY logged_at ASC`,
    [userId],
  );

  const fasting = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, protocol, started_at, ended_at, target_hours
       FROM fasting_sessions WHERE user_id = ? ORDER BY started_at ASC`,
    [userId],
  );

  const mood = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, entry_id, logged_at, local_date, mood, energy, hunger, digestion, note
       FROM mood_entries WHERE user_id = ? ORDER BY logged_at ASC`,
    [userId],
  );

  /**
   * Saved meals, with their foods nested.
   *
   * These are the one thing here a person *authored* rather than recorded, so
   * losing them to a lost phone would be losing work rather than history.
   */
  const savedMealRows = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, name, meal_slot, use_count, last_used_at, created_at
       FROM saved_meals WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [userId],
  );

  const savedMealItems = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT id, saved_meal_id, display_name, grams, portion_label, nutrients, source, confidence
       FROM saved_meal_items
      WHERE deleted_at IS NULL
        AND saved_meal_id IN (SELECT id FROM saved_meals WHERE user_id = ? AND deleted_at IS NULL)
      ORDER BY sort_order ASC`,
    [userId],
  );

  const savedMeals = savedMealRows.map((meal) => ({
    ...meal,
    items: savedMealItems
      .filter((item) => item.saved_meal_id === meal.id)
      .map(({ saved_meal_id: _omit, ...item }) => ({
        ...item,
        nutrients: parseJson(item.nutrients as string | null, {} as Record<string, unknown>),
      })),
  }));

  /**
   * Recipes kept or cooked.
   *
   * The recipe itself is bundled reference data and is deliberately not
   * exported, so each row carries the library id and the title — enough to find
   * the dish again without shipping 496 recipes inside a personal file.
   */
  const keptRecipes = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT i.id, i.recipe_id, r.title, i.kind, i.occurred_at
       FROM recipe_interactions i
       JOIN recipes r ON r.id = i.recipe_id
      WHERE i.user_id = ? AND i.deleted_at IS NULL
      ORDER BY i.occurred_at ASC`,
    [userId],
  );

  const shoppingList = sqlite.getAllSync<Record<string, unknown>>(
    `SELECT s.id, s.recipe_id, r.title, s.servings, s.created_at
       FROM shopping_list_recipes s
       JOIN recipes r ON r.id = s.recipe_id
      WHERE s.user_id = ? AND s.deleted_at IS NULL
      ORDER BY s.created_at ASC`,
    [userId],
  );

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    counts: {
      journalEntries: journal.length,
      loggedItems: items.length,
      weighIns: weighIns.length,
      waterLogs: water.length,
      fastingSessions: fasting.length,
      moodEntries: mood.length,
      goals: goals.length,
      savedMeals: savedMeals.length,
      keptRecipes: keptRecipes.length,
    },
    profile,
    goals,
    journal,
    weighIns,
    water,
    fasting,
    mood,
    savedMeals,
    keptRecipes,
    shoppingList,
  };
}

/**
 * Pretty-printed on purpose.
 *
 * This file exists to be opened by a person as often as by a program, and the
 * size difference is irrelevant next to being able to read it in any text editor
 * without a formatter.
 */
export function serialiseExport(bundle: ExportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** e.g. `daylish-export-2026-07-28.json` — sorts chronologically in a file list. */
export function exportFilename(now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return `daylish-export-${stamp}.json`;
}
