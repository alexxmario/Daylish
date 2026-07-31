/**
 * The Supabase client.
 *
 * Sessions persist in AsyncStorage so a signed-in user stays signed in across
 * launches — being asked for a password every morning is what makes people stop
 * opening an app that they otherwise open five times a day.
 *
 * `detectSessionInUrl` is off because that is a browser concern: it exists to
 * read an OAuth fragment out of `window.location`, which does not exist here and
 * throws if the library goes looking for it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/**
 * False when the build has no Supabase credentials.
 *
 * Since signing in is now required to use the app, a missing key is fatal — but
 * it should fail with a sentence someone can act on rather than a stack trace
 * from inside the client library on first render.
 */
export const supabaseConfigured = url.length > 0 && key.length > 0;

export const MISSING_CONFIG_MESSAGE =
  'This build has no Supabase credentials. Set EXPO_PUBLIC_SUPABASE_URL and ' +
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/mobile/.env and restart the bundler.';

/**
 * Null when unconfigured, so the boot screen can explain itself. Every caller
 * goes through `requireSupabase()` rather than asserting at the import site.
 */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, key, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error(MISSING_CONFIG_MESSAGE);
  return supabase;
}
