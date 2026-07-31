/**
 * Nutrition math.
 *
 * This module is the single source of truth for converting between grams,
 * portions and servings, and for aggregating nutrient vectors. Both the mobile
 * app and the server-side recipe pipeline import it, so a recipe's macros are
 * computed by the same code that renders the user's daily ring.
 */

import {
  KCAL_PER_GRAM,
  MICRO_KEYS,
  NUTRIENTS,
  NUTRIENT_KEYS,
  type NutrientKey,
  type NutrientVector,
} from './nutrients.ts';

/** Nutrient values are stored per this many grams of food. */
export const NUTRIENT_BASIS_GRAMS = 100;

/** Multiply every present nutrient by `factor`. Absent keys stay absent. */
export function scaleNutrients(v: NutrientVector, factor: number): NutrientVector {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`scaleNutrients: factor must be finite, got ${factor}`);
  }
  const out: NutrientVector = {};
  for (const key of NUTRIENT_KEYS) {
    const value = v[key];
    if (value !== undefined) out[key] = value * factor;
  }
  return out;
}

/**
 * Convert a per-100 g nutrient vector into the amounts for an arbitrary weight.
 * Every portion in the app funnels through here.
 */
export function nutrientsForGrams(per100g: NutrientVector, grams: number): NutrientVector {
  if (grams < 0) throw new RangeError(`nutrientsForGrams: grams must be >= 0, got ${grams}`);
  return scaleNutrients(per100g, grams / NUTRIENT_BASIS_GRAMS);
}

export interface NutrientSum {
  readonly totals: NutrientVector;
  /**
   * Keys where at least one contributor supplied a value and at least one did
   * not — the total is therefore an undercount. The UI surfaces this rather than
   * presenting a partial sum as fact.
   */
  readonly incompleteKeys: readonly NutrientKey[];
}

/**
 * Add nutrient vectors together.
 *
 * Missing values are treated as unknown, not zero. A key appears in `totals`
 * only if some contributor actually reported it, and lands in `incompleteKeys`
 * if any contributor didn't.
 */
export function sumNutrients(vectors: readonly NutrientVector[]): NutrientSum {
  const totals: NutrientVector = {};
  const incompleteKeys: NutrientKey[] = [];

  for (const key of NUTRIENT_KEYS) {
    let sum = 0;
    let present = 0;
    for (const v of vectors) {
      const value = v[key];
      if (value !== undefined) {
        sum += value;
        present += 1;
      }
    }
    if (present > 0) {
      totals[key] = sum;
      if (present < vectors.length) incompleteKeys.push(key);
    }
  }

  return { totals, incompleteKeys };
}

/**
 * Energy implied by the macronutrients, via Atwater general factors.
 * Used to sanity-check third-party and AI-sourced entries against their own macros.
 */
export function energyFromMacros(v: NutrientVector): number {
  return (
    (v.proteinG ?? 0) * KCAL_PER_GRAM.protein +
    (v.carbsG ?? 0) * KCAL_PER_GRAM.carbs +
    (v.fatG ?? 0) * KCAL_PER_GRAM.fat
  );
}

export interface EnergyConsistency {
  readonly statedKcal: number | null;
  readonly impliedKcal: number;
  /** Absolute difference as a fraction of the larger value. `null` when unknowable. */
  readonly relativeError: number | null;
  readonly consistent: boolean;
}

/**
 * Compare a food's stated calories against what its macros imply.
 *
 * Crowdsourced barcode data and LLM output both get this wrong in ways that are
 * obvious arithmetically, so every ingested food runs through it. The tolerance
 * is generous because fiber, sugar alcohols, and rounding on labels all
 * legitimately shift the number.
 */
export function checkEnergyConsistency(v: NutrientVector, tolerance = 0.25): EnergyConsistency {
  const impliedKcal = energyFromMacros(v);
  const statedKcal = v.energyKcal ?? null;

  if (statedKcal === null) {
    return { statedKcal: null, impliedKcal, relativeError: null, consistent: true };
  }

  const denominator = Math.max(statedKcal, impliedKcal);
  // Two foods that are both ~0 kcal agree trivially; avoid dividing by zero.
  if (denominator < 1) {
    return { statedKcal, impliedKcal, relativeError: 0, consistent: true };
  }

  const relativeError = Math.abs(statedKcal - impliedKcal) / denominator;
  return { statedKcal, impliedKcal, relativeError, consistent: relativeError <= tolerance };
}

export interface MicroCoverage {
  readonly key: NutrientKey;
  readonly label: string;
  readonly amount: number;
  readonly unit: string;
  readonly dailyValue: number;
  /** 0–1+, uncapped so the UI can show "over" states without recomputing. */
  readonly fraction: number;
}

/**
 * Micronutrient coverage against FDA Daily Values, for the detailed panel.
 * Nutrients without a published DV are omitted — we show amounts for those, but
 * never a made-up percentage.
 */
export function microCoverage(totals: NutrientVector): MicroCoverage[] {
  const out: MicroCoverage[] = [];
  for (const key of MICRO_KEYS) {
    const def = NUTRIENTS[key];
    const amount = totals[key];
    if (amount === undefined || def.dailyValue === null) continue;
    out.push({
      key,
      label: def.label,
      amount,
      unit: def.unit,
      dailyValue: def.dailyValue,
      fraction: amount / def.dailyValue,
    });
  }
  return out;
}

/** Round for display without touching stored precision. */
export function roundNutrients(v: NutrientVector, decimals = 1): NutrientVector {
  const factor = 10 ** decimals;
  const out: NutrientVector = {};
  for (const key of NUTRIENT_KEYS) {
    const value = v[key];
    if (value !== undefined) out[key] = Math.round(value * factor) / factor;
  }
  return out;
}

/**
 * Split a recipe's total nutrients across servings, then optionally rescale to a
 * different serving count. Recipes are stored at their authored yield; the app
 * scales 1–8 at read time.
 */
export function nutrientsPerServing(
  recipeTotals: NutrientVector,
  authoredServings: number,
): NutrientVector {
  if (!Number.isFinite(authoredServings) || authoredServings <= 0) {
    throw new RangeError(`nutrientsPerServing: servings must be > 0, got ${authoredServings}`);
  }
  return scaleNutrients(recipeTotals, 1 / authoredServings);
}

/** Ingredient weights for a rescaled recipe. Pure multiplication — no rounding surprises. */
export function scaleIngredientGrams(
  grams: number,
  authoredServings: number,
  targetServings: number,
): number {
  if (authoredServings <= 0 || targetServings <= 0) {
    throw new RangeError('scaleIngredientGrams: serving counts must be > 0');
  }
  return (grams * targetServings) / authoredServings;
}

/** Percentage of total energy coming from each macro. Useful for diet-preset checks. */
export function macroEnergySplit(v: NutrientVector): {
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
} {
  const total = energyFromMacros(v);
  if (total <= 0) return { proteinPct: 0, carbsPct: 0, fatPct: 0 };
  return {
    proteinPct: ((v.proteinG ?? 0) * KCAL_PER_GRAM.protein) / total,
    carbsPct: ((v.carbsG ?? 0) * KCAL_PER_GRAM.carbs) / total,
    fatPct: ((v.fatG ?? 0) * KCAL_PER_GRAM.fat) / total,
  };
}
