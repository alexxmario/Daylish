/**
 * The Meals screen's filter state.
 *
 * Kept apart from both the screen and the repository because it is neither: it
 * is the vocabulary a person browses in ("under 30 minutes", "no oven", "high
 * protein"), which has to be translated into the vocabulary the query speaks
 * ({@link RecipeFilters}). Holding the two apart is what lets the sheet offer
 * "fits my kitchen" without the repository knowing that a profile exists.
 *
 * One state object rather than fifteen `useState` calls, because almost
 * everything here is read together — the active count, the summary chips, the
 * query — and a dozen dependencies in a `useMemo` is how those drift apart.
 */

import type {
  Allergen,
  Cuisine,
  DietStyle,
  Difficulty,
  Equipment,
  MealSlot,
} from '@daylish/core';

import type { RecipeFilters, RecipeSort } from '@/data/recipes.ts';

export interface MealFilterState {
  readonly query: string;
  readonly slots: readonly MealSlot[];
  readonly cuisines: readonly Cuisine[];
  readonly difficulties: readonly Difficulty[];
  /** Total prep + cook ceiling. Null means any. */
  readonly maxMinutes: number | null;
  readonly dietStyles: readonly DietStyle[];
  readonly maxCalories: number | null;
  readonly minProteinG: number | null;
  readonly maxCarbsG: number | null;
  readonly batchFriendly: boolean;
  readonly freezerFriendly: boolean;
  /** Only recipes this person has saved. */
  readonly savedOnly: boolean;
  /** Only recipes this person has cooked before. */
  readonly cookedOnly: boolean;
  /** Only recipes cookable with the equipment on the profile. */
  readonly fitsMyKitchen: boolean;
  readonly noOven: boolean;
  /** Allergens avoided *in addition* to the profile's, e.g. cooking for a guest. */
  readonly extraAllergens: readonly Allergen[];
  /** Ingredient substrings to exclude. */
  readonly excludeIngredients: readonly string[];
  readonly sort: RecipeSort;
}

export const EMPTY_FILTERS: MealFilterState = {
  query: '',
  slots: [],
  cuisines: [],
  difficulties: [],
  maxMinutes: null,
  dietStyles: [],
  maxCalories: null,
  minProteinG: null,
  maxCarbsG: null,
  batchFriendly: false,
  freezerFriendly: false,
  savedOnly: false,
  cookedOnly: false,
  fitsMyKitchen: false,
  noOven: false,
  extraAllergens: [],
  excludeIngredients: [],
  sort: 'name',
};

/** Every kind of kitchen kit, so "no oven" can be expressed as a subset of it. */
const ALL_EQUIPMENT: readonly Equipment[] = [
  'oven',
  'stovetop',
  'microwave',
  'air_fryer',
  'blender',
  'food_processor',
  'slow_cooker',
  'pressure_cooker',
  'grill',
  'rice_cooker',
];

export interface FilterContext {
  /** Kit the person owns, from their profile. */
  readonly equipment: readonly Equipment[];
  /** Allergens the profile already avoids. Always applied, never optional. */
  readonly allergens: readonly Allergen[];
  /** Recipe ids this person has saved. */
  readonly savedIds: readonly string[];
  /** Recipe ids this person has cooked at least once. */
  readonly cookedIds: readonly string[];
}

/**
 * Translate browse vocabulary into query vocabulary.
 *
 * The two equipment options compose rather than compete: "fits my kitchen"
 * starts from the profile's kit, "no oven" removes the oven from whatever the
 * starting set was. Both on means "what I own, minus the oven", which is what
 * someone whose oven is broken actually wants.
 */
export function toRecipeFilters(
  state: MealFilterState,
  context: FilterContext,
): RecipeFilters {
  let kit: readonly Equipment[] | undefined;
  if (state.fitsMyKitchen) kit = context.equipment;
  if (state.noOven) kit = (kit ?? ALL_EQUIPMENT).filter((e) => e !== 'oven');

  // Saved and cooked compose the same way the equipment options do: each one
  // narrows whatever the previous left, so both on means "saved *and* already
  // cooked" rather than either.
  let ids: readonly string[] | undefined;
  if (state.savedOnly) ids = context.savedIds;
  if (state.cookedOnly) {
    const cooked = new Set(context.cookedIds);
    ids = ids ? ids.filter((id) => cooked.has(id)) : context.cookedIds;
  }

  return {
    recipeIds: ids,
    query: state.query,
    mealSlots: state.slots,
    cuisines: state.cuisines,
    difficulties: state.difficulties,
    maxMinutes: state.maxMinutes ?? undefined,
    dietStyles: state.dietStyles,
    maxCalories: state.maxCalories ?? undefined,
    minProteinG: state.minProteinG ?? undefined,
    maxCarbsG: state.maxCarbsG ?? undefined,
    batchFriendly: state.batchFriendly || undefined,
    freezerFriendly: state.freezerFriendly || undefined,
    equipment: kit,
    excludeIngredients: state.excludeIngredients,
    // The profile's allergens are not a filter the sheet can turn off. Someone
    // who has told the app they cannot eat peanuts should not be able to
    // accidentally browse their way back into them.
    avoidAllergens: [...context.allergens, ...state.extraAllergens],
    sort: state.sort,
  };
}

/**
 * How many filters are on.
 *
 * Search and sort are excluded deliberately: the search box shows its own
 * contents, and a sort is always set to something, so counting either would
 * make the badge read "2 filters" on an untouched screen.
 */
export function activeFilterCount(state: MealFilterState): number {
  return (
    state.slots.length +
    state.cuisines.length +
    state.difficulties.length +
    state.dietStyles.length +
    state.extraAllergens.length +
    state.excludeIngredients.length +
    (state.maxMinutes === null ? 0 : 1) +
    (state.maxCalories === null ? 0 : 1) +
    (state.minProteinG === null ? 0 : 1) +
    (state.maxCarbsG === null ? 0 : 1) +
    (state.batchFriendly ? 1 : 0) +
    (state.freezerFriendly ? 1 : 0) +
    (state.savedOnly ? 1 : 0) +
    (state.cookedOnly ? 1 : 0) +
    (state.fitsMyKitchen ? 1 : 0) +
    (state.noOven ? 1 : 0)
  );
}

/** Toggle a value in one of the multi-select facets. */
export function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** Single-select facets clear when the current value is tapped again. */
export function cycle<T>(current: T | null, value: T): T | null {
  return current === value ? null : value;
}

export interface ActiveFilter {
  readonly id: string;
  readonly label: string;
  /** The state with just this filter lifted. */
  readonly remove: MealFilterState;
}

/**
 * The applied filters, as removable chips.
 *
 * Worth the code because a filter you cannot see is a filter you cannot undo:
 * the commonest way to be confused by a filtered list is to have forgotten
 * about one of the filters. Every chip lifts exactly one thing, so backing out
 * of a search never means starting the whole set again.
 */
export function describeFilters(state: MealFilterState): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  const add = (id: string, label: string, remove: Partial<MealFilterState>) =>
    chips.push({ id, label, remove: { ...state, ...remove } });

  for (const slot of state.slots) {
    add(`slot:${slot}`, SLOT_LABEL[slot], { slots: state.slots.filter((s) => s !== slot) });
  }
  if (state.maxMinutes !== null) {
    add('time', `Under ${state.maxMinutes} min`, { maxMinutes: null });
  }
  for (const diet of state.dietStyles) {
    add(`diet:${diet}`, DIET_LABEL[diet], {
      dietStyles: state.dietStyles.filter((d) => d !== diet),
    });
  }
  for (const cuisine of state.cuisines) {
    add(`cuisine:${cuisine}`, CUISINE_LABEL[cuisine], {
      cuisines: state.cuisines.filter((c) => c !== cuisine),
    });
  }
  for (const difficulty of state.difficulties) {
    add(`difficulty:${difficulty}`, DIFFICULTY_LABEL[difficulty], {
      difficulties: state.difficulties.filter((d) => d !== difficulty),
    });
  }
  if (state.maxCalories !== null) {
    add('calories', `Under ${state.maxCalories} kcal`, { maxCalories: null });
  }
  if (state.minProteinG !== null) {
    add('protein', `Protein ${state.minProteinG} g+`, { minProteinG: null });
  }
  if (state.maxCarbsG !== null) {
    add('carbs', `Under ${state.maxCarbsG} g carbs`, { maxCarbsG: null });
  }
  if (state.savedOnly) add('saved', 'Saved', { savedOnly: false });
  if (state.cookedOnly) add('cooked', 'Cooked before', { cookedOnly: false });
  if (state.batchFriendly) add('batch', 'Batch friendly', { batchFriendly: false });
  if (state.freezerFriendly) add('freezer', 'Freezes well', { freezerFriendly: false });
  if (state.fitsMyKitchen) add('kitchen', 'Fits my kitchen', { fitsMyKitchen: false });
  if (state.noOven) add('oven', 'No oven', { noOven: false });
  for (const allergen of state.extraAllergens) {
    add(`allergen:${allergen}`, `No ${ALLERGEN_LABEL[allergen].toLowerCase()}`, {
      extraAllergens: state.extraAllergens.filter((a) => a !== allergen),
    });
  }
  for (const ingredient of state.excludeIngredients) {
    add(`ingredient:${ingredient}`, `No ${ingredient}`, {
      excludeIngredients: state.excludeIngredients.filter((i) => i !== ingredient),
    });
  }

  return chips;
}

/*
 * Labels.
 *
 * Written out rather than derived from the enum by replacing underscores,
 * because that route gives "Low fodmap" and "Middle eastern" — a machine's
 * guess at a proper noun. Cuisines are title case (they are all proper
 * adjectives); everything else is sentence case, which is the app's voice.
 */

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Some skill',
  hard: 'Ambitious',
};

export const DIET_LABEL: Record<DietStyle, string> = {
  balanced: 'Balanced',
  high_protein: 'High protein',
  keto: 'Keto',
  mediterranean: 'Mediterranean',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  halal: 'Halal',
  kosher: 'Kosher',
  gluten_free: 'Gluten free',
  dairy_free: 'Dairy free',
  low_fodmap: 'Low FODMAP',
};

export const ALLERGEN_LABEL: Record<Allergen, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soybeans: 'Soy',
  milk: 'Milk',
  tree_nuts: 'Tree nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
};

export const CUISINE_LABEL: Record<Cuisine, string> = {
  american: 'American',
  british: 'British',
  french: 'French',
  italian: 'Italian',
  spanish: 'Spanish',
  greek: 'Greek',
  turkish: 'Turkish',
  middle_eastern: 'Middle Eastern',
  north_african: 'North African',
  west_african: 'West African',
  ethiopian: 'Ethiopian',
  indian: 'Indian',
  thai: 'Thai',
  vietnamese: 'Vietnamese',
  chinese: 'Chinese',
  japanese: 'Japanese',
  korean: 'Korean',
  mexican: 'Mexican',
  caribbean: 'Caribbean',
  brazilian: 'Brazilian',
  peruvian: 'Peruvian',
  german: 'German',
  polish: 'Polish',
  scandinavian: 'Scandinavian',
};

export const SORT_LABEL: Record<RecipeSort, string> = {
  name: 'A–Z',
  quickest: 'Quickest',
  lightest: 'Fewest calories',
  most_protein: 'Most protein',
  batch: 'Best to batch',
};
