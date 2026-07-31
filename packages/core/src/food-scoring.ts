/**
 * Food scoring: ranking the foods someone already eats against what is left of
 * their day.
 *
 * This is the counterpart to `rankRecipes` for the case where there is no recipe
 * library — only a logging history. It answers "what should I eat next" from a
 * person's own habits, which is the only source of suggestions that needs no
 * content, no network and no model call.
 *
 * The signal that matters most is *density*, not size. Someone with 400 kcal and
 * 50 g of protein left does not need a smaller portion of what they usually eat;
 * they need something with more protein per calorie. Ranking on calorie fit
 * alone would hand them a second helping of rice.
 */

import type { MealSlot } from './types.ts';
import type { NutrientVector } from './nutrients.ts';
import { nutrientsForGrams } from './nutrition.ts';

/**
 * How much of the remaining budget a given slot should plausibly take.
 *
 * A snack that fills everything left is not a snack, and a dinner that takes a
 * third of it will leave someone hungry — so "fits" has to mean something
 * different per slot. Meals leave a little headroom deliberately: most people
 * eat something else before the day ends.
 */
export const SLOT_BUDGET_SHARE: Readonly<Record<MealSlot, number>> = {
  breakfast: 0.55,
  lunch: 0.7,
  dinner: 0.8,
  snack: 0.25,
};

/** Portions are suggested in whole steps of this, because 137 g is not advice. */
export const PORTION_STEP_G = 5;

/**
 * A suggested portion is never shrunk below this share of what someone normally
 * eats. Past that point the suggestion stops being the food they recognise, and
 * "60 g of your usual chicken" reads as a diet app playing games.
 */
export const MIN_PORTION_FACTOR = 0.5;

/** Uses at which a food counts as fully established. Beyond it, more logs add nothing. */
export const FAMILIARITY_SATURATION = 8;

/** Weight removed from something already eaten today. A penalty, never a filter. */
export const REPEAT_PENALTY = 0.35;

export interface FoodCandidate {
  /** Stable identity for the caller to map back to its own row. */
  readonly key: string;
  readonly per100g: NutrientVector;
  /** What this person usually eats of it, in grams. */
  readonly typicalGrams: number;
  /** Times logged, ever. */
  readonly uses: number;
  /** Times logged into the slot being ranked for. */
  readonly usesInSlot: number;
  /** Times logged today — drives the repeat penalty. */
  readonly usesToday: number;
}

export interface FoodRankingContext {
  /** What is left of today's targets, after everything logged so far. */
  readonly remaining: NutrientVector;
  readonly mealSlot: MealSlot;
}

export interface RankedFood {
  readonly key: string;
  readonly score: number;
  /** The portion to suggest, already fitted to the remaining budget. */
  readonly grams: number;
  readonly energyKcal: number;
  readonly proteinG: number;
  /** The single biggest reason this surfaced, for the "why am I seeing this" line. */
  readonly topReason: string;
}

/**
 * Shrink a portion until it fits inside the remaining calories.
 *
 * Only ever shrinks, and only down to `MIN_PORTION_FACTOR` — a food that cannot
 * fit even at half the usual amount keeps its honest size and is penalised by
 * the scoring instead. Silently suggesting a token portion so that everything
 * "fits" would make the number meaningless.
 */
export function fitPortion(
  per100g: NutrientVector,
  typicalGrams: number,
  kcalRemaining: number,
): number {
  const kcalPer100 = per100g.energyKcal ?? 0;
  if (kcalRemaining <= 0 || kcalPer100 <= 0 || typicalGrams <= 0) return typicalGrams;

  const kcalAtTypical = (kcalPer100 * typicalGrams) / 100;
  if (kcalAtTypical <= kcalRemaining) return typicalGrams;

  const factor = Math.max(MIN_PORTION_FACTOR, kcalRemaining / kcalAtTypical);
  const fitted = Math.round((typicalGrams * factor) / PORTION_STEP_G) * PORTION_STEP_G;
  return Math.max(PORTION_STEP_G, fitted);
}

/**
 * Rank foods from someone's history for the "what fits" list.
 *
 * Foods with no energy value are dropped — every other term is expressed
 * per-calorie, so an entry without one cannot be reasoned about and would only
 * ever sort by familiarity.
 */
export function rankFoods(
  candidates: readonly FoodCandidate[],
  ctx: FoodRankingContext,
): RankedFood[] {
  const kcalLeft = ctx.remaining.energyKcal ?? 0;
  const proteinLeft = ctx.remaining.proteinG ?? 0;
  const slotTargetKcal = Math.max(0, kcalLeft) * SLOT_BUDGET_SHARE[ctx.mealSlot];

  /** Protein per kcal the rest of the day has to average to land on target. */
  const neededDensity = kcalLeft > 0 && proteinLeft > 0 ? proteinLeft / kcalLeft : 0;

  const ranked: RankedFood[] = [];

  for (const food of candidates) {
    if (food.per100g.energyKcal === undefined) continue;

    const grams = fitPortion(food.per100g, food.typicalGrams, kcalLeft);
    const scaled = nutrientsForGrams(food.per100g, grams);
    const kcal = scaled.energyKcal ?? 0;
    const protein = scaled.proteinG ?? 0;

    let score = 0;
    let topReason = 'One you eat often';
    let topContribution = 0;

    const consider = (contribution: number, reason: string) => {
      score += contribution;
      if (contribution > topContribution) {
        topContribution = contribution;
        topReason = reason;
      }
    };

    if (kcalLeft > 0) {
      // Distance from a slot-appropriate share of what is left.
      const fit = 1 - Math.min(1, Math.abs(kcal - slotTargetKcal) / Math.max(slotTargetKcal, 1));
      consider(fit * 0.25, 'Fits what you have left today');
    } else {
      // Already at or past the target. The useful ranking is now simply the
      // lightest things they like, and saying so is better than hiding the list.
      consider((1 - Math.min(1, kcal / 300)) * 0.25, 'Light — you are already at your target');
    }

    // Protein per calorie against the density the rest of the day needs. This
    // is what stops the list degenerating into "more of the same".
    if (neededDensity > 0 && kcal > 0) {
      const density = protein / kcal;
      consider(Math.min(1, density / neededDensity) * 0.3, 'Protein where you are short');
    }

    if (food.uses > 0) {
      const affinity = food.usesInSlot / food.uses;
      consider(affinity * 0.25, `You usually eat this at ${ctx.mealSlot}`);
      consider(Math.min(1, food.uses / FAMILIARITY_SATURATION) * 0.2, 'One of your regulars');
    }

    // Eaten already today: still offered, because people do repeat meals, but it
    // should not lead a list whose whole job is answering "what next".
    if (food.usesToday > 0) score -= REPEAT_PENALTY;

    ranked.push({
      key: food.key,
      score,
      grams,
      energyKcal: kcal,
      proteinG: protein,
      topReason,
    });
  }

  return ranked.sort((a, b) => b.score - a.score);
}
