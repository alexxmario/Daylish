import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { GeneratedRecipe } from '@daylish/core';

import { IngredientResolver, scoreMatch, type UsdaFood } from '../src/resolver.ts';
import { validateRecipe } from '../src/validate.ts';

/**
 * A stubbed USDA endpoint.
 *
 * Values are real per-100 g figures from FoodData Central, so the arithmetic
 * these tests assert is the arithmetic that will run in production — the only
 * thing replaced is the network.
 */
const USDA_FIXTURES: Record<string, UsdaFood[]> = {
  'chicken, broilers or fryers, breast, meat only, raw': [
    {
      fdcId: 171077,
      description: 'Chicken, broilers or fryers, breast, meat only, raw',
      dataType: 'SR Legacy',
      foodNutrients: [
        { nutrientNumber: '208', value: 120 },
        { nutrientNumber: '203', value: 22.5 },
        { nutrientNumber: '205', value: 0 },
        { nutrientNumber: '204', value: 2.62 },
        { nutrientNumber: '307', value: 45 },
      ],
    },
  ],
  'pasta, dry, enriched': [
    {
      fdcId: 168927,
      description: 'Pasta, dry, enriched',
      dataType: 'SR Legacy',
      foodNutrients: [
        { nutrientNumber: '208', value: 371 },
        { nutrientNumber: '203', value: 13.04 },
        { nutrientNumber: '205', value: 74.67 },
        { nutrientNumber: '204', value: 1.51 },
        { nutrientNumber: '291', value: 3.2 },
      ],
    },
  ],
  // Keyed by the *aliased* search term, like `spaghetti` → `pasta, dry, enriched`
  // above: the resolver rewrites ambiguous names before it searches.
  'oil, olive, salad or cooking': [
    {
      fdcId: 171413,
      description: 'Oil, olive, salad or cooking',
      dataType: 'SR Legacy',
      foodNutrients: [
        { nutrientNumber: '208', value: 884 },
        { nutrientNumber: '203', value: 0 },
        { nutrientNumber: '205', value: 0 },
        { nutrientNumber: '204', value: 100 },
      ],
    },
  ],
  'cream, heavy whipping': [
    {
      fdcId: 170859,
      description: 'Cream, fluid, heavy whipping',
      dataType: 'SR Legacy',
      foodNutrients: [
        { nutrientNumber: '208', value: 340 },
        { nutrientNumber: '203', value: 2.84 },
        { nutrientNumber: '205', value: 2.79 },
        { nutrientNumber: '204', value: 36.08 },
      ],
    },
  ],
  garlic: [
    {
      fdcId: 169230,
      description: 'Garlic, raw',
      dataType: 'SR Legacy',
      foodNutrients: [
        { nutrientNumber: '208', value: 149 },
        { nutrientNumber: '203', value: 6.36 },
        { nutrientNumber: '205', value: 33.06 },
        { nutrientNumber: '204', value: 0.5 },
      ],
    },
  ],
};

function stubFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
    const query = (body.query ?? '').toLowerCase();
    const foods = USDA_FIXTURES[query] ?? [];
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ foods }),
    } as Response;
  }) as unknown as typeof fetch;
}

function makeResolver() {
  return new IngredientResolver({ apiKey: 'TEST', fetchImpl: stubFetch() });
}

/** A well-formed recipe: 4 servings of chicken pasta. */
function baseRecipe(overrides: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return {
    title: 'Garlic chicken spaghetti',
    summary: 'A fast weeknight pasta with garlic, chicken and plenty of black pepper.',
    cuisine: 'italian',
    mealSlots: ['dinner'],
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    difficulty: 'easy',
    equipment: ['stovetop'],
    dietStyles: ['balanced'],
    ingredients: [
      { name: 'spaghetti', grams: 400, displayQuantity: '400 g', preparation: null, optional: false },
      { name: 'chicken breast', grams: 500, displayQuantity: '2 breasts', preparation: 'sliced', optional: false },
      { name: 'olive oil', grams: 30, displayQuantity: '2 tbsp', preparation: null, optional: false },
      { name: 'garlic', grams: 15, displayQuantity: '4 cloves', preparation: 'sliced', optional: false },
    ],
    steps: [
      { order: 1, instruction: 'Boil the spaghetti in salted water until al dente.', durationMinutes: 10, isPassive: true },
      { order: 2, instruction: 'Fry the chicken breast in olive oil until golden.', durationMinutes: 8, isPassive: false },
      { order: 3, instruction: 'Add the garlic and cook for a minute more.', durationMinutes: 1, isPassive: false },
      { order: 4, instruction: 'Toss the drained pasta through the pan and serve.', durationMinutes: 2, isPassive: false },
    ],
    storageNotes: 'Keeps two days in the fridge; reheat with a splash of water.',
    fridgeDays: 2,
    freezerMonths: 0,
    ...overrides,
  };
}

describe('validateRecipe — the happy path', () => {
  test('accepts a well-formed recipe and computes nutrition from USDA data', async () => {
    const result = await validateRecipe(baseRecipe(), makeResolver());
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Hand-computed totals:
    //   spaghetti 400 g  → 371  * 4.0 = 1484 kcal
    //   chicken   500 g  → 120  * 5.0 =  600 kcal
    //   olive oil  30 g  → 884  * 0.3 =  265.2 kcal
    //   garlic     15 g  → 149  * 0.15 =  22.35 kcal
    //                                   ---------
    //                                    2371.55 kcal over 4 servings = 592.8875
    const perServing = result.recipe.nutrients.energyKcal ?? 0;
    assert.ok(
      Math.abs(perServing - 592.8875) < 0.001,
      `expected 592.8875 kcal per serving, got ${perServing}`,
    );

    // Protein: 13.04*4 + 22.5*5 + 0 + 6.36*0.15 = 52.16 + 112.5 + 0.954 = 165.614 / 4
    assert.ok(Math.abs((result.recipe.nutrients.proteinG ?? 0) - 41.4035) < 0.001);
  });

  test('every ingredient is matched to a real FDC id', async () => {
    const result = await validateRecipe(baseRecipe(), makeResolver());
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.recipe.ingredients.length, 4);
    for (const ingredient of result.recipe.ingredients) {
      assert.ok(ingredient.fdcId > 0, `${ingredient.name} has no FDC id`);
      assert.ok(ingredient.per100g.energyKcal !== undefined);
    }
  });

  test('reports which nutrients are undercounted rather than hiding it', async () => {
    const result = await validateRecipe(baseRecipe(), makeResolver());
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Only pasta carries fibre in the fixtures, so the fibre total is partial.
    assert.ok(result.recipe.incompleteNutrients.includes('fiberG'));
  });

  test('scores meal-prep suitability', async () => {
    const result = await validateRecipe(baseRecipe(), makeResolver());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.recipe.prepScore >= 0 && result.recipe.prepScore <= 100);
  });
});

describe('validateRecipe — rejections', () => {
  test('rejects a recipe with an ingredient it cannot match', async () => {
    const recipe = baseRecipe({
      ingredients: [
        ...baseRecipe().ingredients,
        { name: 'nduja from a specific shop', grams: 50, displayQuantity: '50 g', preparation: null, optional: false },
      ],
    });

    const result = await validateRecipe(recipe, makeResolver());
    assert.equal(result.ok, false, 'an unmatched ingredient must reject the recipe');
    if (result.ok) return;
    assert.match(result.rejection.reasons.join(' '), /could not be matched/);
    assert.equal(result.rejection.unresolved.length, 1);
  });

  /**
   * The failure this pipeline exists to catch: the recipe reads perfectly, but a
   * gram weight is off by an order of magnitude. Only arithmetic on resolved
   * data notices.
   */
  test('rejects an order-of-magnitude gram error that reads plausibly', async () => {
    const recipe = baseRecipe({
      ingredients: [
        { name: 'spaghetti', grams: 4000, displayQuantity: '400 g', preparation: null, optional: false },
        { name: 'chicken breast', grams: 500, displayQuantity: '2 breasts', preparation: 'sliced', optional: false },
        { name: 'olive oil', grams: 30, displayQuantity: '2 tbsp', preparation: null, optional: false },
        { name: 'garlic', grams: 15, displayQuantity: '4 cloves', preparation: 'sliced', optional: false },
      ],
    });

    const result = await validateRecipe(recipe, makeResolver());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.rejection.reasons.join(' '), /implausibly high|check gram weights/);
  });

  /**
   * The mirror of the previous case: weights given in the wrong unit entirely
   * (milligrams read as grams). The recipe still reads fine, and only the
   * computed energy reveals that a "serving" is a rounding error.
   */
  test('rejects weights that are off by a factor of a thousand', async () => {
    const recipe = baseRecipe({
      servings: 1,
      ingredients: [
        { name: 'spaghetti', grams: 0.4, displayQuantity: '400 g', preparation: null, optional: false },
        { name: 'chicken breast', grams: 0.5, displayQuantity: '2 breasts', preparation: 'sliced', optional: false },
        { name: 'olive oil', grams: 0.03, displayQuantity: '2 tbsp', preparation: null, optional: false },
        { name: 'garlic', grams: 0.015, displayQuantity: '4 cloves', preparation: 'sliced', optional: false },
      ],
    });

    const result = await validateRecipe(recipe, makeResolver());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.rejection.reasons.join(' '), /implausibly low/);
  });

  /**
   * A small portion is not an error. Splitting a normal recipe twelve ways
   * gives ~198 kcal per serving, which is a legitimate snack-sized portion —
   * the plausibility floor exists to catch unit mistakes, not to police how
   * finely someone divides a dish.
   */
  test('accepts a legitimately small portion', async () => {
    const result = await validateRecipe(baseRecipe({ servings: 12 }), makeResolver());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok((result.recipe.nutrients.energyKcal ?? 0) > 150);
  });

  /**
   * The diet filter is a promise to the user, so a mislabelled recipe must never
   * ship. The model's own `dietStyles` claim is advisory; allergens derived from
   * resolved ingredients are authoritative.
   */
  test('rejects a vegan-tagged recipe that resolves to animal products', async () => {
    const recipe = baseRecipe({
      dietStyles: ['vegan'],
      ingredients: [
        { name: 'spaghetti', grams: 400, displayQuantity: '400 g', preparation: null, optional: false },
        { name: 'double cream', grams: 200, displayQuantity: '200 ml', preparation: null, optional: false },
        { name: 'garlic', grams: 15, displayQuantity: '4 cloves', preparation: 'sliced', optional: false },
      ],
      steps: [
        { order: 1, instruction: 'Boil the spaghetti until al dente.', durationMinutes: 10, isPassive: true },
        { order: 2, instruction: 'Warm the double cream with the garlic.', durationMinutes: 5, isPassive: false },
        { order: 3, instruction: 'Toss together and serve.', durationMinutes: 2, isPassive: false },
      ],
    });

    const result = await validateRecipe(recipe, makeResolver());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.rejection.reasons.join(' '), /vegan but contains milk/);
  });

  test('rejects a gluten-free tag on a recipe containing pasta', async () => {
    const result = await validateRecipe(baseRecipe({ dietStyles: ['gluten_free'] }), makeResolver());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.rejection.reasons.join(' '), /gluten free but contains gluten/);
  });

  test('rejects steps that are not a contiguous sequence', async () => {
    const recipe = baseRecipe({
      steps: [
        { order: 1, instruction: 'Boil the spaghetti in salted water.', durationMinutes: 10, isPassive: true },
        { order: 3, instruction: 'Fry the chicken breast in olive oil.', durationMinutes: 8, isPassive: false },
        { order: 4, instruction: 'Add the garlic and toss the pasta through.', durationMinutes: 2, isPassive: false },
      ],
    });
    const result = await validateRecipe(recipe, makeResolver());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.rejection.reasons.join(' '), /contiguous sequence/);
  });
});

describe('allergen derivation', () => {
  test('tags allergens from resolved ingredients, not from the model', async () => {
    const result = await validateRecipe(baseRecipe(), makeResolver());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Pasta implies gluten even though nothing in the recipe declared it.
    assert.ok(result.recipe.allergens.includes('gluten'));
  });
});

/**
 * Every case below was an actual wrong match, observed against the live USDA
 * API before the head-noun rule existed. Each one scored *well* — the query's
 * tokens all appeared in the description — and produced a confidently wrong
 * calorie figure that the app would have labelled "USDA · verified".
 *
 * This is the failure mode the whole project is built to avoid, and it is
 * invisible from the outside: nothing rejects, nothing warns, the number is
 * simply wrong. Hence a regression test per case.
 */
describe('scoreMatch — the head noun decides what a food is', () => {
  const food = (description: string, dataType = 'SR Legacy'): UsdaFood => ({
    fdcId: 1,
    description,
    dataType,
    foodNutrients: [{ nutrientNumber: '208', value: 100 }],
  });

  const cases: { query: string; right: string; wrong: string; note: string }[] = [
    { query: 'milk', right: 'Milk, whole', wrong: 'Crackers, milk', note: 'a biscuit' },
    { query: 'banana', right: 'Bananas, raw', wrong: 'Melon, banana', note: 'a melon' },
    { query: 'onion', right: 'Onions, raw', wrong: 'Spices, onion powder', note: '~341 vs ~40 kcal' },
    { query: 'spinach', right: 'Spinach, raw', wrong: 'Spinach souffle', note: 'a baked egg dish' },
    { query: 'walnuts', right: 'Nuts, walnuts, english', wrong: 'Walnut oil', note: 'oil, not nuts' },
    {
      query: 'eggs',
      right: 'Egg, whole, raw, fresh',
      wrong: 'Eggs, Grade A, Large, egg white',
      note: '~143 vs ~52 kcal',
    },
  ];

  for (const { query, right, wrong, note } of cases) {
    test(`"${query}" prefers ${right} over ${wrong} (${note})`, () => {
      assert.ok(
        scoreMatch(query, food(right)) > scoreMatch(query, food(wrong)),
        `${right} (${scoreMatch(query, food(right)).toFixed(2)}) should beat ` +
          `${wrong} (${scoreMatch(query, food(wrong)).toFixed(2)})`,
      );
    });
  }

  test('a food that merely mentions the query falls below the accept threshold', () => {
    // 0.45 is the resolver's default `minConfidence`. "Crackers, milk" contains
    // every token of "milk", so coverage alone would have accepted it.
    assert.ok(scoreMatch('milk', food('Crackers, milk')) < 0.45);
    assert.ok(scoreMatch('banana', food('Melon, banana')) < 0.45);
  });

  test('USDA category shelves do not count against a match', () => {
    // "Spices, cinnamon, ground" is the correct entry for ground cinnamon, but
    // its head noun is the shelf it sits on, not the food.
    assert.ok(scoreMatch('ground cinnamon', food('Spices, cinnamon, ground')) >= 0.45);
    assert.ok(scoreMatch('walnuts', food('Nuts, walnuts, english')) >= 0.45);
  });

  test('a plain entry beats a qualified one, but neutral qualifiers are free', () => {
    // "raw" is how USDA spells "the ordinary version of this".
    assert.ok(scoreMatch('spinach', food('Spinach, raw')) > scoreMatch('spinach', food('Spinach, cooked, boiled, drained')));
  });

  /**
   * Each of the following shipped a wrong calorie figure at high confidence.
   * They are grouped because they share one cause: a token that means "this is
   * a different food" was being treated as free.
   */
  const regressions: { query: string; right: string; wrong: string; note: string }[] = [
    {
      query: 'black beans, canned',
      right: 'Beans, black turtle, mature seeds, canned',
      wrong: 'Soup, black bean, canned, condensed',
      note: 'a soup made from X is not X',
    },
    { query: 'tortilla', right: 'Tortilla, corn', wrong: 'Soup, tortilla', note: 'likewise' },
    {
      query: 'jasmine rice',
      right: 'Rice, white, long-grain, regular, raw, unenriched',
      wrong: 'Soup, rice',
      note: 'likewise',
    },
    {
      query: 'couscous',
      right: 'Couscous, dry',
      wrong: 'Couscous, cooked',
      note: '376 vs 112 kcal — a recipe weighs what the cook puts in',
    },
    {
      query: 'beef stock',
      right: 'Soup, stock, beef, home-prepared',
      wrong: 'Soup, beef broth, cubed, dry',
      note: 'a cube is a concentrate: 13 vs 170 kcal',
    },
    { query: 'bacon', right: 'Bacon, pork', wrong: 'Bacon, meatless', note: 'an analogue is not the food' },
    {
      query: 'fish sauce',
      right: 'Sauce, fish, ready-to-serve',
      wrong: 'Sauce, enchilada, red, mild',
      note: 'the query may name the category in a cook’s word order',
    },
  ];

  for (const { query, right, wrong, note } of regressions) {
    test(`"${query}" prefers ${right} over ${wrong} (${note})`, () => {
      assert.ok(
        scoreMatch(query, food(right)) > scoreMatch(query, food(wrong)),
        `${right} (${scoreMatch(query, food(right)).toFixed(2)}) should beat ` +
          `${wrong} (${scoreMatch(query, food(wrong)).toFixed(2)})`,
      );
    });
  }

  test('USDA files stocks and broths under Soup, and those are real', () => {
    // The fix above must not throw out the entries that are genuinely filed
    // under `Soup,` — a blanket penalty would have.
    assert.ok(scoreMatch('beef stock', food('Soup, stock, beef, home-prepared')) >= 0.45);
    assert.ok(scoreMatch('chicken broth', food('Soup, chicken broth, ready-to-serve')) >= 0.45);
  });

  test('a stock made from a different animal is rejected outright', () => {
    // `vegetable stock` matched "Soup, stock, fish, home-prepared" at 0.73 and
    // silently put a fish product into seven recipes tagged vegan. `fish` is a
    // category shelf at the front of a description and content anywhere else.
    assert.ok(scoreMatch('vegetable stock', food('Soup, stock, fish, home-prepared')) < 0.45);
  });

  /**
   * Scoring cannot separate two entries that share a head noun and carry one
   * unasked-for token each — "Bread, white" and "Bread, cheese" score
   * identically, and so do the sweet pepper and the cayenne. That is not a bug
   * in the score; it is the point at which the ingredient name is genuinely
   * ambiguous, and it is what the alias map is for. Resolving through the real
   * resolver exercises both halves together.
   */
  describe('ambiguous staples are disambiguated by alias, not by score', () => {
    function resolverReturning(foods: UsdaFood[]) {
      const fetchImpl = (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ foods }),
      })) as unknown as typeof fetch;
      return new IngredientResolver({ apiKey: 'TEST', fetchImpl });
    }

    test('"bread" resolves to plain white bread, not cheese bread', async () => {
      const resolver = resolverReturning([food('Bread, cheese'), food('Bread, white')]);
      const out = await resolver.resolve('bread', 100);
      assert.ok('fdcId' in out, 'bread should resolve');
      assert.equal(out.matchedDescription, 'Bread, white');
    });

    test('"red bell pepper" resolves to a sweet pepper, not cayenne', async () => {
      const resolver = resolverReturning([
        food('Spices, pepper, red or cayenne'),
        food('Peppers, sweet, red, raw'),
      ]);
      const out = await resolver.resolve('red bell pepper', 100);
      assert.ok('fdcId' in out, 'red bell pepper should resolve');
      assert.equal(out.matchedDescription, 'Peppers, sweet, red, raw');
    });

    /**
     * English compounds are head-final ("butter *beans*"); USDA descriptions are
     * head-initial. Matching on the head alone sent butter beans to clarified
     * butter — 876 kcal/100 g against 78, which inflated one traybake from 765
     * to 1639 kcal before anything caught it.
     */
    test('"butter beans" resolves to lima beans, not clarified butter', async () => {
      const resolver = resolverReturning([
        food('Butter, Clarified butter (ghee)'),
        food('Lima beans, large, mature seeds, canned'),
      ]);
      const out = await resolver.resolve('butter beans', 100);
      assert.ok('fdcId' in out, 'butter beans should resolve');
      assert.equal(out.matchedDescription, 'Lima beans, large, mature seeds, canned');
    });

    test('"potato" resolves to a raw potato, not a potato pancake', async () => {
      const resolver = resolverReturning([
        food('Potato pancakes'),
        food('Potatoes, flesh and skin, raw'),
      ]);
      const out = await resolver.resolve('potato', 100);
      assert.ok('fdcId' in out, 'potato should resolve');
      assert.equal(out.matchedDescription, 'Potatoes, flesh and skin, raw');
    });

    test('"courgette" resolves to raw courgette, not the pickled jar', async () => {
      const resolver = resolverReturning([
        food('Zucchini, pickled'),
        food('Squash, summer, zucchini, includes skin, raw'),
      ]);
      const out = await resolver.resolve('courgette', 100);
      assert.ok('fdcId' in out, 'courgette should resolve');
      assert.equal(out.matchedDescription, 'Squash, summer, zucchini, includes skin, raw');
    });
  });
});

describe('scoreMatch', () => {
  test('prefers lab-analysed data over branded submissions', () => {
    const foundation: UsdaFood = {
      fdcId: 1,
      description: 'Olive oil',
      dataType: 'Foundation',
      foodNutrients: [{ nutrientNumber: '208', value: 884 }],
    };
    const branded: UsdaFood = {
      fdcId: 2,
      description: 'Olive oil',
      dataType: 'Branded',
      foodNutrients: [{ nutrientNumber: '208', value: 884 }],
    };
    assert.ok(scoreMatch('olive oil', foundation) > scoreMatch('olive oil', branded));
  });

  test('heavily penalises an entry with no energy value', () => {
    const withEnergy: UsdaFood = {
      fdcId: 1,
      description: 'Garlic, raw',
      dataType: 'SR Legacy',
      foodNutrients: [{ nutrientNumber: '208', value: 149 }],
    };
    const withoutEnergy: UsdaFood = {
      fdcId: 2,
      description: 'Garlic, raw',
      dataType: 'SR Legacy',
      foodNutrients: [{ nutrientNumber: '203', value: 6.36 }],
    };
    assert.ok(scoreMatch('garlic', withEnergy) > scoreMatch('garlic', withoutEnergy));
  });
});
