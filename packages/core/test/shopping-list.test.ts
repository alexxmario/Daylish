import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildShoppingList,
  formatShoppingQuantity,
  shoppingItemKey,
  type ShoppingSource,
} from '../src/shopping-list.ts';

function source(overrides: Partial<ShoppingSource> & { recipeId: string }): ShoppingSource {
  return {
    title: 'A dish',
    servings: 4,
    recipeServings: 4,
    ingredients: [],
    ...overrides,
  };
}

describe('buildShoppingList', () => {
  /** The whole reason the feature exists. */
  test('the same ingredient from two recipes becomes one line', () => {
    const list = buildShoppingList([
      source({
        recipeId: 'a',
        title: 'Shakshuka',
        ingredients: [
          { name: 'garlic', grams: 6, displayQuantity: '2 cloves', optional: false },
        ],
      }),
      source({
        recipeId: 'b',
        title: 'Dal',
        ingredients: [
          { name: 'garlic', grams: 9, displayQuantity: '3 cloves', optional: false },
        ],
      }),
    ]);

    assert.equal(list.length, 1);
    assert.equal(list[0]!.grams, 15);
    assert.equal(list[0]!.sources.length, 2);
    assert.deepEqual(
      list[0]!.sources.map((s) => s.displayQuantity),
      ['2 cloves', '3 cloves'],
    );
  });

  test('case and spacing do not split a line', () => {
    const list = buildShoppingList([
      source({
        recipeId: 'a',
        ingredients: [{ name: 'Olive Oil', grams: 10, displayQuantity: '1 tbsp', optional: false }],
      }),
      source({
        recipeId: 'b',
        ingredients: [{ name: 'olive  oil', grams: 10, displayQuantity: '1 tbsp', optional: false }],
      }),
    ]);

    assert.equal(list.length, 1);
    // The first spelling seen is the one shown.
    assert.equal(list[0]!.name, 'Olive Oil');
  });

  /**
   * The line this deliberately does not cross. Merging these would send someone
   * home with one tin and no fresh tomatoes.
   */
  test('different ingredients that merely look similar stay apart', () => {
    const list = buildShoppingList([
      source({
        recipeId: 'a',
        ingredients: [
          { name: 'tomatoes', grams: 200, displayQuantity: '2', optional: false },
          { name: 'tomatoes, canned', grams: 400, displayQuantity: '1 tin', optional: false },
        ],
      }),
    ]);

    assert.equal(list.length, 2);
  });

  test('quantities scale to the portions you mean to cook', () => {
    const list = buildShoppingList([
      source({
        recipeId: 'a',
        servings: 2,
        recipeServings: 4,
        ingredients: [{ name: 'rice', grams: 300, displayQuantity: '300 g', optional: false }],
      }),
    ]);

    assert.equal(list[0]!.grams, 150);
  });

  test('cooking more than the recipe yields scales up', () => {
    const list = buildShoppingList([
      source({
        recipeId: 'a',
        servings: 8,
        recipeServings: 4,
        ingredients: [{ name: 'rice', grams: 300, displayQuantity: '300 g', optional: false }],
      }),
    ]);

    assert.equal(list[0]!.grams, 600);
  });

  /** One recipe needing it settles it — you cannot half-buy an ingredient. */
  test('optional loses to essential when recipes disagree', () => {
    const list = buildShoppingList([
      source({
        recipeId: 'a',
        ingredients: [{ name: 'feta', grams: 50, displayQuantity: '50 g', optional: true }],
      }),
      source({
        recipeId: 'b',
        ingredients: [{ name: 'feta', grams: 80, displayQuantity: '80 g', optional: false }],
      }),
    ]);

    assert.equal(list.length, 1);
    assert.equal(list[0]!.optional, false);
  });

  test('optional ingredients are kept, marked, and sorted last', () => {
    const list = buildShoppingList([
      source({
        recipeId: 'a',
        ingredients: [
          { name: 'coriander', grams: 5, displayQuantity: 'a handful', optional: true },
          { name: 'onion', grams: 100, displayQuantity: '1', optional: false },
        ],
      }),
    ]);

    assert.deepEqual(list.map((l) => l.name), ['onion', 'coriander']);
    assert.equal(list[1]!.optional, true);
  });

  test('an empty list is empty rather than an error', () => {
    assert.deepEqual(buildShoppingList([]), []);
  });

  test('zero or negative portions is a programming error, not a silent empty list', () => {
    assert.throws(
      () => buildShoppingList([source({ recipeId: 'a', servings: 0 })]),
      RangeError,
    );
  });

  /** Ticking an item off has to survive the list being rebuilt. */
  test('keys are stable across rebuilds and match shoppingItemKey', () => {
    const build = () =>
      buildShoppingList([
        source({
          recipeId: 'a',
          ingredients: [{ name: 'Spring Onions', grams: 30, displayQuantity: '3', optional: false }],
        }),
      ]);

    assert.equal(build()[0]!.key, build()[0]!.key);
    assert.equal(build()[0]!.key, shoppingItemKey('spring onions'));
  });
});

describe('formatShoppingQuantity', () => {
  test('reads like something you would put in a basket', () => {
    assert.equal(formatShoppingQuantity(6), '6 g');
    assert.equal(formatShoppingQuantity(6.4), '6.5 g');
    assert.equal(formatShoppingQuantity(84), '84 g');
    assert.equal(formatShoppingQuantity(347), '345 g');
    assert.equal(formatShoppingQuantity(1247), '1.2 kg');
  });

  test('nothing to buy reads as nothing rather than 0 g', () => {
    assert.equal(formatShoppingQuantity(0), '—');
  });
});
