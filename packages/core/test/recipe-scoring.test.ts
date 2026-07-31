import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  rankRecipes,
  type RankableRecipe,
  type RankingContext,
} from '../src/recipe-scoring.ts';

/** A recipe with sensible defaults, so each test states only what it varies. */
function recipe(overrides: Partial<RankableRecipe> & { id: string }): RankableRecipe {
  return {
    perServing: { energyKcal: 500, proteinG: 30 },
    allergens: [],
    dietStyles: ['balanced'],
    equipment: ['stovetop'],
    totalMinutes: 30,
    mealSlots: ['dinner'],
    ingredientNames: [],
    ...overrides,
  };
}

function context(overrides: Partial<RankingContext> = {}): RankingContext {
  return {
    remaining: { energyKcal: 600, proteinG: 40 },
    avoidedAllergens: [],
    dietStyle: 'balanced',
    availableEquipment: ['stovetop', 'oven'],
    maxPrepMinutes: 60,
    pantryIngredientNames: [],
    mealSlot: 'dinner',
    affinityByRecipeId: {},
    ...overrides,
  };
}

/**
 * These were untested until the Ideas screen started ranking the recipe library
 * with them. The hard filters are the ones worth pinning down: each of them can
 * empty the screen, and an over-eager filter looks identical to an empty
 * library from the outside.
 */
describe('rankRecipes — hard filters', () => {
  test('an avoided allergen removes a recipe outright', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'peanut', allergens: ['peanuts'] }), recipe({ id: 'safe' })],
      context({ avoidedAllergens: ['peanuts'] }),
    );
    assert.deepEqual(ranked.map((r) => r.id), ['safe']);
  });

  test('a recipe that does not belong to the slot is not offered', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'breakfast-only', mealSlots: ['breakfast'] }), recipe({ id: 'dinner' })],
      context({ mealSlot: 'dinner' }),
    );
    assert.deepEqual(ranked.map((r) => r.id), ['dinner']);
  });

  test('equipment is a subset test — missing kit removes the recipe', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'needs-oven', equipment: ['stovetop', 'oven'] }), recipe({ id: 'hob-only' })],
      context({ availableEquipment: ['stovetop'] }),
    );
    assert.deepEqual(ranked.map((r) => r.id), ['hob-only']);
  });

  /**
   * The guard behind the fallback in Ideas: an empty kit excludes *everything*,
   * because every recipe needs at least a hob. The screen must not pass a
   * profile's empty equipment list straight through.
   */
  test('an empty kit excludes the entire library', () => {
    const ranked = rankRecipes([recipe({ id: 'a' }), recipe({ id: 'b' })], context({
      availableEquipment: [],
    }));
    assert.equal(ranked.length, 0);
  });

  test('the prep-time ceiling is applied', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'slow', totalMinutes: 90 }), recipe({ id: 'quick', totalMinutes: 20 })],
      context({ maxPrepMinutes: 45 }),
    );
    assert.deepEqual(ranked.map((r) => r.id), ['quick']);
  });

  test('a non-balanced diet style is required, not merely preferred', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'omni' }), recipe({ id: 'vegan', dietStyles: ['vegan'] })],
      context({ dietStyle: 'vegan' }),
    );
    assert.deepEqual(ranked.map((r) => r.id), ['vegan']);
  });

  test('a balanced diet style filters nothing', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'omni' }), recipe({ id: 'vegan', dietStyles: ['vegan'] })],
      context({ dietStyle: 'balanced' }),
    );
    assert.equal(ranked.length, 2);
  });
});

describe('rankRecipes — ordering', () => {
  test('a serving closer to what is left of the day ranks higher', () => {
    const ranked = rankRecipes(
      [
        recipe({ id: 'huge', perServing: { energyKcal: 1400, proteinG: 30 } }),
        recipe({ id: 'fits', perServing: { energyKcal: 590, proteinG: 30 } }),
      ],
      context({ remaining: { energyKcal: 600, proteinG: 40 } }),
    );
    assert.equal(ranked[0]!.id, 'fits');
  });

  /**
   * The calorie term is weighted above the protein term, so the reason line
   * only says "protein" when the calorie fit is the weaker of the two. 500 kcal
   * against 800 remaining is a middling fit; 45 g against a 40 g gap closes it
   * outright.
   */
  test('protein counts when there is a protein gap to close', () => {
    const ranked = rankRecipes(
      [
        recipe({ id: 'lean', perServing: { energyKcal: 500, proteinG: 5 } }),
        recipe({ id: 'protein', perServing: { energyKcal: 500, proteinG: 45 } }),
      ],
      context({ remaining: { energyKcal: 800, proteinG: 40 } }),
    );
    assert.equal(ranked[0]!.id, 'protein');
    assert.equal(ranked[0]!.topReason, 'Helps you hit your protein');
  });

  /** …and when the calorie fit is perfect, that is what it says instead. */
  test('the reason line names whichever signal actually dominated', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'exact', perServing: { energyKcal: 600, proteinG: 45 } })],
      context({ remaining: { energyKcal: 600, proteinG: 40 } }),
    );
    assert.equal(ranked[0]!.topReason, 'Fits what you have left today');
  });

  /** What saving and cooking a recipe buys: the same dish, offered sooner. */
  test('affinity breaks a tie between otherwise identical recipes', () => {
    const ranked = rankRecipes(
      [recipe({ id: 'stranger' }), recipe({ id: 'favourite' })],
      context({ affinityByRecipeId: { favourite: 1 } }),
    );
    assert.equal(ranked[0]!.id, 'favourite');
  });

  test('every ranked recipe carries a reason to show the user', () => {
    const ranked = rankRecipes([recipe({ id: 'a' })], context());
    assert.equal(ranked.length, 1);
    assert.ok(ranked[0]!.topReason.length > 0);
  });
});
