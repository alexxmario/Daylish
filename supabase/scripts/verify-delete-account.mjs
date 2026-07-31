/**
 * End-to-end check on the `delete-account` Edge Function.
 *
 * App Review guideline 5.1.1(v) requires that an account-gated app can delete
 * accounts from inside the app. "The function deployed without error" is not
 * evidence that it works — this creates a throwaway user, deletes it through the
 * function exactly as the app does, and proves the account is gone by trying to
 * sign in again.
 *
 * Safe to run against production: it only ever touches the throwaway account it
 * just created, and it uses the publishable key, so it holds no privileges the
 * app itself does not have.
 *
 *   node supabase/scripts/verify-delete-account.mjs
 *
 * Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
 * apps/mobile/.env.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const headers = { apikey: KEY, 'Content-Type': 'application/json' };

// A throwaway address. Uses a plus-tag so it is obvious in the users table if a
// run ever fails midway and leaves one behind.
const email = `delete-check+${Date.now()}@daylish.app`;
const password = `Tt-${Math.random().toString(36).slice(2)}-9xQ`;

function step(n, message) {
  console.log(`  ${n}. ${message}`);
}

function fail(message, detail) {
  console.error(`\n  FAILED: ${message}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
}

console.log(`\nVerifying delete-account against ${URL_BASE}\n`);

// --- 1. Create a throwaway account -----------------------------------------
step(1, `creating ${email}`);
const signUp = await fetch(`${URL_BASE}/auth/v1/signup`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password }),
});
const signUpBody = await signUp.json();
if (!signUp.ok) fail('could not create the throwaway account', JSON.stringify(signUpBody));

let token = signUpBody.access_token;
if (!token) {
  // Email confirmation is switched on, so signup returned no session. That is a
  // valid configuration, but it means this check cannot run unattended.
  fail(
    'sign-up returned no session, so email confirmation is enabled',
    'Either disable it in Authentication > Providers > Email while you run this, ' +
      'or confirm the address and re-run. This is also the setting that decides ' +
      'whether real users can log a meal immediately after signing up.',
  );
}

// --- 2. Delete it through the function, exactly as the app does -------------
step(2, 'calling the delete-account function with that user\'s token');
const deletion = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
  method: 'POST',
  headers: { ...headers, Authorization: `Bearer ${token}` },
});
const deletionBody = await deletion.json().catch(() => ({}));

if (deletion.status === 404) {
  fail(
    'the function is not deployed',
    'Run: supabase functions deploy delete-account',
  );
}
if (!deletion.ok) {
  fail(`the function returned ${deletion.status}`, JSON.stringify(deletionBody));
}
if (deletionBody.deleted !== true) {
  fail('the function did not report a deletion', JSON.stringify(deletionBody));
}

// --- 3. Prove the account is actually gone ---------------------------------
step(3, 'confirming the account can no longer sign in');
const retry = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password }),
});

if (retry.ok) {
  fail(
    'the account still signs in — it was not deleted',
    'The function reported success but the auth record survives. Check that ' +
      'SUPABASE_SERVICE_ROLE_KEY is set on the function.',
  );
}

// --- 4. And that the function rejects unauthenticated callers ---------------
step(4, 'confirming an unauthenticated call is refused');
const anonymous = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
  method: 'POST',
  headers,
});
if (anonymous.ok) {
  fail(
    'the function deleted something without a valid token',
    'This would let anyone with the publishable key delete accounts.',
  );
}

console.log('\n  PASS — the account was created, deleted through the function,');
console.log('         can no longer sign in, and unauthenticated calls are refused.\n');
