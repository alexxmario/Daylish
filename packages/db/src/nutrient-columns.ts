/**
 * Keeps the denormalised macro columns and the `nutrients` JSON in lockstep.
 *
 * The schema stores each row's macros twice — as real columns for fast daily
 * SUMs, and inside the full JSON vector. That is a deliberate trade, and it is
 * only safe if exactly one place writes both. This is that place; feature code
 * should never set `energyKcal` and friends by hand.
 */

import type { NutrientVector } from '@daylish/core';

/** The macros mirrored into real columns. Must match `macroColumns` in the schema. */
export const DENORMALISED_MACRO_KEYS = [
  'energyKcal',
  'proteinG',
  'carbsG',
  'fatG',
  'fiberG',
  'sugarG',
  'satFatG',
  'sodiumMg',
] as const;

export type DenormalisedMacroKey = (typeof DENORMALISED_MACRO_KEYS)[number];

export type MacroColumns = {
  [K in DenormalisedMacroKey]: number | null;
};

/**
 * Build the column values for a nutrient vector.
 *
 * Absent nutrients become SQL NULL rather than 0, preserving the "unknown vs
 * zero" distinction that `sumNutrients` relies on.
 */
export function toMacroColumns(nutrients: NutrientVector): MacroColumns {
  const out = {} as MacroColumns;
  for (const key of DENORMALISED_MACRO_KEYS) {
    out[key] = nutrients[key] ?? null;
  }
  return out;
}

/** The row shape for any table carrying both representations. */
export type WithNutrients = MacroColumns & { nutrients: NutrientVector };

/** Spread into an insert or update so both representations are written together. */
export function withNutrients(nutrients: NutrientVector): WithNutrients {
  return { nutrients, ...toMacroColumns(nutrients) };
}

/**
 * Detect drift between the two representations.
 *
 * Used by a startup integrity check in development: if these ever disagree, a
 * write bypassed `withNutrients` and the daily totals are quietly wrong.
 */
export function findMacroDrift(row: WithNutrients): DenormalisedMacroKey[] {
  const expected = toMacroColumns(row.nutrients);
  return DENORMALISED_MACRO_KEYS.filter((key) => {
    const a = expected[key];
    const b = row[key];
    if (a === null || b === null) return a !== b;
    return Math.abs(a - b) > 1e-6;
  });
}
