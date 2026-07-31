/**
 * Domain vocabulary shared by the app, the database schema and the recipe
 * pipeline. Anything that appears as an enum column or an AI output field is
 * declared here so the three layers cannot drift apart.
 */

export type Sex = 'male' | 'female' | 'unspecified';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very' | 'athlete';

export type GoalKind = 'lose' | 'maintain' | 'gain' | 'recomp';

export type DietStyle =
  | 'balanced'
  | 'high_protein'
  | 'keto'
  | 'mediterranean'
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'halal'
  | 'kosher'
  | 'gluten_free'
  | 'dairy_free'
  | 'low_fodmap';

export type CookingSkill = 'beginner' | 'comfortable' | 'confident';

export type Equipment =
  | 'oven'
  | 'stovetop'
  | 'microwave'
  | 'air_fryer'
  | 'blender'
  | 'food_processor'
  | 'slow_cooker'
  | 'pressure_cooker'
  | 'grill'
  | 'rice_cooker';

/**
 * The fourteen major allergens across EU and US labelling regimes.
 * Recipes are tagged from resolved ingredients, never from the LLM's own claim.
 */
export type Allergen =
  | 'gluten'
  | 'crustaceans'
  | 'eggs'
  | 'fish'
  | 'peanuts'
  | 'soybeans'
  | 'milk'
  | 'tree_nuts'
  | 'celery'
  | 'mustard'
  | 'sesame'
  | 'sulphites'
  | 'lupin'
  | 'molluscs';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * Where a food's numbers came from. Drives the verification badge and, for
 * `ai_estimate`, forces a visible confidence indicator.
 */
export type FoodSource = 'usda' | 'off' | 'user' | 'ai_estimate' | 'branded_manual';

/** How an entry got into the journal. Logged so we can measure logging speed per path. */
export type LogMethod =
  | 'barcode'
  | 'photo'
  | 'voice'
  | 'search'
  | 'quick_add'
  | 'copy'
  | 'recipe'
  /** Tapped straight from a ranked suggestion, without searching for it. */
  | 'suggestion'
  /** Logged from a saved combination — the fastest path in the app. */
  | 'saved_meal';

export type FastingProtocol = '16:8' | '18:6' | '20:4' | 'omad' | '5:2' | 'custom';

export type Cuisine =
  | 'american'
  | 'british'
  | 'french'
  | 'italian'
  | 'spanish'
  | 'greek'
  | 'turkish'
  | 'middle_eastern'
  | 'north_african'
  | 'west_african'
  | 'ethiopian'
  | 'indian'
  | 'thai'
  | 'vietnamese'
  | 'chinese'
  | 'japanese'
  | 'korean'
  | 'mexican'
  | 'caribbean'
  | 'brazilian'
  | 'peruvian'
  | 'german'
  | 'polish'
  | 'scandinavian';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Mood / energy / hunger tags attached to a meal for the food-mood correlation feature. */
export type MoodTag = 'great' | 'good' | 'neutral' | 'sluggish' | 'low';

export interface UserProfile {
  readonly id: string;
  readonly sex: Sex;
  readonly birthDate: string;
  readonly heightCm: number;
  readonly activityLevel: ActivityLevel;
  readonly goal: GoalKind;
  readonly rateKgPerWeek: number;
  readonly dietStyle: DietStyle;
  readonly allergens: readonly Allergen[];
  readonly dislikedIngredients: readonly string[];
  readonly cookingSkill: CookingSkill;
  readonly equipment: readonly Equipment[];
  readonly weeklyBudgetMinor: number | null;
  readonly currency: string;
  readonly maxPrepMinutes: number;
  readonly detailedNutrition: boolean;
}
