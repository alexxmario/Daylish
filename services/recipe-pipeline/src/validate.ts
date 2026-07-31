/**
 * Recipe validation and nutrition computation.
 *
 * A generated recipe becomes a Daylish recipe only by passing through here.
 * The order matters: resolve ingredients first, because everything downstream —
 * nutrition, allergens, cost — is derived from resolved data rather than from
 * anything the model asserted.
 */

import {
  allergensForRecipe,
  checkEnergyConsistency,
  checkRecipeSanity,
  nutrientsForGrams,
  nutrientsPerServing,
  scorePrepSuitability,
  sumNutrients,
  type Allergen,
  type GeneratedRecipe,
  type NutrientVector,
  type SanityIssue,
} from '@daylish/core';

import {
  isResolved,
  type IngredientResolver,
  type ResolvedIngredient,
  type UnresolvedIngredient,
} from './resolver.ts';

export interface ValidatedRecipe {
  recipe: GeneratedRecipe;
  /** Per serving, computed from resolved ingredients. */
  nutrients: NutrientVector;
  /** For the whole yield. */
  totalNutrients: NutrientVector;
  ingredients: ResolvedIngredient[];
  /** Derived from resolved ingredient names, never from the model's claim. */
  allergens: Allergen[];
  prepScore: number;
  prepReasons: string[];
  warnings: string[];
  /** Nutrients where at least one ingredient had no data — the totals undercount. */
  incompleteNutrients: string[];
}

export interface RejectedRecipe {
  title: string;
  reasons: string[];
  unresolved: UnresolvedIngredient[];
}

export type ValidationResult =
  | { ok: true; recipe: ValidatedRecipe }
  | { ok: false; rejection: RejectedRecipe };

/**
 * Sanity limits on the computed result.
 *
 * These catch the failure that matters most: a plausible-looking recipe whose
 * gram weights are wrong by an order of magnitude. A model that writes "500"
 * where it meant "5" produces a recipe that reads perfectly and is nutritionally
 * absurd, and only arithmetic on the resolved data will notice.
 */
const LIMITS = {
  minKcalPerServing: 40,
  maxKcalPerServing: 1800,
  maxGramsPerServing: 1500,
  /** Above this share of energy from one macro, something is very likely wrong. */
  maxSingleMacroShare: 0.95,
} as const;

export async function validateRecipe(
  recipe: GeneratedRecipe,
  resolver: IngredientResolver,
): Promise<ValidationResult> {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Structural checks that need no external data.
  const structural: SanityIssue[] = checkRecipeSanity(recipe);
  for (const issue of structural) {
    if (issue.severity === 'error') reasons.push(`${issue.field}: ${issue.message}`);
    else warnings.push(`${issue.field}: ${issue.message}`);
  }

  // 2. Resolve every ingredient against USDA.
  const settled = await Promise.all(
    recipe.ingredients.map((ingredient) => resolver.resolve(ingredient.name, ingredient.grams)),
  );

  const resolved = settled.filter(isResolved);
  const unresolved = settled.filter((r): r is UnresolvedIngredient => !isResolved(r));

  // An unresolved ingredient is fatal. Publishing the recipe anyway would mean
  // publishing macros that silently exclude part of the dish.
  if (unresolved.length > 0) {
    reasons.push(
      `${unresolved.length} of ${recipe.ingredients.length} ingredients could not be matched to nutrition data`,
    );
  }

  if (reasons.length > 0) {
    return { ok: false, rejection: { title: recipe.title, reasons, unresolved } };
  }

  // 3. Compute nutrition from resolved data. This is the only source of macros.
  const contributions = resolved.map((ingredient) =>
    nutrientsForGrams(ingredient.per100g, ingredient.grams),
  );
  const summed = sumNutrients(contributions);
  const totalNutrients = summed.totals;
  const perServing = nutrientsPerServing(totalNutrients, recipe.servings);

  // 4. Sanity-check the computed result.
  const kcal = perServing.energyKcal ?? 0;
  if (kcal < LIMITS.minKcalPerServing) {
    reasons.push(`Computed ${Math.round(kcal)} kcal per serving — implausibly low, check gram weights`);
  }
  if (kcal > LIMITS.maxKcalPerServing) {
    reasons.push(`Computed ${Math.round(kcal)} kcal per serving — implausibly high, check gram weights`);
  }

  const gramsPerServing = resolved.reduce((sum, i) => sum + i.grams, 0) / recipe.servings;
  if (gramsPerServing > LIMITS.maxGramsPerServing) {
    reasons.push(`Serving weighs ${Math.round(gramsPerServing)} g — check gram weights`);
  }

  // Energy must agree with the macros it was computed from. A mismatch here
  // means a USDA entry is internally inconsistent, not that the model erred.
  const energy = checkEnergyConsistency(perServing);
  if (!energy.consistent) {
    warnings.push(
      `Computed energy (${Math.round(energy.statedKcal ?? 0)} kcal) differs from its macros (${Math.round(energy.impliedKcal)} kcal) by ${Math.round((energy.relativeError ?? 0) * 100)}%`,
    );
  }

  const macroKcal = {
    protein: (perServing.proteinG ?? 0) * 4,
    carbs: (perServing.carbsG ?? 0) * 4,
    fat: (perServing.fatG ?? 0) * 9,
  };
  const macroTotal = macroKcal.protein + macroKcal.carbs + macroKcal.fat;
  if (macroTotal > 0) {
    const dominant = Math.max(macroKcal.protein, macroKcal.carbs, macroKcal.fat) / macroTotal;
    // Pure fats and oils legitimately hit this, so only flag multi-ingredient dishes.
    if (dominant > LIMITS.maxSingleMacroShare && resolved.length > 2) {
      warnings.push(`${Math.round(dominant * 100)}% of energy comes from a single macronutrient`);
    }
  }

  // 5. Allergens from resolved ingredient names. The model's `dietStyles` claim
  //    is advisory; this is authoritative.
  const allergens = allergensForRecipe(resolved.map((i) => i.name));

  // A recipe tagged vegan that resolves to dairy or meat is a data error we must
  // not ship — the diet filter is a promise to the user.
  if (recipe.dietStyles.includes('vegan')) {
    const animal = allergens.filter((a) => a === 'milk' || a === 'eggs' || a === 'fish' || a === 'crustaceans' || a === 'molluscs');
    if (animal.length > 0) {
      reasons.push(`Tagged vegan but contains ${animal.join(', ')}`);
    }
  }
  if (recipe.dietStyles.includes('gluten_free') && allergens.includes('gluten')) {
    reasons.push('Tagged gluten free but contains gluten');
  }
  if (recipe.dietStyles.includes('dairy_free') && allergens.includes('milk')) {
    reasons.push('Tagged dairy free but contains milk');
  }

  if (reasons.length > 0) {
    return { ok: false, rejection: { title: recipe.title, reasons, unresolved } };
  }

  const prep = scorePrepSuitability(recipe);

  return {
    ok: true,
    recipe: {
      recipe,
      nutrients: perServing,
      totalNutrients,
      ingredients: resolved,
      allergens,
      prepScore: prep.score,
      prepReasons: [...prep.reasons],
      warnings,
      incompleteNutrients: [...summed.incompleteKeys],
    },
  };
}
