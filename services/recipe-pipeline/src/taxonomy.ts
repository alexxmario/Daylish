/**
 * The generation matrix.
 *
 * The library is produced by walking cuisine × diet × meal-slot cells rather
 * than asking for "500 recipes" in a loop. Two reasons:
 *
 *   1. Coverage is explicit and auditable — we can see which cells are thin.
 *   2. Each cell is a separate Batch API request sharing one cached prefix, so
 *      the taxonomy and rules below are billed once, not once per recipe.
 *
 * **A cell's `count` is dishes, not recipes.** Every dish is written three
 * times — light, standard and hearty — so a cell of 3 dishes returns 9 recipe
 * objects. `GeneratedRecipeBatchSchema` caps a response at 10, which is where
 * `MAX_DISHES_PER_CELL` comes from: 4 dishes would be 12 and the whole response
 * would fail validation.
 */

import type { Cuisine, DietStyle, MealSlot } from '@daylish/core';

export interface GenerationCell {
  cuisine: Cuisine;
  dietStyle: DietStyle;
  mealSlot: MealSlot;
  /** Dishes to write. Each yields three recipes, so this is a third of the yield. */
  count: number;
}

/** Three sizes per dish against a 10-recipe response cap leaves room for three. */
export const MAX_DISHES_PER_CELL = 3;

/** Every dish is written light, standard and hearty. */
export const RECIPES_PER_DISH = 3;

/**
 * Cuisine weights.
 *
 * Deliberately not US-centric: the brief calls for European and international
 * coverage from day one, and a recipe library that only knows about American
 * dinners is exactly the weakness we are trying to beat.
 */
const CUISINE_WEIGHTS: ReadonlyArray<readonly [Cuisine, number]> = [
  ['italian', 8],
  ['mediterranean' as Cuisine, 0], // handled as a diet style, not a cuisine
  ['indian', 7],
  ['mexican', 6],
  ['japanese', 5],
  ['thai', 5],
  ['chinese', 5],
  ['french', 5],
  ['greek', 5],
  ['spanish', 4],
  ['turkish', 4],
  ['middle_eastern', 4],
  ['vietnamese', 4],
  ['korean', 4],
  ['american', 4],
  ['british', 4],
  ['north_african', 3],
  ['german', 3],
  ['polish', 2],
  ['scandinavian', 2],
  ['caribbean', 2],
  ['brazilian', 2],
  ['peruvian', 2],
  ['west_african', 2],
  ['ethiopian', 2],
];

/** Diet coverage. `balanced` dominates because most users pick no preference. */
const DIET_WEIGHTS: ReadonlyArray<readonly [DietStyle, number]> = [
  ['balanced', 40],
  ['high_protein', 14],
  ['vegetarian', 14],
  ['vegan', 10],
  ['mediterranean', 8],
  ['gluten_free', 5],
  ['keto', 4],
  ['pescatarian', 3],
  ['dairy_free', 2],
];

/** Dinner leads, but breakfast and snacks matter — Daylish is a whole-day app. */
const SLOT_WEIGHTS: ReadonlyArray<readonly [MealSlot, number]> = [
  ['dinner', 40],
  ['lunch', 28],
  ['breakfast', 20],
  ['snack', 12],
];

/**
 * Build a generation plan totalling roughly `target` recipes.
 *
 * Weights are multiplied and normalised, so the plan is deterministic and
 * reproducible — rerunning the pipeline asks for the same distribution.
 */
export function buildPlan(targetDishes: number, dishesPerCell = MAX_DISHES_PER_CELL): GenerationCell[] {
  const cuisines = CUISINE_WEIGHTS.filter(([, weight]) => weight > 0);
  const totalCuisine = cuisines.reduce((sum, [, w]) => sum + w, 0);
  const totalDiet = DIET_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  const totalSlot = SLOT_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

  // Exact fractional share per cell first. Rounding each independently loses a
  // large fraction of the target across ~300 cells — a naive `Math.round` here
  // produced 408 recipes when asked for 500, because every cell below half a
  // recipe silently became zero.
  const draft: { cell: Omit<GenerationCell, 'count'>; exact: number }[] = [];

  for (const [cuisine, cw] of cuisines) {
    for (const [dietStyle, dw] of DIET_WEIGHTS) {
      for (const [mealSlot, sw] of SLOT_WEIGHTS) {
        const share = (cw / totalCuisine) * (dw / totalDiet) * (sw / totalSlot);
        draft.push({ cell: { cuisine, dietStyle, mealSlot }, exact: share * targetDishes });
      }
    }
  }

  // Largest-remainder apportionment: floor everything, then hand the shortfall
  // to the cells with the biggest fractional parts. The result sums to `target`.
  // Floored *and* capped in one step. Clamping only at the end — which is what
  // this did — silently threw away the surplus of any cell whose exact share
  // exceeded the cap, instead of handing it to a cell with room. Invisible
  // while the cap was 5; at 3 it lost 14 dishes in 500.
  const counts = draft.map((d) => Math.min(Math.floor(d.exact), dishesPerCell));
  let assigned = counts.reduce((sum, n) => sum + n, 0);

  const byRemainder = draft
    .map((d, index) => ({ index, remainder: d.exact - Math.floor(d.exact) }))
    .sort((a, b) => b.remainder - a.remainder);

  let cursor = 0;
  let assignedAtPassStart = assigned;
  while (assigned < targetDishes && cursor < byRemainder.length) {
    const entry = byRemainder[cursor]!;
    if (counts[entry.index]! < dishesPerCell) {
      counts[entry.index]! += 1;
      assigned += 1;
    }
    cursor += 1;

    // Wrap around if every cell has taken one and we still owe dishes — but
    // stop if a whole pass added nothing, which means every cell is at the cap
    // and the target is simply larger than the matrix can hold.
    if (cursor === byRemainder.length && assigned < targetDishes) {
      if (assigned === assignedAtPassStart) break;
      assignedAtPassStart = assigned;
      cursor = 0;
    }
  }

  return draft
    .map((d, index) => ({ ...d.cell, count: Math.min(counts[index]!, dishesPerCell) }))
    .filter((cell) => cell.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Total recipes a plan will request. */
export function planTotal(plan: readonly GenerationCell[]): number {
  return plan.reduce((sum, cell) => sum + cell.count, 0);
}

/** Recipe objects the plan will yield — three per dish. */
export function planRecipeTotal(plan: readonly GenerationCell[]): number {
  return planTotal(plan) * RECIPES_PER_DISH;
}
