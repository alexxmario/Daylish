/**
 * Searching USDA FoodData Central without shipping the key.
 *
 * `EXPO_PUBLIC_` variables are substituted into the JavaScript at build time, so
 * a key used from the client is inside the `.ipa` for anyone who cares to look.
 * That is not a breach — the data is public and read-only — but it is one key
 * shared by every install, so a single extracted copy can exhaust the quota for
 * everybody, and rotating it would mean an App Store review.
 *
 * The key now lives in a function secret and this asks the function instead.
 */

import { supabase } from '@/lib/supabase.ts';
import type { UsdaTransport } from '@/data/foods.ts';

/**
 * Null when there is no signed-in client to ask with.
 *
 * Search degrades rather than breaks: Open Food Facts needs no key and the local
 * library needs no network, so a missing USDA source narrows the results instead
 * of emptying the screen.
 */
export function usdaTransport(): UsdaTransport | null {
  const client = supabase;
  if (!client) return null;

  return async (query, signal) => {
    const { data, error } = await client.functions.invoke('usda-search', {
      body: { query },
    });
    if (signal?.aborted) throw new Error('aborted');
    if (error) throw error;
    return data;
  };
}
