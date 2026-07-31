import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { runMigrations } from '@/db/client.ts';
import { ensureAccountUser, type LocalDataSummary } from '@/data/account.ts';
import { seedRecipes } from '@/data/recipes.ts';
import { restoreFromAccount, syncNow } from '@/data/sync.ts';
import { getCurrentGoal, getUserById, type CurrentGoal, type Profile } from '@/data/user.ts';
import { forgetPurchaser, identifyPurchaser } from '@/state/entitlement.tsx';
import { registerPushToken, revokePushToken } from '@/lib/push.ts';
import { MISSING_CONFIG_MESSAGE, supabase, supabaseConfigured } from '@/lib/supabase.ts';

interface SessionValue {
  ready: boolean;
  error: string | null;
  /** Null when nobody is signed in — the root layout then routes to /sign-in. */
  session: Session | null;
  profile: Profile | null;
  goal: CurrentGoal | null;
  /** Set once when a pre-account diary has been moved onto a new account. */
  adopted: LocalDataSummary | null;
  acknowledgeAdoption: () => void;
  /** Re-read the profile and goal after a write. */
  refresh: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Boots the local database, then follows the auth session.
 *
 * Order matters. Migrations run before anything reads, and the auth listener is
 * attached before the first session is fetched, so a token refresh landing
 * mid-boot is not missed.
 *
 * Signing out deliberately leaves every local row where it is. There is no
 * server copy of the diary yet, so wiping on sign-out would be destroying the
 * only one — see the note at the top of `data/account.ts`.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<CurrentGoal | null>(null);
  const [adopted, setAdopted] = useState<LocalDataSummary | null>(null);

  /** Stops the link step re-running on every token refresh for the same account. */
  const linkedUserId = useRef<string | null>(null);

  const loadProfile = useCallback((userId: string) => {
    const user = getUserById(userId);
    setProfile(user);
    setGoal(user ? getCurrentGoal(user.id) : null);
  }, []);

  /** Attach the signed-in account to its local rows, adopting a pre-account diary once. */
  const link = useCallback(
    (next: Session | null) => {
      if (!next?.user) {
        linkedUserId.current = null;
        setProfile(null);
        setGoal(null);
        return;
      }

      if (linkedUserId.current !== next.user.id) {
        const outcome = ensureAccountUser(next.user.id, next.user.email ?? '');
        linkedUserId.current = next.user.id;
        if (outcome.adopted && outcome.adoptedSummary?.hasData) {
          setAdopted(outcome.adoptedSummary);
        }
      }

      loadProfile(next.user.id);
    },
    [loadProfile],
  );

  const refresh = useCallback(() => {
    if (profile) loadProfile(profile.id);
  }, [profile, loadProfile]);

  /**
   * A stable handle on `refresh` for the backup effect.
   *
   * `refresh` changes identity whenever the profile does, so depending on it
   * would re-run the effect — and therefore re-attach the AppState listener —
   * on every profile reload. The ref keeps the effect keyed to the profile
   * alone while still calling the current version.
   */
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    // `seedRecipes` is async so that the 2.7 MB recipe library is only loaded on
    // the launch that actually writes it to SQLite. That makes boot a promise
    // chain rather than a straight line, so unsubscribing has to survive the
    // component unmounting before the chain finishes.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        runMigrations();
        // The bundled recipe library, copied in on first launch. Cheap no-op
        // afterwards, and it must happen before any screen reads recipes —
        // which is why everything below waits on it.
        await seedRecipes();
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setReady(true);
        return;
      }

      if (cancelled) return;

      if (!supabaseConfigured || !supabase) {
        setError(MISSING_CONFIG_MESSAGE);
        setReady(true);
        return;
      }

      const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
        try {
          link(next);
          setError(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });

      // The effect may already have been cleaned up while seeding ran, in which
      // case nothing will ever call the cleanup below again.
      if (cancelled) {
        listener.subscription.unsubscribe();
        return;
      }
      unsubscribe = () => listener.subscription.unsubscribe();

      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (cancelled) return;
          setSession(data.session);
          link(data.session);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [link]);

  /**
   * Back the diary up when there is a good reason to, and never on a timer.
   *
   * Two triggers, both moments when something has plausibly changed: signing in,
   * and the app coming back to the foreground. A diary changes a handful of
   * times a day, so polling would spend battery to discover nothing — and every
   * read in the app comes from local SQLite, so there is no screen waiting on
   * this to finish.
   *
   * Failures are deliberately swallowed. A push that cannot reach the server is
   * not something to interrupt someone about; the next trigger will carry the
   * same rows, and the You tab says plainly how far behind the backup is.
   */
  useEffect(() => {
    if (!profile) return;
    const userId = profile.id;

    // Restore first, and only ever on a phone holding nothing for this account —
    // that is what makes signing in on a new device give you your diary back
    // rather than an empty one. `restoreFromAccount` decides that for itself and
    // is a no-op on a phone already in use, so this is safe to run every time.
    void (async () => {
      const restore = await restoreFromAccount(userId).catch(() => null);
      if (restore && !restore.skipped && restore.restored > 0) refreshRef.current();
      await syncNow(userId).catch(() => {});
      // Where to reach this handset, if it has already been given permission.
      // Never prompts — see `registerPushToken`. Riding along with the sync
      // triggers rather than running on its own timer keeps this to the same two
      // moments something has plausibly changed.
      await registerPushToken(userId).catch(() => {});
      // Same reason: a webhook can only find this account if the store knows it.
      await identifyPurchaser(userId).catch(() => {});
    })();

    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void syncNow(userId).catch(() => {});
      void registerPushToken(userId).catch(() => {});
    });
    return () => subscription.remove();
  }, [profile]);

  const signOut = useCallback(async () => {
    // Push what is queued before the session goes away, so the last few minutes
    // of a day are not stranded on the device until the next sign-in.
    if (profile) await syncNow(profile.id).catch(() => {});
    // Hand the push token back before the session goes, so we stop addressing a
    // handset this account no longer occupies. Must happen while the token is
    // still authorised to delete its own row.
    await revokePushToken().catch(() => {});
    await forgetPurchaser().catch(() => {});
    await supabase?.auth.signOut();
  }, [profile]);

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      error,
      session,
      profile,
      goal,
      adopted,
      acknowledgeAdoption: () => setAdopted(null),
      refresh,
      signOut,
    }),
    [ready, error, session, profile, goal, adopted, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
