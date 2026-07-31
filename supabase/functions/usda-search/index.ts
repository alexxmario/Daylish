/**
 * USDA food search, proxied.
 *
 * The app used to call FoodData Central directly with a key inlined into the
 * bundle. `EXPO_PUBLIC_` variables are substituted at build time, so that key
 * shipped inside the `.ipa` where anyone can read it — and because it is one key
 * shared by every install, the failure mode is not a breach but a shared quota:
 * one person extracting it and hammering the endpoint rate-limits food search
 * for everybody at once, and there is no way to rotate it without shipping an
 * update.
 *
 * Moving it here fixes both. The key lives in a function secret, the quota is
 * spent by one caller we control, and rotating it is a redeploy rather than an
 * App Store review.
 *
 * The response is passed through unchanged. This is a proxy and nothing more —
 * the app already knows how to read USDA's shape, and reshaping it here would
 * put the parsing in two places for the pipeline and the app to disagree about.
 *
 * Deploy:  supabase functions deploy usda-search
 * Secrets: supabase secrets set USDA_API_KEY=...
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const USDA_ENDPOINT = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/** Matches the app's own page size. Bounded so one caller cannot ask for the world. */
const MAX_PAGE_SIZE = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);

  // Signed-in callers only. The point of the proxy is that the quota belongs to
  // us, so it must not be spendable by anyone who finds the URL.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) return json({ error: 'Not signed in' }, 401);

  let body: { query?: string; pageSize?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const query = (body.query ?? '').trim();
  if (query.length === 0) return json({ error: 'query is required' }, 400);

  const apiKey = Deno.env.get('USDA_API_KEY');
  if (!apiKey) {
    // Deliberately not an error the app should shout about: search still works
    // from Open Food Facts and the local library, so a missing key degrades the
    // results rather than the feature.
    return json({ foods: [] });
  }

  try {
    const response = await fetch(`${USDA_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        pageSize: Math.min(body.pageSize ?? 20, MAX_PAGE_SIZE),
        dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'],
      }),
    });

    if (!response.ok) {
      // Upstream said no — most often the shared quota. Reported as a bad
      // gateway rather than dressed up as an empty result set, because "no
      // matches" and "could not ask" are different things to a searcher.
      return json({ error: `USDA returned ${response.status}` }, 502);
    }

    return json(await response.json());
  } catch (error) {
    console.error('usda-search failed', error);
    return json({ error: 'Could not reach the food database.' }, 502);
  }
});
