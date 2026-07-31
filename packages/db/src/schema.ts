/**
 * The Daylish data model, as Drizzle tables targeting on-device SQLite.
 *
 * Conventions used throughout:
 *
 * - **Ids are client-generated UUIDs.** The device is the source of truth and
 *   must be able to create rows offline, so the server never assigns identity.
 *
 * - **Two time columns, always.** `*_at` is an ISO-8601 instant with offset;
 *   `local_date` is the `YYYY-MM-DD` the user considers that moment to belong
 *   to. A meal logged at 00:30 in Berlin and viewed from a phone in UTC must
 *   still land on the Berlin day, and "today's ring" is a `local_date` query.
 *   Deriving one from the other at read time gets this wrong across timezone
 *   changes and DST, so both are stored.
 *
 * - **Nutrients are stored twice, deliberately.** The eight macros that drive
 *   the daily rings are real columns so a day's totals are one indexed SUM.
 *   The full 35-nutrient vector rides alongside as JSON, because summing
 *   micronutrients is a detail-view operation that does not need to be fast.
 *   `packages/core` owns the arithmetic in both cases.
 *
 * - **Soft deletes.** Rows carry `deleted_at` rather than being removed, so the
 *   sync layer can propagate a deletion that happened offline.
 */

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import type {
  ActivityLevel,
  Allergen,
  CookingSkill,
  Cuisine,
  DietStyle,
  Difficulty,
  Equipment,
  FastingProtocol,
  FoodSource,
  GoalKind,
  LogMethod,
  MealSlot,
  MoodTag,
  Sex,
} from '@daylish/core';
import type { NutrientVector } from '@daylish/core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Columns every synced table carries. */
const syncColumns = {
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
  deletedAt: text('deleted_at'),
  /** Set once the row has been acknowledged by the server. Null means pending. */
  syncedAt: text('synced_at'),
};

/**
 * The denormalised macro columns.
 *
 * Kept in sync with `nutrients` JSON by the repository layer — never written
 * directly by feature code.
 */
const macroColumns = {
  energyKcal: real('energy_kcal'),
  proteinG: real('protein_g'),
  carbsG: real('carbs_g'),
  fatG: real('fat_g'),
  fiberG: real('fiber_g'),
  sugarG: real('sugar_g'),
  satFatG: real('sat_fat_g'),
  sodiumMg: real('sodium_mg'),
};

// ---------------------------------------------------------------------------
// User & goals
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  displayName: text('display_name'),
  sex: text('sex').$type<Sex>().notNull().default('unspecified'),
  birthDate: text('birth_date'),
  heightCm: real('height_cm'),
  activityLevel: text('activity_level').$type<ActivityLevel>().notNull().default('moderate'),
  cookingSkill: text('cooking_skill').$type<CookingSkill>().notNull().default('comfortable'),
  /** JSON `Allergen[]`. Read through the repository, which validates against the enum. */
  allergens: text('allergens', { mode: 'json' }).$type<Allergen[]>().notNull().default([]),
  dislikedIngredients: text('disliked_ingredients', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default([]),
  equipment: text('equipment', { mode: 'json' }).$type<Equipment[]>().notNull().default([]),
  /** Minor units (cents) to avoid floating-point money. */
  weeklyBudgetMinor: integer('weekly_budget_minor'),
  currency: text('currency').notNull().default('EUR'),
  maxPrepMinutes: integer('max_prep_minutes').notNull().default(45),
  /** Drives the simple/detailed nutrition toggle. Off by default so beginners are not buried. */
  detailedNutrition: integer('detailed_nutrition', { mode: 'boolean' }).notNull().default(false),
  timezone: text('timezone').notNull().default('UTC'),
  onboardedAt: text('onboarded_at'),
  ...syncColumns,
});

/**
 * Targets over time.
 *
 * Append-only: each weekly recalibration inserts a new row rather than updating
 * the last one, so a user can always see what their target was on a given day
 * and why it moved. `reason` is the plain-language sentence from the goal engine
 * and is shown verbatim in the UI.
 */
export const userGoals = sqliteTable(
  'user_goals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    effectiveFrom: text('effective_from').notNull(),
    goal: text('goal').$type<GoalKind>().notNull(),
    dietStyle: text('diet_style').$type<DietStyle>().notNull().default('balanced'),
    rateKgPerWeek: real('rate_kg_per_week').notNull().default(0),

    energyKcal: real('energy_kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    fiberG: real('fiber_g').notNull(),

    /** Expenditure the targets were derived from, and how much we trusted it. */
    estimatedExpenditureKcal: real('estimated_expenditure_kcal'),
    estimateConfidence: text('estimate_confidence'),
    /** One sentence, e.g. "We raised your target 60 kcal because…". */
    reason: text('reason'),
    ...syncColumns,
  },
  (t) => [index('user_goals_user_from_idx').on(t.userId, t.effectiveFrom)],
);

// ---------------------------------------------------------------------------
// Food database
// ---------------------------------------------------------------------------

/**
 * A food, from any source.
 *
 * `source` plus `confidence` is the honesty mechanism: a USDA Foundation entry
 * sits at 1.0 and renders a verified badge, while an AI photo estimate carries
 * its model-reported confidence and renders it in the UI. Nothing can be logged
 * without one, because the column is NOT NULL.
 */
export const foodItems = sqliteTable(
  'food_items',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    brand: text('brand'),
    barcode: text('barcode'),
    source: text('source').$type<FoodSource>().notNull(),
    /** USDA `fdcId`, or the Open Food Facts barcode. */
    sourceRef: text('source_ref'),
    confidence: real('confidence').notNull().default(1),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    /** True for rows the user created, which stay on-device until moderated. */
    userSubmitted: integer('user_submitted', { mode: 'boolean' }).notNull().default(false),

    /** Full `NutrientVector` per 100 g. */
    nutrients: text('nutrients', { mode: 'json' }).$type<NutrientVector>().notNull(),
    ...macroColumns,

    allergens: text('allergens', { mode: 'json' }).$type<Allergen[]>().notNull().default([]),
    /** Populated for barcode scans so the scanner can work fully offline on a rescan. */
    cachedAt: text('cached_at'),
    ...syncColumns,
  },
  (t) => [
    index('food_items_barcode_idx').on(t.barcode),
    index('food_items_name_idx').on(t.name),
  ],
);

/** Named servings. `grams` is the only quantity used for arithmetic. */
export const foodPortions = sqliteTable(
  'food_portions',
  {
    id: text('id').primaryKey(),
    foodItemId: text('food_item_id').notNull().references(() => foodItems.id),
    label: text('label').notNull(),
    grams: real('grams').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('food_portions_food_idx').on(t.foodItemId)],
);

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/**
 * One eating occasion. Water, mood, weight and fasting are separate tables
 * rather than variants of this one — a polymorphic `kind` column would leave
 * most fields null on most rows and push validation into application code. The
 * timeline is assembled by unioning these tables at read time.
 */
export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    loggedAt: text('logged_at').notNull(),
    /** The user's local `YYYY-MM-DD`. See the header note on why this is stored. */
    localDate: text('local_date').notNull(),
    mealSlot: text('meal_slot').$type<MealSlot>().notNull(),
    /** How this got logged. Recorded so we can measure each path's speed in the field. */
    logMethod: text('log_method').$type<LogMethod>().notNull(),
    note: text('note'),
    photoUri: text('photo_uri'),
    ...syncColumns,
  },
  (t) => [index('journal_entries_user_date_idx').on(t.userId, t.localDate)],
);

/**
 * A food within an entry.
 *
 * The nutrient snapshot is the important part. Correcting a `food_items` row
 * later — a better USDA match, a fixed crowdsourced label — must not silently
 * rewrite what someone ate last March. `food_item_id` stays for provenance and
 * re-logging, but the numbers here are frozen at log time.
 */
export const journalEntryItems = sqliteTable(
  'journal_entry_items',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull().references(() => journalEntries.id),
    foodItemId: text('food_item_id').references(() => foodItems.id),
    recipeId: text('recipe_id').references(() => recipes.id),

    /** Denormalised so history reads without joining, and survives a deleted food. */
    displayName: text('display_name').notNull(),
    grams: real('grams').notNull(),
    portionLabel: text('portion_label'),
    portionCount: real('portion_count'),

    /** Frozen `NutrientVector` for the amount actually eaten. */
    nutrients: text('nutrients', { mode: 'json' }).$type<NutrientVector>().notNull(),
    ...macroColumns,

    /** Carried from the source food so AI estimates stay visibly uncertain. */
    confidence: real('confidence').notNull().default(1),
    source: text('source').$type<FoodSource>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...syncColumns,
  },
  (t) => [index('journal_entry_items_entry_idx').on(t.entryId)],
);

export const waterLogs = sqliteTable(
  'water_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    loggedAt: text('logged_at').notNull(),
    localDate: text('local_date').notNull(),
    millilitres: real('millilitres').notNull(),
    ...syncColumns,
  },
  (t) => [index('water_logs_user_date_idx').on(t.userId, t.localDate)],
);

export const weightEntries = sqliteTable(
  'weight_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    localDate: text('local_date').notNull(),
    weightKg: real('weight_kg').notNull(),
    /** `manual` or `healthkit`, so an import is distinguishable from a deliberate weigh-in. */
    source: text('source').notNull().default('manual'),
    bodyFatPercent: real('body_fat_percent'),
    ...syncColumns,
  },
  (t) => [uniqueIndex('weight_entries_user_date_idx').on(t.userId, t.localDate)],
);

/**
 * Optional per-meal tags feeding the food-mood correlation feature.
 * Nullable throughout: partial answers are more useful than an all-or-nothing form.
 */
export const moodEntries = sqliteTable(
  'mood_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    entryId: text('entry_id').references(() => journalEntries.id),
    loggedAt: text('logged_at').notNull(),
    localDate: text('local_date').notNull(),
    mood: text('mood').$type<MoodTag>(),
    energy: integer('energy'),
    hunger: integer('hunger'),
    digestion: integer('digestion'),
    note: text('note'),
    ...syncColumns,
  },
  (t) => [index('mood_entries_user_date_idx').on(t.userId, t.localDate)],
);

export const fastingSessions = sqliteTable(
  'fasting_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    protocol: text('protocol').$type<FastingProtocol>().notNull(),
    startedAt: text('started_at').notNull(),
    /** Null while a fast is in progress. */
    endedAt: text('ended_at'),
    targetHours: real('target_hours').notNull(),
    ...syncColumns,
  },
  (t) => [index('fasting_sessions_user_started_idx').on(t.userId, t.startedAt)],
);

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    cuisine: text('cuisine').$type<Cuisine>().notNull(),
    mealSlots: text('meal_slots', { mode: 'json' }).$type<MealSlot[]>().notNull(),
    servings: integer('servings').notNull(),
    prepMinutes: integer('prep_minutes').notNull(),
    cookMinutes: integer('cook_minutes').notNull(),
    difficulty: text('difficulty').$type<Difficulty>().notNull(),
    equipment: text('equipment', { mode: 'json' }).$type<Equipment[]>().notNull(),
    dietStyles: text('diet_styles', { mode: 'json' }).$type<DietStyle[]>().notNull(),
    /** Derived from resolved ingredients, never from the model's own claim. */
    allergens: text('allergens', { mode: 'json' }).$type<Allergen[]>().notNull(),

    /** Per serving, computed from resolved ingredients by the pipeline. */
    nutrients: text('nutrients', { mode: 'json' }).$type<NutrientVector>().notNull(),
    ...macroColumns,

    storageNotes: text('storage_notes'),
    fridgeDays: integer('fridge_days').notNull().default(0),
    freezerMonths: integer('freezer_months').notNull().default(0),
    /** 0-100 from `scorePrepSuitability`. */
    prepScore: integer('prep_score').notNull().default(0),
    estimatedCostMinor: integer('estimated_cost_minor'),

    /** `ai_generated` until a human signs off on the surfaced ones. */
    reviewState: text('review_state').notNull().default('ai_generated'),
    ...syncColumns,
  },
  (t) => [
    index('recipes_cuisine_idx').on(t.cuisine),
    index('recipes_prep_score_idx').on(t.prepScore),
  ],
);

export const recipeIngredients = sqliteTable(
  'recipe_ingredients',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id').notNull().references(() => recipes.id),
    /** Null when the pipeline could not resolve it — such recipes are rejected, so this is for audit. */
    foodItemId: text('food_item_id').references(() => foodItems.id),
    name: text('name').notNull(),
    grams: real('grams').notNull(),
    displayQuantity: text('display_quantity').notNull(),
    preparation: text('preparation'),
    optional: integer('optional', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('recipe_ingredients_recipe_idx').on(t.recipeId)],
);

export const recipeSteps = sqliteTable(
  'recipe_steps',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id').notNull().references(() => recipes.id),
    stepOrder: integer('step_order').notNull(),
    instruction: text('instruction').notNull(),
    durationMinutes: integer('duration_minutes'),
    /** Passive steps are the gaps the prep-day scheduler packs other work into. */
    isPassive: integer('is_passive', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('recipe_steps_recipe_idx').on(t.recipeId)],
);

/** Likes, cooks and skips — the taste profile behind feed ranking. */
export const recipeInteractions = sqliteTable(
  'recipe_interactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    recipeId: text('recipe_id').notNull().references(() => recipes.id),
    kind: text('kind').notNull(),
    occurredAt: text('occurred_at').notNull(),
    ...syncColumns,
  },
  (t) => [index('recipe_interactions_user_idx').on(t.userId, t.recipeId)],
);

// ---------------------------------------------------------------------------
// Pantry & planning
// ---------------------------------------------------------------------------

/** Pantry-first planning: what the user already owns, usually via a grocery-haul scan. */
export const pantryItems = sqliteTable(
  'pantry_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    foodItemId: text('food_item_id').references(() => foodItems.id),
    name: text('name').notNull(),
    quantityGrams: real('quantity_grams'),
    addedAt: text('added_at').notNull(),
    expiresOn: text('expires_on'),
    location: text('location').notNull().default('pantry'),
    ...syncColumns,
  },
  (t) => [index('pantry_items_user_idx').on(t.userId)],
);

export const mealPlans = sqliteTable(
  'meal_plans',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    weekStartDate: text('week_start_date').notNull(),
    generatedAt: text('generated_at'),
    ...syncColumns,
  },
  (t) => [uniqueIndex('meal_plans_user_week_idx').on(t.userId, t.weekStartDate)],
);

export const mealPlanSlots = sqliteTable(
  'meal_plan_slots',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id').notNull().references(() => mealPlans.id),
    localDate: text('local_date').notNull(),
    mealSlot: text('meal_slot').$type<MealSlot>().notNull(),
    recipeId: text('recipe_id').references(() => recipes.id),
    servings: real('servings').notNull().default(1),
    /** Locked slots survive regeneration — the "keep my favourites" affordance. */
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    /** Set when this slot is eating a previous day's planned leftovers. */
    leftoverOfSlotId: text('leftover_of_slot_id'),
    ...syncColumns,
  },
  (t) => [index('meal_plan_slots_plan_idx').on(t.planId, t.localDate)],
);

// ---------------------------------------------------------------------------
// Saved meals
// ---------------------------------------------------------------------------

/**
 * A combination of foods someone eats often, logged in one tap.
 *
 * Distinct from a recipe on purpose. A recipe is something you cook — it has
 * steps, timings and yields. A saved meal is just "what I have for breakfast":
 * two or three foods at the amounts this person actually eats them.
 *
 * This exists because the dominant reason people abandon food diaries is time,
 * not motivation, and the dominant cause of that time is re-entering meals they
 * have already entered before. Frequent foods and copy-day cover part of it;
 * neither can capture a *combination* the way this does.
 */
export const savedMeals = sqliteTable(
  'saved_meals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    /** The slot it is usually eaten in, used to order suggestions. Null if it varies. */
    mealSlot: text('meal_slot').$type<MealSlot>(),
    /** Drives "most used first", which is the only ordering that stays useful. */
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: text('last_used_at'),
    ...syncColumns,
  },
  (t) => [index('saved_meals_user_idx').on(t.userId)],
);

/**
 * One food inside a saved meal.
 *
 * Nutrients are stored **per 100 g**, unlike `journal_entry_items`, which stores
 * the vector for the amount eaten. A saved meal is a template rather than a
 * record of something consumed, so it holds the food's own basis and the portion
 * separately — which means logging it is a straight hand-off to `logMeal`, with
 * no conversion step to get wrong.
 */
export const savedMealItems = sqliteTable(
  'saved_meal_items',
  {
    id: text('id').primaryKey(),
    savedMealId: text('saved_meal_id')
      .notNull()
      .references(() => savedMeals.id),
    foodItemId: text('food_item_id').references(() => foodItems.id),
    displayName: text('display_name').notNull(),
    grams: real('grams').notNull(),
    portionLabel: text('portion_label'),
    /** Full `NutrientVector`, per 100 g. */
    nutrients: text('nutrients', { mode: 'json' }).$type<NutrientVector>().notNull(),
    confidence: real('confidence').notNull().default(1),
    source: text('source').$type<FoodSource>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...syncColumns,
  },
  (t) => [index('saved_meal_items_meal_idx').on(t.savedMealId)],
);

// ---------------------------------------------------------------------------
// Shopping
// ---------------------------------------------------------------------------

/**
 * The shopping list, stored as **recipes rather than ingredients**.
 *
 * The list you read in the shop is computed from these by `buildShoppingList`
 * in `packages/core`, which scales each recipe to the portions wanted and adds
 * up anything the recipes share.
 *
 * Storing the derived lines instead would mean re-deriving them anyway the
 * moment anything changed — cook for six instead of four, drop a recipe, and
 * every combined line is wrong. Deriving on read makes those one-row edits, and
 * makes it impossible for the list to disagree with the recipes it came from.
 */
export const shoppingListRecipes = sqliteTable(
  'shopping_list_recipes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    recipeId: text('recipe_id').notNull().references(() => recipes.id),
    /** Portions to cook, which is not necessarily what the recipe yields. */
    servings: integer('servings').notNull(),
    ...syncColumns,
  },
  (t) => [index('shopping_list_recipes_user_idx').on(t.userId)],
);

/**
 * What has already been put in the basket.
 *
 * Keyed by the normalised ingredient name (`shoppingItemKey`) rather than by a
 * line id, because lines are derived and have no identity of their own — adding
 * a fifth recipe rebuilds every line, and the garlic you already picked up must
 * stay ticked through that.
 */
export const shoppingListChecks = sqliteTable(
  'shopping_list_checks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    itemKey: text('item_key').notNull(),
    ...syncColumns,
  },
  (t) => [index('shopping_list_checks_user_idx').on(t.userId, t.itemKey)],
);

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * The offline write queue.
 *
 * Every mutation appends here in the same transaction as the write itself, so a
 * crash cannot leave a row saved locally but never queued. A background worker
 * drains it; rows that fail repeatedly keep their `lastError` for support.
 */
export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: text('id').primaryKey(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    operation: text('operation').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    queuedAt: text('queued_at').notNull().default(now),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('sync_outbox_queued_idx').on(t.queuedAt)],
);

/** Server cursor per table, so a sync pulls only what changed. */
export const syncState = sqliteTable('sync_state', {
  tableName: text('table_name').primaryKey(),
  lastPulledAt: text('last_pulled_at'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserGoal = typeof userGoals.$inferSelect;
export type FoodItem = typeof foodItems.$inferSelect;
export type NewFoodItem = typeof foodItems.$inferInsert;
export type FoodPortion = typeof foodPortions.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type JournalEntryItem = typeof journalEntryItems.$inferSelect;
export type NewJournalEntryItem = typeof journalEntryItems.$inferInsert;
export type WaterLog = typeof waterLogs.$inferSelect;
export type WeightEntry = typeof weightEntries.$inferSelect;
export type MoodEntry = typeof moodEntries.$inferSelect;
export type FastingSession = typeof fastingSessions.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type RecipeStep = typeof recipeSteps.$inferSelect;
export type PantryItem = typeof pantryItems.$inferSelect;
export type MealPlan = typeof mealPlans.$inferSelect;
export type MealPlanSlot = typeof mealPlanSlots.$inferSelect;
export type SavedMeal = typeof savedMeals.$inferSelect;
export type NewSavedMeal = typeof savedMeals.$inferInsert;
export type SavedMealItem = typeof savedMealItems.$inferSelect;
