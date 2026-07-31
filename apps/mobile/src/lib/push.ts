/**
 * Registering this device to receive push.
 *
 * Push is the smaller half of Daylish's notifications and deliberately so.
 * Anything derived from the diary — remaining macros, a moved target, weigh-in
 * day — is scheduled locally in [`reminders.ts`](./reminders.ts), because the
 * goal engine runs on the device and a second server-side implementation of the
 * same maths would eventually disagree with it. Push carries only what the
 * server alone knows: billing state from RevenueCat, and account security.
 *
 * Everything here degrades to a no-op rather than throwing, following the same
 * shape as the Supabase client and the RevenueCat SDK: a build without
 * credentials, an Expo Go session with no EAS project, and a user who has never
 * granted notification permission are all *states to handle*, not faults. The
 * app runs identically in all of them, minus the banners.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase.ts';

/**
 * The last token this device registered, kept so sign-out can revoke it.
 *
 * Without this, revoking would mean asking APNs for the token again at the exact
 * moment the session is going away — which fails offline, and leaves the server
 * holding a token that now points at a phone belonging to someone else's
 * account. Cheaper and more reliable to remember what we sent.
 */
const TOKEN_KEY = 'daylish.push.token.v1';

/** Why registration did nothing. Surfaced in the You tab so support can ask. */
export type PushSkipReason =
  | 'no-supabase'
  | 'no-project-id'
  | 'no-permission'
  | 'not-a-device'
  | 'failed';

export type PushRegistration =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: PushSkipReason };

/**
 * The EAS project id, which `getExpoPushTokenAsync` cannot work without.
 *
 * Absent until `eas init` has run, and absent in Expo Go. Reading it defensively
 * rather than asserting means the app behaves sensibly in the development build
 * everyone is currently using.
 */
function projectId(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof fromExtra === 'string' && fromExtra.length > 0 ? fromExtra : null;
}

/**
 * Register this device against the signed-in account.
 *
 * **Never prompts.** Permission is asked once, in the You tab, at the moment
 * someone switches reminders on — iOS only lets you ask a single time, and
 * spending that prompt on a background call at launch is how an app ends up
 * permanently unable to notify anyone. If permission has not been granted this
 * returns `no-permission` and does nothing.
 *
 * Safe to call on every sign-in and every foreground. The upsert is keyed on the
 * token, so repeat calls refresh `last_seen_at` and nothing else.
 */
export async function registerPushToken(userId: string): Promise<PushRegistration> {
  if (!supabase) return { ok: false, reason: 'no-supabase' };

  const id = projectId();
  if (!id) return { ok: false, reason: 'no-project-id' };

  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return { ok: false, reason: 'no-permission' };

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId: id });
    token = result.data;
  } catch {
    // Simulators have no APNs registration, and a device can fail this
    // transiently with no network. Neither is worth an error to the user.
    return { ok: false, reason: 'not-a-device' };
  }

  // Keyed on `token` alone, matching the unique constraint in migration 0008:
  // if this handset was previously signed in as someone else, the row *moves*
  // to the current account rather than existing twice. See that migration for
  // why the alternative leaks one user's notifications to another's phone.
  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: userId,
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      device_name: Constants.deviceName ?? null,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'token' },
  );

  if (error) return { ok: false, reason: 'failed' };

  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
  return { ok: true, token };
}

/**
 * Ask for notification permission on behalf of billing alerts, then register.
 *
 * **The one place in the app that requests permission for something other than
 * reminders**, and it exists because of a gap the reminders-only path leaves:
 * push tokens are only ever minted once permission is granted, and permission is
 * only ever asked when someone switches meal reminders on. A subscriber who does
 * not want meal reminders is therefore unreachable — including on the one message
 * that could save their subscription, that a payment has failed.
 *
 * Called immediately after a successful purchase, which is the strongest moment
 * available: the person has just demonstrated they care about this account, and
 * the thing being offered is a warning about their own money rather than
 * anything promotional.
 *
 * `canAskAgain` is checked first because iOS grants exactly one system prompt per
 * install. A caller that has already spent it gets a truthful `false` instead of
 * a dialog that will never appear.
 */
export async function enableBillingAlerts(userId: string): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync().catch(() => null);
  if (!existing) return false;

  if (!existing.granted) {
    if (!existing.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync().catch(() => null);
    if (!requested?.granted) return false;
  }

  const result = await registerPushToken(userId);
  return result.ok;
}

/**
 * Hand the token back on sign-out.
 *
 * The row would cascade away on account deletion regardless, but a plain sign-out
 * leaves the account intact — and a token still attached to it addresses a phone
 * that someone else may now be holding. Revoking is the difference between
 * "signed out" and "signed out, and we stopped talking to your handset".
 *
 * Best-effort: a failure here is invisible and harmless, because the next
 * sign-in on this device reassigns the same token to whoever signs in.
 */
export async function revokePushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token || !supabase) return;

  await supabase.from('push_tokens').delete().eq('token', token);
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}
