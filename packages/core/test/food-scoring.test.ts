import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_PORTION_FACTOR,
  PORTION_STEP_G,
  fitPortion,
  rankFoods,
  type FoodCandidate,
} from '../src/food-scoring.ts';

/** A candidate with sensible defaults, so each test states only what it varies. */
function candidate(overrides: Partial<FoodCandidate> & { key: string }): FoodCandidate {
  return {
    per100g: { energyKcal: 150, proteinG: 10 },
    typicalGrams: 100,
    uses: 4,
    usesInSlot: 2,
    usesToday: 0,
    ...overrides,
  };
}

function keysOf(candidates: FoodCandidate[], remaining: { energyKcal: number; proteinG: number }) {
  return rankFoods(candidates, { remaining, mealSlot: 'dinner' }).map((r) => r.key);
}

describe('fitPortion', () => {
  test('leaves a portion alone when it already fits', () => {
    // 100 g at 150 kcal/100 g = 150 kcal, well inside 600.
    assert.equal(fitPortion({ energyKcal: 150 }, 100, 600), 100);
  });

  test('shrinks a portion to the remaining calories, rounded to a whole step', () => {
    // 200 g at 200 kcal/100 g = 400 kcal against 300 left → factor 0.75 → 150 g.
    assert.equal(fitPortion({ energyKcal: 200 }, 200, 300), 150);
  });

  test('never shrinks below half the usual portion', () => {
    // 10 kcal of headroom would imply a 5 g portion; the floor holds it at 100 g.
    const grams = fitPortion({ energyKcal: 200 }, 200, 10);
    assert.equal(grams, 200 * MIN_PORTION_FACTOR);
  });

  test('suggests portions in whole steps', () => {
    const grams = fitPortion({ energyKcal: 137 }, 173, 200);
    assert.equal(grams % PORTION_STEP_G, 0);
  });

  test('leaves the portion alone when nothing is left, rather than returning zero', () => {
    assert.equal(fitPortion({ energyKcal: 150 }, 120, 0), 120);
    assert.equal(fitPortion({ energyKcal: 150 }, 120, -400), 120);
  });
});

describe('rankFoods', () => {
  test('prefers protein density when the protein gap outpaces the calorie gap', () => {
    // 400 kcal and 45 g protein left needs 0.1125 g/kcal. Chicken clears it;
    // rice, at the same calories, does not.
    const chicken = candidate({ key: 'chicken', per100g: { energyKcal: 165, proteinG: 31 } });
    const rice = candidate({ key: 'rice', per100g: { energyKcal: 130, proteinG: 2.7 } });

    const order = keysOf([rice, chicken], { energyKcal: 400, proteinG: 45 });
    assert.deepEqual(order, ['chicken', 'rice']);
  });

  test('does not rank on density when the protein target is already met', () => {
    // Same two foods, but with protein banked. Calorie fit and habit decide,
    // and rice lands nearer a dinner-sized share of what is left.
    const chicken = candidate({ key: 'chicken', per100g: { energyKcal: 165, proteinG: 31 } });
    const rice = candidate({
      key: 'rice',
      per100g: { energyKcal: 130, proteinG: 2.7 },
      typicalGrams: 300,
    });

    const order = keysOf([chicken, rice], { energyKcal: 500, proteinG: 0 });
    assert.deepEqual(order, ['rice', 'chicken']);
  });

  test('demotes something already eaten today without hiding it', () => {
    const fresh = candidate({ key: 'fresh' });
    const repeat = candidate({ key: 'repeat', usesToday: 1 });

    const ranked = rankFoods(
      [repeat, fresh],
      { remaining: { energyKcal: 600, proteinG: 40 }, mealSlot: 'dinner' },
    );

    assert.deepEqual(ranked.map((r) => r.key), ['fresh', 'repeat']);
    assert.equal(ranked.length, 2, 'the repeat is still offered');
  });

  test('favours foods this person eats in this slot', () => {
    const breakfastish = candidate({ key: 'porridge', uses: 6, usesInSlot: 0 });
    const dinnerish = candidate({ key: 'salmon', uses: 6, usesInSlot: 6 });

    const order = keysOf([breakfastish, dinnerish], { energyKcal: 600, proteinG: 40 });
    assert.deepEqual(order, ['salmon', 'porridge']);
  });

  test('ranks the lightest options first once the target is spent', () => {
    const heavy = candidate({ key: 'heavy', per100g: { energyKcal: 400, proteinG: 8 } });
    const light = candidate({ key: 'light', per100g: { energyKcal: 40, proteinG: 3 } });

    const ranked = rankFoods(
      [heavy, light],
      { remaining: { energyKcal: -120, proteinG: 10 }, mealSlot: 'snack' },
    );

    assert.equal(ranked[0]?.key, 'light');
    assert.match(ranked[0]?.topReason ?? '', /already at your target/);
  });

  test('drops foods with no energy value rather than sorting them by habit alone', () => {
    const unknown = candidate({ key: 'unknown', per100g: { proteinG: 12 } });
    const known = candidate({ key: 'known' });

    const order = keysOf([unknown, known], { energyKcal: 600, proteinG: 40 });
    assert.deepEqual(order, ['known']);
  });

  test('reports the fitted portion and its nutrition, not the usual portion', () => {
    const big = candidate({
      key: 'big',
      per100g: { energyKcal: 200, proteinG: 10 },
      typicalGrams: 300,
    });

    const [ranked] = rankFoods(
      [big],
      { remaining: { energyKcal: 300, proteinG: 20 }, mealSlot: 'dinner' },
    );

    assert.equal(ranked?.grams, 150, '600 kcal usual, 300 left → half the portion');
    assert.equal(ranked?.energyKcal, 300);
    assert.equal(ranked?.proteinG, 15);
  });
});
