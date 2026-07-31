/**
 * The nutrient registry.
 *
 * Every nutrient Daylish tracks is declared here exactly once, keyed by a stable
 * camelCase id. The `usdaNumber` is USDA FoodData Central's `nutrient.number`
 * field (a string, not the internal numeric id) — it is the join key used by the
 * recipe pipeline when it resolves an ingredient to real lab data.
 *
 * Design note: nutrient *values* are always stored per 100 g of edible food.
 * Portions, servings and recipe scaling are all derived from grams, so there is
 * exactly one conversion path in the codebase and one place for it to be wrong.
 */

export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'ug';

/** Which panel a nutrient belongs to in the UI's simple/detailed toggle. */
export type NutrientTier = 'macro' | 'micro';

export interface NutrientDef {
  readonly key: NutrientKey;
  readonly label: string;
  readonly unit: NutrientUnit;
  readonly usdaNumber: string;
  readonly tier: NutrientTier;
  /**
   * Reference daily intake used for the micronutrient coverage bar.
   * Based on FDA Daily Values (adult, 2000 kcal). `null` where no DV exists —
   * we show the amount but never a percentage, rather than inventing a target.
   */
  readonly dailyValue: number | null;
}

export const NUTRIENT_KEYS = [
  // --- Macros & energy -----------------------------------------------------
  'energyKcal',
  'proteinG',
  'carbsG',
  'fatG',
  'fiberG',
  'sugarG',
  'addedSugarG',
  'satFatG',
  'transFatG',
  'monoFatG',
  'polyFatG',
  'cholesterolMg',
  'waterG',
  // --- Minerals ------------------------------------------------------------
  'sodiumMg',
  'potassiumMg',
  'calciumMg',
  'ironMg',
  'magnesiumMg',
  'phosphorusMg',
  'zincMg',
  'copperMg',
  'manganeseMg',
  'seleniumUg',
  // --- Vitamins ------------------------------------------------------------
  'vitaminAUg',
  'vitaminCMg',
  'vitaminDUg',
  'vitaminEMg',
  'vitaminKUg',
  'thiaminMg',
  'riboflavinMg',
  'niacinMg',
  'pantothenicAcidMg',
  'vitaminB6Mg',
  'folateUg',
  'vitaminB12Ug',
  'cholineMg',
  // --- Other ---------------------------------------------------------------
  'caffeineMg',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const NUTRIENTS: Readonly<Record<NutrientKey, NutrientDef>> = {
  energyKcal: { key: 'energyKcal', label: 'Calories', unit: 'kcal', usdaNumber: '208', tier: 'macro', dailyValue: 2000 },
  proteinG: { key: 'proteinG', label: 'Protein', unit: 'g', usdaNumber: '203', tier: 'macro', dailyValue: 50 },
  carbsG: { key: 'carbsG', label: 'Carbs', unit: 'g', usdaNumber: '205', tier: 'macro', dailyValue: 275 },
  fatG: { key: 'fatG', label: 'Fat', unit: 'g', usdaNumber: '204', tier: 'macro', dailyValue: 78 },
  fiberG: { key: 'fiberG', label: 'Fiber', unit: 'g', usdaNumber: '291', tier: 'macro', dailyValue: 28 },
  sugarG: { key: 'sugarG', label: 'Sugars', unit: 'g', usdaNumber: '269', tier: 'macro', dailyValue: null },
  addedSugarG: { key: 'addedSugarG', label: 'Added sugars', unit: 'g', usdaNumber: '539', tier: 'macro', dailyValue: 50 },
  satFatG: { key: 'satFatG', label: 'Saturated fat', unit: 'g', usdaNumber: '606', tier: 'macro', dailyValue: 20 },
  transFatG: { key: 'transFatG', label: 'Trans fat', unit: 'g', usdaNumber: '605', tier: 'macro', dailyValue: null },
  monoFatG: { key: 'monoFatG', label: 'Monounsaturated fat', unit: 'g', usdaNumber: '645', tier: 'micro', dailyValue: null },
  polyFatG: { key: 'polyFatG', label: 'Polyunsaturated fat', unit: 'g', usdaNumber: '646', tier: 'micro', dailyValue: null },
  cholesterolMg: { key: 'cholesterolMg', label: 'Cholesterol', unit: 'mg', usdaNumber: '601', tier: 'micro', dailyValue: 300 },
  waterG: { key: 'waterG', label: 'Water', unit: 'g', usdaNumber: '255', tier: 'micro', dailyValue: null },

  sodiumMg: { key: 'sodiumMg', label: 'Sodium', unit: 'mg', usdaNumber: '307', tier: 'macro', dailyValue: 2300 },
  potassiumMg: { key: 'potassiumMg', label: 'Potassium', unit: 'mg', usdaNumber: '306', tier: 'micro', dailyValue: 4700 },
  calciumMg: { key: 'calciumMg', label: 'Calcium', unit: 'mg', usdaNumber: '301', tier: 'micro', dailyValue: 1300 },
  ironMg: { key: 'ironMg', label: 'Iron', unit: 'mg', usdaNumber: '303', tier: 'micro', dailyValue: 18 },
  magnesiumMg: { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', usdaNumber: '304', tier: 'micro', dailyValue: 420 },
  phosphorusMg: { key: 'phosphorusMg', label: 'Phosphorus', unit: 'mg', usdaNumber: '305', tier: 'micro', dailyValue: 1250 },
  zincMg: { key: 'zincMg', label: 'Zinc', unit: 'mg', usdaNumber: '309', tier: 'micro', dailyValue: 11 },
  copperMg: { key: 'copperMg', label: 'Copper', unit: 'mg', usdaNumber: '312', tier: 'micro', dailyValue: 0.9 },
  manganeseMg: { key: 'manganeseMg', label: 'Manganese', unit: 'mg', usdaNumber: '315', tier: 'micro', dailyValue: 2.3 },
  seleniumUg: { key: 'seleniumUg', label: 'Selenium', unit: 'ug', usdaNumber: '317', tier: 'micro', dailyValue: 55 },

  vitaminAUg: { key: 'vitaminAUg', label: 'Vitamin A', unit: 'ug', usdaNumber: '320', tier: 'micro', dailyValue: 900 },
  vitaminCMg: { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', usdaNumber: '401', tier: 'micro', dailyValue: 90 },
  vitaminDUg: { key: 'vitaminDUg', label: 'Vitamin D', unit: 'ug', usdaNumber: '328', tier: 'micro', dailyValue: 20 },
  vitaminEMg: { key: 'vitaminEMg', label: 'Vitamin E', unit: 'mg', usdaNumber: '323', tier: 'micro', dailyValue: 15 },
  vitaminKUg: { key: 'vitaminKUg', label: 'Vitamin K', unit: 'ug', usdaNumber: '430', tier: 'micro', dailyValue: 120 },
  thiaminMg: { key: 'thiaminMg', label: 'Thiamin (B1)', unit: 'mg', usdaNumber: '404', tier: 'micro', dailyValue: 1.2 },
  riboflavinMg: { key: 'riboflavinMg', label: 'Riboflavin (B2)', unit: 'mg', usdaNumber: '405', tier: 'micro', dailyValue: 1.3 },
  niacinMg: { key: 'niacinMg', label: 'Niacin (B3)', unit: 'mg', usdaNumber: '406', tier: 'micro', dailyValue: 16 },
  pantothenicAcidMg: { key: 'pantothenicAcidMg', label: 'Pantothenic acid (B5)', unit: 'mg', usdaNumber: '410', tier: 'micro', dailyValue: 5 },
  vitaminB6Mg: { key: 'vitaminB6Mg', label: 'Vitamin B6', unit: 'mg', usdaNumber: '415', tier: 'micro', dailyValue: 1.7 },
  folateUg: { key: 'folateUg', label: 'Folate', unit: 'ug', usdaNumber: '417', tier: 'micro', dailyValue: 400 },
  vitaminB12Ug: { key: 'vitaminB12Ug', label: 'Vitamin B12', unit: 'ug', usdaNumber: '418', tier: 'micro', dailyValue: 2.4 },
  cholineMg: { key: 'cholineMg', label: 'Choline', unit: 'mg', usdaNumber: '421', tier: 'micro', dailyValue: 550 },

  caffeineMg: { key: 'caffeineMg', label: 'Caffeine', unit: 'mg', usdaNumber: '262', tier: 'micro', dailyValue: null },
};

/** Reverse index: USDA nutrient number → our key. Used by the ingredient resolver. */
export const NUTRIENT_BY_USDA_NUMBER: Readonly<Record<string, NutrientKey>> = Object.freeze(
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [NUTRIENTS[k].usdaNumber, k])),
);

/**
 * A set of nutrient amounts.
 *
 * Deliberately `Partial`: real food data is incomplete, and a missing value means
 * "we don't know", not "zero". Code that sums vectors must decide explicitly how
 * to treat absence — see `sumNutrients`, which tracks it rather than hiding it.
 */
export type NutrientVector = Partial<Record<NutrientKey, number>>;

export const MACRO_KEYS = NUTRIENT_KEYS.filter((k) => NUTRIENTS[k].tier === 'macro');
export const MICRO_KEYS = NUTRIENT_KEYS.filter((k) => NUTRIENTS[k].tier === 'micro');

/** Energy contributed per gram of each macronutrient (Atwater general factors). */
export const KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
  alcohol: 7,
} as const;
