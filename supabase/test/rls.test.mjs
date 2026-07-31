/**
 * Row-level security tests.
 *
 * Runs the real migrations against a real Postgres (PGlite compiles Postgres to
 * WebAssembly), then proves isolation with two users. This is the only part of
 * the stack where a mistake leaks one person's food diary to another, so it is
 * tested rather than reasoned about — and it runs without Docker or a hosted
 * project, so it can sit in CI from day one.
 *
 *   node --test supabase/test/rls.test.mjs
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

let db;

/** Run a query as a signed-in user, the way PostgREST does. */
async function as(uid, fn) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role; reset request.jwt.claim.sub;');
  }
}

async function count(table, where = 'true') {
  const result = await db.query(`select count(*)::int as c from ${table} where ${where}`);
  return result.rows[0].c;
}

before(async () => {
  db = await PGlite.create({ extensions: { pg_trgm } });

  // Stand in for the pieces Supabase supplies. `auth.uid()` reads the JWT claim
  // from a session setting, which is exactly how PostgREST exposes it.
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create role authenticated;
    create role anon;
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);

  // Read the directory rather than listing files here: a hardcoded list silently
  // stops testing every migration added after it was written, which is the one
  // failure mode a migration test cannot afford. Numeric prefixes sort lexically.
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  assert.ok(migrations.length >= 2, 'migrations directory should not be empty');

  for (const file of migrations) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  // Seeded as the owner, which bypasses RLS.
  await db.exec(`
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
    insert into profiles (id) values ('${ALICE}'), ('${BOB}');
    insert into journal_entries (user_id, logged_at, local_date, meal_slot, log_method)
      values ('${ALICE}', now(), current_date, 'lunch', 'barcode'),
             ('${BOB}',   now(), current_date, 'lunch', 'barcode');
    insert into weight_entries (user_id, local_date, weight_kg)
      values ('${ALICE}', current_date, 70), ('${BOB}', current_date, 90);
    insert into food_items (name, source, nutrients)
      values ('Shared Apple', 'usda', '{"energyKcal":52}');
  `);
});

describe('migrations', () => {
  test('every public table has RLS enabled', async () => {
    const result = await db.query(`
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'`);
    const unprotected = result.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    assert.deepEqual(unprotected, [], `tables without RLS: ${unprotected.join(', ')}`);
  });

  test('no table has RLS on with zero policies', async () => {
    // RLS with no policy denies everything — safe, but always a mistake.
    const result = await db.query(`
      select c.relname, count(p.polname)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      left join pg_policy p on p.polrelid = c.oid
      where c.relkind = 'r' and c.relrowsecurity
      group by 1`);
    const silent = result.rows.filter((r) => r.policies === 0).map((r) => r.relname);
    assert.deepEqual(silent, [], `tables with RLS but no policies: ${silent.join(', ')}`);
  });
});

describe('read isolation', () => {
  test('each user sees only their own journal', async () => {
    assert.equal(await as(ALICE, () => count('journal_entries')), 1);
    assert.equal(await as(BOB, () => count('journal_entries')), 1);
  });

  test('a user cannot read anyone else’s weight history', async () => {
    assert.equal(await as(ALICE, () => count('weight_entries', `user_id = '${BOB}'`)), 0);
    assert.equal(await as(BOB, () => count('weight_entries', `user_id = '${ALICE}'`)), 0);
  });

  test('the food library is shared — a barcode lookup must resolve for everyone', async () => {
    assert.ok((await as(ALICE, () => count('food_items'))) >= 1);
    assert.ok((await as(BOB, () => count('food_items'))) >= 1);
  });

  test('a shopping list is private to the person cooking from it', async () => {
    await db.exec(`
      insert into shopping_list_recipes (user_id, recipe_id, servings)
        values ('${ALICE}', 'seed:shakshuka', 4), ('${BOB}', 'seed:lentil-dal', 2);
      insert into shopping_list_checks (user_id, item_key)
        values ('${ALICE}', 'garlic'), ('${BOB}', 'onion');
    `);

    assert.equal(await as(ALICE, () => count('shopping_list_recipes')), 1);
    assert.equal(await as(ALICE, () => count('shopping_list_recipes', `user_id = '${BOB}'`)), 0);
    assert.equal(await as(BOB, () => count('shopping_list_checks')), 1);
    assert.equal(await as(BOB, () => count('shopping_list_checks', `user_id = '${ALICE}'`)), 0);
  });

  /**
   * The reason 0006 exists. A recipe reference is the device's own key, not a
   * uuid into a server-side library — so a reference to a recipe the server has
   * never heard of has to store and read back cleanly.
   */
  /**
   * The failure this guards against is not a leaked diary — it is a leaked
   * *notification*. A token readable across accounts would let one person's
   * billing message be addressed to a phone somebody else is holding.
   */
  test('a push token is private to the device that registered it', async () => {
    await db.exec(`
      insert into push_tokens (user_id, token, platform)
        values ('${ALICE}', 'ExponentPushToken[alice]', 'ios'),
               ('${BOB}',   'ExponentPushToken[bob]',   'ios');
    `);

    assert.equal(await as(ALICE, () => count('push_tokens')), 1);
    assert.equal(await as(ALICE, () => count('push_tokens', `user_id = '${BOB}'`)), 0);
    assert.equal(await as(BOB, () => count('push_tokens', `user_id = '${ALICE}'`)), 0);
  });

  /**
   * The reason the unique constraint is on `token` alone rather than on
   * `(user_id, token)`. Two accounts signing in on the same handset get the same
   * token from APNs; if both rows could stand, the first account's notifications
   * would keep arriving on a phone the second account now occupies.
   */
  test('one token cannot belong to two accounts at once', async () => {
    await db.exec(`
      insert into push_tokens (user_id, token, platform)
        values ('${ALICE}', 'ExponentPushToken[shared]', 'ios');
    `);

    await assert.rejects(
      () =>
        db.query(`
          insert into push_tokens (user_id, token, platform)
            values ('${BOB}', 'ExponentPushToken[shared]', 'ios')
        `),
      /unique|duplicate key/i,
      'a second account must not be able to hold the same handset’s token',
    );

    // The upsert the app actually performs moves the row rather than duplicating
    // it, which is the behaviour `registerPushToken` depends on.
    await db.exec(`
      insert into push_tokens (user_id, token, platform)
        values ('${BOB}', 'ExponentPushToken[shared]', 'ios')
        on conflict (token) do update set user_id = excluded.user_id;
    `);

    assert.equal(await count('push_tokens', `token = 'ExponentPushToken[shared]'`), 1);
    assert.equal(
      await count('push_tokens', `token = 'ExponentPushToken[shared]' and user_id = '${BOB}'`),
      1,
      'the token follows whoever signed in last',
    );
  });

  test('deleting an account takes its push tokens with it', async () => {
    const doomed = '33333333-3333-3333-3333-333333333333';
    await db.exec(`
      insert into auth.users (id) values ('${doomed}');
      insert into profiles (id) values ('${doomed}');
      insert into push_tokens (user_id, token, platform)
        values ('${doomed}', 'ExponentPushToken[doomed]', 'ios');
    `);

    assert.equal(await count('push_tokens', `user_id = '${doomed}'`), 1);
    // `delete-account` deletes the auth user; everything else cascades from
    // profiles. This is the assertion that the new table joined that chain.
    await db.exec(`delete from profiles where id = '${doomed}'`);
    assert.equal(await count('push_tokens', `user_id = '${doomed}'`), 0);
  });

  test('a recipe reference is a text key, not a foreign key', async () => {
    await as(ALICE, async () => {
      await db.query(
        `insert into recipe_interactions (user_id, recipe_id, kind)
         values ('${ALICE}', 'seed:a-dish-the-server-has-never-seen', 'saved')`,
      );
    });
    assert.equal(
      await as(ALICE, () =>
        count('recipe_interactions', `recipe_id = 'seed:a-dish-the-server-has-never-seen'`),
      ),
      1,
    );
  });
});

describe('write protection', () => {
  test('a user cannot attribute an entry to someone else', async () => {
    await as(ALICE, async () => {
      await assert.rejects(
        () =>
          db.query(`insert into journal_entries (user_id, logged_at, local_date, meal_slot, log_method)
                    values ('${BOB}', now(), current_date, 'dinner', 'search')`),
        /row-level security/,
      );
    });
  });

  /**
   * The verified badge is a promise that a number came from lab data. If a user
   * could set it on their own submission, the badge would mean nothing.
   */
  test('a user cannot mark their own submission as verified', async () => {
    await as(ALICE, async () => {
      await assert.rejects(
        () =>
          db.query(`insert into food_items (name, source, nutrients, submitted_by, user_submitted, verified)
                    values ('Fake Verified', 'user', '{"energyKcal":1}', '${ALICE}', true, true)`),
        /row-level security/,
      );
    });
  });

  test('a user can submit an unverified food', async () => {
    await as(ALICE, async () => {
      await db.query(`insert into food_items (name, source, nutrients, submitted_by, user_submitted, verified)
                      values ('Alice Sourdough', 'user', '{"energyKcal":250}', '${ALICE}', true, false)`);
    });
    assert.equal(await count('food_items', `name = 'Alice Sourdough'`), 1);
  });

  test('a delete cannot reach another user’s rows', async () => {
    await as(ALICE, async () => {
      const result = await db.query(
        `delete from weight_entries where user_id = '${BOB}' returning id`,
      );
      assert.equal(result.rows.length, 0);
    });
    // Bob's row is still there when checked without RLS.
    assert.equal(await count('weight_entries', `user_id = '${BOB}'`), 1);
  });

  test('child rows inherit their parent’s ownership', async () => {
    const bobEntry = await db.query(
      `select id from journal_entries where user_id = '${BOB}' limit 1`,
    );
    const entryId = bobEntry.rows[0].id;

    await as(ALICE, async () => {
      await assert.rejects(
        () =>
          db.query(`insert into journal_entry_items
                      (entry_id, display_name, grams, nutrients, confidence, source)
                    values ('${entryId}', 'Sneaky', 100, '{}', 1, 'usda')`),
        /row-level security/,
      );
    });
  });
});
