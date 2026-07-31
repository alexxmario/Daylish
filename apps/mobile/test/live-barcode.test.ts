/**
 * Live Open Food Facts integration check.
 *
 * Runs the real resolver against the real API — no fetch mocking — so it proves
 * the whole lookup path end to end: request shape, response parsing, the
 * sodium/salt conversion, allergen recovery from ingredient text, and the write
 * to the local cache.
 *
 * Opt-in, because it needs the network and Open Food Facts is community-edited:
 * a product can change under us, and that should not fail an unrelated CI run.
 *
 *   DAYLISH_LIVE_TESTS=1 npm run test:live -w @daylish/mobile
 */

import { test, describe, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

class FakeDatabase {
  private readonly db = new DatabaseSync(':memory:');
  execSync(s: string) { this.db.exec(s); }
  runSync(s: string, p: unknown[] = []) { return { changes: Number(this.db.prepare(s).run(...(p as never[])).changes) }; }
  getAllSync<T>(s: string, p: unknown[] = []) { return this.db.prepare(s).all(...(p as never[])) as T[]; }
  getFirstSync<T>(s: string, p: unknown[] = []) { return (this.db.prepare(s).get(...(p as never[])) as T) ?? null; }
}
const fakeDb = new FakeDatabase();
mock.module('expo-sqlite', { namedExports: { openDatabaseSync: () => fakeDb } });
mock.module('expo-crypto', { namedExports: { randomUUID: () => randomUUID() } });
mock.module('drizzle-orm/expo-sqlite', { namedExports: { drizzle: () => ({}) } });

let foods: typeof import('../src/data/foods.ts');
let client: typeof import('../src/db/client.ts');

before(async () => {
  client = await import('../src/db/client.ts');
  foods = await import('../src/data/foods.ts');
  client.runMigrations();
});

const LIVE = process.env.DAYLISH_LIVE_TESTS === '1';

describe('LIVE Open Food Facts', { skip: LIVE ? false : 'set DAYLISH_LIVE_TESTS=1 to run' }, () => {
  const barcodes = [
    ['3017624010701', 'Nutella'],
    ['5449000000996', 'Coca-Cola'],
    ['5000159407236', 'Mars'],
    ['8076809513388', 'Barilla sauce'],
  ] as const;

  for (const [code, label] of barcodes) {
    test(`resolves ${label} (${code})`, async () => {
      const outcome = await foods.resolveBarcode(code);
      assert.equal(outcome.status, 'found', `expected to resolve ${label}`);
      if (outcome.status !== 'found') return;
      const f = outcome.food;
      assert.ok(f.name.length > 0);
      assert.ok((f.per100g.energyKcal ?? 0) > 0, 'must have calories');
      console.log(`    ${label.padEnd(16)} → "${f.name.slice(0,28)}" ${Math.round(f.per100g.energyKcal!)} kcal/100g · conf ${f.confidence.toFixed(2)} · allergens [${f.allergens.join(', ') || 'none'}]`);
    });
  }

  test('a rescan resolves from cache with no network', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('network must not be used'); }) as typeof fetch;
    const outcome = await foods.resolveBarcode('3017624010701');
    globalThis.fetch = saved;
    assert.equal(outcome.status, 'found');
    if (outcome.status === 'found') assert.equal(outcome.food.fromCache, true);
  });

  test('a barcode absent from the database reports not found', async () => {
    // 0000000000000 returns status=0 from Open Food Facts. 9999999999999 does
    // not — it is a real cucumber — which is a good reminder that "looks fake"
    // and "is absent" are different things.
    const outcome = await foods.resolveBarcode('0000000000000');
    assert.equal(outcome.status, 'not_found');
  });

  test('a product with no name is treated as unusable', async () => {
    // 9780000000002 resolves with status=1 but carries no product_name, so
    // there is nothing to show the user in the confirm sheet.
    const outcome = await foods.resolveBarcode('9780000000002');
    assert.equal(outcome.status, 'not_found');
  });
});

describe('LIVE Open Food Facts search', { skip: LIVE ? false : 'set DAYLISH_LIVE_TESTS=1 to run' }, () => {
  /**
   * Coverage is the whole point of this path, so the assertion is about hit rate
   * on things people actually type, not about any one product existing.
   */
  test('common searches return loggable results', async () => {
    const queries = ['oat milk', 'greek yogurt', 'cheddar cheese', 'peanut butter', 'coca cola'];
    const hits: string[] = [];

    for (const q of queries) {
      const results = await foods.searchOpenFoodFacts(q);
      if (results.length > 0) hits.push(`${q} -> ${results.length} (top: ${results[0]!.name})`);
      // OFF rate-limits aggressive clients; be a good citizen.
      await new Promise((r) => setTimeout(r, 1200));
    }

    console.log(hits.join('\n'));
    assert.equal(hits.length, queries.length, 'every everyday search should return something');
  });

  test('a search result carries everything needed to log it', async () => {
    const [first] = await foods.searchOpenFoodFacts('nutella');
    assert.ok(first, 'a household-name product must be findable by name');
    assert.ok(first.name.length > 0);
    assert.ok(first.per100g.energyKcal! > 0, 'no calories means it cannot be logged');
    assert.ok(first.barcode, 'needed to cache and re-resolve the food later');
    assert.ok(first.confidence > 0 && first.confidence <= 1);
  });
});
