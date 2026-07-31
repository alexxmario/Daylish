import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  allergensForIngredient,
  allergensForRecipe,
  isRecipeSafeFor,
} from '../src/allergens.ts';

/**
 * Allergen detection is a safety surface, so these tests lean on the side of
 * over-tagging. A false positive costs a user one irrelevant recipe; a false
 * negative could cost them a hospital visit.
 */
describe('allergensForIngredient', () => {
  test('detects the obvious cases', () => {
    assert.deepEqual(allergensForIngredient('whole milk'), ['milk']);
    assert.deepEqual(allergensForIngredient('peanut butter'), ['peanuts']);
    assert.deepEqual(allergensForIngredient('large egg'), ['eggs']);
    assert.deepEqual(allergensForIngredient('king prawns'), ['crustaceans']);
  });

  test('catches allergens hidden inside compound ingredients', () => {
    // The ones people actually get caught by.
    assert.ok(allergensForIngredient('fish sauce').includes('fish'));
    assert.ok(allergensForIngredient('Worcestershire sauce').includes('fish'));
    assert.ok(allergensForIngredient('soy sauce').includes('gluten'));
    assert.ok(allergensForIngredient('soy sauce').includes('soybeans'));
    assert.ok(allergensForIngredient('tahini').includes('sesame'));
    assert.ok(allergensForIngredient('marzipan').includes('tree_nuts'));
    assert.ok(allergensForIngredient('panko breadcrumbs').includes('gluten'));
    assert.ok(allergensForIngredient('dashi stock').includes('fish'));
  });

  test('does not tag plant milks as dairy', () => {
    for (const name of ['coconut milk', 'almond milk', 'oat milk', 'soy milk']) {
      assert.ok(
        !allergensForIngredient(name).includes('milk'),
        `${name} was wrongly tagged as dairy`,
      );
    }
  });

  test('almond milk is still a tree nut even though it is not dairy', () => {
    const tags = allergensForIngredient('almond milk');
    assert.ok(tags.includes('tree_nuts'));
    assert.ok(!tags.includes('milk'));
  });

  test('avoids the classic substring false positives', () => {
    assert.ok(!allergensForIngredient('nutmeg').includes('tree_nuts'));
    assert.ok(!allergensForIngredient('eggplant').includes('eggs'));
    assert.ok(!allergensForIngredient('butternut squash').includes('milk'));
    assert.ok(!allergensForIngredient('butter beans').includes('milk'));
    assert.ok(!allergensForIngredient('cocoa butter').includes('milk'));
    assert.ok(!allergensForIngredient('water chestnut').includes('tree_nuts'));
    assert.ok(!allergensForIngredient('buckwheat flour').includes('gluten'));
    assert.ok(!allergensForIngredient('gluten-free pasta').includes('gluten'));
  });

  test('single-word patterns match whole words only', () => {
    // "creamy" must not imply cream; "ryegrass" must not imply rye.
    assert.ok(!allergensForIngredient('creamy dressing base').includes('milk'));
    assert.ok(!allergensForIngredient('ryegrass sprouts').includes('gluten'));
  });

  test('handles plurals and casing', () => {
    assert.ok(allergensForIngredient('EGGS').includes('eggs'));
    assert.ok(allergensForIngredient('Walnuts, chopped').includes('tree_nuts'));
    assert.ok(allergensForIngredient('mussels').includes('molluscs'));
  });

  test('an ingredient can carry several allergens at once', () => {
    const tags = allergensForIngredient('miso ramen noodles');
    assert.ok(tags.includes('soybeans'));
    assert.ok(tags.includes('gluten'));
  });

  test('returns nothing for a plain vegetable', () => {
    assert.deepEqual(allergensForIngredient('carrot'), []);
    assert.deepEqual(allergensForIngredient('red onion'), []);
  });

  /**
   * Plant yoghurts and creams.
   *
   * Regression from real USDA data: "Yogurt, coconut milk" was reported as
   * containing milk. Stripping the excluded phrase "coconut milk" left a bare
   * "yogurt", which then matched the dairy marker — so every plant yoghurt in
   * the library was flagged as dairy, and a vegan recipe built on one was
   * rejected as not vegan.
   *
   * The failure direction here is a false *positive*: safe food wrongly hidden
   * from the people who most need the filter to work. The tests below the fold
   * guard the opposite and more dangerous direction.
   */
  test('plant yoghurts and creams are not dairy', () => {
    for (const name of [
      'Yogurt, coconut milk',
      'coconut yogurt',
      'soy yogurt',
      'almond yogurt',
      'oat yogurt',
      'tofu yogurt',
      'coconut cream',
      'oat cream',
    ]) {
      assert.deepEqual(
        allergensForIngredient(name).filter((a) => a === 'milk'),
        [],
        `${name} should not be flagged as dairy`,
      );
    }
  });

  /**
   * The direction that actually matters. A plant-milk phrase must not license
   * real dairy elsewhere in the same text — the same class of bug as the Mars
   * bar below, and the one where being wrong hurts somebody.
   */
  test('a plant yoghurt does not mask real dairy alongside it', () => {
    assert.ok(allergensForIngredient('coconut yogurt with cream').includes('milk'));
    assert.ok(allergensForIngredient('coconut milk and butter').includes('milk'));
    assert.ok(allergensForIngredient('oat cream, cheddar cheese').includes('milk'));
    assert.ok(allergensForIngredient('soy yogurt, whey powder').includes('milk'));
  });

  test('dairy yoghurt is still dairy', () => {
    assert.ok(allergensForIngredient('Yogurt, Greek, plain, whole milk').includes('milk'));
    assert.ok(allergensForIngredient('greek yogurt').includes('milk'));
    assert.ok(allergensForIngredient('yoghurt').includes('milk'));
  });
});

describe('full ingredient lists (packaged products)', () => {
  /**
   * Regression: an exclusion phrase anywhere in the text used to suppress the
   * whole allergen. On a real Mars bar the "Cocoa Butter" cancelled the
   * "Skimmed Milk Powder", hiding milk entirely — a false negative on a major
   * allergen, from real Open Food Facts data.
   */
  test('an exclusion phrase does not suppress a genuine match elsewhere in the list', () => {
    const mars =
      'Sugar, Glucose Syrup, Skimmed Milk Powder, Cocoa Butter, Cocoa Mass, Sunflower Oil, ' +
      'Milk Fat, Barley Malt Extract, Emulsifier (Soya Lecithin), Egg White Powder';
    const tags = allergensForIngredient(mars);
    assert.ok(tags.includes('milk'), 'cocoa butter must not cancel skimmed milk powder');
    assert.ok(tags.includes('gluten'), 'barley malt extract is gluten');
    assert.ok(tags.includes('soybeans'));
    assert.ok(tags.includes('eggs'));
  });

  test('recovers allergens that Open Food Facts fails to declare', () => {
    // OFF tags this product `en:nuts` only, despite the milk and soy below.
    const nutella =
      'Sugar, palm oil, hazelnuts 13%, skimmed milk powder 8.7%, fat-reduced cocoa 7.4%, ' +
      'emulsifier: lecithins (soya), vanillin.';
    const tags = allergensForIngredient(nutella);
    assert.ok(tags.includes('milk'));
    assert.ok(tags.includes('soybeans'));
    assert.ok(tags.includes('tree_nuts'));
  });

  test('a free-from declaration suppresses the allergen across the whole text', () => {
    // A negation is not a phrase exclusion: it applies to everything after it,
    // so the words "pasta" and "flour" downstream must not re-trigger gluten.
    const tags = allergensForIngredient('Gluten-free pasta made with rice flour and maize flour');
    assert.ok(!tags.includes('gluten'));

    assert.ok(!allergensForIngredient('Dairy-free spread, contains butter flavour').includes('milk'));
    assert.ok(!allergensForIngredient('Egg-free mayonnaise').includes('eggs'));
  });

  test('still excludes correctly when the exclusion is the only mention', () => {
    assert.ok(!allergensForIngredient('Water, coconut milk, salt').includes('milk'));
    assert.ok(
      allergensForIngredient('Water, coconut milk, butter, salt').includes('milk'),
      'a real dairy ingredient alongside coconut milk must still register',
    );
  });
});

describe('allergensForRecipe', () => {
  test('unions across ingredients and sorts deterministically', () => {
    const tags = allergensForRecipe([
      'chicken breast',
      'double cream',
      'plain flour',
      'parmesan',
    ]);
    assert.deepEqual(tags, ['gluten', 'milk']);
  });

  test('a fully plant-based recipe carries no dairy tag', () => {
    const tags = allergensForRecipe(['chickpeas', 'coconut milk', 'spinach', 'tomato']);
    assert.ok(!tags.includes('milk'));
  });
});

describe('isRecipeSafeFor', () => {
  test('blocks a recipe containing an avoided allergen', () => {
    assert.equal(isRecipeSafeFor(['gluten', 'milk'], ['milk']), false);
  });

  test('allows a recipe with no overlap', () => {
    assert.equal(isRecipeSafeFor(['gluten'], ['peanuts', 'fish']), true);
  });

  test('a user avoiding nothing can eat anything', () => {
    assert.equal(isRecipeSafeFor(['gluten', 'milk', 'eggs'], []), true);
  });
});
