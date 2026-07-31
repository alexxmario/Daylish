import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FREE_RECIPE_LIMIT,
  PREMIUM_FEATURES,
  entitlementsFor,
} from '../src/entitlements.ts';

/**
 * The tier is data, so it can be asserted rather than argued about. These are
 * the promises the app makes; a change that breaks one should require deleting
 * a test that says why it existed.
 */
describe('entitlements', () => {
  test('premium grants everything free does not', () => {
    const free = entitlementsFor(false);
    const premium = entitlementsFor(true);

    assert.equal(free.recipeLimit, FREE_RECIPE_LIMIT);
    assert.equal(premium.recipeLimit, null, 'null means the whole library');

    for (const key of ['trends', 'adaptiveTargets', 'micronutrients', 'multiRecipeShopping'] as const) {
      assert.equal(free[key], false, `${key} should be paid`);
      assert.equal(premium[key], true, `${key} should be granted by premium`);
    }
  });

  /** Free has to remain a usable calorie tracker, or nobody stays to buy anything. */
  test('the free tier is still a working diary', () => {
    const free = entitlementsFor(false);
    assert.ok(free.recipeLimit !== null && free.recipeLimit >= 50);
  });

  test('the paywall copy matches the flags it is selling', () => {
    assert.ok(PREMIUM_FEATURES.length >= 4);
    for (const feature of PREMIUM_FEATURES) {
      assert.ok(feature.title.length > 0);
      assert.ok(feature.blurb.length > 0);
    }
    const text = PREMIUM_FEATURES.map((f) => `${f.title} ${f.blurb}`).join(' ');
    assert.ok(text.includes(String(FREE_RECIPE_LIMIT)), 'the recipe limit should be stated');
  });
});
