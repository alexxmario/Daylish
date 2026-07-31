import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkEnergyConsistency,
  macroEnergySplit,
  microCoverage,
  nutrientsForGrams,
  nutrientsPerServing,
  scaleIngredientGrams,
  sumNutrients,
} from '../src/nutrition.ts';
import type { NutrientVector } from '../src/nutrients.ts';

/**
 * Real per-100 g values from USDA FoodData Central (SR Legacy / Foundation).
 * Hand-checked against fdc.nal.usda.gov so the arithmetic below is anchored to
 * something external rather than to our own output.
 */
const USDA = {
  /** Chicken breast, skinless, boneless, raw — FDC 171077 */
  chickenBreastRaw: {
    energyKcal: 120,
    proteinG: 22.5,
    carbsG: 0,
    fatG: 2.62,
    sodiumMg: 45,
    potassiumMg: 334,
    ironMg: 0.37,
  } satisfies NutrientVector,

  /** Rice, white, long-grain, regular, raw, unenriched — FDC 169756 */
  whiteRiceRaw: {
    energyKcal: 365,
    proteinG: 7.13,
    carbsG: 79.95,
    fatG: 0.66,
    fiberG: 1.3,
    sodiumMg: 5,
    ironMg: 0.8,
  } satisfies NutrientVector,

  /** Oil, olive, salad or cooking — FDC 171413 */
  oliveOil: {
    energyKcal: 884,
    proteinG: 0,
    carbsG: 0,
    fatG: 100,
    satFatG: 13.8,
    monoFatG: 72.96,
    vitaminEMg: 14.35,
  } satisfies NutrientVector,
} as const;

describe('nutrientsForGrams', () => {
  test('scales a per-100g vector to an arbitrary weight', () => {
    const result = nutrientsForGrams(USDA.chickenBreastRaw, 150);
    assert.equal(result.energyKcal, 180);
    assert.ok(Math.abs(result.proteinG! - 33.75) < 1e-9);
    assert.ok(Math.abs(result.fatG! - 3.93) < 1e-9);
  });

  test('a zero-gram portion contributes nothing', () => {
    const result = nutrientsForGrams(USDA.oliveOil, 0);
    assert.equal(result.energyKcal, 0);
    assert.equal(result.fatG, 0);
  });

  test('absent nutrients stay absent rather than becoming zero', () => {
    const result = nutrientsForGrams(USDA.chickenBreastRaw, 150);
    assert.equal(result.fiberG, undefined, 'chicken has no fiber value in USDA, so we must not invent one');
    assert.ok(!('fiberG' in result));
  });

  test('rejects negative weights', () => {
    assert.throws(() => nutrientsForGrams(USDA.oliveOil, -10), RangeError);
  });
});

describe('sumNutrients', () => {
  test('adds vectors and reports which totals are undercounts', () => {
    const { totals, incompleteKeys } = sumNutrients([
      nutrientsForGrams(USDA.chickenBreastRaw, 100),
      nutrientsForGrams(USDA.whiteRiceRaw, 100),
    ]);

    assert.equal(totals.energyKcal, 485);
    assert.ok(Math.abs(totals.proteinG! - 29.63) < 1e-9);

    // Only rice reports fiber, so the fiber total is real but incomplete.
    assert.equal(totals.fiberG, 1.3);
    assert.ok(incompleteKeys.includes('fiberG'));

    // Both report energy, so that total is complete.
    assert.ok(!incompleteKeys.includes('energyKcal'));
  });

  test('a nutrient no contributor reports is omitted entirely, not zeroed', () => {
    const { totals } = sumNutrients([USDA.chickenBreastRaw, USDA.whiteRiceRaw]);
    assert.equal(totals.vitaminB12Ug, undefined);
  });

  test('summing nothing yields nothing', () => {
    const { totals, incompleteKeys } = sumNutrients([]);
    assert.deepEqual(totals, {});
    assert.deepEqual(incompleteKeys, []);
  });
});

describe('recipe-level nutrition (the pipeline path)', () => {
  /**
   * A realistic pipeline case: 600 g raw chicken, 300 g raw rice, 30 g olive oil,
   * yielding 4 servings. This mirrors exactly what the recipe validator computes,
   * so a regression here would ship wrong macros to users.
   */
  const recipeTotals = sumNutrients([
    nutrientsForGrams(USDA.chickenBreastRaw, 600),
    nutrientsForGrams(USDA.whiteRiceRaw, 300),
    nutrientsForGrams(USDA.oliveOil, 30),
  ]).totals;

  test('recipe totals match hand-computed values', () => {
    // 120*6 + 365*3 + 884*0.3 = 720 + 1095 + 265.2 = 2080.2
    assert.ok(Math.abs(recipeTotals.energyKcal! - 2080.2) < 1e-6);
    // 22.5*6 + 7.13*3 + 0 = 135 + 21.39 = 156.39
    assert.ok(Math.abs(recipeTotals.proteinG! - 156.39) < 1e-6);
    // 2.62*6 + 0.66*3 + 100*0.3 = 15.72 + 1.98 + 30 = 47.7
    assert.ok(Math.abs(recipeTotals.fatG! - 47.7) < 1e-6);
  });

  test('per-serving divides the total', () => {
    const perServing = nutrientsPerServing(recipeTotals, 4);
    assert.ok(Math.abs(perServing.energyKcal! - 520.05) < 1e-6);
    assert.ok(Math.abs(perServing.proteinG! - 39.0975) < 1e-6);
  });

  test('per-serving energy is consistent with per-serving macros', () => {
    const perServing = nutrientsPerServing(recipeTotals, 4);
    const check = checkEnergyConsistency(perServing);
    assert.equal(check.consistent, true, `relative error was ${check.relativeError}`);
  });

  test('rejects a zero or negative serving count', () => {
    assert.throws(() => nutrientsPerServing(recipeTotals, 0), RangeError);
    assert.throws(() => nutrientsPerServing(recipeTotals, -2), RangeError);
  });
});

describe('scaleIngredientGrams', () => {
  test('scales a 4-serving recipe up to 6', () => {
    assert.equal(scaleIngredientGrams(600, 4, 6), 900);
  });

  test('scales down to a single serving', () => {
    assert.equal(scaleIngredientGrams(600, 4, 1), 150);
  });

  test('is identity when the serving count is unchanged', () => {
    assert.equal(scaleIngredientGrams(137.5, 3, 3), 137.5);
  });
});

describe('checkEnergyConsistency', () => {
  test('accepts a label whose macros match its calories', () => {
    const result = checkEnergyConsistency(USDA.chickenBreastRaw);
    assert.equal(result.consistent, true);
  });

  test('flags a food claiming far fewer calories than its macros imply', () => {
    // 30 g protein + 40 g carbs + 20 g fat implies 460 kcal, not 200.
    const bogus: NutrientVector = { energyKcal: 200, proteinG: 30, carbsG: 40, fatG: 20 };
    const result = checkEnergyConsistency(bogus);
    assert.equal(result.consistent, false);
    assert.ok(Math.abs(result.impliedKcal - 460) < 1e-9);
    assert.ok(result.relativeError! > 0.5);
  });

  test('treats a missing calorie value as unknowable rather than wrong', () => {
    const result = checkEnergyConsistency({ proteinG: 10, carbsG: 10, fatG: 5 });
    assert.equal(result.statedKcal, null);
    assert.equal(result.consistent, true);
  });

  test('does not divide by zero on a calorie-free food', () => {
    const result = checkEnergyConsistency({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    assert.equal(result.consistent, true);
    assert.equal(result.relativeError, 0);
  });
});

describe('macroEnergySplit', () => {
  test('olive oil is essentially all fat by energy', () => {
    const split = macroEnergySplit(USDA.oliveOil);
    assert.ok(Math.abs(split.fatPct - 1) < 1e-9);
    assert.equal(split.proteinPct, 0);
  });

  test('returns zeros rather than NaN for an empty vector', () => {
    const split = macroEnergySplit({});
    assert.deepEqual(split, { proteinPct: 0, carbsPct: 0, fatPct: 0 });
  });
});

describe('microCoverage', () => {
  test('reports coverage against daily values', () => {
    const coverage = microCoverage({ vitaminCMg: 45, ironMg: 9 });
    const vitC = coverage.find((c) => c.key === 'vitaminCMg');
    assert.ok(vitC);
    assert.ok(Math.abs(vitC.fraction - 0.5) < 1e-9);
  });

  test('omits nutrients that have no published daily value', () => {
    const coverage = microCoverage({ caffeineMg: 95 });
    assert.equal(coverage.length, 0, 'caffeine has no DV, so no percentage should be invented');
  });
});
