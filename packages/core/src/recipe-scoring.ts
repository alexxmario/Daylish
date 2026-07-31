/**
 * Recipe scoring: meal-prep suitability, cook-time sanity, and personalised
 * ranking. These are the numbers that make the planner and the feed feel smart,
 * and they are all deterministic — no model call at read time.
 */

import type { Allergen, DietStyle, Equipment, MealSlot } from './types.ts';
import type { NutrientVector } from './nutrients.ts';
import type { GeneratedRecipe } from './schemas.ts';

// ---------------------------------------------------------------------------
// Meal-prep suitability
// ---------------------------------------------------------------------------

export interface PrepSuitability {
  /** 0–100. How well the dish survives being cooked ahead and reheated. */
  readonly score: number;
  readonly reasons: readonly string[];
}

/**
 * Ingredients whose texture collapses on reheating. Present in quantity, they
 * make a dish a poor batch-cook candidate no matter how good the storage notes.
 */
const POOR_REHEAT_MARKERS = [
  'lettuce', 'rocket', 'arugula', 'spinach leaves', 'salad', 'avocado',
  'fried egg', 'poached egg', 'crisp', 'tempura', 'batter', 'meringue',
  'ice cream', 'whipped cream', 'fresh herbs to serve', 'croutons',
];

const GOOD_REHEAT_MARKERS = [
  'stew', 'curry', 'chilli', 'chili', 'soup', 'braise', 'ragu', 'ragù',
  'casserole', 'bake', 'dal', 'daal', 'tagine', 'bolognese', 'stock',
];

export function scorePrepSuitability(recipe: GeneratedRecipe): PrepSuitability {
  const reasons: string[] = [];
  let score = 50;

  if (recipe.fridgeDays >= 4) {
    score += 20;
    reasons.push(`Keeps ${recipe.fridgeDays} days in the fridge`);
  } else if (recipe.fridgeDays >= 2) {
    score += 10;
  } else {
    score -= 15;
    reasons.push('Best eaten the day it is made');
  }

  if (recipe.freezerMonths >= 1) {
    score += 15;
    reasons.push(`Freezes for ${recipe.freezerMonths} month${recipe.freezerMonths > 1 ? 's' : ''}`);
  }

  // Dishes that scale cleanly are worth more on a prep day than fiddly ones.
  if (recipe.servings >= 4) {
    score += 10;
    reasons.push('Scales well for batch cooking');
  }

  const haystack = `${recipe.title} ${recipe.summary} ${recipe.storageNotes}`.toLowerCase();
  if (GOOD_REHEAT_MARKERS.some((m) => haystack.includes(m))) {
    score += 12;
    reasons.push('Flavour improves after a day');
  }

  const ingredientText = recipe.ingredients.map((i) => i.name.toLowerCase()).join(' ');
  const poorMarkers = POOR_REHEAT_MARKERS.filter(
    (m) => ingredientText.includes(m) || haystack.includes(m),
  );
  if (poorMarkers.length > 0) {
    score -= 20;
    reasons.push('Some components are best added fresh');
  }

  // A long passive cook is fine on a prep day; long *active* time is not.
  const activeMinutes =
    recipe.prepMinutes +
    recipe.steps.filter((s) => !s.isPassive).reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  if (activeMinutes > 60) {
    score -= 10;
    reasons.push('Needs over an hour of hands-on time');
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

// ---------------------------------------------------------------------------
// Sanity checks used by the validation pipeline
// ---------------------------------------------------------------------------

export interface SanityIssue {
  readonly field: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

/**
 * Structural checks that catch the ways generated recipes actually go wrong:
 * step timings that contradict the stated cook time, ingredients that are never
 * used, steps that reference ingredients not in the list.
 */
export function checkRecipeSanity(recipe: GeneratedRecipe): SanityIssue[] {
  const issues: SanityIssue[] = [];

  const stepMinutes = recipe.steps.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  const statedMinutes = recipe.prepMinutes + recipe.cookMinutes;
  if (statedMinutes > 0 && stepMinutes > statedMinutes * 2.5) {
    issues.push({
      field: 'steps',
      message: `Step timings total ${stepMinutes} min but the recipe claims ${statedMinutes} min`,
      severity: 'error',
    });
  }

  if (recipe.cookMinutes === 0 && recipe.steps.some((s) => /bake|roast|simmer|boil|fry/i.test(s.instruction))) {
    issues.push({
      field: 'cookMinutes',
      message: 'Cook time is zero but the steps describe cooking',
      severity: 'error',
    });
  }

  // Every non-optional ingredient should be referenced by at least one step.
  const stepText = recipe.steps.map((s) => s.instruction.toLowerCase()).join(' ');
  for (const ing of recipe.ingredients) {
    if (ing.optional) continue;
    const head = ing.name.toLowerCase().split(',')[0]!.trim();
    const keyword = head.split(' ').pop() ?? head;
    if (keyword.length >= 4 && !stepText.includes(keyword)) {
      issues.push({
        field: 'ingredients',
        message: `"${ing.name}" is listed but never used in the steps`,
        severity: 'warning',
      });
    }
  }

  const orders = recipe.steps.map((s) => s.order);
  const expected = Array.from({ length: recipe.steps.length }, (_, i) => i + 1);
  if (orders.join(',') !== expected.join(',')) {
    issues.push({
      field: 'steps',
      message: 'Step numbers are not a contiguous sequence starting at 1',
      severity: 'error',
    });
  }

  // A single ingredient dominating the weight usually means a units mistake
  // (e.g. 500 g of garlic when 5 g was meant).
  const totalGrams = recipe.ingredients.reduce((sum, i) => sum + i.grams, 0);
  for (const ing of recipe.ingredients) {
    if (totalGrams > 0 && ing.grams / totalGrams > 0.75 && recipe.ingredients.length > 3) {
      issues.push({
        field: 'ingredients',
        message: `"${ing.name}" is ${Math.round((ing.grams / totalGrams) * 100)}% of the total weight — likely a units error`,
        severity: 'warning',
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Personalised ranking
// ---------------------------------------------------------------------------

export interface RankingContext {
  /** What is left of today's targets, after everything logged so far. */
  readonly remaining: NutrientVector;
  readonly avoidedAllergens: readonly Allergen[];
  readonly dietStyle: DietStyle;
  readonly availableEquipment: readonly Equipment[];
  readonly maxPrepMinutes: number;
  readonly pantryIngredientNames: readonly string[];
  readonly mealSlot: MealSlot;
  /** Recipe ids the user has cooked or liked, weighted by how recently. */
  readonly affinityByRecipeId: Readonly<Record<string, number>>;
}

export interface RankableRecipe {
  readonly id: string;
  readonly perServing: NutrientVector;
  readonly allergens: readonly Allergen[];
  readonly dietStyles: readonly DietStyle[];
  readonly equipment: readonly Equipment[];
  readonly totalMinutes: number;
  readonly mealSlots: readonly MealSlot[];
  readonly ingredientNames: readonly string[];
}

export interface RankedRecipe {
  readonly id: string;
  readonly score: number;
  /** The single biggest reason this surfaced, for the "why am I seeing this" line. */
  readonly topReason: string;
}

/**
 * Rank recipes for the personalised feed.
 *
 * Hard filters come first and are absolute — an allergen match or missing
 * equipment removes a recipe entirely rather than merely demoting it. Soft
 * signals then compete on a 0–1 scale.
 */
export function rankRecipes(
  recipes: readonly RankableRecipe[],
  ctx: RankingContext,
): RankedRecipe[] {
  const targetKcal = ctx.remaining.energyKcal ?? 0;
  const targetProtein = ctx.remaining.proteinG ?? 0;

  const ranked: RankedRecipe[] = [];

  for (const r of recipes) {
    if (r.allergens.some((a) => ctx.avoidedAllergens.includes(a))) continue;
    if (!r.mealSlots.includes(ctx.mealSlot)) continue;
    if (!r.equipment.every((e) => ctx.availableEquipment.includes(e))) continue;
    if (r.totalMinutes > ctx.maxPrepMinutes) continue;
    if (ctx.dietStyle !== 'balanced' && !r.dietStyles.includes(ctx.dietStyle)) continue;

    let score = 0;
    let topReason = 'Fits your day';
    let topContribution = 0;

    const consider = (contribution: number, reason: string) => {
      score += contribution;
      if (contribution > topContribution) {
        topContribution = contribution;
        topReason = reason;
      }
    };

    // Calorie fit: how close this serving lands to what is left today.
    if (targetKcal > 0) {
      const kcal = r.perServing.energyKcal ?? 0;
      const fit = 1 - Math.min(1, Math.abs(kcal - targetKcal) / Math.max(targetKcal, 1));
      consider(fit * 0.3, 'Fits what you have left today');
    }

    // Protein fit rewards hitting a protein gap without overshooting calories.
    if (targetProtein > 0) {
      const protein = r.perServing.proteinG ?? 0;
      const fit = Math.min(1, protein / targetProtein);
      consider(fit * 0.25, 'Helps you hit your protein');
    }

    // Pantry-first: the differentiator. Recipes you can cook right now win.
    if (r.ingredientNames.length > 0) {
      const pantry = new Set(ctx.pantryIngredientNames.map((n) => n.toLowerCase()));
      const have = r.ingredientNames.filter((n) => pantry.has(n.toLowerCase())).length;
      const coverage = have / r.ingredientNames.length;
      consider(coverage * 0.3, `You already have ${have} of ${r.ingredientNames.length} ingredients`);
    }

    const affinity = ctx.affinityByRecipeId[r.id] ?? 0;
    consider(Math.min(1, affinity) * 0.15, 'Similar to meals you have liked');

    ranked.push({ id: r.id, score, topReason });
  }

  return ranked.sort((a, b) => b.score - a.score);
}
