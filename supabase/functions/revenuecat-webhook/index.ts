/**
 * The only thing that sends a push notification in Daylish.
 *
 * Everything a person could be told about their own diary — what is left of
 * today, a target that moved, a weight trend that has gone quiet — is scheduled
 * on the device by `planReminders` in `@daylish/core`, because that is where the
 * goal engine runs. Recomputing any of it here would mean a second
 * implementation of the same maths, and the first time the two disagreed we
 * would push a number the app does not show. In an app whose whole claim is that
 * it does not produce confidently wrong numbers, that is the worst bug
 * available.
 *
 * So push carries only what the device cannot know: billing state, which lives
 * at RevenueCat and arrives here as a webhook.
 *
 * **Two events are acted on, out of the dozen RevenueCat sends.** The test is
 * the same one the local reminders use — does this tell someone something true,
 * about them, that they do not already know?
 *
 *   * `BILLING_ISSUE` — a renewal failed and there is a grace period in which
 *     they can fix it. Actionable, time-limited, and invisible otherwise: Apple
 *     emails about it, and that email is routinely missed.
 *   * `EXPIRATION` — access has actually ended. A person who opens the app to
 *     find features gone deserves to have been told why.
 *
 * Everything else is silence, and `CANCELLATION` is the one worth being explicit
 * about: someone who has just cancelled knows they cancelled. A notification at
 * that moment is a win-back, which is marketing, which is not what this channel
 * is for — see the note on guideline 4.5.4 in `docs/app-store-listing.md`.
 *
 * Deploy:
 *   supabase functions deploy revenuecat-webhook --no-verify-jwt
 *   supabase secrets set REVENUECAT_WEBHOOK_SECRET=…
 *
 * `--no-verify-jwt` is required and is not a hole: RevenueCat has no Supabase
 * session to present, so this authenticates on the shared secret below instead.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

/** Expo's push service. Tokens are minted by the app; APNs sits behind this. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushRow {
  readonly id: string;
  readonly token: string;
}

interface ExpoTicket {
  readonly status: 'ok' | 'error';
  readonly message?: string;
  readonly details?: { readonly error?: string };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The copy for each event we act on. Kept together so the whole channel reads as one voice. */
const MESSAGES: Readonly<Record<string, { title: string; body: string }>> = {
  BILLING_ISSUE: {
    title: 'Your payment did not go through',
    // Names the consequence and the deadline without threatening either.
    body: 'Premium stays on for now. Updating your payment method in Settings keeps it that way.',
  },
  EXPIRATION: {
    title: 'Premium has ended',
    // The second sentence is the one that matters: nothing was taken away.
    body: 'Your diary, your history and your export are all still yours.',
  },
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (!url || !serviceKey || !secret) {
    return json({ error: 'Function is not configured' }, 500);
  }

  // RevenueCat sends whatever Authorization header value is configured in its
  // dashboard. This is the whole authentication story for this endpoint, so it
  // is checked before the body is even read.
  if (request.headers.get('Authorization') !== secret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let event: { type?: string; app_user_id?: string };
  try {
    const payload = (await request.json()) as { event?: typeof event };
    event = payload.event ?? {};
  } catch {
    return json({ error: 'Malformed body' }, 400);
  }

  const message = event.type ? MESSAGES[event.type] : undefined;
  // Unhandled events are a success, not a failure. Returning non-200 would make
  // RevenueCat retry a delivery we have deliberately decided to ignore.
  if (!message || !event.app_user_id) return json({ ignored: event.type ?? null }, 200);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // `app_user_id` is the Supabase user id because the app calls
  // `identifyPurchaser` on sign-in. Without that it would be an anonymous
  // RevenueCat id matching nothing here, and this lookup would find no rows.
  const { data: rows, error: lookupFailed } = await admin
    .from('push_tokens')
    .select('id, token')
    .eq('user_id', event.app_user_id);

  if (lookupFailed) return json({ error: lookupFailed.message }, 500);

  const tokens = (rows ?? []) as PushRow[];
  // Nobody has granted notification permission on any device. Not an error —
  // the app still shows the state next time it is opened.
  if (tokens.length === 0) return json({ delivered: 0 }, 200);

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      tokens.map((row) => ({
        to: row.token,
        title: message.title,
        body: message.body,
        // Silent, like every other notification this app sends. A chime for a
        // billing message would be the app raising its voice about money.
        sound: null,
      })),
    ),
  });

  if (!response.ok) return json({ error: `Push service returned ${response.status}` }, 502);

  const result = (await response.json()) as { data?: ExpoTicket[] };
  const tickets = result.data ?? [];

  /**
   * Delete tokens the push service says are dead.
   *
   * This app is deliberately single-active-device, so someone who changes phone
   * every couple of years leaves a dead token behind each time. Left to
   * accumulate, every future send fans out to handsets that no longer exist and
   * the delivery rate quietly rots. `DeviceNotRegistered` is the service telling
   * us plainly, and the only correct response is to forget the row.
   */
  const dead = tickets
    .map((ticket, index) => (ticket.details?.error === 'DeviceNotRegistered' ? tokens[index]?.id : null))
    .filter((id): id is string => typeof id === 'string');

  if (dead.length > 0) {
    await admin.from('push_tokens').delete().in('id', dead);
  }

  return json(
    {
      delivered: tickets.filter((ticket) => ticket.status === 'ok').length,
      pruned: dead.length,
    },
    200,
  );
});
