/**
 * Who is paying, and what that unlocks.
 *
 * This is the seam. Every gate in the app reads {@link useEntitlements} and
 * nothing else knows how entitlement is decided, so wiring a real store to it
 * later is a change to this one file rather than to every screen that gates
 * something.
 *
 * Today it resolves to a cached flag and defaults to false. When purchases land,
 * `resolve` below becomes a call to the store SDK and the rest of the app does
 * not move.
 *
 * **The cache is deliberate, not laziness.** Every read in Daylish comes from
 * local SQLite and works with no connection; an entitlement that had to be
 * fetched before the app could decide what to show would make a paid user's
 * flight-mode breakfast look like a paywall. The store is the source of truth,
 * the cache is what the app actually reads, and the two reconcile in the
 * background. Erring towards the last known answer is right in both directions:
 * a lapsed subscriber keeps access until the app next reaches the network, which
 * is a far cheaper mistake than locking out someone who has paid.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { entitlementsFor, type Entitlements } from '@daylish/core';

/** Where the current answer came from. Shown in the You tab so support can ask. */
export type EntitlementSource = 'free' | 'store' | 'override';

const CACHE_KEY = 'daylish.entitlement.v1';

/**
 * The RevenueCat key, and the entitlement name configured in their dashboard.
 *
 * Absent in a build without purchases — which is every build until the Paid
 * Applications Agreement is active — and the app runs perfectly well that way,
 * with everyone on the free tier. Following the same shape as the Supabase
 * client: a missing key is a state to handle, not a crash.
 */
const REVENUECAT_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ENTITLEMENT_ID = 'premium';

export const purchasesConfigured = REVENUECAT_KEY.length > 0;

/**
 * Whether this build contains the local premium override at all.
 *
 * The override grants every paid feature with nothing charged. That is exactly
 * what is wanted on a development build and exactly what must never reach a
 * customer — a free unlock that someone finds is a free unlock that gets posted.
 *
 * **App Review does not need it.** Reviewers test in-app purchases against
 * StoreKit's sandbox, where a purchase completes and settles without money
 * moving, so the demo account reaches Premium the same way a customer does. That
 * is also a better test than the override, because it exercises the real
 * RevenueCat path rather than a flag that bypasses it.
 *
 * Gated on an environment variable rather than `__DEV__` alone, because internal
 * and preview builds are release builds where `__DEV__` is false and the switch
 * is still wanted. Set on the `development` and `preview` EAS environments only;
 * its absence from `production` is what removes it from the App Store binary,
 * the same shape as the Test Store key.
 */
export const overrideAvailable =
  __DEV__ || process.env.EXPO_PUBLIC_ALLOW_PREMIUM_OVERRIDE === '1';

/**
 * The store SDK, loaded only if there is a key to configure it with.
 *
 * A dynamic import inside a guard, deliberately. `react-native-purchases` is a
 * native module, and Expo Go does not contain it — a top-level import would
 * resolve at bundle time and then throw on first use, taking the whole app down
 * on the development build everyone is currently using. Loaded this way, a
 * build without the native side degrades to the free tier instead of crashing,
 * which is the same failure everyone already has.
 */
let purchases: typeof import('react-native-purchases').default | null = null;
let configured = false;

async function loadPurchases() {
  if (!purchasesConfigured) return null;
  if (configured) return purchases;

  try {
    const module = await import('react-native-purchases');
    purchases = module.default;
    await purchases.configure({ apiKey: REVENUECAT_KEY });
    configured = true;
    return purchases;
  } catch {
    // No native module (Expo Go), or the SDK refused the key. Either way this
    // account is not premium, which is already the safe answer.
    purchases = null;
    return null;
  }
}

interface EntitlementValue {
  /** False until proven otherwise, and false is always a safe answer. */
  readonly isPremium: boolean;
  /** What the current tier grants. Read this rather than branching on the flag. */
  readonly entitlements: Entitlements;
  /** False until the cached answer has been read, so nothing flashes locked. */
  readonly ready: boolean;
  readonly source: EntitlementSource;
  /** Re-ask the store. A no-op until one is wired up. */
  refresh: () => Promise<void>;
  /**
   * Force premium on for this device.
   *
   * Needed before a store exists at all: the reviewer's demo account has to
   * reach the paid features, and so does anyone testing them. It is a local
   * flag with no effect on billing, and the You tab labels it plainly so it can
   * never be mistaken for a real subscription.
   */
  setOverride: (on: boolean) => Promise<void>;
}

const EntitlementContext = createContext<EntitlementValue | null>(null);

/**
 * Ask the store what this account is entitled to.
 *
 * The one function that changes when purchases ship. It returns the override
 * first so that a device set to premium stays premium regardless of what a
 * future store says, which is what makes it useful for testing.
 */
async function resolve(): Promise<{ isPremium: boolean; source: EntitlementSource }> {
  const cached = await AsyncStorage.getItem(CACHE_KEY);
  if (cached === 'override') {
    if (overrideAvailable) return { isPremium: true, source: 'override' };
    // A device that had the switch on under a preview build, then updated to a
    // store build, would otherwise keep Premium forever on a flag that no longer
    // has any UI to turn it off. Hiding the control is not enough; the cached
    // answer it wrote has to stop being honoured too.
    await AsyncStorage.removeItem(CACHE_KEY);
  }

  const store = await loadPurchases();
  if (!store) {
    // No store in this build. The cached answer is all there is, and erring
    // towards the last known one keeps a paying user working offline.
    return { isPremium: cached === 'store', source: cached === 'store' ? 'store' : 'free' };
  }

  try {
    const info = await store.getCustomerInfo();
    const active = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
    if (active) await AsyncStorage.setItem(CACHE_KEY, 'store');
    else if (cached === 'store') await AsyncStorage.removeItem(CACHE_KEY);
    return { isPremium: active, source: active ? 'store' : 'free' };
  } catch {
    // Offline, or the store is having a bad day. Keep the last known answer
    // rather than locking out someone who has paid.
    return { isPremium: cached === 'store', source: cached === 'store' ? 'store' : 'free' };
  }
}

/**
 * RevenueCat's Customer Center.
 *
 * The one piece of purchase UI worth taking off the shelf rather than building.
 * It is the plumbing nobody enjoys writing and everybody needs: see the current
 * plan and renewal date, change it, cancel, request a refund, and restore. Apple
 * expects an in-app route to all of that, and hand-rolling it means
 * reimplementing the manage-subscriptions deep link, the refund request sheet
 * and the restore flow, each with their own edge cases.
 *
 * The paywall stays hand-built, deliberately. That screen carries the argument
 * for paying and is written in the app's own voice from `PREMIUM_FEATURES`; a
 * template would read like every other subscription app. This screen carries no
 * argument at all, so there is nothing to lose by using theirs.
 *
 * Loaded through the same dynamic-import guard as the SDK itself, and for the
 * same reason: `react-native-purchases-ui` is a native module that Expo Go does
 * not contain. A top-level import would resolve at bundle time and take the
 * whole app down on the development build. See the trap in `context.md`.
 *
 * Returns false when there is no native module to show it with, so the caller
 * can fall back rather than leaving someone tapping a dead row.
 */
export async function presentCustomerCenter(): Promise<boolean> {
  // No key means no configured SDK, and Customer Center reads the customer from
  // it. Showing it would be an empty sheet.
  if (!purchasesConfigured) return false;
  if (!(await loadPurchases())) return false;

  try {
    const ui = await import('react-native-purchases-ui');
    await ui.default.presentCustomerCenter();
    return true;
  } catch {
    // Expo Go, or a build predating the native module. Neither is an error
    // worth a dialog — the caller offers the system settings route instead.
    return false;
  }
}

/**
 * Tell the store which account this is.
 *
 * Without this, RevenueCat mints an anonymous customer id per install, and the
 * `app_user_id` on every webhook it sends is a string that appears nowhere in
 * our database — so a billing-issue notification could not be addressed to the
 * person it concerns. Calling `logIn` with the Supabase user id is what makes
 * the webhook in `supabase/functions/revenuecat-webhook` able to find a phone.
 *
 * It also makes a subscription follow the account rather than the handset, which
 * is the same promise backup and restore already make about the diary.
 *
 * Called from the session provider on sign-in and on every foreground; the SDK
 * treats a repeat `logIn` with the same id as a no-op.
 */
export async function identifyPurchaser(userId: string): Promise<void> {
  const store = await loadPurchases();
  if (!store) return;

  try {
    await store.logIn(userId);
  } catch {
    // Identification failing does not change what this account is entitled to —
    // `getCustomerInfo` still answers, and the cached flag still holds. It only
    // means webhooks cannot reach this device, which is not worth a dialog.
  }
}

/**
 * Hand the store back to nobody on sign-out.
 *
 * Leaves the SDK on an anonymous id, so a second account signing in on the same
 * handset does not inherit the first one's entitlement. Mirrors what
 * `revokePushToken` does for notifications.
 */
export async function forgetPurchaser(): Promise<void> {
  const store = await loadPurchases();
  if (!store) return;

  try {
    await store.logOut();
  } catch {
    // Already anonymous, which is the state we wanted.
  }
}

export interface Offering {
  readonly id: string;
  /** "£3.99" — already formatted in the store's own currency. */
  readonly price: string;
  readonly title: string;
}

/**
 * What is actually for sale, straight from the store.
 *
 * Never a hardcoded price. App Review rejects a paywall whose stated price
 * differs from StoreKit's, and it would be wrong in every currency but one.
 */
export async function listOfferings(): Promise<Offering[]> {
  const store = await loadPurchases();
  if (!store) return [];

  try {
    const offerings = await store.getOfferings();
    return (offerings.current?.availablePackages ?? []).map((pkg) => ({
      id: pkg.identifier,
      price: pkg.product.priceString,
      title: pkg.product.title,
    }));
  } catch {
    return [];
  }
}

/** Buy. Resolves false when the person cancelled, which is not an error. */
export async function purchase(offeringId: string): Promise<boolean> {
  const store = await loadPurchases();
  if (!store) throw new Error('Purchases are not available in this build.');

  const offerings = await store.getOfferings();
  const pkg = offerings.current?.availablePackages.find((p) => p.identifier === offeringId);
  if (!pkg) throw new Error('That option is no longer available.');

  try {
    const { customerInfo } = await store.purchasePackage(pkg);
    return customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  } catch (cause) {
    if ((cause as { userCancelled?: boolean }).userCancelled) return false;
    throw cause;
  }
}

/**
 * Restore a subscription bought on another device.
 *
 * Required by App Review guideline 3.1.1, not optional, and the reason is
 * sound: someone who has paid must be able to get back what they paid for on a
 * new phone without paying twice.
 */
export async function restorePurchases(): Promise<boolean> {
  const store = await loadPurchases();
  if (!store) return false;

  const info = await store.restorePurchases();
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [source, setSource] = useState<EntitlementSource>('free');
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const next = await resolve();
    setIsPremium(next.isPremium);
    setSource(next.source);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setOverride = useCallback(
    async (on: boolean) => {
      // Defence in depth. The control is not rendered in a build without the
      // override, but a caller reaching this by any other route must not be able
      // to write a flag that `resolve` would then have to clean up.
      if (!overrideAvailable) return;
      if (on) await AsyncStorage.setItem(CACHE_KEY, 'override');
      else await AsyncStorage.removeItem(CACHE_KEY);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<EntitlementValue>(
    () => ({
      isPremium,
      entitlements: entitlementsFor(isPremium),
      ready,
      source,
      refresh,
      setOverride,
    }),
    [isPremium, ready, source, refresh, setOverride],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlements(): EntitlementValue {
  const value = useContext(EntitlementContext);
  if (!value) throw new Error('useEntitlements must be used inside an EntitlementProvider');
  return value;
}
