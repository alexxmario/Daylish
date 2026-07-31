/**
 * Account deletion.
 *
 * App Review guideline 5.1.1(v) is unambiguous: an app that requires an account
 * must let people delete that account from inside the app. Not email us, not
 * visit a website — a control in the app that actually removes the record.
 *
 * This has to be a function rather than a client call because deleting an auth
 * user needs the service-role key, and that key can never touch the app bundle.
 * The client sends its own access token; this verifies the token, learns who the
 * caller is from it, and deletes exactly that person.
 *
 * The security property that matters: **the caller's id comes from the verified
 * token, never from the request body.** A user id in the body would let anyone
 * with the publishable key delete anyone else's account.
 *
 * Deploy:  supabase functions deploy delete-account
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return json({ error: 'Function is not configured' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Missing bearer token' }, 401);

  // Service role: needed both to verify the token and to perform the delete.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The identity comes from the token itself. This is the whole security model.
  const { data: caller, error: lookupFailed } = await admin.auth.getUser(token);
  if (lookupFailed || !caller.user) {
    return json({ error: 'Not signed in' }, 401);
  }

  const { error: deleteFailed } = await admin.auth.admin.deleteUser(caller.user.id);
  if (deleteFailed) {
    return json({ error: deleteFailed.message }, 500);
  }

  // Rows in public tables cascade from auth.users via the foreign key on
  // `profiles.id` (see 0001_initial_schema.sql), so there is nothing else to
  // clean up server-side. The client wipes its own SQLite copy separately.
  return json({ deleted: true }, 200);
});
