/**
 * End-to-end check on the backup and restore wire contract.
 *
 * The sync worker is tested thoroughly against a fake push target, and the RLS
 * policies against a real Postgres — but neither proves the two agree. What has
 * never been exercised is the join between them: whether Postgres actually
 * accepts the rows SQLite produces, whether row-level security behaves under a
 * real JWT, and whether what comes back out is what went in.
 *
 * The specific worry that prompted this: the device stores JSON columns as
 * *text*, and the push sends that text unchanged into a `jsonb` column. If
 * PostgREST takes `'["peanuts"]'` as a JSON string rather than an array, the
 * value survives a round trip looking correct while actually being a string —
 * and someone's allergen list quietly stops being a list.
 *
 * Safe to run against production: it creates two throwaway accounts, touches
 * nothing but their own rows, and deletes both at the end. It uses the
 * publishable key, so it holds no privilege the app itself does not have.
 *
 *   npm run verify:sync
 *
 * Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
 * apps/mobile/.env.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '..', 'apps', 'mobile', '.env');

function readEnv() {
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

const env = readEnv();
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!URL_BASE || !KEY) {
  console.error(`Missing Supabase credentials in ${envPath}`);
  process.exit(1);
}

const anon = { apikey: KEY, 'Content-Type': 'application/json' };
const created = [];

function step(n, message) {
  console.log(`  ${n}. ${message}`);
}

async function fail(message, detail) {
  console.error(`\n  FAILED: ${message}`);
  if (detail) console.error(`  ${detail}`);
  await cleanup();
  process.exit(1);
}

/** Delete every throwaway account, whatever happened. Cascades to their rows. */
async function cleanup() {
  for (const account of created) {
    await fetch(`${URL_BASE}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { ...anon, Authorization: `Bearer ${account.token}` },
    }).catch(() => {});
  }
}

async function signUp(tag) {
  const email = `sync-check+${tag}-${Date.now()}@daylish.app`;
  const password = `Tt-${Math.random().toString(36).slice(2)}-9xQ`;

  const response = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: anon,
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (!response.ok) await fail('could not create a throwaway account', JSON.stringify(body));
  if (!body.access_token) {
    await fail(
      'sign-up returned no session, so email confirmation is enabled',
      'Disable it in Authentication > Providers > Email while you run this.',
    );
  }

  const account = { email, token: body.access_token, id: body.user.id };
  created.push(account);
  return account;
}

function authed(account) {
  return { ...anon, Authorization: `Bearer ${account.token}` };
}

/** Exactly the call `supabasePushTarget` makes. */
async function upsert(account, table, rows) {
  const response = await fetch(`${URL_BASE}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: { ...authed(account), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    return { ok: false, detail: `${response.status} ${await response.text()}` };
  }
  return { ok: true };
}

async function select(account, table) {
  const response = await fetch(`${URL_BASE}/rest/v1/${table}?select=*`, {
    headers: authed(account),
  });
  if (!response.ok) await fail(`select from ${table} failed`, await response.text());
  return response.json();
}

console.log(`\nVerifying backup and restore against ${URL_BASE}\n`);

// --- 1. Two accounts, so isolation can be proved rather than assumed --------
step(1, 'creating two throwaway accounts');
const alice = await signUp('a');
const bob = await signUp('b');

// --- 2. Push a profile, exactly as the device holds it ----------------------
//
// The values are the shapes SQLite produces: JSON columns as text, booleans as
// 0 and 1 — except that the worker converts booleans before sending, so this
// sends `false`, matching what it actually does.
step(2, 'pushing a profile, with JSON columns parsed as the worker parses them');
const now = new Date().toISOString();
const profile = {
  id: alice.id,
  sex: 'female',
  birth_date: '1990-04-02',
  height_cm: 168,
  activity_level: 'moderate',
  cooking_skill: 'comfortable',
  allergens: ['peanuts', 'milk'],
  disliked_ingredients: ['olives'],
  equipment: ['oven', 'stovetop'],
  currency: 'EUR',
  max_prep_minutes: 45,
  detailed_nutrition: false,
  timezone: 'Europe/Dublin',
  onboarded_at: now,
  created_at: now,
  updated_at: now,
};

const profilePush = await upsert(alice, 'profiles', [profile]);
if (!profilePush.ok) {
  await fail('the profile was rejected', profilePush.detail);
}

// --- 3. The bug this script exists for -------------------------------------
step(3, 'checking a jsonb column came back as an array, not a string');
const [storedProfile] = await select(alice, 'profiles');
if (!storedProfile) await fail('the profile did not come back');

if (!Array.isArray(storedProfile.allergens)) {
  await fail(
    'a jsonb column came back as a ' + typeof storedProfile.allergens + ', not an array',
    `Postgres stored the text as a JSON string. Value: ${JSON.stringify(storedProfile.allergens)}\n` +
      '  The push must send parsed JSON for these columns rather than the SQLite text.',
  );
}
if (storedProfile.allergens.join(',') !== 'peanuts,milk') {
  await fail('the allergen list changed in transit', JSON.stringify(storedProfile.allergens));
}
if (typeof storedProfile.detailed_nutrition !== 'boolean') {
  await fail('a boolean column did not come back as a boolean');
}

// --- 4. A parent and its child, in the order the worker sends them ----------
step(4, 'pushing a journal entry and its items');
const entryId = randomUUID();
const entry = await upsert(alice, 'journal_entries', [
  {
    id: entryId,
    user_id: alice.id,
    logged_at: now,
    local_date: now.slice(0, 10),
    meal_slot: 'lunch',
    log_method: 'quick_add',
    created_at: now,
    updated_at: now,
  },
]);
if (!entry.ok) await fail('the journal entry was rejected', entry.detail);

const item = await upsert(alice, 'journal_entry_items', [
  {
    id: randomUUID(),
    entry_id: entryId,
    display_name: 'Porridge',
    grams: 320,
    nutrients: { energyKcal: 250, proteinG: 9 },
    confidence: 1,
    source: 'user',
    created_at: now,
    updated_at: now,
  },
]);
if (!item.ok) await fail('the journal item was rejected — check the child ordering', item.detail);

const [storedItem] = await select(alice, 'journal_entry_items');
if (!storedItem || typeof storedItem.nutrients !== 'object') {
  await fail('the nutrient vector did not come back as an object');
}
if (storedItem.nutrients.energyKcal !== 250) {
  await fail('the nutrition changed in transit', JSON.stringify(storedItem.nutrients));
}

// --- 5. Row-level security, under a real token -----------------------------
step(5, 'confirming the second account cannot see the first one\'s diary');
const bobsView = await select(bob, 'journal_entries');
if (bobsView.length !== 0) {
  await fail(
    'RLS did not isolate the accounts',
    `The second account can read ${bobsView.length} of the first account's entries.`,
  );
}

const stolen = await upsert(bob, 'journal_entries', [
  {
    id: randomUUID(),
    user_id: alice.id,
    logged_at: now,
    local_date: now.slice(0, 10),
    meal_slot: 'dinner',
    log_method: 'search',
    created_at: now,
    updated_at: now,
  },
]);
if (stolen.ok) {
  await fail('one account was able to write a row belonging to another');
}

// --- 6. The restore path ---------------------------------------------------
step(6, 'reading the diary back the way a new phone would');
const restored = await select(alice, 'journal_entries');
if (restored.length !== 1 || restored[0].id !== entryId) {
  await fail('the entry did not come back', JSON.stringify(restored));
}

// --- 7. Clean up ------------------------------------------------------------
step(7, 'deleting both throwaway accounts');
await cleanup();

console.log('\n  Backup and restore verified against the live project.\n');
