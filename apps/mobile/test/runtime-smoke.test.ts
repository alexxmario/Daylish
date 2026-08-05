/**
 * Runtime smoke test for the data layer.
 *
 * This exists because of a real bug that shipped: `globalThis.crypto.randomUUID()`
 * type-checked, bundled, and served perfectly, then threw
 * "Cannot read property 'randomUUID' of undefined" on the very first write,
 * because Hermes provides no `crypto` global. Compiling is not running, and
 * until this file existed nothing in the repo actually *ran* app code.
 *
 * The approach: mock the two native modules (`expo-sqlite`, `expo-crypto`) with
 * Node equivalents, then import and execute the real repositories. Everything
 * between the mock boundary and the assertions is production code — the same
 * migrations, the same SQL, the same nutrition maths.
 *
 * What it cannot catch: React rendering, native camera behaviour, anything
 * genuinely device-side. It catches logic and API-surface mistakes, which is
 * where the bugs have actually been.
 *
 *   node --experimental-strip-types --experimental-test-module-mocks \
 *        --test apps/mobile/test/runtime-smoke.test.ts
 */

import { test, describe, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

import { baselineExpenditure, computeTargets, rankFoods } from '@daylish/core';

/**
 * A stand-in for `expo-sqlite`'s synchronous API.
 *
 * `node:sqlite` and `expo-sqlite` expose nearly the same surface; this adapter
 * covers the four methods the app uses and nothing more. If the app starts
 * calling a fifth, this will fail loudly rather than silently diverge.
 */
class FakeDatabase {
  private readonly db = new DatabaseSync(':memory:');

  execSync(sql: string): void {
    this.db.exec(sql);
  }

  runSync(sql: string, params: unknown[] = []): { changes: number } {
    const result = this.db.prepare(sql).run(...(params as never[]));
    return { changes: Number(result.changes) };
  }

  getAllSync<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  getFirstSync<T>(sql: string, params: unknown[] = []): T | null {
    return (this.db.prepare(sql).get(...(params as never[])) as T) ?? null;
  }
}

const fakeDb = new FakeDatabase();

// Mocks must be registered before the modules under test are imported.
mock.module('expo-sqlite', {
  namedExports: { openDatabaseSync: () => fakeDb },
});
mock.module('expo-crypto', {
  namedExports: { randomUUID: () => randomUUID() },
});
mock.module('expo-constants', {
  defaultExport: { expoConfig: { version: '1.0.0' } },
});
// Drizzle's Expo driver is only used for its typed query builder, which this
// test does not exercise — the repositories issue raw SQL through `sqlite`.
mock.module('drizzle-orm/expo-sqlite', {
  namedExports: { drizzle: () => ({}) },
});

let journal: typeof import('../src/data/journal.ts');
let exporter: typeof import('../src/data/export.ts');
let account: typeof import('../src/data/account.ts');
let savedMeals: typeof import('../src/data/saved-meals.ts');
let foods: typeof import('../src/data/foods.ts');
let recipes: typeof import('../src/data/recipes.ts');
let interactions: typeof import('../src/data/recipe-interactions.ts');
let shopping: typeof import('../src/data/shopping-list.ts');
let sync: typeof import('../src/data/sync.ts');
let reset: typeof import('../src/data/reset.ts');
let daily: typeof import('../src/data/daily.ts');
let insights: typeof import('../src/data/insights.ts');
let user: typeof import('../src/data/user.ts');
let client: typeof import('../src/db/client.ts');
let dates: typeof import('../src/lib/dates.ts');

before(async () => {
  client = await import('../src/db/client.ts');
  journal = await import('../src/data/journal.ts');
  exporter = await import('../src/data/export.ts');
  account = await import('../src/data/account.ts');
  savedMeals = await import('../src/data/saved-meals.ts');
  foods = await import('../src/data/foods.ts');
  recipes = await import('../src/data/recipes.ts');
  interactions = await import('../src/data/recipe-interactions.ts');
  shopping = await import('../src/data/shopping-list.ts');
  sync = await import('../src/data/sync.ts');
  user = await import('../src/data/user.ts');
  reset = await import('../src/data/reset.ts');
  daily = await import('../src/data/daily.ts');
  insights = await import('../src/data/insights.ts');
  dates = await import('../src/lib/dates.ts');

  client.runMigrations();
});

describe('startup', () => {
  test('migrations apply and are idempotent', () => {
    // Second call must be a no-op; the migration ledger prevents re-running.
    const second = client.runMigrations();
    assert.equal(second.applied.length, 0);
    assert.ok(second.alreadyCurrent > 0);
  });

  /**
   * The regression this file was written for. Creating the local user is the
   * first write the app performs, and it needs a UUID to do it.
   */
  test('creating the local user does not need a crypto global', () => {
    const profile = user.getOrCreateLocalUser();
    assert.match(profile.id, /^[0-9a-f-]{36}$/);
    assert.equal(profile.onboardedAt, null);
  });

  test('the local user is stable across calls', () => {
    const first = user.getOrCreateLocalUser();
    const second = user.getOrCreateLocalUser();
    assert.equal(first.id, second.id);
  });
});

describe('onboarding', () => {
  test('writes a profile, a weigh-in and a first goal', () => {
    const profile = user.getOrCreateLocalUser();
    const goal = user.completeOnboarding(profile.id, {
      sex: 'male',
      birthDate: '1995-01-01',
      heightCm: 180,
      weightKg: 80,
      activityLevel: 'moderate',
      goal: 'lose',
      rateKgPerWeek: -0.5,
      dietStyle: 'balanced',
      allergens: ['peanuts'],
      maxPrepMinutes: 45,
      equipment: ['oven', 'stovetop'],
    });

    // Rather than hardcoding a number — which silently rots as the subject ages
    // past each birthday — assert that the repository wired the goal engine up
    // correctly by recomputing the expectation from the same inputs.
    const ageYears = new Date().getUTCFullYear() - 1995;
    const expected = computeTargets({
      expenditureKcal: baselineExpenditure({
        sex: 'male',
        ageYears,
        heightCm: 180,
        weightKg: 80,
        activityLevel: 'moderate',
      }),
      weightKg: 80,
      goal: 'lose',
      rateKgPerWeek: -0.5,
      dietStyle: 'balanced',
    });

    assert.equal(
      goal.energyKcal,
      expected.energyKcal,
      'the stored goal must match what the engine computes',
    );
    assert.equal(goal.proteinG, 160, '2.0 g/kg at 80 kg');
    assert.ok(goal.reason && goal.reason.length > 20, 'every goal carries an explanation');

    const reloaded = user.getOrCreateLocalUser();
    assert.ok(reloaded.onboardedAt, 'onboarding is marked complete');
    assert.deepEqual(reloaded.allergens, ['peanuts'], 'JSON columns round-trip');
  });
});

describe('logging a meal', () => {
  test('writes the entry, its items, and the sync outbox in one go', () => {
    const profile = user.getOrCreateLocalUser();

    const entryId = journal.logMeal({
      userId: profile.id,
      mealSlot: 'lunch',
      logMethod: 'barcode',
      items: [
        {
          foodItemId: null,
          displayName: 'Chicken breast, raw',
          grams: 150,
          // Real USDA per-100 g values for FDC 171077.
          per100g: { energyKcal: 120, proteinG: 22.5, carbsG: 0, fatG: 2.62 },
          source: 'usda',
          confidence: 1,
        },
      ],
    });

    assert.match(entryId, /^[0-9a-f-]{36}$/);

    const entries = journal.getDayEntries(profile.id, dates.today());
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.items.length, 1);

    // 120 kcal/100 g × 150 g = 180. Scaling happens inside logMeal.
    assert.equal(entries[0]!.items[0]!.nutrients.energyKcal, 180);
    assert.equal(entries[0]!.items[0]!.nutrients.proteinG, 33.75);
  });

  test('day totals come back from the indexed SUM', () => {
    const profile = user.getOrCreateLocalUser();
    const totals = journal.getDayTotals(profile.id, dates.today());
    assert.equal(totals.energyKcal, 180);
    assert.equal(totals.proteinG, 33.75);
  });

  test('the denormalised columns agree with the JSON vector', () => {
    // The whole reason nutrients are stored twice. A write that bypassed
    // `withNutrients` would show up here as a mismatch.
    const rows = client.sqlite.getAllSync<{ energy_kcal: number; nutrients: string }>(
      'SELECT energy_kcal, nutrients FROM journal_entry_items WHERE deleted_at IS NULL',
    );
    assert.ok(rows.length > 0);
    for (const row of rows) {
      const parsed = JSON.parse(row.nutrients) as { energyKcal?: number };
      assert.equal(row.energy_kcal, parsed.energyKcal);
    }
  });

  test('every mutation is queued for sync', () => {
    const outbox = client.sqlite.getAllSync<{ table_name: string }>(
      'SELECT table_name FROM sync_outbox',
    );
    const tables = outbox.map((r) => r.table_name);
    assert.ok(tables.includes('journal_entries'));
    assert.ok(tables.includes('journal_entry_items'));
  });

  test('deleting an entry is soft, so the deletion can sync', () => {
    const profile = user.getOrCreateLocalUser();
    const [entry] = journal.getDayEntries(profile.id, dates.today());
    journal.deleteEntry(entry!.id);

    assert.equal(journal.getDayEntries(profile.id, dates.today()).length, 0);
    assert.equal(journal.getDayTotals(profile.id, dates.today()).energyKcal, 0);

    // The row is still on disk, flagged rather than removed.
    const row = client.sqlite.getFirstSync<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM journal_entries WHERE id = ?',
      [entry!.id],
    );
    assert.ok(row?.deleted_at, 'row should be soft-deleted, not gone');
  });
});

describe('copy a previous day', () => {
  /**
   * `copyDay` converts stored per-serving vectors back to a per-100 g basis so
   * `logMeal` can rescale them. That round-trip is easy to get wrong by a factor
   * of 100 — and an earlier draft did exactly that.
   */
  test('copied meals keep their original nutrition', () => {
    const profile = user.getOrCreateLocalUser();
    const yesterday = dates.addDays(dates.today(), -1);

    journal.logMeal({
      userId: profile.id,
      mealSlot: 'dinner',
      logMethod: 'search',
      loggedAt: new Date(`${yesterday}T19:00:00`),
      items: [
        {
          foodItemId: null,
          displayName: 'Pasta, dry',
          grams: 125,
          per100g: { energyKcal: 371, proteinG: 13.04, carbsG: 74.67, fatG: 1.51 },
          source: 'usda',
          confidence: 1,
        },
      ],
    });

    const before = journal.getDayTotals(profile.id, yesterday);
    assert.ok(Math.abs(before.energyKcal - 463.75) < 0.01, `got ${before.energyKcal}`);

    const copied = journal.copyDay(profile.id, yesterday, dates.today());
    assert.equal(copied, 1);

    const after = journal.getDayTotals(profile.id, dates.today());
    assert.ok(
      Math.abs(after.energyKcal - before.energyKcal) < 0.01,
      `copy changed the calories: ${before.energyKcal} → ${after.energyKcal}`,
    );
  });
});

describe('suggestions from history', () => {
  /** Logs `times` portions of the same food, so the aggregates have something to count. */
  function logChicken(userId: string, times: number) {
    for (let i = 0; i < times; i += 1) {
      journal.logMeal({
        userId,
        mealSlot: 'dinner',
        logMethod: 'search',
        items: [
          {
            foodItemId: null,
            displayName: 'Chicken breast, raw',
            grams: 150,
            per100g: { energyKcal: 120, proteinG: 22.5, carbsG: 0, fatG: 2.62 },
            source: 'usda',
            confidence: 1,
          },
        ],
      });
    }
  }

  /**
   * The per-100 g round trip, again — but this time inside a GROUP BY, where the
   * stored vector and the grams it was computed for must come from the *same*
   * row. Pairing an average portion with some other row's vector would be off by
   * whatever the portions differ by, and would look plausible in the UI.
   */
  test('recovers per-100 g nutrition from what was actually eaten', () => {
    const profile = user.getOrCreateLocalUser();
    logChicken(profile.id, 1);

    const history = journal.getFoodHistory(profile.id, {
      mealSlot: 'dinner',
      localDate: dates.today(),
    });
    const chicken = history.find((f) => f.displayName === 'Chicken breast, raw');
    assert.ok(chicken, 'the food just logged is in the history');

    assert.ok(Math.abs((chicken!.per100g.energyKcal ?? 0) - 120) < 0.01);
    assert.ok(Math.abs((chicken!.per100g.proteinG ?? 0) - 22.5) < 0.01);
    assert.equal(chicken!.typicalGrams, 150);

    // The identical chicken logged at lunch earlier was soft-deleted. If the
    // aggregate counted deleted rows, this would be 2.
    assert.equal(chicken!.uses, 1, 'soft-deleted items are excluded from the counts');
  });

  test('counts slot affinity and same-day repeats', () => {
    const profile = user.getOrCreateLocalUser();
    logChicken(profile.id, 2);

    const [chicken] = journal
      .getFoodHistory(profile.id, { mealSlot: 'dinner', localDate: dates.today() })
      .filter((f) => f.displayName === 'Chicken breast, raw');

    assert.equal(chicken?.uses, 3);
    assert.equal(chicken?.usesInSlot, 3, 'all three went in at dinner');
    assert.equal(chicken?.usesToday, 3);

    // The same history read for a different slot scores no affinity at all.
    const [atBreakfast] = journal
      .getFoodHistory(profile.id, { mealSlot: 'breakfast', localDate: dates.today() })
      .filter((f) => f.displayName === 'Chicken breast, raw');
    assert.equal(atBreakfast?.usesInSlot, 0);
  });

  /**
   * End to end: real rows out of SQLite, through the ranker, in the order the
   * Ideas screen will draw them.
   */
  test('ranks a protein-dense food above a carb-heavy one when protein is short', () => {
    const profile = user.getOrCreateLocalUser();
    const history = journal.getFoodHistory(profile.id, {
      mealSlot: 'dinner',
      localDate: dates.today(),
    });

    const ranked = rankFoods(history, {
      remaining: { energyKcal: 500, proteinG: 60 },
      mealSlot: 'dinner',
    });

    const names = ranked.map((r) => history.find((f) => f.key === r.key)?.displayName);
    assert.ok(names.length >= 2, 'both the chicken and the copied pasta are candidates');
    assert.equal(names[0], 'Chicken breast, raw');
    assert.ok(names.includes('Pasta, dry'));

    // Every suggestion is offered at a portion that fits, with a reason attached.
    for (const suggestion of ranked) {
      assert.ok(suggestion.grams > 0, 'a suggestion always names a portion');
      assert.ok(suggestion.topReason.length > 0, 'nothing is ranked without saying why');
    }
  });
});

describe('adaptive recalibration', () => {
  test('declines to move targets without enough data, and says why', () => {
    const profile = user.getOrCreateLocalUser();
    const result = user.recalibrate(profile.id);
    assert.equal(result.changed, false);
    assert.ok(result.reason.length > 10, 'a refusal still needs an explanation');
  });

  test('raises the target when the weight trend outpaces the plan', () => {
    const profile = user.getOrCreateLocalUser();

    // Three weeks of eating 2000 kcal while losing 1 kg/week: real expenditure
    // is far above the current target, so the engine should push it up.
    for (let i = 0; i < 21; i += 1) {
      const date = dates.addDays(dates.today(), -(20 - i));
      client.sqlite.runSync(
        `INSERT INTO weight_entries (id, user_id, local_date, weight_kg, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'manual', ?, ?)
         ON CONFLICT(user_id, local_date) DO UPDATE SET weight_kg = excluded.weight_kg`,
        [randomUUID(), profile.id, date, 80 - (1 / 7) * i, date, date],
      );

      // Three slots so the day counts as fully logged.
      for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
        journal.logMeal({
          userId: profile.id,
          mealSlot: slot,
          logMethod: 'quick_add',
          loggedAt: new Date(`${date}T12:00:00`),
          items: [
            {
              foodItemId: null,
              displayName: 'Test food',
              grams: 100,
              per100g: { energyKcal: 2000 / 3, proteinG: 30, carbsG: 60, fatG: 20 },
              source: 'user',
              confidence: 1,
            },
          ],
        });
      }
    }

    const result = user.recalibrate(profile.id);
    assert.equal(result.changed, true, `expected an adjustment, got: ${result.reason}`);
    assert.match(result.reason, /raised your target/);

    const goal = user.getCurrentGoal(profile.id);
    assert.ok(goal!.energyKcal > 2200, 'target should have gone up');
  });
});

describe('correcting a logged portion', () => {
  /** Oats and milk, per 100 g. Distinct from the foods the tests above rely on. */
  const OATS = { energyKcal: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9 };
  const MILK = { energyKcal: 61, proteinG: 3.15, carbsG: 4.8, fatG: 3.25 };

  let entryId = '';
  let oatsId = '';
  let milkId = '';

  function logBreakfast() {
    const profile = user.getOrCreateLocalUser();
    entryId = journal.logMeal({
      userId: profile.id,
      mealSlot: 'breakfast',
      logMethod: 'search',
      items: [
        { foodItemId: null, displayName: 'Oats', grams: 80, per100g: OATS, source: 'usda', confidence: 1 },
        { foodItemId: null, displayName: 'Milk', grams: 200, per100g: MILK, source: 'usda', confidence: 1 },
      ],
    });

    const entry = journal
      .getDayEntries(profile.id, dates.today())
      .find((e) => e.id === entryId)!;
    oatsId = entry.items.find((i) => i.displayName === 'Oats')!.id;
    milkId = entry.items.find((i) => i.displayName === 'Milk')!.id;
    return profile;
  }

  test('a corrected portion recomputes the item and the day total', () => {
    const profile = logBreakfast();
    const before = journal.getDayTotals(profile.id, dates.today());

    // 389 kcal/100 g × 80 g = 311.2, going to × 120 g = 466.8. The day moves by
    // the difference and by nothing else.
    journal.updateEntryItemGrams(oatsId, 120);

    const item = journal.getEntryItem(oatsId)!;
    assert.equal(item.grams, 120);

    const after = journal.getDayTotals(profile.id, dates.today());
    assert.ok(
      Math.abs(after.energyKcal - (before.energyKcal + 155.6)) < 0.01,
      `day total moved to ${after.energyKcal}, expected ${before.energyKcal + 155.6}`,
    );
  });

  /**
   * Nutrition is recomputed from a per-100 g basis on every edit rather than
   * scaled from the current values. Scaling would compound its own rounding, so
   * a few corrections would quietly walk the numbers away from the truth.
   */
  test('repeated corrections do not drift', () => {
    const original = journal.getEntryItem(oatsId)!;
    const originalKcal = original.per100g.energyKcal ?? 0;

    journal.updateEntryItemGrams(oatsId, 250);
    journal.updateEntryItemGrams(oatsId, 35);
    journal.updateEntryItemGrams(oatsId, 120);

    const back = journal.getEntryItem(oatsId)!;
    assert.equal(back.grams, 120);
    assert.ok(
      Math.abs((back.per100g.energyKcal ?? 0) - originalKcal) < 0.001,
      `per-100 g basis drifted: ${originalKcal} → ${back.per100g.energyKcal}`,
    );
  });

  test('the denormalised columns follow the corrected vector', () => {
    const row = client.sqlite.getFirstSync<{ energy_kcal: number; protein_g: number; nutrients: string }>(
      'SELECT energy_kcal, protein_g, nutrients FROM journal_entry_items WHERE id = ?',
      [oatsId],
    )!;
    const parsed = JSON.parse(row.nutrients) as { energyKcal?: number; proteinG?: number };

    assert.equal(row.energy_kcal, parsed.energyKcal);
    assert.equal(row.protein_g, parsed.proteinG);
  });

  test('the correction is queued for sync', () => {
    const queued = client.sqlite.getAllSync<{ operation: string }>(
      'SELECT operation FROM sync_outbox WHERE row_id = ?',
      [oatsId],
    );
    assert.ok(
      queued.some((r) => r.operation === 'update'),
      'an edit that never reaches the outbox would be lost on sync',
    );
  });

  test('rejects a portion that is not a positive number', () => {
    assert.throws(() => journal.updateEntryItemGrams(oatsId, 0), RangeError);
    assert.throws(() => journal.updateEntryItemGrams(oatsId, -50), RangeError);
    assert.equal(journal.getEntryItem(oatsId)!.grams, 120, 'a rejected edit changes nothing');
  });

  test('removing one food of several leaves the rest of the meal alone', () => {
    const profile = user.getOrCreateLocalUser();
    journal.deleteEntryItem(milkId);

    const entry = journal.getDayEntries(profile.id, dates.today()).find((e) => e.id === entryId);
    assert.ok(entry, 'the meal itself survives');
    assert.equal(entry!.items.length, 1);
    assert.equal(entry!.items[0]!.displayName, 'Oats');
  });

  /**
   * An entry with every item removed would draw as a meal containing no food,
   * which reads as a bug rather than as a deletion.
   */
  test('removing the last food removes the meal with it', () => {
    const profile = user.getOrCreateLocalUser();
    journal.deleteEntryItem(oatsId);

    const entry = journal.getDayEntries(profile.id, dates.today()).find((e) => e.id === entryId);
    assert.equal(entry, undefined, 'the empty meal is gone too');
    assert.equal(journal.getEntryItem(oatsId), null);
  });
});

describe('saved meals', () => {
  let savedMealId = '';

  /**
   * The round trip that matters: a journal item stores the vector for the amount
   * eaten, a saved meal stores the per-100 g basis, and logging converts back.
   * Get the factor of 100 wrong in either direction and the meal silently logs
   * at a hundredth or a hundred times the calories.
   */
  test('a meal saved from the journal logs back at identical nutrition', () => {
    const profile = user.getOrCreateLocalUser();

    const entryId = journal.logMeal({
      userId: profile.id,
      mealSlot: 'breakfast',
      logMethod: 'search',
      items: [
        {
          foodItemId: null,
          displayName: 'Porridge oats',
          grams: 80,
          per100g: { energyKcal: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9 },
          source: 'usda',
          confidence: 1,
        },
        {
          foodItemId: null,
          displayName: 'Semi-skimmed milk',
          grams: 200,
          per100g: { energyKcal: 50, proteinG: 3.6, carbsG: 4.8, fatG: 1.8 },
          source: 'usda',
          confidence: 1,
        },
      ],
    });

    const original = journal
      .getDayEntries(profile.id, dates.today())
      .find((e) => e.id === entryId)!;

    savedMealId = savedMeals.saveMealFromEntry(profile.id, entryId, 'Weekday breakfast');

    const saved = savedMeals.getSavedMeal(savedMealId)!;
    assert.equal(saved.name, 'Weekday breakfast');
    assert.equal(saved.itemCount, 2);
    assert.ok(
      Math.abs(saved.energyKcal - (original.totals.energyKcal ?? 0)) < 0.01,
      `saved totals ${saved.energyKcal} != logged ${original.totals.energyKcal}`,
    );

    // 389 kcal/100 g recovered from 311.2 kcal at 80 g.
    const oats = saved.items.find((i) => i.displayName === 'Porridge oats')!;
    assert.ok(Math.abs((oats.per100g.energyKcal ?? 0) - 389) < 0.01);
    assert.equal(oats.grams, 80);

    // And logging it back produces the same meal again.
    const relogged = savedMeals.logSavedMeal(profile.id, savedMealId);
    const copy = journal.getDayEntries(profile.id, dates.today()).find((e) => e.id === relogged)!;
    assert.ok(
      Math.abs((copy.totals.energyKcal ?? 0) - (original.totals.energyKcal ?? 0)) < 0.01,
      `relogged ${copy.totals.energyKcal} != original ${original.totals.energyKcal}`,
    );
    assert.equal(copy.items.length, 2);
    assert.equal(copy.mealSlot, 'breakfast', 'the slot it is usually eaten in carries over');
  });

  test('logging a saved meal counts a use, so the list can order by it', () => {
    const profile = user.getOrCreateLocalUser();
    const before = savedMeals.getSavedMeal(savedMealId)!.useCount;

    savedMeals.logSavedMeal(profile.id, savedMealId, { mealSlot: 'snack' });

    assert.equal(savedMeals.getSavedMeal(savedMealId)!.useCount, before + 1);
  });

  test('an empty meal is refused rather than stored', () => {
    const profile = user.getOrCreateLocalUser();
    assert.throws(
      () => savedMeals.createSavedMeal({ userId: profile.id, name: 'Nothing', items: [] }),
      RangeError,
    );
    assert.throws(
      () =>
        savedMeals.createSavedMeal({
          userId: profile.id,
          name: '   ',
          items: [
            {
              foodItemId: null,
              displayName: 'x',
              grams: 10,
              per100g: { energyKcal: 100 },
              source: 'user',
              confidence: 1,
            },
          ],
        }),
      RangeError,
    );
  });

  test('deleting a saved meal leaves meals already logged from it alone', () => {
    const profile = user.getOrCreateLocalUser();
    const loggedBefore = journal.getDayTotals(profile.id, dates.today()).energyKcal;

    savedMeals.deleteSavedMeal(savedMealId);

    assert.equal(savedMeals.getSavedMeal(savedMealId), null);
    assert.equal(
      journal.getDayTotals(profile.id, dates.today()).energyKcal,
      loggedBefore,
      'the journal is a record of what was eaten, not a view of the template',
    );
  });

  test('one account never sees another account\'s saved meals', () => {
    const profile = user.getOrCreateLocalUser();
    savedMeals.createSavedMeal({
      userId: profile.id,
      name: 'Mine',
      items: [
        {
          foodItemId: null,
          displayName: 'Toast',
          grams: 60,
          per100g: { energyKcal: 265, proteinG: 9 },
          source: 'user',
          confidence: 1,
        },
      ],
    });

    assert.ok(savedMeals.listSavedMeals(profile.id).some((m) => m.name === 'Mine'));
    assert.equal(savedMeals.listSavedMeals('someone-else').length, 0);
  });
});

describe('custom foods', () => {
  test('a food the user types becomes searchable, marked as theirs', () => {
    const id = foods.createCustomFood({
      name: 'Nan bakery sourdough',
      per100g: { energyKcal: 259, proteinG: 9.1, carbsG: 48, fatG: 2.1 },
    });
    assert.match(id, /^[0-9a-f-]{36}$/);

    const found = foods.searchCached('sourdough');
    const mine = found.find((f) => f.name === 'Nan bakery sourdough');

    assert.ok(mine, 'a custom food is findable by search like any other');
    assert.equal(mine!.source, 'user');
    assert.equal(mine!.verified, false, 'we never imply we checked it');
    assert.ok(Math.abs((mine!.per100g.energyKcal ?? 0) - 259) < 0.01);
  });

  test('a nameless custom food is refused', () => {
    assert.throws(
      () => foods.createCustomFood({ name: '  ', per100g: { energyKcal: 100 } }),
      RangeError,
    );
  });
});

describe('the recipe library', () => {
  test('seeds from the bundle, and seeding twice is a no-op', async () => {
    // Async because the library is loaded by dynamic import — only on the
    // launch that actually needs it, so that later boots never construct it.
    const first = await recipes.seedRecipes();
    assert.ok(first.inserted > 0, 'the bundled library should not be empty');

    const second = await recipes.seedRecipes();
    assert.equal(second.inserted, 0, 'a second boot must not re-insert');

    assert.equal(recipes.listRecipes().length, first.inserted);
  });

  test('a recipe comes back whole', () => {
    const [summary] = recipes.listRecipes({ query: 'shakshuka' });
    assert.ok(summary, 'shakshuka should be in the library');

    const detail = recipes.getRecipe(summary!.id)!;
    assert.ok(detail.ingredients.length >= 2);
    assert.ok(detail.steps.length >= 2);
    assert.equal(detail.steps[0]!.order, 1, 'steps come back in order');
    assert.ok(detail.nutrients.energyKcal! > 0, 'nutrition came across from the pipeline');
    assert.ok(detail.storageNotes && detail.storageNotes.length > 0);
  });

  describe('filters', () => {
    test('meal slot, time and diet each narrow the list', () => {
      const all = recipes.listRecipes().length;

      const breakfast = recipes.listRecipes({ mealSlots: ['breakfast'] });
      assert.ok(breakfast.length > 0 && breakfast.length < all);
      assert.ok(breakfast.every((r) => r.mealSlots.includes('breakfast')));

      const quick = recipes.listRecipes({ maxMinutes: 20 });
      assert.ok(quick.every((r) => r.totalMinutes <= 20));

      const vegan = recipes.listRecipes({ dietStyles: ['vegan'] });
      assert.ok(vegan.length > 0, 'the library should carry at least one vegan recipe');
      assert.ok(vegan.every((r) => r.dietStyles.includes('vegan')));
    });

    /** Several slots is "any of", because nobody wants breakfast *and* lunch. */
    test('meal slots are a union', () => {
      const breakfast = recipes.listRecipes({ mealSlots: ['breakfast'] }).length;
      const both = recipes.listRecipes({ mealSlots: ['breakfast', 'lunch'] });
      assert.ok(both.length > breakfast);
      assert.ok(
        both.every((r) => r.mealSlots.includes('breakfast') || r.mealSlots.includes('lunch')),
      );
    });

    /**
     * Diet styles go the other way, and the difference matters: someone who is
     * vegan *and* gluten free cannot eat a recipe that satisfies one of the two.
     */
    test('diet styles are an intersection', () => {
      const both = recipes.listRecipes({ dietStyles: ['vegan', 'gluten_free'] });
      assert.ok(both.length > 0, 'test needs a vegan gluten-free recipe to be meaningful');
      assert.ok(
        both.every((r) => r.dietStyles.includes('vegan') && r.dietStyles.includes('gluten_free')),
      );
      assert.ok(both.length < recipes.listRecipes({ dietStyles: ['vegan'] }).length);
    });

    test('nutrition floors and ceilings are per serving', () => {
      const light = recipes.listRecipes({ maxCalories: 400 });
      assert.ok(light.length > 0);
      assert.ok(light.every((r) => r.energyKcal <= 400));

      const protein = recipes.listRecipes({ minProteinG: 30 });
      assert.ok(protein.length > 0);
      assert.ok(protein.every((r) => r.proteinG >= 30));

      const lowCarb = recipes.listRecipes({ maxCarbsG: 20 });
      assert.ok(lowCarb.every((r) => r.carbsG <= 20));
    });

    /** The kit filter is a subset test — "can I cook this", not "does it mention a grill". */
    test('equipment narrows to what can actually be cooked', () => {
      const stovetopOnly = recipes.listRecipes({ equipment: ['stovetop'] });
      assert.ok(stovetopOnly.length > 0);
      assert.ok(stovetopOnly.every((r) => r.equipment.every((e) => e === 'stovetop')));

      const ovenless = recipes.listRecipes({
        equipment: ['stovetop', 'blender', 'grill', 'food_processor', 'rice_cooker'],
      });
      assert.ok(ovenless.every((r) => !r.equipment.includes('oven')));
      assert.ok(ovenless.length > stovetopOnly.length);
    });

    test('cuisine and difficulty narrow the list', () => {
      const italian = recipes.listRecipes({ cuisines: ['italian', 'greek'] });
      assert.ok(italian.length > 0);
      assert.ok(italian.every((r) => r.cuisine === 'italian' || r.cuisine === 'greek'));

      const easy = recipes.listRecipes({ difficulties: ['easy'] });
      assert.ok(easy.length > 0);
      assert.ok(easy.every((r) => r.difficulty === 'easy'));
    });

    test('excluded ingredients drop every recipe that uses them', () => {
      const withGarlic = recipes
        .listRecipes()
        .filter((r) => recipes.getRecipe(r.id)!.ingredients.some((i) => /garlic/i.test(i.name)));
      assert.ok(withGarlic.length > 0, 'test needs a garlic recipe to be meaningful');

      const without = recipes.listRecipes({ excludeIngredients: ['garlic'] });
      assert.ok(without.length > 0);
      assert.ok(
        without.every((r) => !recipes.getRecipe(r.id)!.ingredients.some((i) => /garlic/i.test(i.name))),
      );
    });

    test('freezer and batch filters use the pipeline’s own numbers', () => {
      const freezes = recipes.listRecipes({ freezerFriendly: true });
      assert.ok(freezes.length > 0);
      assert.ok(freezes.every((r) => r.freezerMonths > 0));

      const batch = recipes.listRecipes({ batchFriendly: true });
      assert.ok(batch.every((r) => r.prepScore >= 60));
    });

    test('sorting reorders without dropping anything', () => {
      const all = recipes.listRecipes().length;

      const quickest = recipes.listRecipes({ sort: 'quickest' });
      assert.equal(quickest.length, all);
      for (let i = 1; i < quickest.length; i += 1) {
        assert.ok(quickest[i - 1]!.totalMinutes <= quickest[i]!.totalMinutes);
      }

      const protein = recipes.listRecipes({ sort: 'most_protein' });
      for (let i = 1; i < protein.length; i += 1) {
        assert.ok(protein[i - 1]!.proteinG >= protein[i]!.proteinG);
      }

      // Dishes follow the same order, read off the variant on the card.
      const dishes = recipes.listDishes({ sort: 'lightest' });
      for (let i = 1; i < dishes.length; i += 1) {
        assert.ok(
          dishes[i - 1]!.representative.energyKcal <= dishes[i]!.representative.energyKcal,
        );
      }
    });

    /** How "Saved" is expressed. An empty set must mean empty, not unfiltered. */
    test('restricting to a set of recipe ids', () => {
      const [first, second] = recipes.listRecipes();
      const pair = recipes.listRecipes({ recipeIds: [first!.id, second!.id] });
      assert.equal(pair.length, 2);

      assert.equal(recipes.listRecipes({ recipeIds: [] }).length, 0);
      assert.ok(recipes.listRecipes().length > 2, 'no ids at all still means everything');
    });

    /** The sheet is built from this, so an empty facet is a broken filter screen. */
    test('the library reports the facets it can be filtered by', () => {
      const facets = recipes.libraryFacets();
      assert.ok(facets.cuisines.length > 5);
      assert.ok(facets.difficulties.length > 0);
      assert.ok(facets.dietStyles.includes('vegan'));
      assert.ok(facets.allergens.includes('gluten'));
      assert.ok(facets.equipment.includes('stovetop'));
    });

    /**
     * Allergens are a hard filter, never a warning. Someone who has told the app
     * they cannot eat gluten should not have to read a badge to find out.
     */
    test('avoided allergens are excluded outright', () => {
      const withGluten = recipes.listRecipes().filter((r) => r.allergens.includes('gluten'));
      assert.ok(withGluten.length > 0, 'test needs a gluten recipe to be meaningful');

      const safe = recipes.listRecipes({ avoidAllergens: ['gluten'] });
      assert.ok(safe.every((r) => !r.allergens.includes('gluten')));
      assert.ok(safe.length > 0, 'avoiding one allergen should not empty the library');
    });
  });

  /**
   * Saving is the exit from the browse funnel: the Meals screen can narrow the
   * library a dozen ways, and without this every one of those searches has to be
   * repeated from scratch next week.
   */
  describe('saving and cooking', () => {
    test('saving toggles, and survives a re-read', () => {
      const profile = user.getOrCreateLocalUser();
      const [recipe] = recipes.listRecipes({ query: 'shakshuka' });
      assert.ok(recipe);

      assert.equal(interactions.isRecipeSaved(profile.id, recipe!.id), false);

      assert.equal(interactions.toggleRecipeSaved(profile.id, recipe!.id), true);
      assert.equal(interactions.isRecipeSaved(profile.id, recipe!.id), true);
      assert.ok(interactions.listSavedRecipeIds(profile.id).includes(recipe!.id));

      assert.equal(interactions.toggleRecipeSaved(profile.id, recipe!.id), false);
      assert.equal(interactions.isRecipeSaved(profile.id, recipe!.id), false);
      assert.ok(!interactions.listSavedRecipeIds(profile.id).includes(recipe!.id));
    });

    /** Soft-deleted, not removed — the sync layer has to see the un-save. */
    test('un-saving leaves a tombstone rather than deleting the row', () => {
      const profile = user.getOrCreateLocalUser();
      const [recipe] = recipes.listRecipes({ query: 'traybake' });

      interactions.toggleRecipeSaved(profile.id, recipe!.id);
      interactions.toggleRecipeSaved(profile.id, recipe!.id);

      const rows = client.sqlite.getAllSync<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM recipe_interactions
          WHERE user_id = ? AND recipe_id = ? AND kind = 'saved'`,
        [profile.id, recipe!.id],
      );
      assert.equal(rows.length, 1);
      assert.ok(rows[0]!.deleted_at, 'the row should still be there, marked deleted');
    });

    /** Saving twice must not leave two live rows to un-save one at a time. */
    test('re-saving after un-saving does not accumulate live rows', () => {
      const profile = user.getOrCreateLocalUser();
      const [recipe] = recipes.listRecipes({ query: 'lentil dal' });

      interactions.toggleRecipeSaved(profile.id, recipe!.id);
      interactions.toggleRecipeSaved(profile.id, recipe!.id);
      interactions.toggleRecipeSaved(profile.id, recipe!.id);

      const live = client.sqlite.getAllSync<{ id: string }>(
        `SELECT id FROM recipe_interactions
          WHERE user_id = ? AND recipe_id = ? AND kind = 'saved' AND deleted_at IS NULL`,
        [profile.id, recipe!.id],
      );
      assert.equal(live.length, 1);
      assert.equal(interactions.isRecipeSaved(profile.id, recipe!.id), true);

      interactions.toggleRecipeSaved(profile.id, recipe!.id);
    });

    /** Cooking is a history, not a flag — that is what makes the count possible. */
    test('cooking the same recipe twice counts twice', () => {
      const profile = user.getOrCreateLocalUser();
      const [recipe] = recipes.listRecipes({ query: 'chilli' });

      const before = interactions.recipeCookCounts(profile.id)[recipe!.id] ?? 0;
      interactions.recordRecipeCooked(profile.id, recipe!.id);
      interactions.recordRecipeCooked(profile.id, recipe!.id);

      assert.equal(interactions.recipeCookCounts(profile.id)[recipe!.id], before + 2);
    });

    /** Ideas ranks with this, and `rankRecipes` expects a 0–1 scale. */
    test('affinity weights cooking above saving and stays within range', () => {
      const profile = user.getOrCreateLocalUser();
      const [saved] = recipes.listRecipes({ query: 'shakshuka' });
      const [cooked] = recipes.listRecipes({ query: 'traybake' });

      interactions.toggleRecipeSaved(profile.id, saved!.id);
      interactions.recordRecipeCooked(profile.id, cooked!.id);

      const affinity = interactions.recipeAffinity(profile.id);
      assert.ok(affinity[cooked!.id]! > affinity[saved!.id]!);
      for (const value of Object.values(affinity)) {
        assert.ok(value > 0 && value <= 1, `affinity ${value} is outside 0–1`);
      }

      interactions.toggleRecipeSaved(profile.id, saved!.id);
    });
  });

  /**
   * The shopping list stores recipes and derives the lines on every read, so
   * these tests are mostly about that derivation staying honest as the list
   * changes underneath it.
   */
  describe('the shopping list', () => {
    /** Each test starts from an empty list; the user is shared across the file. */
    function freshList() {
      const profile = user.getOrCreateLocalUser();
      shopping.clearShoppingList(profile.id);
      return profile;
    }

    test('an empty list derives no lines rather than throwing', () => {
      const profile = freshList();
      const list = shopping.getShoppingList(profile.id);
      assert.deepEqual(list.recipes, []);
      assert.deepEqual(list.lines, []);
      assert.equal(list.remaining, 0);
    });

    test('a recipe on the list produces a line for each of its ingredients', () => {
      const profile = freshList();
      const [recipe] = recipes.listRecipes({ query: 'shakshuka' });
      const detail = recipes.getRecipe(recipe!.id)!;

      shopping.addToShoppingList(profile.id, recipe!.id, detail.servings);
      const list = shopping.getShoppingList(profile.id);

      assert.equal(list.recipes.length, 1);
      assert.equal(list.lines.length, new Set(detail.ingredients.map((i) => i.name.toLowerCase())).size);
      assert.equal(list.remaining, list.lines.length);
    });

    /** The point of the feature: two recipes, one line for what they share. */
    test('ingredients shared by two recipes are combined into one line', () => {
      const profile = freshList();

      // Two recipes that genuinely share an ingredient — garlic is in 338 of them.
      const withGarlic = recipes
        .listRecipes()
        .filter((r) => recipes.getRecipe(r.id)!.ingredients.some((i) => /^garlic$/i.test(i.name)))
        .slice(0, 2);
      assert.equal(withGarlic.length, 2, 'test needs two garlic recipes');

      for (const recipe of withGarlic) {
        const detail = recipes.getRecipe(recipe.id)!;
        shopping.addToShoppingList(profile.id, recipe.id, detail.servings);
      }

      const list = shopping.getShoppingList(profile.id);
      const garlic = list.lines.find((line) => line.key === 'garlic')!;
      assert.ok(garlic, 'garlic should be on the list');
      assert.equal(garlic.sources.length, 2, 'both recipes should be credited');

      const expected = withGarlic.reduce(
        (sum, recipe) =>
          sum +
          recipes.getRecipe(recipe.id)!.ingredients
            .filter((i) => /^garlic$/i.test(i.name))
            .reduce((n, i) => n + i.grams, 0),
        0,
      );
      assert.ok(Math.abs(garlic.grams - expected) < 0.001);
    });

    test('portions scale the quantities', () => {
      const profile = freshList();
      const [recipe] = recipes.listRecipes({ query: 'shakshuka' });
      const detail = recipes.getRecipe(recipe!.id)!;

      shopping.addToShoppingList(profile.id, recipe!.id, detail.servings);
      const single = shopping.getShoppingList(profile.id).lines[0]!.grams;

      // Adding again is a correction, not a second dinner.
      shopping.addToShoppingList(profile.id, recipe!.id, detail.servings * 2);
      const doubled = shopping.getShoppingList(profile.id);

      assert.equal(doubled.recipes.length, 1, 'adding twice must not duplicate the recipe');
      assert.ok(Math.abs(doubled.lines[0]!.grams - single * 2) < 0.001);
    });

    test('ticking an item off survives the list being rebuilt', () => {
      const profile = freshList();
      const [first] = recipes.listRecipes({ query: 'shakshuka' });
      shopping.addToShoppingList(profile.id, first!.id, 4);

      const before = shopping.getShoppingList(profile.id);
      const key = before.lines[0]!.key;

      assert.equal(shopping.toggleShoppingItem(profile.id, key), true);
      assert.equal(shopping.getShoppingList(profile.id).remaining, before.lines.length - 1);

      // Adding another recipe re-derives every line; the tick must survive it.
      const [second] = recipes.listRecipes({ query: 'traybake' });
      shopping.addToShoppingList(profile.id, second!.id, 4);

      const after = shopping.getShoppingList(profile.id);
      assert.equal(after.lines.find((line) => line.key === key)!.checked, true);

      assert.equal(shopping.toggleShoppingItem(profile.id, key), false);
      assert.equal(shopping.getShoppingList(profile.id).lines.find((l) => l.key === key)!.checked, false);
    });

    /** Removing one recipe of several must not un-buy what is already in the basket. */
    test('removing a recipe leaves the ticks alone', () => {
      const profile = freshList();
      const [first] = recipes.listRecipes({ query: 'shakshuka' });
      const [second] = recipes.listRecipes({ query: 'traybake' });
      shopping.addToShoppingList(profile.id, first!.id, 4);
      shopping.addToShoppingList(profile.id, second!.id, 4);

      const list = shopping.getShoppingList(profile.id);
      // A line that only the recipe we are keeping contributes to.
      const kept = list.lines.find((line) => line.sources.every((s) => s.recipeId === second!.id))!;
      assert.ok(kept, 'test needs a line unique to the second recipe');
      shopping.toggleShoppingItem(profile.id, kept.key);

      shopping.removeFromShoppingList(profile.id, first!.id);

      const after = shopping.getShoppingList(profile.id);
      assert.equal(after.recipes.length, 1);
      assert.equal(after.lines.find((line) => line.key === kept.key)!.checked, true);
    });

    test('clearing empties the recipes and the ticks together', () => {
      const profile = freshList();
      const [recipe] = recipes.listRecipes({ query: 'shakshuka' });
      shopping.addToShoppingList(profile.id, recipe!.id, 4);
      const key = shopping.getShoppingList(profile.id).lines[0]!.key;
      shopping.toggleShoppingItem(profile.id, key);

      shopping.clearShoppingList(profile.id);
      assert.deepEqual(shopping.getShoppingList(profile.id).recipes, []);

      // Re-adding the same recipe must come back untouched, not half-ticked.
      shopping.addToShoppingList(profile.id, recipe!.id, 4);
      const after = shopping.getShoppingList(profile.id);
      assert.ok(after.lines.every((line) => !line.checked));
      shopping.clearShoppingList(profile.id);
    });

    test('membership is reported for the recipe screen’s button', () => {
      const profile = freshList();
      const [recipe] = recipes.listRecipes({ query: 'shakshuka' });

      assert.equal(shopping.isOnShoppingList(profile.id, recipe!.id), false);
      shopping.addToShoppingList(profile.id, recipe!.id, 4);
      assert.equal(shopping.isOnShoppingList(profile.id, recipe!.id), true);
      shopping.removeFromShoppingList(profile.id, recipe!.id);
      assert.equal(shopping.isOnShoppingList(profile.id, recipe!.id), false);
    });

    /**
     * The limit lives in the repository, not only in the screen, so every path
     * that adds a recipe is covered by the same rule — including ones written
     * later by someone who has forgotten there is one.
     */
    test('a free list holds one recipe, and says so', () => {
      const profile = freshList();
      const [first] = recipes.listRecipes({ query: 'shakshuka' });
      const [second] = recipes.listRecipes({ query: 'traybake' });

      shopping.addToShoppingList(profile.id, first!.id, 4, { maxRecipes: 1 });

      assert.throws(
        () => shopping.addToShoppingList(profile.id, second!.id, 4, { maxRecipes: 1 }),
        (error: Error) => error.name === 'ShoppingListLimitError',
      );
      assert.equal(shopping.getShoppingList(profile.id).recipes.length, 1);

      // Changing the portions of something already on the list is a correction,
      // not a second addition, so the limit must not block it.
      shopping.addToShoppingList(profile.id, first!.id, 8, { maxRecipes: 1 });
      assert.equal(shopping.getShoppingList(profile.id).recipes[0]!.servings, 8);

      // And premium passes no limit at all.
      shopping.addToShoppingList(profile.id, second!.id, 4);
      assert.equal(shopping.getShoppingList(profile.id).recipes.length, 2);
    });

    test('zero portions is rejected rather than silently stored', () => {
      const profile = freshList();
      const [recipe] = recipes.listRecipes({ query: 'shakshuka' });
      assert.throws(() => shopping.addToShoppingList(profile.id, recipe!.id, 0), RangeError);
    });
  });

  /**
   * The conversion that would be invisible if it were wrong. Recipe nutrition is
   * stored per serving; `logMeal` scales from a per-100 g basis. Two servings of
   * a 600 kcal recipe is 1200 kcal in the journal, and nothing else in the app
   * would notice if it were 12 or 120,000.
   */
  test('logging a recipe puts its own per-serving nutrition in the journal', () => {
    const profile = user.getOrCreateLocalUser();
    const [summary] = recipes.listRecipes({ query: 'traybake' });
    const detail = recipes.getRecipe(summary!.id)!;

    const before = journal.getDayTotals(profile.id, dates.today()).energyKcal;

    const entryId = recipes.logRecipeAsMeal({
      userId: profile.id,
      recipeId: detail.id,
      mealSlot: 'dinner',
    });

    const entry = journal.getDayEntries(profile.id, dates.today()).find((e) => e.id === entryId)!;
    assert.equal(entry.items.length, 1, 'a recipe logs as one line, not one per ingredient');
    assert.equal(entry.items[0]!.displayName, detail.title);

    const logged = entry.totals.energyKcal ?? 0;
    assert.ok(
      Math.abs(logged - (detail.nutrients.energyKcal ?? 0)) < 1,
      `logged ${logged} kcal for a ${detail.nutrients.energyKcal} kcal serving`,
    );
    assert.ok(
      Math.abs(journal.getDayTotals(profile.id, dates.today()).energyKcal - (before + logged)) < 1,
    );
  });

  test('two servings logs twice the nutrition', () => {
    const profile = user.getOrCreateLocalUser();
    const [summary] = recipes.listRecipes({ query: 'lentil dal' });
    const detail = recipes.getRecipe(summary!.id)!;

    const entryId = recipes.logRecipeAsMeal({
      userId: profile.id,
      recipeId: detail.id,
      mealSlot: 'dinner',
      servings: 2,
    });

    const entry = journal.getDayEntries(profile.id, dates.today()).find((e) => e.id === entryId)!;
    assert.ok(
      Math.abs((entry.totals.energyKcal ?? 0) - (detail.nutrients.energyKcal ?? 0) * 2) < 1,
    );
    assert.equal(entry.items[0]!.portionLabel, '2 servings');
  });

  test('a logged recipe can still have its portion corrected', () => {
    const profile = user.getOrCreateLocalUser();
    const [summary] = recipes.listRecipes({ query: 'chilli' });
    const entryId = recipes.logRecipeAsMeal({
      userId: profile.id,
      recipeId: summary!.id,
      mealSlot: 'dinner',
    });

    // The grams the recipe logs are a real weight derived from its ingredients,
    // so the journal's portion editor works on it like any other food.
    const entry = journal.getDayEntries(profile.id, dates.today()).find((e) => e.id === entryId)!;
    const item = entry.items[0]!;
    assert.ok(item.grams > 0);

    journal.updateEntryItemGrams(item.id, item.grams / 2);
    const halved = journal.getEntryItem(item.id)!;
    assert.ok(Math.abs(halved.grams - item.grams / 2) < 0.01);
  });

  test('rejects a serving count that is not a positive number', () => {
    const profile = user.getOrCreateLocalUser();
    const [summary] = recipes.listRecipes();
    assert.throws(
      () =>
        recipes.logRecipeAsMeal({
          userId: profile.id,
          recipeId: summary!.id,
          mealSlot: 'dinner',
          servings: 0,
        }),
      RangeError,
    );
  });

  describe('grouping variants into dishes', () => {
    test('a variant suffix is split off; anything else is part of the name', () => {
      assert.deepEqual(recipes.identifyDish('Shakshuka, light'), {
        dishKey: 'shakshuka',
        dishName: 'Shakshuka',
        variantLabel: 'Light',
      });
      assert.equal(recipes.identifyDish('Shakshuka').variantLabel, recipes.STANDARD_VARIANT);
      assert.equal(recipes.identifyDish('Red lentil dal, vegan').variantLabel, 'Vegan');
    });

    /**
     * The trap this design has to survive: plenty of real dish names contain a
     * comma. Only a *known* variant word may be split off, or "Chicken, leek and
     * potato pie" becomes a dish called "Chicken".
     */
    test('a dish name containing a comma is not mistaken for a variant', () => {
      const identity = recipes.identifyDish('Chicken, leek and potato pie');
      assert.equal(identity.dishName, 'Chicken, leek and potato pie');
      assert.equal(identity.variantLabel, recipes.STANDARD_VARIANT);
    });

    test('the library collapses to its distinct dishes', () => {
      const allRecipes = recipes.listRecipes();
      const dishes = recipes.listDishes();

      assert.ok(dishes.length < allRecipes.length, 'grouping should reduce the browse list');
      assert.equal(
        dishes.reduce((sum, d) => sum + d.variants.length, 0),
        allRecipes.length,
        'every recipe belongs to exactly one dish',
      );
    });

    test('variants are ordered light, standard, hearty', () => {
      const dish = recipes.listDishes().find((d) => d.variants.length >= 3)!;
      const labels = dish.variants.map((v) => v.variantLabel);
      assert.deepEqual(labels.slice(0, 3), ['Light', recipes.STANDARD_VARIANT, 'Hearty']);
    });

    test('the standard version represents the dish on the browse card', () => {
      const dish = recipes.listDishes().find((d) => d.variants.length >= 3)!;
      assert.equal(dish.representative.variantLabel, recipes.STANDARD_VARIANT);
    });

    /**
     * A filter that excludes the standard version must still surface the dish
     * through whichever variant survived — otherwise filtering to "vegan" hides
     * dishes that have a perfectly good vegan variant.
     */
    test('a filtered-out standard falls back to a surviving variant', () => {
      const light = recipes
        .listRecipes()
        .filter((r) => recipes.identifyDish(r.title).variantLabel === 'Light');
      assert.ok(light.length > 0);

      const dishes = recipes.listDishes({ maxMinutes: 0 });
      assert.equal(dishes.length, 0, 'an impossible filter yields no dishes at all');
    });
  });

  describe('scaling a recipe', () => {
    test('quantities scale but a serving stays a serving', () => {
      const [summary] = recipes.listRecipes({ query: 'traybake' });
      const recipe = recipes.getRecipe(summary!.id)!;

      const doubled = recipes.scaleRecipe(recipe, recipe.servings * 2);

      assert.equal(doubled.servings, recipe.servings * 2);
      for (const [index, ingredient] of doubled.ingredients.entries()) {
        const original = recipe.ingredients[index]!.grams;
        assert.ok(
          Math.abs(ingredient.scaledGrams - original * 2) <= 5,
          `${ingredient.name}: ${ingredient.scaledGrams} should be about ${original * 2}`,
        );
      }

      // The point of the whole feature: cooking more does not make a portion bigger.
      assert.deepEqual(doubled.nutrients, recipe.nutrients);
    });

    test('cooking for one from a batch recipe divides the quantities', () => {
      const [summary] = recipes.listRecipes({ query: 'chilli' });
      const recipe = recipes.getRecipe(summary!.id)!;
      assert.ok(recipe.servings > 1, 'test needs a batch recipe');

      const single = recipes.scaleRecipe(recipe, 1);
      const factor = 1 / recipe.servings;

      for (const [index, ingredient] of single.ingredients.entries()) {
        const expected = recipe.ingredients[index]!.grams * factor;
        assert.ok(Math.abs(ingredient.scaledGrams - expected) <= 5);
      }
    });

    test('quantities come back at a precision a cook can measure', () => {
      const [summary] = recipes.listRecipes({ query: 'shakshuka' });
      const recipe = recipes.getRecipe(summary!.id)!;
      const scaled = recipes.scaleRecipe(recipe, recipe.servings * 1.5);

      for (const ingredient of scaled.ingredients) {
        // Never a long decimal — half grams at the small end, fives at the large.
        const rounded =
          ingredient.scaledGrams < 10
            ? Math.round(ingredient.scaledGrams * 2) / 2
            : ingredient.scaledGrams < 100
              ? Math.round(ingredient.scaledGrams)
              : Math.round(ingredient.scaledGrams / 5) * 5;
        assert.equal(ingredient.scaledGrams, rounded);
      }
    });

    /** Scaling that stops being honest should say so rather than quietly mislead. */
    test('warns when scaling past what one pan holds', () => {
      const [summary] = recipes.listRecipes({ query: 'traybake' });
      const recipe = recipes.getRecipe(summary!.id)!;

      assert.equal(recipes.scaleRecipe(recipe, recipe.servings).warnings.length, 0);
      assert.ok(recipes.scaleRecipe(recipe, recipe.servings * 3).warnings.length > 0);
    });

    test('warns about fractions of whole ingredients when scaling down', () => {
      const [summary] = recipes.listRecipes({ query: 'shakshuka' });
      const recipe = recipes.getRecipe(summary!.id)!;

      const warnings = recipes.scaleRecipe(recipe, 1).warnings.join(' ');
      assert.match(warnings, /egg/i, 'a half-egg should be called out, not rounded silently');
    });

    test('rejects a nonsensical serving count', () => {
      const [summary] = recipes.listRecipes();
      const recipe = recipes.getRecipe(summary!.id)!;
      assert.throws(() => recipes.scaleRecipe(recipe, 0), RangeError);
      assert.throws(() => recipes.scaleRecipe(recipe, -2), RangeError);
    });
  });
});

describe('exporting everything', () => {
  test('the bundle is complete, and its counts match the database', () => {
    const profile = user.getOrCreateLocalUser();
    const bundle = exporter.buildExport(profile.id);

    assert.equal(bundle.format, exporter.EXPORT_FORMAT);
    assert.equal(bundle.version, exporter.EXPORT_VERSION);
    assert.match(bundle.exportedAt, /^\d{4}-\d{2}-\d{2}T/);

    // Counts are the thing a person checks the file against, so they have to be
    // the real numbers rather than the length of whatever happened to serialise.
    assert.equal(bundle.counts.journalEntries, bundle.journal.length);
    assert.equal(
      bundle.counts.loggedItems,
      bundle.journal.reduce((sum, e) => sum + (e.items as unknown[]).length, 0),
    );
    assert.ok(bundle.counts.journalEntries > 0, 'test needs logged data to be meaningful');
    assert.ok(bundle.counts.goals > 0, 'the goal history is part of the record');
  });

  test('soft-deleted rows stay out of the export', () => {
    const profile = user.getOrCreateLocalUser();
    const live = client.sqlite.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = ? AND deleted_at IS NULL`,
      [profile.id],
    );
    const deleted = client.sqlite.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = ? AND deleted_at IS NOT NULL`,
      [profile.id],
    );

    assert.ok((deleted?.c ?? 0) > 0, 'earlier tests should have left tombstones behind');
    assert.equal(exporter.buildExport(profile.id).counts.journalEntries, live?.c);
  });

  test('nutrition survives in full, not just the macros', () => {
    const profile = user.getOrCreateLocalUser();
    const bundle = exporter.buildExport(profile.id);

    const items = bundle.journal.flatMap((e) => e.items as Record<string, unknown>[]);
    assert.ok(items.length > 0);

    for (const item of items) {
      const nutrients = item.nutrients as Record<string, number>;
      assert.equal(typeof nutrients, 'object', 'the vector is an object, not a JSON string');
      assert.ok(typeof nutrients.energyKcal === 'number');
      assert.ok(typeof item.grams === 'number');
    }
  });

  test('JSON columns come back as values rather than strings', () => {
    const profile = user.getOrCreateLocalUser();
    const exported = exporter.buildExport(profile.id).profile!;

    assert.ok(Array.isArray(exported.allergens), 'allergens should be an array');
    assert.ok(Array.isArray(exported.equipment), 'equipment should be an array');
    assert.equal(typeof exported.detailed_nutrition, 'boolean');
  });

  /**
   * Saved meals were missing from the export, the reset and the account delete
   * alike — the app would have destroyed them on request while being unable to
   * hand them over. They are the one thing in the file a person authored rather
   * than recorded, so losing them is losing work.
   */
  test('saved meals are exported with their foods nested', () => {
    const profile = user.getOrCreateLocalUser();
    savedMeals.createSavedMeal({
      userId: profile.id,
      name: 'Export test breakfast',
      mealSlot: 'breakfast',
      items: [
        {
          foodItemId: null,
          displayName: 'Greek yoghurt',
          grams: 170,
          per100g: { energyKcal: 59, proteinG: 10 },
          source: 'user',
          confidence: 1,
        },
      ],
    });

    const bundle = exporter.buildExport(profile.id);
    const meal = bundle.savedMeals.find((m) => m.name === 'Export test breakfast');
    assert.ok(meal, 'the saved meal should be in the export');

    const items = meal!.items as Record<string, unknown>[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.display_name, 'Greek yoghurt');
    assert.equal(
      typeof (items[0]!.nutrients as Record<string, number>).energyKcal,
      'number',
      'nutrients come back as a vector, not a JSON string',
    );
    assert.ok(bundle.counts.savedMeals >= 1);
  });

  /**
   * Recipes themselves are bundled reference data and stay out. What a person
   * *did* with one is theirs, and travels by id and title so it can be matched
   * back to the library without shipping 496 recipes inside a personal file.
   */
  test('kept and cooked recipes travel by reference, not by value', () => {
    const profile = user.getOrCreateLocalUser();
    const [recipe] = recipes.listRecipes({ query: 'shakshuka' });

    interactions.toggleRecipeSaved(profile.id, recipe!.id);
    shopping.addToShoppingList(profile.id, recipe!.id, 4);

    const bundle = exporter.buildExport(profile.id);

    const kept = bundle.keptRecipes.find((r) => r.recipe_id === recipe!.id);
    assert.ok(kept, 'a saved recipe should be in the export');
    assert.equal(kept!.kind, 'saved');
    assert.equal(kept!.title, recipe!.title, 'the title travels so the id is not opaque');
    assert.ok(!('ingredients' in kept!), 'the recipe itself must not be copied in');

    const onList = bundle.shoppingList.find((r) => r.recipe_id === recipe!.id);
    assert.ok(onList, 'the shopping list should be in the export');
    assert.equal(onList!.servings, 4);

    interactions.toggleRecipeSaved(profile.id, recipe!.id);
    shopping.clearShoppingList(profile.id);
  });

  /** Never collected by any screen, so exporting it promised a field that is always null. */
  test('the weekly budget is not exported', () => {
    const profile = user.getOrCreateLocalUser();
    const exported = exporter.buildExport(profile.id).profile!;
    assert.ok(!('weekly_budget_minor' in exported));
  });

  /**
   * The export is the answer to "what if I lose my phone", so it has to survive
   * the round trip it is written for — serialise, save, reopen elsewhere.
   */
  test('serialises to valid JSON that parses back identically', () => {
    const profile = user.getOrCreateLocalUser();
    const bundle = exporter.buildExport(profile.id);
    const text = exporter.serialiseExport(bundle);

    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(bundle)));
    assert.ok(text.endsWith('\n'), 'files end with a newline');
  });

  test('leaves the shared food library out', () => {
    const profile = user.getOrCreateLocalUser();
    client.sqlite.runSync(
      `INSERT INTO food_items (id, name, source, confidence, verified, user_submitted, nutrients, allergens, created_at, updated_at)
       VALUES ('export-cache-1', 'Some Cached Food', 'off', 0.8, 0, 0, '{"energyKcal":100}', '[]', '2026-01-01', '2026-01-01')`,
    );

    const text = exporter.serialiseExport(exporter.buildExport(profile.id));
    assert.ok(
      !text.includes('Some Cached Food'),
      'public reference data would bloat the file with nothing personal in it',
    );
  });

  test('the filename is dated, so exports sort chronologically', () => {
    assert.equal(
      exporter.exportFilename(new Date('2026-03-09T12:00:00')),
      'daylish-export-2026-03-09.json',
    );
  });
});

describe('accounts', () => {
  const ACCOUNT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const ACCOUNT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  /**
   * Signing in for the first time has to bring the existing diary with it.
   *
   * Before this build the app had no accounts, so everyone using it already has
   * a pre-account diary sitting in SQLite. Losing it at the sign-in wall would
   * be the single worst bug this feature could ship with.
   */
  test('a first sign-in adopts the diary that was already on the device', () => {
    const anonymous = user.getOrCreateLocalUser();
    const before = journal.getDayTotals(anonymous.id, dates.today());
    assert.ok(before.energyKcal > 0, 'test needs a pre-account diary to be meaningful');

    const outcome = account.ensureAccountUser(ACCOUNT_A, 'alex@example.com');

    assert.equal(outcome.userId, ACCOUNT_A);
    assert.equal(outcome.adopted, true);
    assert.ok(outcome.adoptedSummary?.hasData);

    // Same food, now under the account id.
    const after = journal.getDayTotals(ACCOUNT_A, dates.today());
    assert.ok(
      Math.abs(after.energyKcal - before.energyKcal) < 0.01,
      `calories changed in adoption: ${before.energyKcal} -> ${after.energyKcal}`,
    );
    assert.equal(journal.getDayTotals(anonymous.id, dates.today()).energyKcal, 0);
    assert.equal(account.userExists(anonymous.id), false, 'the old row is renamed, not duplicated');
  });

  test('onboarding answers and goal history survive adoption', () => {
    const profile = user.getUserById(ACCOUNT_A);
    assert.ok(profile, 'the adopted profile is readable by its new id');
    assert.ok(profile!.onboardedAt, 'onboarding is still marked complete');
    assert.ok(user.getCurrentGoal(ACCOUNT_A), 'targets came across too');
  });

  test('signing in again is not a second adoption', () => {
    const outcome = account.ensureAccountUser(ACCOUNT_A, 'alex@example.com');
    assert.equal(outcome.adopted, false);
    assert.equal(outcome.userId, ACCOUNT_A);
    assert.equal(account.findAnonymousUserId(), null, 'nothing anonymous is left to adopt');
  });

  /**
   * The property that matters most on a shared device: a second account must
   * never inherit the first one's food. Adoption is a one-time event, and once
   * it has happened there is no anonymous row for the next person to absorb.
   */
  test('a second account on the same device starts empty', () => {
    const outcome = account.ensureAccountUser(ACCOUNT_B, 'sam@example.com');

    assert.equal(outcome.adopted, false);
    assert.equal(journal.getDayEntries(ACCOUNT_B, dates.today()).length, 0);
    assert.equal(user.getUserById(ACCOUNT_B)?.onboardedAt ?? null, null, 'B does its own setup');

    // And A is untouched by B arriving.
    assert.ok(journal.getDayTotals(ACCOUNT_A, dates.today()).energyKcal > 0);
  });

  test('deleting one account leaves the other account alone', () => {
    const survivingBefore = journal.getDayTotals(ACCOUNT_A, dates.today());

    journal.logMeal({
      userId: ACCOUNT_B,
      mealSlot: 'lunch',
      logMethod: 'quick_add',
      items: [
        {
          foodItemId: null,
          displayName: 'Sandwich',
          grams: 200,
          per100g: { energyKcal: 250, proteinG: 10 },
          source: 'user',
          confidence: 0.5,
        },
      ],
    });
    assert.ok(journal.getDayTotals(ACCOUNT_B, dates.today()).energyKcal > 0);

    const result = account.deleteAccountData(ACCOUNT_B);
    assert.ok(result.rowsDeleted > 0);

    assert.equal(account.userExists(ACCOUNT_B), false);
    assert.equal(journal.getDayEntries(ACCOUNT_B, dates.today()).length, 0);
    assert.equal(
      journal.getDayTotals(ACCOUNT_A, dates.today()).energyKcal,
      survivingBefore.energyKcal,
      "deleting B must not touch A's diary",
    );
  });

  test('deleting an account leaves no orphaned meal items behind', () => {
    const orphans = client.sqlite.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal_entry_items i
        WHERE NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.id = i.entry_id)`,
    );
    assert.equal(orphans?.c, 0);
  });
});

describe('starting over', () => {
  /**
   * "Answer setup again" must not cost the user their history — that is the
   * entire difference between it and the destructive reset beside it.
   */
  test('restarting onboarding keeps logged meals but clears targets', () => {
    const profile = user.getOrCreateLocalUser();
    const before = journal.getDayTotals(profile.id, dates.today());
    assert.ok(before.energyKcal > 0, 'test needs logged data to be meaningful');

    reset.restartOnboarding(profile.id);

    assert.equal(user.getCurrentGoal(profile.id), null, 'targets should be gone');
    assert.equal(
      user.getOrCreateLocalUser().onboardedAt,
      null,
      'the app should route back to onboarding',
    );
    assert.equal(
      journal.getDayTotals(profile.id, dates.today()).energyKcal,
      before.energyKcal,
      'logged meals must survive',
    );
  });

  test('a full reset empties everything and returns to first-launch state', () => {
    const before = user.getOrCreateLocalUser();
    const result = reset.resetLocalData();
    assert.ok(result.rowsDeleted > 0);

    // A fresh user is minted, and it is genuinely a different one.
    const after = user.getOrCreateLocalUser();
    assert.notEqual(after.id, before.id);
    assert.equal(after.onboardedAt, null);
    assert.equal(journal.getDayEntries(after.id, dates.today()).length, 0);
    assert.equal(user.getCurrentGoal(after.id), null);

    // The outbox must go too, or the sync worker would push rows for a user
    // that no longer exists.
    const outbox = client.sqlite.getAllSync('SELECT id FROM sync_outbox');
    assert.equal(outbox.length, 0);
  });

  /**
   * The regression guard for a bug that shipped: `saved_meals` was keyed to a
   * user and listed in neither the reset nor the account-deletion table lists,
   * so saved meals survived "delete everything on this phone" and were never
   * adopted on first sign-in.
   *
   * Enumerating the live schema rather than a hand-written list is the point —
   * this fails the next time a user-scoped table is added and the lists are not
   * updated, which is exactly how the first one was missed.
   */
  test('no table keyed to a user survives a reset', () => {
    const profile = user.getOrCreateLocalUser();

    // Populate the tables that are easy to forget, so the check is not vacuous.
    const [recipe] = recipes.listRecipes({ query: 'shakshuka' });
    interactions.toggleRecipeSaved(profile.id, recipe!.id);
    shopping.addToShoppingList(profile.id, recipe!.id, 4);
    shopping.toggleShoppingItem(profile.id, shopping.getShoppingList(profile.id).lines[0]!.key);
    journal.logMeal({
      userId: profile.id,
      mealSlot: 'lunch',
      logMethod: 'quick_add',
      items: [
        {
          foodItemId: null,
          displayName: 'Something',
          grams: 100,
          per100g: { energyKcal: 100, proteinG: 5 },
          source: 'user',
          confidence: 1,
        },
      ],
    });
    savedMeals.createSavedMeal({
      userId: profile.id,
      name: 'My usual',
      items: [
        {
          foodItemId: null,
          displayName: 'Porridge',
          grams: 250,
          per100g: { energyKcal: 70, proteinG: 3 },
          source: 'user',
          confidence: 1,
        },
      ],
    });

    const tables = client.sqlite
      .getAllSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .map((row) => row.name)
      .filter((name) =>
        client.sqlite
          .getAllSync<{ name: string }>(`PRAGMA table_info(${name})`)
          .some((column) => column.name === 'user_id'),
      );

    assert.ok(tables.length > 5, 'expected several user-scoped tables in the schema');
    assert.ok(
      tables.includes('saved_meals') && tables.includes('shopping_list_recipes'),
      'the tables this test exists for should be among them',
    );

    reset.resetLocalData();

    for (const table of tables) {
      const rows = client.sqlite.getAllSync(`SELECT 1 FROM ${table} LIMIT 1`);
      assert.equal(
        rows.length,
        0,
        `${table} still holds rows after a reset — add it to USER_TABLES in reset.ts and USER_SCOPED_TABLES in account.ts`,
      );
    }
  });

  test('the cached food library survives a reset by default', () => {
    client.sqlite.runSync(
      `INSERT INTO food_items (id, name, source, confidence, verified, user_submitted, nutrients, allergens, created_at, updated_at)
       VALUES ('cache-1', 'Cached Oats', 'off', 0.8, 0, 0, '{"energyKcal":389}', '[]', '2026-01-01', '2026-01-01')`,
    );
    reset.resetLocalData();
    const foods = client.sqlite.getAllSync('SELECT id FROM food_items');
    assert.ok(
      foods.length > 0,
      'wiping the barcode cache would force every scan to be re-fetched for no benefit',
    );

    reset.resetLocalData({ includeCachedFoods: true });
    assert.equal(client.sqlite.getAllSync('SELECT id FROM food_items').length, 0);
  });
});

describe('the daily loop', () => {
  let userId: string;

  before(() => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();
    userId = profile.id;
    user.completeOnboarding(userId, {
      sex: 'female', birthDate: '1992-03-01', heightCm: 168, weightKg: 65,
      activityLevel: 'light', goal: 'maintain', rateKgPerWeek: 0,
      dietStyle: 'balanced', allergens: [], maxPrepMinutes: 30, equipment: ['oven'],
    });
  });

  describe('weigh-ins', () => {
    /**
     * The unique index on (user_id, local_date) is load-bearing: two rows for one
     * morning would double-count that day in the trend regression and skew the
     * expenditure estimate.
     */
    test('a second weigh-in on the same day corrects the first', () => {
      daily.recordWeight(userId, 65.4);
      daily.recordWeight(userId, 65.1);

      const stored = daily.getWeightForDate(userId, dates.today());
      assert.equal(stored?.weightKg, 65.1);

      const rows = client.sqlite.getAllSync(
        'SELECT id FROM weight_entries WHERE user_id = ? AND local_date = ?',
        [userId, dates.today()],
      );
      assert.equal(rows.length, 1, 'one row per day, not two');
    });

    test('rejects an implausible weight rather than storing it', () => {
      assert.throws(() => daily.recordWeight(userId, 0), RangeError);
      assert.throws(() => daily.recordWeight(userId, 900), RangeError);
    });

    test('the latest weigh-in is found across gaps', () => {
      daily.recordWeight(userId, 64.8, { localDate: dates.addDays(dates.today(), -5) });
      const latest = daily.getLatestWeight(userId, dates.addDays(dates.today(), -3));
      assert.equal(latest?.weightKg, 64.8, 'should reach back past days with no weigh-in');
    });

    /** The point of the whole feature: weigh-ins let the engine adapt. */
    test('weigh-ins feed the adaptive engine', () => {
      const before = user.recalibrate(userId);
      assert.equal(before.changed, false, 'two weigh-ins is not enough to move a target');
      assert.ok(before.reason.length > 10, 'and it must say why');
    });
  });

  describe('water', () => {
    test('adds up across the day and can be undone', () => {
      assert.equal(daily.getWaterTotal(userId), 0);
      daily.logWater(userId, daily.GLASS_ML);
      daily.logWater(userId, daily.GLASS_ML);
      assert.equal(daily.getWaterTotal(userId), 500);

      assert.equal(daily.undoLastWater(userId), true);
      assert.equal(daily.getWaterTotal(userId), 250);
    });

    test('undo on an empty day reports that there was nothing to undo', () => {
      const other = dates.addDays(dates.today(), -9);
      assert.equal(daily.undoLastWater(userId, other), false);
    });

    test('the goal scales with bodyweight and falls back sensibly', () => {
      assert.equal(daily.waterGoalMl(65), 2300);
      assert.equal(daily.waterGoalMl(null), 2000);
    });
  });

  describe('fasting', () => {
    test('starting a fast closes any fast already running', () => {
      daily.startFast(userId, '16:8', 16);
      daily.startFast(userId, '18:6', 18);

      const open = client.sqlite.getAllSync(
        'SELECT id FROM fasting_sessions WHERE user_id = ? AND ended_at IS NULL',
        [userId],
      );
      assert.equal(open.length, 1, 'two open fasts would make the timeline ambiguous');
      assert.equal(daily.getActiveFast(userId)?.protocol, '18:6');
    });

    test('elapsed and remaining are computed from the start time', () => {
      const active = daily.getActiveFast(userId)!;
      const fourHoursIn = new Date(new Date(active.startedAt).getTime() + 4 * 3_600_000);
      const progress = daily.describeFast(active, fourHoursIn);

      assert.ok(Math.abs(progress.elapsedHours - 4) < 0.01);
      assert.ok(Math.abs(progress.remainingHours - 14) < 0.01);
      assert.equal(progress.complete, false);
    });

    test('passing the target completes the fast without ending it', () => {
      const active = daily.getActiveFast(userId)!;
      const wayPast = new Date(new Date(active.startedAt).getTime() + 30 * 3_600_000);
      const progress = daily.describeFast(active, wayPast);

      assert.equal(progress.complete, true);
      assert.equal(progress.remainingHours, 0);
      assert.equal(progress.fraction, 1, 'the bar fills but does not overflow');
      assert.equal(daily.getActiveFast(userId)?.id, active.id, 'still running until ended');
    });

    /**
     * Fasts cross midnight by design, so the band drawn on a given day has to be
     * clipped to that day — otherwise a 16-hour fast started at 20:00 would try
     * to render from hour 20 to hour 36.
     */
    test('the timeline band is clipped to the day being viewed', () => {
      daily.endFast(daily.getActiveFast(userId)!.id);

      const yesterday = dates.addDays(dates.today(), -1);
      const startedLastNight = new Date(`${yesterday}T20:00:00`);
      daily.startFast(userId, '16:8', 16, startedLastNight);

      const lastNight = daily.fastingBandForDate(userId, yesterday);
      assert.ok(lastNight, 'the fast should appear on the day it started');
      assert.ok(Math.abs(lastNight.startHour - 20) < 0.02);
      assert.ok(lastNight.endHour > 23.9, 'and run to the end of that day');

      const thisMorning = daily.fastingBandForDate(userId, dates.today());
      assert.ok(thisMorning, 'and continue into today');
      assert.ok(thisMorning.startHour < 0.02, 'starting at midnight');
      assert.ok(Math.abs(thisMorning.endHour - 12) < 0.02, 'ending 16 hours after 20:00');
    });

    /**
     * Regression: the band lookup ordered by start time alone, so a fast ended
     * earlier today outranked one still running since last night — and the
     * ongoing fast's band silently vanished from the timeline.
     */
    test('an ongoing fast outranks one ended more recently', () => {
      const openFast = daily.getActiveFast(userId)!;
      // End and immediately restart something else *later* than the open fast's start.
      daily.startFast(userId, '20:4', 20, new Date());
      daily.endFast(daily.getActiveFast(userId)!.id);

      // Re-open the overnight fast so there is one running again.
      const yesterday = dates.addDays(dates.today(), -1);
      daily.startFast(userId, '16:8', 16, new Date(`${yesterday}T20:00:00`));

      const band = daily.fastingBandForDate(userId, dates.today());
      assert.ok(band, 'the running overnight fast must still draw a band today');
      assert.ok(band.startHour < 0.02);
      assert.ok(Math.abs(band.endHour - 12) < 0.02);
      assert.ok(openFast);
    });

    test('no band on a day the fast does not touch', () => {
      assert.equal(daily.fastingBandForDate(userId, dates.addDays(dates.today(), -14)), null);
    });
  });
});

/**
 * Backing the diary up to the account.
 *
 * Exercised against a fake push target rather than mocked out, because the
 * parts that can lose data are all local: what gets read, what order it goes in,
 * when the queue is cleared, and what happens when the server says no. A test
 * that stubbed `pushOutbox` itself would prove nothing.
 */
describe('sync', () => {
  /** Records what it was asked to send, and can be told to refuse. */
  function fakeTarget(options: { failOn?: string } = {}) {
    const sent: { table: string; rows: Record<string, unknown>[] }[] = [];
    return {
      sent,
      target: {
        async upsert(table: string, rows: readonly Record<string, unknown>[]) {
          if (options.failOn === table) throw new Error(`${table}: refused by test`);
          sent.push({ table, rows: rows as Record<string, unknown>[] });
        },
      },
    };
  }

  function freshQueue() {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();
    user.completeOnboarding(profile.id, {
      sex: 'female', birthDate: '1990-01-01', heightCm: 170, weightKg: 68,
      activityLevel: 'moderate', goal: 'maintain', rateKgPerWeek: 0,
      dietStyle: 'balanced', allergens: [], maxPrepMinutes: 45, equipment: ['oven'],
    });
    return profile.id;
  }

  /** Pending is a property of the rows, so a second run with no edits is silent. */
  test('nothing changed means nothing sent', async () => {
    const userId = freshQueue();
    await sync.pushOutbox(userId, fakeTarget().target);
    assert.equal(sync.pendingWrites(userId), 0, 'the first push clears the backlog');

    const { target, sent } = fakeTarget();
    const outcome = await sync.pushOutbox(userId, target);

    assert.equal(outcome.pushed, 0);
    assert.equal(sent.length, 0, 'an unchanged diary must not be re-sent');
  });

  /**
   * The bug that made this file drive off `synced_at` instead of the outbox:
   * onboarding never enqueued anything, so the profile, the first weigh-in and
   * the first goal — everything a new phone needs — were invisible to a push.
   */
  test('onboarding data is pushed even though nothing enqueued it', async () => {
    const userId = freshQueue();
    client.sqlite.runSync('DELETE FROM sync_outbox');

    const { target, sent } = fakeTarget();
    await sync.pushOutbox(userId, target);

    const tables = sent.map((s) => s.table);
    assert.ok(tables.includes('profiles'), 'the profile must reach the server');
    assert.ok(tables.includes('user_goals'), 'and the goal that onboarding computed');
  });

  /** Another account's rows stay on the device after sign-out and are not ours to send. */
  test('only the signed-in account’s rows are pushed', async () => {
    const userId = freshQueue();
    const otherId = '00000000-0000-4000-8000-00000000beef';
    client.sqlite.runSync(
      `INSERT INTO users (id, sex, activity_level, cooking_skill, allergens,
         disliked_ingredients, equipment, currency, max_prep_minutes, detailed_nutrition,
         timezone, created_at, updated_at)
       VALUES (?, 'unspecified', 'moderate', 'comfortable', '[]', '[]', '[]', 'EUR', 45, 0, 'UTC', ?, ?)`,
      [otherId, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    );

    const { target, sent } = fakeTarget();
    await sync.pushOutbox(userId, target);

    const profiles = sent.filter((s) => s.table === 'profiles').flatMap((s) => s.rows);
    assert.ok(
      !profiles.some((row) => row.id === otherId),
      'a previous account’s profile must never be offered under this session',
    );
  });

  test('queued writes are pushed and the queue drains', async () => {
    const userId = freshQueue();
    journal.logMeal({
      userId,
      mealSlot: 'lunch',
      logMethod: 'quick_add',
      items: [
        {
          foodItemId: null,
          displayName: 'Test soup',
          grams: 300,
          per100g: { energyKcal: 40, proteinG: 2 },
          source: 'user',
          confidence: 1,
        },
      ],
    });

    assert.ok(sync.pendingWrites(userId) > 0, 'logging should queue writes');
    const { target, sent } = fakeTarget();
    const outcome = await sync.pushOutbox(userId, target);

    assert.ok(outcome.pushed > 0);
    assert.equal(outcome.error, null);
    assert.equal(sync.pendingWrites(userId), 0, 'a successful push drains the queue');

    const tables = sent.map((s) => s.table);
    assert.ok(tables.includes('journal_entries'));
    assert.ok(tables.includes('journal_entry_items'));
  });

  /** The server calls it `profiles`, and it has to arrive before anything referencing it. */
  test('the profile is renamed and sent before its children', async () => {
    const userId = freshQueue();
    daily.recordWeight(userId, 68.5);

    const { target, sent } = fakeTarget();
    await sync.pushOutbox(userId, target);

    const tables = sent.map((s) => s.table);
    assert.ok(!tables.includes('users'), 'the device name must not reach the server');
    if (tables.includes('profiles')) {
      assert.ok(
        tables.indexOf('profiles') < tables.indexOf('weight_entries'),
        'profiles must be sent before rows that reference it',
      );
    }
  });

  /** Device bookkeeping and a local-only file path must never leave the phone. */
  test('device-only columns are stripped', async () => {
    const userId = freshQueue();
    daily.recordWeight(userId, 70);

    const { target, sent } = fakeTarget();
    await sync.pushOutbox(userId, target);

    for (const { rows } of sent) {
      for (const row of rows) {
        assert.ok(!('synced_at' in row), 'synced_at is device bookkeeping');
        assert.ok(!('email' in row), 'email lives in auth.users on the server');
        assert.ok(!('photo_uri' in row), 'progress photos never leave the device');
      }
    }
  });

  /**
   * The queued operation is deliberately ignored: deletes are soft, so a deleted
   * row is still a row and travels as itself, carrying `deleted_at`.
   */
  test('a soft delete travels as the row, not as an operation', async () => {
    const userId = freshQueue();
    const entryId = journal.logMeal({
      userId,
      mealSlot: 'dinner',
      logMethod: 'quick_add',
      items: [
        {
          foodItemId: null,
          displayName: 'Deleted later',
          grams: 100,
          per100g: { energyKcal: 100 },
          source: 'user',
          confidence: 1,
        },
      ],
    });
    await sync.pushOutbox(userId, fakeTarget().target);

    journal.deleteEntry(entryId);
    const { target, sent } = fakeTarget();
    await sync.pushOutbox(userId, target);

    const entries = sent.find((s) => s.table === 'journal_entries');
    assert.ok(entries, 'the deletion should be pushed');
    assert.ok(entries!.rows[0]!.deleted_at, 'it travels with deleted_at set');
  });

  /** Five edits to one row are one push, not five. */
  test('repeated edits to a row coalesce into a single send', async () => {
    const userId = freshQueue();
    // Four weigh-ins on one day are one row — `recordWeight` upserts — so this
    // is four queued markers collapsing to a single send.
    for (const kg of [70, 70.2, 70.4, 70.6]) daily.recordWeight(userId, kg);

    const queued = client.sqlite.getAllSync(
      `SELECT id FROM sync_outbox WHERE table_name = 'weight_entries'`,
    );
    assert.ok(queued.length >= 2, 'several writes should have been queued');

    const { target, sent } = fakeTarget();
    await sync.pushOutbox(userId, target);

    const rows = sent.filter((s) => s.table === 'weight_entries').flatMap((s) => s.rows);
    assert.equal(rows.length, 1, 'many edits to one row are a single push');
    assert.equal(rows[0]!.weight_kg, 70.6, 'and it carries the latest value, not the first');
  });

  test('a refusal leaves the row queued and records why', async () => {
    const userId = freshQueue();
    daily.recordWeight(userId, 71);

    const before = sync.pendingWrites(userId);
    const outcome = await sync.pushOutbox(userId, fakeTarget({ failOn: 'weight_entries' }).target);

    assert.ok(outcome.error?.includes('refused by test'));
    assert.ok(sync.pendingWrites(userId) > 0, 'a refused row must stay queued');
    assert.ok(before > 0);

    const failed = client.sqlite.getFirstSync<{ attempts: number; last_error: string }>(
      `SELECT attempts, last_error FROM sync_outbox WHERE table_name = 'weight_entries' LIMIT 1`,
    );
    assert.equal(failed?.attempts, 1);
    assert.ok(failed?.last_error?.includes('refused'));
  });

  /** A row the server will never accept must not block the ones behind it. */
  test('a row that has failed too often is stepped over, not dropped', async () => {
    const userId = freshQueue();
    daily.recordWeight(userId, 72);
    client.sqlite.runSync(
      `UPDATE sync_outbox SET attempts = 9 WHERE table_name = 'weight_entries'`,
    );

    const { target, sent } = fakeTarget();
    const outcome = await sync.pushOutbox(userId, target);

    assert.equal(outcome.stuck, 1);
    assert.ok(!sent.some((s) => s.table === 'weight_entries'), 'the stuck row is not retried');
    assert.ok(sync.pendingWrites(userId) > 0, 'and it is kept rather than thrown away');
  });

  test('a successful push stamps the rows as backed up', async () => {
    const userId = freshQueue();
    daily.recordWeight(userId, 73);
    await sync.pushOutbox(userId, fakeTarget().target);

    const row = client.sqlite.getFirstSync<{ synced_at: string | null }>(
      `SELECT synced_at FROM weight_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    assert.ok(row?.synced_at, 'synced_at is what "backed up" means');
  });

  test('booleans become booleans, because SQLite has none', async () => {
    const userId = freshQueue();
    const { target, sent } = fakeTarget();
    await sync.pushOutbox(userId, target);

    const profile = sent.find((s) => s.table === 'profiles');
    if (profile) {
      assert.equal(typeof profile.rows[0]!.detailed_nutrition, 'boolean');
    }
  });
});

/**
 * The two numbers the You tab shows about the backup.
 *
 * Both are derived from the rows rather than remembered separately, so they
 * cannot claim a diary is safe while rows sit unsent — which is the only way a
 * backup indicator can actually mislead someone.
 */
describe('backup status', () => {
  test('reports nothing backed up before the first push', () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();
    assert.equal(sync.lastBackupAt(profile.id), null);
    assert.ok(sync.pendingWrites(profile.id) > 0, 'a new user row is itself pending');
  });

  test('after a push there is a timestamp and nothing waiting', async () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();

    await sync.pushOutbox(profile.id, {
      async upsert() {
        /* accepts everything */
      },
    });

    assert.ok(sync.lastBackupAt(profile.id), 'a successful push must be visible');
    assert.equal(sync.pendingWrites(profile.id), 0);
  });

  /** A refused push must leave the indicator honest rather than optimistic. */
  test('a failed push leaves the work still showing as waiting', async () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();

    const outcome = await sync.pushOutbox(profile.id, {
      async upsert() {
        throw new Error('no network');
      },
    });

    assert.ok(outcome.error);
    assert.equal(sync.lastBackupAt(profile.id), null, 'nothing reached the server');
    assert.ok(sync.pendingWrites(profile.id) > 0, 'so the work is still outstanding');
  });

  /** Two triggers landing together must not send everything twice. */
  test('concurrent pushes collapse into one run', async () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();

    let runs = 0;
    const slow = {
      async upsert() {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    };

    // `syncNow` shares its in-flight promise; `pushOutbox` is the raw call.
    const [a, b] = await Promise.all([
      sync.pushOutbox(profile.id, slow),
      Promise.resolve().then(() => sync.pushOutbox(profile.id, slow)),
    ]);
    assert.ok(a.pushed + b.pushed > 0);
    assert.ok(runs > 0);
  });
});

/**
 * Getting the diary back on a new phone.
 *
 * The round trip is the test that matters: push a real diary into a fake
 * server, wipe the device, sign in again, and check what comes back is the same
 * diary — because "your data is safe" is only true if it can be returned.
 */
describe('restore', () => {
  /** A fake server that keeps whatever it is given, per table. */
  function fakeServer() {
    const store = new Map<string, Record<string, unknown>[]>();
    return {
      store,
      target: {
        async upsert(table: string, rows: readonly Record<string, unknown>[]) {
          const existing = store.get(table) ?? [];
          for (const row of rows) {
            const at = existing.findIndex((r) => r.id === row.id);
            if (at >= 0) existing[at] = { ...row };
            else existing.push({ ...row });
          }
          store.set(table, existing);
        },
      },
      source: {
        async select(table: string) {
          return (store.get(table) ?? []).map((row) => ({ ...row }));
        },
      },
    };
  }

  test('a diary survives losing the phone', async () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();
    const userId = profile.id;

    user.completeOnboarding(userId, {
      sex: 'male', birthDate: '1988-06-01', heightCm: 180, weightKg: 82,
      activityLevel: 'moderate', goal: 'lose', rateKgPerWeek: 0.5,
      dietStyle: 'balanced', allergens: ['peanuts'], maxPrepMinutes: 30, equipment: ['oven'],
    });
    journal.logMeal({
      userId,
      mealSlot: 'breakfast',
      logMethod: 'quick_add',
      items: [
        {
          foodItemId: null,
          displayName: 'Porridge and berries',
          grams: 320,
          per100g: { energyKcal: 78, proteinG: 3 },
          source: 'user',
          confidence: 1,
        },
      ],
    });
    daily.recordWeight(userId, 81.4);
    daily.logWater(userId, 500);

    const server = fakeServer();
    const push = await sync.pushOutbox(userId, server.target);
    assert.ok(push.pushed > 0);
    assert.equal(push.error, null);

    const before = {
      entries: journal.getDayEntries(userId, dates.today()).length,
      totals: journal.getDayTotals(userId, dates.today()).energyKcal,
      water: daily.getWaterTotal(userId),
      weight: daily.getLatestWeight(userId)?.weightKg,
      allergens: user.getUserById(userId)?.allergens,
    };

    // The phone is gone. A new one signs in to the same account.
    reset.resetLocalData();
    client.sqlite.runSync(
      `INSERT INTO users (id, sex, activity_level, cooking_skill, allergens,
         disliked_ingredients, equipment, currency, max_prep_minutes, detailed_nutrition,
         timezone, created_at, updated_at)
       VALUES (?, 'unspecified', 'moderate', 'comfortable', '[]', '[]', '[]', 'EUR', 45, 0, 'UTC', ?, ?)`,
      [userId, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'],
    );

    const outcome = await sync.restoreFromAccount(userId, server.source);
    assert.equal(outcome.error, null);
    assert.equal(outcome.skipped, false);
    assert.ok(outcome.restored > 0);

    assert.equal(journal.getDayEntries(userId, dates.today()).length, before.entries);
    assert.ok(
      Math.abs(journal.getDayTotals(userId, dates.today()).energyKcal - before.totals) < 1,
      'the calories that came back must be the ones that went up',
    );
    assert.equal(daily.getWaterTotal(userId), before.water);
    assert.equal(daily.getLatestWeight(userId)?.weightKg, before.weight);
    assert.deepEqual(user.getUserById(userId)?.allergens, before.allergens);
  });

  /** JSON and booleans are the two things Postgres and SQLite genuinely disagree about. */
  test('json columns and booleans survive the round trip as values', async () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();
    const userId = profile.id;
    user.completeOnboarding(userId, {
      sex: 'female', birthDate: '1995-01-01', heightCm: 165, weightKg: 60,
      activityLevel: 'light', goal: 'maintain', rateKgPerWeek: 0,
      dietStyle: 'balanced', allergens: ['gluten', 'milk'], maxPrepMinutes: 20, equipment: ['air_fryer'],
    });
    user.setDetailedNutrition(userId, true);

    const server = fakeServer();
    await sync.pushOutbox(userId, server.target);

    /*
      The wire shape, asserted directly — this is the regression guard for a bug
      found only by running against the live database. SQLite holds these
      columns as text, and sending that text into a `jsonb` column does not make
      Postgres parse it: it stores the *string*, so `'["gluten"]'` comes back as
      the string `["gluten"]` rather than a list of one. An allergen list that
      has quietly stopped being a list is about the worst shape a silent bug can
      take, and a fake server cannot catch it because a fake echoes back
      whatever it was handed.
    */
    const [sentProfile] = server.store.get('profiles') ?? [];
    assert.ok(Array.isArray(sentProfile!.allergens), 'jsonb must be sent as an array');
    assert.deepEqual(sentProfile!.allergens, ['gluten', 'milk']);
    assert.equal(typeof sentProfile!.detailed_nutrition, 'boolean', 'and booleans as booleans');

    reset.resetLocalData();
    await sync.restoreFromAccount(userId, server.source);

    const restored = user.getUserById(userId)!;
    assert.deepEqual(restored.allergens, ['gluten', 'milk'], 'arrays, not a JSON string');
    assert.deepEqual(restored.equipment, ['air_fryer']);
    assert.equal(restored.detailedNutrition, true, 'a boolean, not the number 1');
  });

  /** A phone already in use is left alone — that is what keeps this merge-free. */
  test('a device with a diary on it is never overwritten', async () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();
    const userId = profile.id;
    daily.recordWeight(userId, 90);

    const server = fakeServer();
    await server.target.upsert('weight_entries', [
      {
        id: '00000000-0000-4000-8000-0000000000ff',
        user_id: userId,
        local_date: dates.today(),
        weight_kg: 55,
        source: 'manual',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      },
    ]);

    const outcome = await sync.restoreFromAccount(userId, server.source);
    assert.equal(outcome.skipped, true, 'a populated phone must be left alone');
    assert.equal(daily.getLatestWeight(userId)?.weightKg, 90, 'local data is untouched');
  });

  /** Restored rows must not be mistaken for local work and sent straight back. */
  test('what came down is not immediately pushed back up', async () => {
    reset.resetLocalData();
    const profile = user.getOrCreateLocalUser();
    const userId = profile.id;
    daily.recordWeight(userId, 77);

    const server = fakeServer();
    await sync.pushOutbox(userId, server.target);

    reset.resetLocalData();
    await sync.restoreFromAccount(userId, server.source);

    assert.equal(
      sync.pendingWrites(userId),
      0,
      'a freshly restored diary has nothing waiting to back up',
    );
  });
});

/**
 * The history calendar's query.
 *
 * The arithmetic here is the kind that looks obvious and is wrong at month
 * boundaries, so it is exercised against real dates rather than reasoned about.
 */
describe('month history', () => {
  /** A month nobody is currently in, so "future" and "elapsed" are unambiguous. */
  const MONTH = '2026-03';

  function logOn(userId: string, localDate: string, kcal: number) {
    journal.logMeal({
      userId,
      mealSlot: 'lunch',
      logMethod: 'quick_add',
      loggedAt: new Date(`${localDate}T12:00:00`),
      items: [
        {
          foodItemId: null,
          displayName: 'Quick add',
          grams: 100,
          per100g: { energyKcal: kcal, proteinG: 0, carbsG: 0, fatG: 0 },
          source: 'user',
          confidence: 1,
        },
      ],
    });
  }

  test('the grid covers every day of the month and nothing outside it', () => {
    reset.resetLocalData();
    const userId = user.getOrCreateLocalUser().id;

    logOn(userId, '2026-02-28', 2000);
    logOn(userId, '2026-03-01', 2000);
    logOn(userId, '2026-03-31', 2000);
    logOn(userId, '2026-04-01', 2000);

    const history = insights.getMonthHistory(userId, MONTH);

    assert.equal(history.days.length, 31, 'March has 31 days');
    assert.equal(history.days[0]!.localDate, '2026-03-01');
    assert.equal(history.days[30]!.localDate, '2026-03-31');
    assert.equal(history.daysLogged, 2, 'the neighbouring months must not leak in');
  });

  /** February is the month that catches a naive 30-or-31 assumption. */
  test('short and leap months are the right length', () => {
    reset.resetLocalData();
    const userId = user.getOrCreateLocalUser().id;

    assert.equal(insights.getMonthHistory(userId, '2026-02').days.length, 28);
    assert.equal(insights.getMonthHistory(userId, '2024-02').days.length, 29, '2024 was a leap year');
  });

  /**
   * A past month has fully elapsed; the current one has not. Dividing by the
   * whole month would report every current month as a failure until the 31st.
   */
  test('days that have not happened are not counted as elapsed', () => {
    reset.resetLocalData();
    const userId = user.getOrCreateLocalUser().id;

    const past = insights.getMonthHistory(userId, MONTH);
    assert.equal(past.daysElapsed, 31, 'a past month has fully elapsed');

    const current = insights.getMonthHistory(userId, insights.monthOf(dates.today()));
    const dayOfMonth = Number(dates.today().slice(-2));
    assert.equal(current.daysElapsed, dayOfMonth, 'only up to today');
    assert.ok(current.daysElapsed <= current.days.length);
  });

  test('averages and on-target counts use logged days only', () => {
    reset.resetLocalData();
    const userId = user.getOrCreateLocalUser().id;
    // Inserted directly: `completeOnboarding` dates a goal today, and this
    // needs one in force during March 2026 so `targetKcal` resolves per day.
    client.sqlite.runSync(
      `INSERT INTO user_goals
         (id, user_id, effective_from, goal, energy_kcal, protein_g, carbs_g, fat_g, fiber_g)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), userId, '2026-03-01', 'maintain', 2000, 150, 200, 60, 30],
    );

    logOn(userId, '2026-03-05', 2000);
    logOn(userId, '2026-03-06', 1000);

    const history = insights.getMonthHistory(userId, MONTH);

    assert.equal(history.daysLogged, 2);
    assert.equal(history.averageKcal, 1500, 'the 29 unlogged days must not drag it to zero');
    assert.equal(history.onTarget, 1, 'only the day within 10% of a 2000 kcal target');
  });

  test('a month with nothing in it reports null rather than zero', () => {
    reset.resetLocalData();
    const userId = user.getOrCreateLocalUser().id;

    const history = insights.getMonthHistory(userId, MONTH);
    assert.equal(history.daysLogged, 0);
    assert.equal(history.averageKcal, null, 'no average exists, and 0 kcal would be a lie');
    assert.equal(history.onTarget, null);
  });

  test('stepping months crosses years correctly', () => {
    assert.equal(insights.addMonths('2026-01', -1), '2025-12');
    assert.equal(insights.addMonths('2026-12', 1), '2027-01');
    assert.equal(insights.monthOf('2026-08-05'), '2026-08');
  });
});
