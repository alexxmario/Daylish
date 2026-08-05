/**
 * Barcode resolution tests.
 *
 * The scanner has two halves. The camera half — permissions, frame capture,
 * symbology detection — belongs to `expo-camera` and can only be proven on a
 * device. This file covers the other half, which is all our own code: the
 * cache → Open Food Facts → USDA chain, the nutrient parsing, the allergen
 * union, and what gets written to the database afterwards.
 *
 * Fixtures are real API responses, captured from the live endpoints, so the
 * parsing asserted here is the parsing that runs in production.
 */

import { test, describe, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

class FakeDatabase {
  private readonly db = new DatabaseSync(':memory:');
  execSync(sql: string): void {
    this.db.exec(sql);
  }
  runSync(sql: string, params: unknown[] = []): { changes: number } {
    return { changes: Number(this.db.prepare(sql).run(...(params as never[])).changes) };
  }
  getAllSync<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  getFirstSync<T>(sql: string, params: unknown[] = []): T | null {
    return (this.db.prepare(sql).get(...(params as never[])) as T) ?? null;
  }
}

const fakeDb = new FakeDatabase();
mock.module('expo-sqlite', { namedExports: { openDatabaseSync: () => fakeDb } });
mock.module('expo-crypto', { namedExports: { randomUUID: () => randomUUID() } });
mock.module('expo-constants', {
  defaultExport: { expoConfig: { version: '1.0.0' } },
});
mock.module('drizzle-orm/expo-sqlite', { namedExports: { drizzle: () => ({}) } });

/** A real Open Food Facts response, trimmed to the fields we request. */
const NUTELLA = {
  code: '3017624010701',
  product: {
    product_name: 'Nutella',
    brands: 'Ferrero',
    // Only `en:nuts` is declared — the milk and soy in the ingredients are not.
    allergens_tags: ['en:nuts'],
    ingredients_text:
      'Sugar, palm oil, hazelnuts 13%, skimmed milk powder 8.7%, fat-reduced cocoa 7.4%, ' +
      'emulsifier: lecithins (soya), vanillin.',
    nutriments: {
      'energy-kcal_100g': 539,
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      fat_100g: 30.9,
      'saturated-fat_100g': 10.6,
      sugars_100g: 56.3,
      sodium_100g: 0.043,
      salt_100g: 0.1075,
    },
  },
};

/** A product that reports salt but not sodium — the fallback path. */
const SALT_ONLY = {
  code: '1111111111111',
  product: {
    product_name: 'Salted Crackers',
    brands: 'Testco',
    nutriments: {
      'energy-kcal_100g': 450,
      proteins_100g: 8,
      carbohydrates_100g: 70,
      fat_100g: 15,
      salt_100g: 2.5,
    },
  },
};

let foods: typeof import('../src/data/foods.ts');
let client: typeof import('../src/db/client.ts');

const originalFetch = globalThis.fetch;

before(async () => {
  client = await import('../src/db/client.ts');
  foods = await import('../src/data/foods.ts');
  client.runMigrations();
});

function stubFetch(handler: (url: string) => unknown | null) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = handler(url);
    const headers = new Headers({ 'content-type': 'application/json' });
    if (body === null) return { ok: false, status: 404, headers, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, headers, json: async () => body } as unknown as Response;
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe('Open Food Facts parsing', () => {
  test('parses a real product into per-100g nutrients', async () => {
    stubFetch(() => NUTELLA);
    const food = await foods.fetchFromOpenFoodFacts('3017624010701');
    restoreFetch();

    assert.ok(food);
    assert.equal(food.name, 'Nutella');
    assert.equal(food.brand, 'Ferrero');
    assert.equal(food.source, 'off');
    assert.equal(food.per100g.energyKcal, 539);
    assert.equal(food.per100g.proteinG, 6.3);
    assert.equal(food.per100g.carbsG, 57.5);
    assert.equal(food.per100g.fatG, 30.9);
  });

  /** OFF reports sodium in grams; we store milligrams. */
  test('converts sodium from grams to milligrams', async () => {
    stubFetch(() => NUTELLA);
    const food = await foods.fetchFromOpenFoodFacts('3017624010701');
    restoreFetch();
    assert.ok(Math.abs((food!.per100g.sodiumMg ?? 0) - 43) < 0.001);
  });

  /** Salt ÷ 2.5 × 1000 is the standard conversion when sodium is absent. */
  test('falls back to salt when sodium is not reported', async () => {
    stubFetch(() => SALT_ONLY);
    const food = await foods.fetchFromOpenFoodFacts('1111111111111');
    restoreFetch();
    assert.ok(Math.abs((food!.per100g.sodiumMg ?? 0) - 1000) < 0.001);
  });

  /**
   * The safety case. Open Food Facts tags Nutella `en:nuts` only, despite the
   * skimmed milk powder and soya lecithin in its own ingredient list. Trusting
   * the declared tags alone would hide two major allergens.
   */
  test('recovers allergens the declared tags omit', async () => {
    stubFetch(() => NUTELLA);
    const food = await foods.fetchFromOpenFoodFacts('3017624010701');
    restoreFetch();

    assert.ok(food!.allergens.includes('tree_nuts'), 'declared');
    assert.ok(food!.allergens.includes('milk'), 'recovered from ingredients');
    assert.ok(food!.allergens.includes('soybeans'), 'recovered from ingredients');
  });

  test('scores crowdsourced data below lab data', async () => {
    stubFetch(() => NUTELLA);
    const food = await foods.fetchFromOpenFoodFacts('3017624010701');
    restoreFetch();
    assert.ok(food!.confidence < 1, 'community-edited data is never fully verified');
    assert.equal(food!.verified, false);
  });

  test('a product with no usable energy value is rejected', async () => {
    stubFetch(() => ({ code: '2', product: { product_name: 'Mystery', nutriments: {} } }));
    const food = await foods.fetchFromOpenFoodFacts('2');
    restoreFetch();
    assert.equal(food, null, 'a food with no calories is not loggable');
  });
});

describe('USDA nutrient shape', () => {
  /**
   * Regression: the search endpoint returns flat `{nutrientNumber, value}` while
   * the detail endpoint returns nested `{nutrient:{number}, amount}`. Reading
   * only the nested form parsed without error and produced *silently empty*
   * nutrition for every food.
   */
  test('accepts the flat shape the search endpoint returns', () => {
    const v = foods.parseUsdaNutrients([
      { nutrientNumber: '208', value: 149 },
      { nutrientNumber: '203', value: 6.36 },
    ]);
    assert.equal(v.energyKcal, 149);
    assert.equal(v.proteinG, 6.36);
  });

  test('also accepts the nested shape the detail endpoint returns', () => {
    const v = foods.parseUsdaNutrients([
      { nutrient: { number: '208' }, amount: 120 },
      { nutrient: { number: '203' }, amount: 22.5 },
    ]);
    assert.equal(v.energyKcal, 120);
    assert.equal(v.proteinG, 22.5);
  });
});

describe('the resolution chain', () => {
  test('a miss is reported as not found, not as an error', async () => {
    stubFetch(() => null);
    const outcome = await foods.resolveBarcode('0000000000000');
    restoreFetch();
    assert.equal(outcome.status, 'not_found');
  });

  /**
   * Being offline and the product genuinely not existing deserve different
   * wording on screen, so they are different outcomes rather than one failure.
   */
  test('a network failure is distinguished from a miss', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network request failed');
    }) as typeof fetch;
    const outcome = await foods.resolveBarcode('3017624010701');
    restoreFetch();
    assert.equal(outcome.status, 'offline');
  });

  test('a found product is cached, and the next scan needs no network', async () => {
    stubFetch(() => NUTELLA);
    const first = await foods.resolveBarcode('3017624010701');
    restoreFetch();

    assert.equal(first.status, 'found');
    if (first.status !== 'found') return;
    assert.equal(first.food.fromCache, false, 'first scan came from the network');

    // No fetch at all this time: any network call would throw.
    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called for a cached barcode');
    }) as typeof fetch;
    const second = await foods.resolveBarcode('3017624010701');
    restoreFetch();

    assert.equal(second.status, 'found');
    if (second.status !== 'found') return;
    assert.equal(second.food.fromCache, true, 'rescans resolve offline');
    assert.equal(second.food.name, 'Nutella');
    assert.equal(second.food.per100g.energyKcal, 539);
  });

  test('caching writes the food and its portions once', () => {
    const rows = client.sqlite.getAllSync<{ id: string; barcode: string }>(
      "SELECT id, barcode FROM food_items WHERE barcode = '3017624010701'",
    );
    assert.equal(rows.length, 1, 'a rescan must not duplicate the row');

    const portions = client.sqlite.getAllSync<{ label: string; grams: number }>(
      'SELECT label, grams FROM food_portions WHERE food_item_id = ?',
      [rows[0]!.id],
    );
    assert.ok(portions.length >= 1, 'at least a 100 g portion is always available');
    assert.ok(portions.some((p) => p.grams === 100));
  });

  test('the denormalised macro columns are populated for the day-total SUM', () => {
    const row = client.sqlite.getFirstSync<{ energy_kcal: number; nutrients: string }>(
      "SELECT energy_kcal, nutrients FROM food_items WHERE barcode = '3017624010701'",
    );
    assert.equal(row?.energy_kcal, 539);
    assert.equal((JSON.parse(row!.nutrients) as { energyKcal: number }).energyKcal, 539);
  });

  test('local search finds a cached product by name', () => {
    const results = foods.searchCached('nutel');
    assert.ok(results.length >= 1);
    assert.equal(results[0]!.fromCache, true);
  });
});

describe('full-text search', () => {
  const SEARCH_RESULT = {
    hits: [
      {
        code: '5060042641093',
        product_name: 'Oat Drink Barista',
        brands: ['Oatly'],
        nutriments: { 'energy-kcal_100g': 61, proteins_100g: 1.1, carbohydrates_100g: 6.7, fat_100g: 3 },
        ingredients_text: 'Oat base (water, oats 10%), rapeseed oil, acidity regulator.',
      },
      {
        code: '5411188110835',
        product_name: 'Oat No Sugars',
        brands: 'Alpro',
        nutriments: { 'energy-kcal_100g': 44, proteins_100g: 0.3, carbohydrates_100g: 6.2, fat_100g: 1.5 },
      },
      // No calorie figure — cannot be logged, so must not appear in a list whose
      // only purpose is logging.
      { code: '9', product_name: 'Mystery Item', nutriments: {} },
    ],
  };

  test('returns loggable products and drops the rest', async () => {
    stubFetch(() => SEARCH_RESULT);
    const results = await foods.searchOpenFoodFacts('oat milk');
    restoreFetch();

    assert.equal(results.length, 2, 'the product with no calories is filtered out');
    assert.equal(results[0]!.name, 'Oat Drink Barista');
    assert.equal(results[0]!.brand, 'Oatly', 'the array-valued brands shape is handled');
    assert.equal(results[0]!.per100g.energyKcal, 61);
    assert.equal(results[0]!.barcode, '5060042641093', 'so a result can be logged and cached');
  });

  test('search results get the same allergen treatment as a scan', async () => {
    stubFetch(() => SEARCH_RESULT);
    const results = await foods.searchOpenFoodFacts('oat milk');
    restoreFetch();
    // Recovered from ingredient text, not from any declared tag.
    assert.ok(results[0]!.allergens.includes('gluten'), 'oats are a gluten source');
  });

  /**
   * `search.pl` is heavily loaded and answers 503 with an HTML body often enough
   * that this is a normal path. It must degrade to "no results", never to a
   * thrown parse error surfaced as "you are offline".
   */
  test('falls back to the legacy endpoint when the new one is empty', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      // Search-a-licious up but with nothing to say.
      if (url.includes('search.openfoodfacts.org')) return { hits: [] };
      return { products: [{ code: '1', product_name: 'Fallback Oats', brands: 'Testco',
        nutriments: { 'energy-kcal_100g': 370 } }] };
    });
    const results = await foods.searchOpenFoodFacts('oats');
    restoreFetch();

    assert.equal(seen.length, 2, 'both endpoints were tried, in order');
    assert.ok(seen[0]!.includes('search.openfoodfacts.org'));
    assert.ok(seen[1]!.includes('cgi/search.pl'));
    assert.equal(results[0]!.name, 'Fallback Oats');
    assert.equal(results[0]!.brand, 'Testco', 'the comma-string brands shape still works');
  });

  /**
   * Being offline and the food not existing are different facts, and the search
   * screen says different things about them. A swallowed network error would
   * tell someone on a plane that their breakfast does not exist.
   */
  test('a network failure propagates instead of reading as no results', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    await assert.rejects(() => foods.searchOpenFoodFacts('oats'), /Network request failed/);
    restoreFetch();
  });

  test('an HTML error page yields no results rather than throwing', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 503,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new Error('not JSON');
        },
      }) as unknown as Response) as typeof fetch;
    const results = await foods.searchOpenFoodFacts('anything');
    restoreFetch();
    assert.deepEqual(results, []);
  });

  test('a 200 carrying HTML is also survived', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new Error('not JSON');
        },
      }) as unknown as Response) as typeof fetch;
    const results = await foods.searchOpenFoodFacts('anything');
    const scan = await foods.fetchFromOpenFoodFacts('3017624010701');
    restoreFetch();
    assert.deepEqual(results, []);
    assert.equal(scan, null, 'the barcode path must not report offline for an HTML body');
  });
});

describe('USDA search results', () => {
  const USDA_RESULT = {
    foods: [
      {
        fdcId: 1,
        description: 'Yogurt, Greek, nonfat, plain, CHOBANI',
        dataType: 'SR Legacy',
        // Lab entries carry no ingredient list at all.
        foodNutrients: [
          { nutrientNumber: '208', value: 54 },
          { nutrientNumber: '203', value: 9.7 },
          { nutrientNumber: '205', value: 3.6 },
          { nutrientNumber: '204', value: 0.2 },
        ],
      },
      {
        fdcId: 2,
        description: 'Cheerios Cereal',
        brandOwner: 'General Mills',
        dataType: 'Branded',
        ingredients: 'WHOLE GRAIN OATS, CORN STARCH, SUGAR, SALT.',
        servingSize: 28,
        servingSizeUnit: 'GRM',
        foodNutrients: [
          { nutrientNumber: '208', value: 357 },
          { nutrientNumber: '203', value: 14.3 },
          { nutrientNumber: '205', value: 75 },
          { nutrientNumber: '204', value: 7.14 },
        ],
      },
    ],
  };

  async function search() {
    // The transport is injected, so the payload is handed over directly rather
    // than smuggled in through a stubbed global.
    return foods.searchUsda('anything', async () => USDA_RESULT);
  }

  /**
   * Every USDA food used to report no allergens, because the ingredient list was
   * discarded and the description was never read. An empty allergen field is
   * indistinguishable from "checked and clear" on screen, which is the one thing
   * it must never mean.
   */
  test('recovers allergens from the printed ingredient list', async () => {
    const [, cheerios] = await search();
    assert.ok(cheerios!.allergens.includes('gluten'), 'whole grain oats');
  });

  test('recovers allergens from the description when there is no ingredient list', async () => {
    const [yogurt] = await search();
    assert.ok(yogurt!.allergens.includes('milk'), 'a lab entry still names its food');
  });

  test("offers the manufacturer's serving, not just 100 g", async () => {
    const [, cheerios] = await search();
    const preferred = cheerios!.portions.find((p) => p.isDefault);
    assert.equal(preferred!.grams, 28, 'nobody weighs cereal against 100 g');
    assert.ok(cheerios!.portions.some((p) => p.grams === 100), '100 g stays available');
  });

  test('a lab entry with no serving size still gets 100 g', async () => {
    const [yogurt] = await search();
    assert.deepEqual(yogurt!.portions, [{ label: '100 g', grams: 100, isDefault: true }]);
  });

  test('lab entries outrank manufacturer-submitted ones', async () => {
    const [yogurt, cheerios] = await search();
    assert.equal(yogurt!.verified, true);
    assert.equal(yogurt!.confidence, 1);
    assert.equal(cheerios!.verified, false);
    assert.ok(cheerios!.confidence < 1);
  });

  /** Manufacturer arithmetic gets the same scrutiny as a crowdsourced label. */
  test('a branded entry whose calories contradict its macros is marked down', async () => {
    const impossible = {
      foods: [{
        fdcId: 3,
        description: 'Impossible Bar',
        dataType: 'Branded',
        foodNutrients: [
          { nutrientNumber: '208', value: 100 },
          { nutrientNumber: '203', value: 20 },
          { nutrientNumber: '205', value: 60 },
          { nutrientNumber: '204', value: 30 },
        ],
      }],
    };
    const [bar] = await foods.searchUsda('bar', async () => impossible);
    assert.ok(bar!.confidence < 0.9, '100 kcal cannot hold 320 kcal of macros');
  });
});
