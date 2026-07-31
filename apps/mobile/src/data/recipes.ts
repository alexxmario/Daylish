/**
 * Recipe repository.
 *
 * Recipes are reference content rather than user data: everyone gets the same
 * library, nobody edits it, and it must work with no network on a fresh
 * install. So it ships in the bundle and is copied into SQLite on first launch,
 * which keeps every read on the same query path as the rest of the app.
 *
 * **Nutrition here is never recomputed.** `nutrientsPerServing` was calculated by
 * the pipeline from ingredients resolved against USDA FoodData Central, and the
 * `fdcId` behind each ingredient is stored alongside it. Recomputing on device
 * from a different source is exactly how two screens end up disagreeing about
 * the same meal.
 *
 * That note used to say 27 recipes was 157 KB and that several hundred would be
 * too many to bundle. The library is now 496 recipes and 2.7 MB, and the
 * conclusion turned out to be half right.
 *
 * Bundling it is still fine — 2.7 MB of source is about 0.6 MB of Hermes
 * bytecode, and it buys a library that works on a fresh install with no
 * network, which is the point. What was not fine was *evaluating* it. A static
 * import built all 496 objects during module initialisation, on the boot path,
 * on every launch, to serve a function that needs them on exactly one launch.
 * {@link seedRecipes} now loads them through a dynamic import behind a count
 * check, so every later boot compares two integers and stops.
 *
 * If it grows far past this, the next move is the one the old note predicted: a
 * download on first launch, with `seedRecipes` running after it rather than at
 * boot. Nothing here assumes the data is local except `loadSeed`.
 */

import type {
  Allergen,
  Cuisine,
  DietStyle,
  Difficulty,
  Equipment,
  FoodSource,
  MealSlot,
  NutrientVector,
} from '@daylish/core';
import { scaleNutrients } from '@daylish/core';
import { withNutrients } from '@daylish/db';

import { sqlite } from '@/db/client.ts';
import { newId } from '@/lib/ids.ts';
import { logMeal } from '@/data/journal.ts';
import { SEED_RECIPE_COUNT } from './seed-recipes-count.generated.ts';
import { FREE_RECIPE_IDS } from './free-recipes.generated.ts';

/** One recipe as the pipeline emits it. Mirrors `supabase/seed/recipes.json`. */
export interface SeedRecipe {
  title: string;
  summary: string;
  cuisine: string;
  mealSlots: string[];
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: string;
  equipment: string[];
  dietStyles: string[];
  allergens: string[];
  prepScore: number;
  storageNotes: string;
  fridgeDays: number;
  freezerMonths: number;
  nutrientsPerServing: Record<string, number>;
  ingredients: {
    name: string;
    grams: number;
    displayQuantity: string;
    preparation: string | null;
    optional: boolean;
  }[];
  steps: { order: number; instruction: string; durationMinutes: number | null; isPassive: boolean }[];
}

/**
 * The bundled library, loaded only when it is about to be written to SQLite.
 *
 * A static import would evaluate all {@link SEED_RECIPE_COUNT} recipe objects —
 * 2.7 MB of them — during module initialisation, on the boot path, on every
 * launch. They are needed on exactly one launch: the first. Deferring to a
 * dynamic import means later launches compare two integers and stop, and the
 * array is never constructed at all.
 *
 * `import()` rather than `require()` deliberately: the runtime smoke test loads
 * this module under Node's ESM loader, which cannot parse `require`.
 */
async function loadSeed(): Promise<readonly SeedRecipe[]> {
  const module = await import('./seed-recipes.generated.ts');
  return module.SEED_RECIPES;
}

/**
 * A recipe's id is derived from its title rather than random.
 *
 * That makes re-seeding idempotent across app launches and across builds: the
 * same recipe keeps the same id, so a saved interaction or a planned meal still
 * points at it after the library is updated.
 */
function recipeIdFor(title: string): string {
  return `seed:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Copy the bundled library into SQLite if it is not already there.
 *
 * Runs at boot, and is a no-op on every launch after the first. Compares counts
 * rather than diffing: the library is versioned by the bundle, so "the numbers
 * differ" is the only signal that matters and a full replace is the simplest
 * correct response to it.
 */
export async function seedRecipes(): Promise<{ inserted: number }> {
  const existing = sqlite.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM recipes');
  if ((existing?.c ?? 0) === SEED_RECIPE_COUNT) return { inserted: 0 };

  // Only now is the library worth constructing.
  const SEED = await loadSeed();
  const timestamp = new Date().toISOString();

  sqlite.execSync('PRAGMA foreign_keys = OFF;');
  sqlite.execSync('BEGIN');
  try {
    // Replaced wholesale rather than merged. Recipes are read-only reference
    // data, so there is nothing on them worth preserving across a library update.
    sqlite.runSync('DELETE FROM recipe_steps');
    sqlite.runSync('DELETE FROM recipe_ingredients');
    sqlite.runSync('DELETE FROM recipes');

    for (const recipe of SEED) {
      const id = recipeIdFor(recipe.title);
      const columns = withNutrients(recipe.nutrientsPerServing as NutrientVector);

      sqlite.runSync(
        `INSERT INTO recipes
           (id, title, summary, cuisine, meal_slots, servings, prep_minutes, cook_minutes,
            difficulty, equipment, diet_styles, allergens, nutrients,
            energy_kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
            storage_notes, fridge_days, freezer_months, prep_score, review_state,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          recipe.title,
          recipe.summary,
          recipe.cuisine,
          JSON.stringify(recipe.mealSlots),
          recipe.servings,
          recipe.prepMinutes,
          recipe.cookMinutes,
          recipe.difficulty,
          JSON.stringify(recipe.equipment),
          JSON.stringify(recipe.dietStyles),
          JSON.stringify(recipe.allergens),
          JSON.stringify(recipe.nutrientsPerServing),
          columns.energyKcal,
          columns.proteinG,
          columns.carbsG,
          columns.fatG,
          columns.fiberG,
          columns.sugarG,
          columns.satFatG,
          columns.sodiumMg,
          recipe.storageNotes,
          recipe.fridgeDays,
          recipe.freezerMonths,
          recipe.prepScore,
          'seed',
          timestamp,
          timestamp,
        ],
      );

      recipe.ingredients.forEach((ingredient, index) => {
        sqlite.runSync(
          `INSERT INTO recipe_ingredients
             (id, recipe_id, food_item_id, name, grams, display_quantity, preparation, optional, sort_order)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
          [
            newId(),
            id,
            ingredient.name,
            ingredient.grams,
            ingredient.displayQuantity,
            ingredient.preparation,
            ingredient.optional ? 1 : 0,
            index,
          ],
        );
      });

      for (const step of recipe.steps) {
        sqlite.runSync(
          `INSERT INTO recipe_steps (id, recipe_id, step_order, instruction, duration_minutes, is_passive)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newId(), id, step.order, step.instruction, step.durationMinutes, step.isPassive ? 1 : 0],
        );
      }
    }

    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  } finally {
    sqlite.execSync('PRAGMA foreign_keys = ON;');
  }

  return { inserted: SEED.length };
}

export interface RecipeSummary {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly cuisine: Cuisine;
  readonly mealSlots: MealSlot[];
  readonly servings: number;
  readonly totalMinutes: number;
  readonly difficulty: Difficulty;
  readonly dietStyles: DietStyle[];
  readonly allergens: Allergen[];
  /** What you need in the kitchen to cook it. */
  readonly equipment: Equipment[];
  readonly fridgeDays: number;
  readonly freezerMonths: number;
  readonly prepScore: number;
  readonly energyKcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
}

interface RecipeRow {
  id: string;
  title: string;
  summary: string;
  cuisine: Cuisine;
  meal_slots: string;
  servings: number;
  prep_minutes: number;
  cook_minutes: number;
  difficulty: Difficulty;
  diet_styles: string;
  allergens: string;
  equipment: string;
  fridge_days: number;
  freezer_months: number;
  prep_score: number;
  energy_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/**
 * Every column the browse list needs.
 *
 * Equipment, keeping times and difficulty are read on the list path rather than
 * only on the detail path because they are all filterable — "what can I cook
 * tonight with a hob and no oven" is a browse question, not a recipe question.
 */
const SUMMARY_COLUMNS = `id, title, summary, cuisine, meal_slots, servings, prep_minutes, cook_minutes,
       difficulty, diet_styles, allergens, equipment, fridge_days, freezer_months, prep_score,
       energy_kcal, protein_g, carbs_g, fat_g`;

function rowToSummary(row: RecipeRow): RecipeSummary {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    cuisine: row.cuisine,
    mealSlots: JSON.parse(row.meal_slots) as MealSlot[],
    servings: row.servings,
    totalMinutes: row.prep_minutes + row.cook_minutes,
    difficulty: row.difficulty,
    dietStyles: JSON.parse(row.diet_styles) as DietStyle[],
    allergens: JSON.parse(row.allergens) as Allergen[],
    equipment: JSON.parse(row.equipment) as Equipment[],
    fridgeDays: row.fridge_days,
    freezerMonths: row.freezer_months,
    prepScore: row.prep_score,
    energyKcal: row.energy_kcal ?? 0,
    proteinG: row.protein_g ?? 0,
    carbsG: row.carbs_g ?? 0,
    fatG: row.fat_g ?? 0,
  };
}

/**
 * Suffixes that mark a recipe as a variant of a dish rather than a dish of its
 * own. "Shakshuka, light" and "Shakshuka, vegan" are the same meal cooked
 * differently; "Chicken, leek and potato pie" is not three things.
 *
 * Matched against the final comma-separated segment only, and only against this
 * list — which is why a dish name may contain commas safely. The generation
 * prompt mandates these exact suffixes, so this list and that prompt have to
 * agree; adding a variant kind means adding it in both places.
 */
const VARIANT_SUFFIXES: Readonly<Record<string, string>> = {
  light: 'Light',
  hearty: 'Hearty',
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  'gluten-free': 'Gluten free',
  'dairy-free': 'Dairy free',
  keto: 'Keto',
  pescatarian: 'Pescatarian',
};

/** The label for the unsuffixed recipe — the dish as you would normally cook it. */
export const STANDARD_VARIANT = 'Standard';

export interface DishIdentity {
  /** Stable key shared by every variant of the same dish. */
  readonly dishKey: string;
  /** The dish name, without the variant suffix. */
  readonly dishName: string;
  /** "Light", "Vegan", or "Standard". */
  readonly variantLabel: string;
}

export function identifyDish(title: string): DishIdentity {
  const parts = title.split(',');
  const last = (parts.at(-1) ?? '').trim().toLowerCase();
  const suffix = VARIANT_SUFFIXES[last];

  const dishName = suffix ? parts.slice(0, -1).join(',').trim() : title.trim();

  return {
    dishKey: dishName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    dishName,
    variantLabel: suffix ?? STANDARD_VARIANT,
  };
}

/** Standard first, then lighter, then heavier — the order people scan them in. */
const VARIANT_ORDER = ['Light', STANDARD_VARIANT, 'Hearty'];

function variantRank(label: string): number {
  const index = VARIANT_ORDER.indexOf(label);
  // Diet variants sort after the calorie ladder, alphabetically among themselves.
  return index === -1 ? VARIANT_ORDER.length : index;
}

export interface Dish {
  readonly dishKey: string;
  readonly name: string;
  /** Every variant, ordered light → standard → hearty → diet variants. */
  readonly variants: readonly (RecipeSummary & { variantLabel: string })[];
  /** The variant shown on the browse card: standard where there is one. */
  readonly representative: RecipeSummary & { variantLabel: string };
}

/**
 * Browse by dish rather than by recipe.
 *
 * Nine dishes shown as twenty-seven cards reads as a repetitive library rather
 * than a varied one — the same meal three times in a row, with the differences
 * only legible by squinting at the calorie figure. Grouping puts breadth on the
 * browse screen and depth on the detail screen, which is also what lets diet
 * variants be added without making the list worse.
 */
export function listDishes(filters: RecipeFilters = {}): Dish[] {
  const grouped = new Map<string, (RecipeSummary & { variantLabel: string })[]>();

  for (const recipe of listRecipes(filters)) {
    const { dishKey, variantLabel } = identifyDish(recipe.title);
    const entry = { ...recipe, variantLabel };
    const existing = grouped.get(dishKey);
    if (existing) existing.push(entry);
    else grouped.set(dishKey, [entry]);
  }

  const dishes: Dish[] = [];
  for (const [dishKey, variants] of grouped) {
    variants.sort(
      (a, b) =>
        variantRank(a.variantLabel) - variantRank(b.variantLabel) ||
        a.variantLabel.localeCompare(b.variantLabel),
    );

    // The standard version represents the dish where it survived the filters;
    // otherwise whichever variant did, so a vegan-filtered list still shows the
    // dish rather than dropping it.
    const representative =
      variants.find((v) => v.variantLabel === STANDARD_VARIANT) ?? variants[0]!;

    dishes.push({
      dishKey,
      name: identifyDish(representative.title).dishName,
      variants,
      representative,
    });
  }

  // Dishes are ordered by the variant on the card, so the order matches the
  // numbers being read. Sorting by the best variant instead would put a dish at
  // the top of "most protein" on the strength of a figure that is not shown.
  const compare = compareBy(filters.sort ?? 'name');
  return dishes.sort(
    (a, b) => compare(a.representative, b.representative) || a.name.localeCompare(b.name),
  );
}

/** The prep score above which a recipe is worth cooking in bulk. */
const BATCH_FRIENDLY_SCORE = 60;

/**
 * How the list is ordered.
 *
 * Alphabetical is the default because it is the only order that stays put while
 * you scroll — every other option re-ranks the library around a number, which is
 * what you want when you are shopping for a constraint rather than browsing.
 */
export type RecipeSort = 'name' | 'quickest' | 'lightest' | 'most_protein' | 'batch';

export interface RecipeFilters {
  /** Free text over title and summary. */
  readonly query?: string;
  /** Any of these slots. Empty or absent means every slot. */
  readonly mealSlots?: readonly MealSlot[];
  /** Any of these cuisines. */
  readonly cuisines?: readonly Cuisine[];
  /** Any of these difficulties. */
  readonly difficulties?: readonly Difficulty[];
  /** Total prep + cook time ceiling, in minutes. */
  readonly maxMinutes?: number;
  /**
   * *Every* one of these, not any. Diet styles are requirements rather than
   * preferences — someone who picks vegan and gluten free wants recipes that are
   * both, and a list that satisfies half of what they asked for is worse than an
   * empty one.
   */
  readonly dietStyles?: readonly DietStyle[];
  /** Allergens to exclude. A hard filter — never a warning. */
  readonly avoidAllergens?: readonly Allergen[];
  /** Substrings matched against ingredient names, e.g. "mushroom". */
  readonly excludeIngredients?: readonly string[];
  /**
   * Restrict to these recipes. How "saved only" is expressed, and deliberately
   * a list of ids rather than a `savedOnly` flag: this repository has no reason
   * to know what saving is, and the same door serves any other set-of-recipes
   * filter later. An empty array means an empty result, not "no filter" — the
   * distinction is the whole difference between showing nothing saved and
   * showing the entire library.
   */
  readonly recipeIds?: readonly string[];
  /** Per-serving nutrition ceilings and floors. */
  readonly maxCalories?: number;
  readonly minProteinG?: number;
  readonly maxCarbsG?: number;
  /** Only recipes that keep and reheat well. */
  readonly batchFriendly?: boolean;
  /** Only recipes that survive the freezer. */
  readonly freezerFriendly?: boolean;
  /**
   * The kit available to cook with. A recipe passes when everything it needs is
   * in here — so this narrows to what you can actually make, rather than to
   * recipes that happen to mention a blender.
   */
  readonly equipment?: readonly Equipment[];
  readonly sort?: RecipeSort;
  /**
   * Only recipes a free account can cook.
   *
   * Used where the app *suggests* a dish rather than where someone browses for
   * one: recommending something and then charging at the tap is the kind of
   * thing people leave one-star reviews about. Browsing is deliberately not
   * filtered by this.
   */
  readonly freeOnly?: boolean;
}

/**
 * Order two recipes for the given sort.
 *
 * Every comparator falls back to the title so the list is stable: two 30-minute
 * recipes must not swap places between renders, or the list appears to shuffle
 * itself while being read.
 */
function compareBy(sort: RecipeSort): (a: RecipeSummary, b: RecipeSummary) => number {
  const byTitle = (a: RecipeSummary, b: RecipeSummary) => a.title.localeCompare(b.title);

  switch (sort) {
    case 'quickest':
      return (a, b) => a.totalMinutes - b.totalMinutes || byTitle(a, b);
    case 'lightest':
      return (a, b) => a.energyKcal - b.energyKcal || byTitle(a, b);
    case 'most_protein':
      return (a, b) => b.proteinG - a.proteinG || byTitle(a, b);
    case 'batch':
      return (a, b) => b.prepScore - a.prepScore || byTitle(a, b);
    case 'name':
    default:
      return byTitle;
  }
}

/**
 * Browse the library.
 *
 * Scalar columns are filtered in SQL; the JSON arrays — meal slots, diet styles,
 * allergens, equipment — are filtered in JavaScript, because the schema stores
 * them that way so a recipe can carry several. At a few hundred recipes that is
 * far cheaper than the JSON1 extension would be to maintain, and it keeps the
 * filter logic readable.
 *
 * Ingredient exclusion is the exception: it lives in SQL as an anti-join,
 * because the alternative is reading every ingredient row in the library to
 * answer "no mushrooms".
 */
export function listRecipes(filters: RecipeFilters = {}): RecipeSummary[] {
  // Asking for none of the recipes is a question SQL should never be troubled
  // with, and `IN ()` is a syntax error in SQLite rather than an empty set.
  if (filters.recipeIds && filters.recipeIds.length === 0) return [];

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.recipeIds) {
    where.push(`id IN (${filters.recipeIds.map(() => '?').join(', ')})`);
    params.push(...filters.recipeIds);
  }

  if (filters.query && filters.query.trim().length > 0) {
    where.push('(title LIKE ? OR summary LIKE ?)');
    const like = `%${filters.query.trim()}%`;
    params.push(like, like);
  }
  if (typeof filters.maxMinutes === 'number') {
    where.push('(prep_minutes + cook_minutes) <= ?');
    params.push(filters.maxMinutes);
  }
  if (typeof filters.maxCalories === 'number') {
    where.push('energy_kcal <= ?');
    params.push(filters.maxCalories);
  }
  if (typeof filters.minProteinG === 'number') {
    where.push('protein_g >= ?');
    params.push(filters.minProteinG);
  }
  if (typeof filters.maxCarbsG === 'number') {
    where.push('carbs_g <= ?');
    params.push(filters.maxCarbsG);
  }
  if (filters.cuisines && filters.cuisines.length > 0) {
    where.push(`cuisine IN (${filters.cuisines.map(() => '?').join(', ')})`);
    params.push(...filters.cuisines);
  }
  if (filters.difficulties && filters.difficulties.length > 0) {
    where.push(`difficulty IN (${filters.difficulties.map(() => '?').join(', ')})`);
    params.push(...filters.difficulties);
  }
  if (filters.batchFriendly) {
    where.push('prep_score >= ?');
    params.push(BATCH_FRIENDLY_SCORE);
  }
  if (filters.freezerFriendly) {
    where.push('freezer_months > 0');
  }

  const excluded = (filters.excludeIngredients ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  if (excluded.length > 0) {
    where.push(
      `id NOT IN (SELECT recipe_id FROM recipe_ingredients
                   WHERE ${excluded.map(() => 'name LIKE ?').join(' OR ')})`,
    );
    params.push(...excluded.map((term) => `%${term}%`));
  }

  const rows = sqlite.getAllSync<RecipeRow>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM recipes
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY title ASC`,
    params,
  );

  const avoid = new Set(filters.avoidAllergens ?? []);
  const slots = filters.mealSlots ?? [];
  const diets = filters.dietStyles ?? [];
  const kit = filters.equipment ? new Set(filters.equipment) : null;

  return rows
    .map(rowToSummary)
    .filter((recipe) => {
      if (slots.length > 0 && !slots.some((slot) => recipe.mealSlots.includes(slot))) return false;
      if (diets.length > 0 && !diets.every((diet) => recipe.dietStyles.includes(diet))) return false;
      if (avoid.size > 0 && recipe.allergens.some((a) => avoid.has(a))) return false;
      if (kit && !recipe.equipment.every((e) => kit.has(e))) return false;
      if (filters.freeOnly && !FREE_RECIPE_IDS.has(recipe.id)) return false;
      return true;
    })
    .sort(compareBy(filters.sort ?? 'name'));
}

/**
 * Whether a free account can cook this one.
 *
 * The whole library ships in the bundle and stays browsable — hiding the other
 * 446 would mean a free user never learns what they are missing, whereas
 * filtering to "vegan, under 30 minutes, no oven" and seeing eleven results
 * with two of them unlocked is the moment a paywall is worth showing.
 */
export function isFreeRecipe(recipeId: string): boolean {
  return FREE_RECIPE_IDS.has(recipeId);
}

export interface LibraryFacets {
  readonly cuisines: Cuisine[];
  readonly difficulties: Difficulty[];
  readonly dietStyles: DietStyle[];
  readonly allergens: Allergen[];
  readonly equipment: Equipment[];
}

/**
 * What the library actually contains, for building the filter sheet.
 *
 * Read from the data rather than from the enums in `@daylish/core`, because the
 * enums describe what the *schema* can hold and the sheet has to describe what
 * is cookable. Offering "kosher" or "low FODMAP" when no recipe carries either
 * tag promises a library that does not exist, and the person who taps it learns
 * only that the app wasted their time.
 *
 * One pass over a few hundred short strings, called once when the sheet mounts.
 */
export function libraryFacets(): LibraryFacets {
  const rows = sqlite.getAllSync<{
    cuisine: Cuisine;
    difficulty: Difficulty;
    diet_styles: string;
    allergens: string;
    equipment: string;
  }>('SELECT cuisine, difficulty, diet_styles, allergens, equipment FROM recipes');

  const cuisines = new Set<Cuisine>();
  const difficulties = new Set<Difficulty>();
  const dietStyles = new Set<DietStyle>();
  const allergens = new Set<Allergen>();
  const equipment = new Set<Equipment>();

  for (const row of rows) {
    cuisines.add(row.cuisine);
    difficulties.add(row.difficulty);
    for (const diet of JSON.parse(row.diet_styles) as DietStyle[]) dietStyles.add(diet);
    for (const allergen of JSON.parse(row.allergens) as Allergen[]) allergens.add(allergen);
    for (const item of JSON.parse(row.equipment) as Equipment[]) equipment.add(item);
  }

  const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

  return {
    cuisines: [...cuisines].sort(),
    difficulties: [...difficulties].sort(
      (a, b) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b),
    ),
    dietStyles: [...dietStyles],
    allergens: [...allergens].sort(),
    equipment: [...equipment].sort(),
  };
}

export interface RecipeIngredient {
  readonly name: string;
  readonly grams: number;
  readonly displayQuantity: string;
  readonly preparation: string | null;
  readonly optional: boolean;
}

export interface RecipeStep {
  readonly order: number;
  readonly instruction: string;
  readonly durationMinutes: number | null;
  readonly isPassive: boolean;
}

export interface RecipeDetail extends RecipeSummary {
  readonly prepMinutes: number;
  readonly cookMinutes: number;
  readonly storageNotes: string | null;
  /** Per serving, as computed by the pipeline. */
  readonly nutrients: NutrientVector;
  readonly ingredients: RecipeIngredient[];
  readonly steps: RecipeStep[];
}

export function getRecipe(recipeId: string): RecipeDetail | null {
  const row = sqlite.getFirstSync<
    RecipeRow & {
      storage_notes: string | null;
      nutrients: string;
    }
  >(
    `SELECT ${SUMMARY_COLUMNS}, storage_notes, nutrients
       FROM recipes WHERE id = ?`,
    [recipeId],
  );
  if (!row) return null;

  const ingredients = sqlite.getAllSync<{
    name: string;
    grams: number;
    display_quantity: string;
    preparation: string | null;
    optional: number;
  }>(
    `SELECT name, grams, display_quantity, preparation, optional
       FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order ASC`,
    [recipeId],
  );

  const steps = sqlite.getAllSync<{
    step_order: number;
    instruction: string;
    duration_minutes: number | null;
    is_passive: number;
  }>(
    `SELECT step_order, instruction, duration_minutes, is_passive
       FROM recipe_steps WHERE recipe_id = ? ORDER BY step_order ASC`,
    [recipeId],
  );

  return {
    ...rowToSummary(row),
    prepMinutes: row.prep_minutes,
    cookMinutes: row.cook_minutes,
    storageNotes: row.storage_notes,
    nutrients: JSON.parse(row.nutrients) as NutrientVector,
    ingredients: ingredients.map((i) => ({
      name: i.name,
      grams: i.grams,
      displayQuantity: i.display_quantity,
      preparation: i.preparation,
      optional: i.optional === 1,
    })),
    steps: steps.map((s) => ({
      order: s.step_order,
      instruction: s.instruction,
      durationMinutes: s.duration_minutes,
      isPassive: s.is_passive === 1,
    })),
  };
}

/**
 * Log a recipe as a meal.
 *
 * Written as a single journal item named after the recipe rather than one item
 * per ingredient. A diary that shows "Chicken and chorizo traybake" is readable;
 * one that shows eleven rows including 6 g of garlic is not, and nobody wants to
 * scroll past their own seasoning.
 *
 * `logMeal` scales from a per-100 g basis, so the per-serving nutrition is
 * converted to that basis first — and `servings` here means portions eaten, not
 * the recipe's yield.
 */
export function logRecipeAsMeal(input: {
  userId: string;
  recipeId: string;
  mealSlot: MealSlot;
  /** Portions eaten. Defaults to one. */
  servings?: number;
  loggedAt?: Date;
}): string {
  const recipe = getRecipe(input.recipeId);
  if (!recipe) throw new Error(`logRecipeAsMeal: no such recipe ${input.recipeId}`);

  const portions = input.servings ?? 1;
  if (!Number.isFinite(portions) || portions <= 0) {
    throw new RangeError(`logRecipeAsMeal: servings must be > 0, got ${portions}`);
  }

  // A "gram weight" for one serving, so the journal's portion editor still
  // works on a logged recipe. Derived from the ingredient weights rather than
  // invented, then divided by the recipe's yield.
  const totalGrams = recipe.ingredients.reduce((sum, i) => sum + i.grams, 0);
  const gramsPerServing = recipe.servings > 0 ? totalGrams / recipe.servings : totalGrams;
  const grams = gramsPerServing * portions;

  // `nutrients` is per serving; convert to per 100 g so logMeal can rescale.
  const per100g =
    gramsPerServing > 0
      ? scaleNutrients(recipe.nutrients, 100 / gramsPerServing)
      : recipe.nutrients;

  return logMeal({
    userId: input.userId,
    mealSlot: input.mealSlot,
    logMethod: 'recipe',
    loggedAt: input.loggedAt,
    items: [
      {
        foodItemId: null,
        recipeId: recipe.id,
        displayName: recipe.title,
        grams,
        portionLabel: portions === 1 ? '1 serving' : `${portions} servings`,
        portionCount: portions,
        per100g,
        source: 'usda' as FoodSource,
        confidence: 1,
      },
    ],
  });
}

/** What a given number of servings works out to, for the detail screen's header. */
export function servingNutrition(recipe: RecipeDetail, portions = 1): NutrientVector {
  return scaleNutrients(recipe.nutrients, portions);
}

/**
 * Round a scaled quantity to something a cook would actually measure.
 *
 * Scaling produces numbers like 6.6666 g of garlic. Below 10 g people work in
 * whole grams, above 100 g nobody minds five either way — so the precision
 * follows the size rather than a fixed number of decimals.
 */
function roundQuantity(grams: number): number {
  if (grams < 10) return Math.round(grams * 2) / 2;
  if (grams < 100) return Math.round(grams);
  return Math.round(grams / 5) * 5;
}

export interface ScaledRecipe {
  readonly servings: number;
  readonly ingredients: readonly (RecipeIngredient & { readonly scaledGrams: number })[];
  /** Per serving — unchanged by scaling, which is the point. */
  readonly nutrients: NutrientVector;
  /** Things that stop being true when a recipe is scaled this far. */
  readonly warnings: readonly string[];
}

/**
 * Cook the same recipe for a different number of people.
 *
 * This is the batch-cook and the cooking-for-one case, and it is arithmetic
 * rather than content: a traybake for four scaled to one is the same recipe with
 * the quantities divided. Authoring both would double the library for no new
 * information and give two entries that drift apart.
 *
 * What it does *not* pretend: scaling is not perfectly linear. A tray that fits
 * four portions does not fit eight, cook times move when a pan is fuller, and
 * you cannot crack a third of an egg. Those are surfaced as warnings rather than
 * silently ignored, because a cook who is misled once stops trusting the number.
 *
 * Per-serving nutrition deliberately does not change — that is what makes this
 * safe. Scaling changes how much you cook, not what a portion is.
 */
export function scaleRecipe(recipe: RecipeDetail, servings: number): ScaledRecipe {
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new RangeError(`scaleRecipe: servings must be > 0, got ${servings}`);
  }

  const factor = servings / recipe.servings;
  const warnings: string[] = [];

  if (factor > 2) {
    warnings.push(
      'Cooking more than double may need a second tin or pan, and a little longer in the oven.',
    );
  }
  if (factor < 1) {
    // Whole-unit ingredients are the ones that scale badly downwards.
    const awkward = recipe.ingredients.filter((ingredient) =>
      /\b(egg|eggs)\b/i.test(ingredient.name),
    );
    if (awkward.length > 0) {
      warnings.push(
        `Scaling down leaves fractions of ${awkward.map((i) => i.name).join(' and ')} — round to whole ones and accept the difference.`,
      );
    }
  }

  return {
    servings,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      scaledGrams: roundQuantity(ingredient.grams * factor),
    })),
    nutrients: recipe.nutrients,
    warnings,
  };
}
