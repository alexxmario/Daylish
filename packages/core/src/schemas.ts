/**
 * Zod schemas for anything crossing a trust boundary: LLM output, third-party
 * food APIs, and user submissions.
 *
 * The recipe schema is the load-bearing one. Note what it does *not* contain:
 * there is no calorie or macro field anywhere in `GeneratedRecipeSchema`. The
 * model is structurally unable to hand us a nutrition number, so it cannot
 * hallucinate one. Nutrition is computed downstream from resolved ingredients.
 */

import { z } from 'zod';
import { NUTRIENT_KEYS } from './nutrients.ts';

export const AllergenSchema = z.enum([
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
]);

export const DietStyleSchema = z.enum([
  'balanced',
  'high_protein',
  'keto',
  'mediterranean',
  'vegetarian',
  'vegan',
  'pescatarian',
  'halal',
  'kosher',
  'gluten_free',
  'dairy_free',
  'low_fodmap',
]);

export const CuisineSchema = z.enum([
  'american', 'british', 'french', 'italian', 'spanish', 'greek', 'turkish',
  'middle_eastern', 'north_african', 'west_african', 'ethiopian', 'indian',
  'thai', 'vietnamese', 'chinese', 'japanese', 'korean', 'mexican',
  'caribbean', 'brazilian', 'peruvian', 'german', 'polish', 'scandinavian',
]);

export const EquipmentSchema = z.enum([
  'oven', 'stovetop', 'microwave', 'air_fryer', 'blender', 'food_processor',
  'slow_cooker', 'pressure_cooker', 'grill', 'rice_cooker',
]);

export const MealSlotSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);

/**
 * One ingredient line as the model produces it.
 *
 * `grams` is mandatory and is the only quantity the pipeline trusts. `displayQuantity`
 * is cosmetic ("2 tbsp") and is never used for arithmetic — cooks read it, the
 * computer ignores it.
 */
export const GeneratedIngredientSchema = z.object({
  name: z.string().min(1).max(120).describe('Plain ingredient name, no brand, no preparation. e.g. "chicken breast, skinless"'),
  grams: z.number().positive().max(5000).describe('Edible weight in grams for the full recipe yield'),
  displayQuantity: z.string().min(1).max(60).describe('Human-readable amount, e.g. "2 tbsp" or "1 medium onion"'),
  preparation: z.string().max(80).nullable().describe('e.g. "finely diced", or null'),
  optional: z.boolean(),
});

export const GeneratedStepSchema = z.object({
  order: z.number().int().min(1),
  instruction: z.string().min(5).max(600),
  durationMinutes: z.number().int().min(0).max(480).nullable().describe('Active or waiting time for this step, null if instantaneous'),
  isPassive: z.boolean().describe('True when the cook is free during this step (baking, simmering) — the prep-day scheduler packs other work into these windows'),
});

/**
 * The complete contract for AI-generated recipes.
 *
 * Every field here is either creative (which the model is good at) or
 * verifiable downstream (which protects us where it is not).
 */
export const GeneratedRecipeSchema = z.object({
  title: z.string().min(3).max(80),
  summary: z.string().min(20).max(300).describe('One or two appetising sentences'),
  cuisine: CuisineSchema,
  mealSlots: z.array(MealSlotSchema).min(1),
  servings: z.number().int().min(1).max(12),
  prepMinutes: z.number().int().min(0).max(240),
  cookMinutes: z.number().int().min(0).max(480),
  difficulty: DifficultySchema,
  equipment: z.array(EquipmentSchema),
  dietStyles: z.array(DietStyleSchema).describe('Diets this recipe is compatible with'),
  ingredients: z.array(GeneratedIngredientSchema).min(2).max(30),
  steps: z.array(GeneratedStepSchema).min(2).max(25),
  storageNotes: z.string().max(300).describe('How it keeps and reheats — feeds the meal-prep suitability score'),
  fridgeDays: z.number().int().min(0).max(7),
  freezerMonths: z.number().int().min(0).max(12),
});

export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;
export type GeneratedIngredient = z.infer<typeof GeneratedIngredientSchema>;
export type GeneratedStep = z.infer<typeof GeneratedStepSchema>;

/** A batch response is a list; asking for several per call amortises the cached prefix. */
export const GeneratedRecipeBatchSchema = z.object({
  recipes: z.array(GeneratedRecipeSchema).min(1).max(10),
});

// ---------------------------------------------------------------------------
// AI photo / voice logging
// ---------------------------------------------------------------------------

/**
 * One recognised item from a photo or a spoken sentence.
 *
 * `confidence` is mandatory and is rendered in the UI on every AI-sourced entry.
 * The model estimates a portion weight, which the user confirms or adjusts
 * before anything is written to the journal.
 */
export const RecognisedFoodSchema = z.object({
  name: z.string().min(1).max(120),
  estimatedGrams: z.number().positive().max(3000),
  confidence: z.number().min(0).max(1).describe('How sure you are this item is present and correctly portioned'),
  searchQuery: z.string().min(1).max(80).describe('Terms to look this food up in a nutrition database'),
  notes: z.string().max(200).nullable(),
});

export const PhotoRecognitionSchema = z.object({
  items: z.array(RecognisedFoodSchema).max(15),
  overallConfidence: z.number().min(0).max(1),
  caveat: z.string().max(300).nullable().describe('Anything ambiguous about the image worth telling the user'),
});

export type PhotoRecognition = z.infer<typeof PhotoRecognitionSchema>;
export type RecognisedFood = z.infer<typeof RecognisedFoodSchema>;

// ---------------------------------------------------------------------------
// Food data
// ---------------------------------------------------------------------------

const nutrientVectorShape = Object.fromEntries(
  NUTRIENT_KEYS.map((key) => [key, z.number().min(0).optional()]),
) as Record<(typeof NUTRIENT_KEYS)[number], z.ZodOptional<z.ZodNumber>>;

export const NutrientVectorSchema = z.object(nutrientVectorShape);

export const FoodSourceSchema = z.enum(['usda', 'off', 'user', 'ai_estimate', 'branded_manual']);

export const FoodPortionSchema = z.object({
  label: z.string().min(1).max(60),
  grams: z.number().positive(),
  isDefault: z.boolean(),
});

export const FoodItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  source: FoodSourceSchema,
  sourceRef: z.string().nullable().describe('USDA fdcId or Open Food Facts code'),
  /** 0–1. Always populated; `usda` entries sit at 1. */
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
  per100g: NutrientVectorSchema,
  portions: z.array(FoodPortionSchema),
  allergens: z.array(AllergenSchema),
});

export type FoodItem = z.infer<typeof FoodItemSchema>;

// ---------------------------------------------------------------------------
// Open Food Facts — only the fields we actually consume
// ---------------------------------------------------------------------------

export const OffProductSchema = z.object({
  code: z.string(),
  product: z
    .object({
      product_name: z.string().optional(),
      product_name_en: z.string().optional(),
      brands: z.string().optional(),
      serving_quantity: z.union([z.number(), z.string()]).optional(),
      serving_size: z.string().optional(),
      allergens_tags: z.array(z.string()).optional(),
      nutriments: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  status: z.number().optional(),
});

export type OffProduct = z.infer<typeof OffProductSchema>;
