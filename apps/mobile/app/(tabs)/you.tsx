import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';

import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_SLOTS,
  type ReminderSettings,
  type ReminderSlot,
} from '@daylish/core';

import { Locked } from '@/components/Locked.tsx';
import { presentCustomerCenter, useEntitlements } from '@/state/entitlement.tsx';
import { deleteAccountData } from '@/data/account.ts';
import { lastBackupAt, pendingWrites, syncNow } from '@/data/sync.ts';
import { reminderSignals } from '@/data/reminders.ts';
import { registerPushToken } from '@/lib/push.ts';
import {
  cancelAllReminders,
  loadReminderSettings,
  requestReminderPermission,
  rescheduleReminders,
  saveReminderSettings,
} from '@/lib/reminders.ts';
import { today } from '@/lib/dates.ts';
import { buildExport, exportFilename, serialiseExport } from '@/data/export.ts';
import { recalibrate, setDetailedNutrition } from '@/data/user.ts';
import { resetLocalData, restartOnboarding } from '@/data/reset.ts';
import { requireSupabase } from '@/lib/supabase.ts';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/** Read from the manifest so the footer cannot drift from what shipped. */
const APP_VERSION = (Constants.expoConfig?.version ?? '1.0.0') as string;

const SLOT_LABEL: Record<ReminderSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

const GOAL_LABEL: Record<string, string> = {
  lose: 'Losing weight',
  maintain: 'Maintaining',
  gain: 'Gaining weight',
  recomp: 'Recomposition',
};

/**
 * You — targets, preferences, data.
 *
 * Targets come first because they are the thing people come here to check or
 * question. The recalibration control is exposed rather than hidden in a
 * background job: someone who has just weighed in wants to see the effect, and
 * an adaptive system that only works invisibly is one people stop trusting.
 */
export default function YouScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, goal, refresh, session, signOut } = useSession();
  const { entitlements } = useEntitlements();
  const [lastRecalibration, setLastRecalibration] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reminders, setReminders] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);

  useEffect(() => {
    void loadReminderSettings().then(setReminders);
  }, []);

  const [backup, setBackup] = useState<{ pending: number; at: string | null }>({
    pending: 0,
    at: null,
  });
  const [backingUp, setBackingUp] = useState(false);

  const readBackupState = useCallback(() => {
    if (!profile) return;
    setBackup({ pending: pendingWrites(profile.id), at: lastBackupAt(profile.id) });
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      setLastRecalibration(null);
      readBackupState();
    }, [readBackupState]),
  );

  if (!profile || !goal) return null;

  const handleRestartOnboarding = () => {
    Alert.alert(
      'Answer the setup questions again?',
      'Your logged meals and weigh-ins are kept. Only your targets are worked out afresh.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start setup',
          onPress: () => {
            restartOnboarding(profile.id);
            refresh();
            router.replace('/onboarding');
          },
        },
      ],
    );
  };

  const handleReset = () => {
    Alert.alert(
      'Delete everything on this device?',
      'Every meal, weigh-in and target is removed and cannot be recovered. Daylish starts as if newly installed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            resetLocalData();
            refresh();
            router.replace('/onboarding');
          },
        },
      ],
    );
  };

  /**
   * Write the whole diary to a file and hand it to the share sheet.
   *
   * Written to the cache directory rather than documents: once the share sheet
   * has taken it the copy here is spent, and cache is the one place the system
   * is allowed to reclaim on its own. Nothing is lost if it does — the export is
   * regenerated from the database every time.
   */
  const handleExport = async () => {
    if (!profile || exporting) return;
    setExporting(true);
    try {
      const bundle = buildExport(profile.id);
      const file = new File(Paths.cache, exportFilename());
      if (file.exists) file.delete();
      file.create();
      file.write(serialiseExport(bundle));

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          'Sharing is unavailable',
          `Your export was written to ${file.name}, but this device has no way to share it.`,
        );
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: 'Export your Daylish data',
      });
    } catch (error) {
      // An export that fails silently is worse than one that fails: the whole
      // point is knowing the data is safe.
      Alert.alert(
        'Export failed',
        error instanceof Error ? error.message : 'Something went wrong writing the file.',
      );
    } finally {
      setExporting(false);
    }
  };

  /**
   * Turning reminders on is where permission is requested — not at launch.
   * iOS only lets you ask once, so it is asked at the moment someone has said
   * they want the thing it is for.
   */
  const handleToggleReminders = async () => {
    if (!profile) return;

    if (reminders.enabled) {
      const next = { ...reminders, enabled: false };
      setReminders(next);
      await saveReminderSettings(next);
      await cancelAllReminders();
      return;
    }

    const granted = await requestReminderPermission();
    if (!granted) {
      Alert.alert(
        'Notifications are off for Daylish',
        'Turn them on in Settings → Notifications → Daylish, then try again.',
      );
      return;
    }

    const next = { ...reminders, enabled: true };
    setReminders(next);
    await saveReminderSettings(next);
    const signals = reminderSignals(profile.id, goal);
    await rescheduleReminders({ settings: next, loggedToday: signals.loggedToday, signals });

    // This is the only moment permission can go from denied to granted, and
    // `registerPushToken` refuses to do anything without it. Registering here
    // rather than waiting for the next foreground means someone who turns
    // reminders on can be told about a billing problem the same day.
    await registerPushToken(profile.id).catch(() => {});
  };

  /**
   * The three reminders that are not tied to a meal slot.
   *
   * Each is a plain boolean on the settings object, so one handler covers all
   * three rather than three near-identical ones. Re-planning after every change
   * is what makes a switch take effect immediately instead of at the next
   * foreground.
   */
  const handleToggleExtra = async (key: 'eveningIdeas' | 'weighIn' | 'fastEnd') => {
    if (!profile) return;
    const next: ReminderSettings = { ...reminders, [key]: !reminders[key] };
    setReminders(next);
    await saveReminderSettings(next);
    const signals = reminderSignals(profile.id, goal);
    await rescheduleReminders({ settings: next, loggedToday: signals.loggedToday, signals });
  };

  const handleToggleSlot = async (slot: ReminderSlot) => {
    if (!profile) return;
    const off = reminders.disabledSlots.includes(slot);
    const next: ReminderSettings = {
      ...reminders,
      disabledSlots: off
        ? reminders.disabledSlots.filter((s) => s !== slot)
        : [...reminders.disabledSlots, slot],
    };
    setReminders(next);
    await saveReminderSettings(next);
    const signals = reminderSignals(profile.id, goal);
    await rescheduleReminders({ settings: next, loggedToday: signals.loggedToday, signals });
  };

  /**
   * Open RevenueCat's Customer Center, or say plainly why it cannot open.
   *
   * The fallback matters more than it looks. In Expo Go, and in any build made
   * before the native module landed, there is no Customer Center — and a row
   * that silently does nothing when tapped is worse than one that admits it,
   * because the person concludes the app is broken rather than that they need
   * the Settings app.
   */
  const handleManageSubscription = async () => {
    if (await presentCustomerCenter()) return;

    Alert.alert(
      'Manage your subscription',
      'Open Settings → your name → Subscriptions on this phone to change or cancel it.',
    );
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Your diary stays on this phone and comes back when you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', onPress: () => void signOut() },
      ],
    );
  };

  /**
   * Delete the account for real: the auth record first, then the local copy.
   *
   * That order matters. If the local wipe went first and the server call then
   * failed, the person would be left signed in to an account whose data had
   * already been destroyed — the worst of both outcomes. Failing on the server
   * first leaves everything exactly as it was, and they can try again.
   */
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'Your account and everything in this diary are removed permanently. This cannot be undone.\n\nExport your data first if you want to keep it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            if (!profile) return;
            setDeleting(true);
            try {
              const client = requireSupabase();
              const { error: failed } = await client.functions.invoke('delete-account', {
                method: 'POST',
              });
              if (failed) throw failed;

              deleteAccountData(profile.id);
              await signOut();
            } catch (cause) {
              Alert.alert(
                'Could not delete your account',
                cause instanceof Error
                  ? `${cause.message}\n\nNothing has been deleted. Please try again.`
                  : 'Nothing has been deleted. Please try again.',
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const handleRecalibrate = () => {
    const result = recalibrate(profile.id);
    setLastRecalibration(result.reason);
    if (result.changed) refresh();
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: insets.top + theme.spacing.lg,
        paddingBottom: theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Text variant="display">You</Text>

      <Eyebrow>Your targets</Eyebrow>
      <Ticket label={GOAL_LABEL[goal.goal] ?? goal.goal} meta={`since ${goal.effectiveFrom.slice(5)}`}>
        <View style={{ alignItems: 'flex-start' }}>
          <Text variant="hero">{goal.energyKcal.toLocaleString()}</Text>
          <Text variant="eyebrow" tone="muted">
            kcal a day
          </Text>
        </View>

        <Divider />

        <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
          {[
            { label: 'Protein', value: goal.proteinG, color: theme.palette.macro.protein },
            { label: 'Carbs', value: goal.carbsG, color: theme.palette.macro.carbs },
            { label: 'Fat', value: goal.fatG, color: theme.palette.macro.fat },
          ].map((macro) => (
            <View key={macro.label} style={{ flex: 1, gap: 5 }}>
              <View style={{ height: 3, backgroundColor: macro.color }} />
              <Text variant="numericSmall">{macro.value} g</Text>
              <Text variant="eyebrow" tone="muted">
                {macro.label}
              </Text>
            </View>
          ))}
        </View>

        {goal.reason ? (
          <>
            <Divider />
            <Text variant="caption" tone="secondary">
              {goal.reason}
            </Text>
          </>
        ) : null}
      </Ticket>

      <Ticket rule={theme.palette.celesteInk} label="Adaptive targets">
        <Text variant="caption" tone="secondary">
          Adjusts weekly from your own data.
        </Text>
        {entitlements.adaptiveTargets ? (
          <>
            <Pressable
              onPress={handleRecalibrate}
              accessibilityRole="button"
              accessibilityLabel="Recalculate my targets now"
              style={{
                minHeight: MIN_TAP_TARGET,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: theme.radii.sm,
                borderWidth: 1,
                borderColor: theme.palette.celesteInk,
              }}
            >
              <Text variant="captionStrong" tone="celeste">
                Check my targets now
              </Text>
            </Pressable>
            {lastRecalibration ? (
              <Text variant="caption" tone="secondary">
                {lastRecalibration}
              </Text>
            ) : null}
          </>
        ) : (
          /*
            Said here, on the target itself, and not left to be discovered.

            A number that never moves reads as a broken feature unless something
            explains that it is a fixed one. Naming the formula is what makes it
            a deliberate tier rather than an app that has stopped paying
            attention — and it is also the most honest place to describe what
            the paid version actually does differently.
          */
          <Text variant="caption" tone="secondary">
            Worked out from your height, weight, age and activity, and it stays put
            unless you change one of them. Premium adjusts it every week from your
            real weight trend, and explains every change.
          </Text>
        )}
      </Ticket>

      {!entitlements.adaptiveTargets ? (
        <Locked
          title="Targets that learn you"
          blurb="Formulas are averages and you are not one. Premium works out what you are actually burning from your own weight trend, and says why it changed."
        />
      ) : null}

      <Eyebrow>Preferences</Eyebrow>
      <Ticket padded={false}>
        <SettingRow label="Diet" value={goal.dietStyle.replace(/_/g, ' ')} />
        <Divider />
        <SettingRow
          label="Avoiding"
          value={profile.allergens.length > 0 ? profile.allergens.join(', ').replace(/_/g, ' ') : 'Nothing'}
        />
        <Divider />
        <SettingRow label="Weeknight cooking" value={`Up to ${profile.maxPrepMinutes} min`} />
        <Divider />
        <SettingRow
          label="Nutrition detail"
          value={
            !entitlements.micronutrients
              ? 'Macros only · Premium'
              : profile.detailedNutrition
                ? 'Vitamins & minerals'
                : 'Macros only'
          }
          onPress={() => {
            if (!entitlements.micronutrients) {
              router.push('/premium');
              return;
            }
            setDetailedNutrition(profile.id, !profile.detailedNutrition);
            refresh();
          }}
        />
        <Divider />
        <SettingRow label="Kitchen" value={`${profile.equipment.length} items`} />
      </Ticket>
      {/* These come from setup and have no individual editors yet. Saying where
          they are changed is what stops a read-only row from being a dead end. */}
      <Text variant="caption" tone="muted">
        Set during setup. Answer the questions again below to change them.
      </Text>

      <Eyebrow>Reminders</Eyebrow>
      <Ticket padded={false}>
        <SettingRow
          label="Meal reminders"
          value={reminders.enabled ? 'On' : 'Off'}
          onPress={handleToggleReminders}
        />
        {reminders.enabled ? (
          <>
            <Divider />
            {REMINDER_SLOTS.map((slot, index) => (
              <View key={slot}>
                {index > 0 ? <Divider /> : null}
                <SettingRow
                  label={SLOT_LABEL[slot]}
                  value={
                    reminders.disabledSlots.includes(slot) ? 'Off' : reminders.times[slot]
                  }
                  onPress={() => handleToggleSlot(slot)}
                />
              </View>
            ))}
            <Divider />
            {/*
              The three that are not tied to a meal slot. Listed separately
              because each one answers a different question, and someone who
              wants the evening figure rarely wants a fasting alarm too.
            */}
            <SettingRow
              label="What's left, at teatime"
              value={reminders.eveningIdeas ? reminders.eveningTime : 'Off'}
              onPress={() => handleToggleExtra('eveningIdeas')}
            />
            <Divider />
            <SettingRow
              label="Weigh-in, if the trend goes quiet"
              value={reminders.weighIn ? reminders.weighInTime : 'Off'}
              onPress={() => handleToggleExtra('weighIn')}
            />
            <Divider />
            <SettingRow
              label="End of a fasting window"
              value={reminders.fastEnd ? 'On' : 'Off'}
              onPress={() => handleToggleExtra('fastEnd')}
            />
          </>
        ) : null}
      </Ticket>
      <Text variant="caption" tone="muted">
        {reminders.enabled
          ? 'Nothing arrives for a meal you have already logged, and the weigh-in nudge stays quiet while you are weighing in.'
          : 'A nudge at meal times, and nothing for a meal you have already logged.'}
      </Text>

      <Eyebrow>Account</Eyebrow>
      <Ticket padded={false}>
        <SettingRow label="Signed in as" value={session?.user.email ?? '—'} />
        <Divider />
        {/*
          Shown to everyone, not only to subscribers. Someone whose subscription
          has lapsed is exactly the person who needs the manage screen, and
          hiding it from them is how an app ends up with billing complaints it
          never sees. Restore also lives behind here, which a lifetime buyer on
          a new phone needs and has no other route to.
        */}
        <SettingRow label="Manage subscription" value="" onPress={handleManageSubscription} />
        <Divider />
        <SettingRow label="Sign out" value="" onPress={handleSignOut} />
      </Ticket>
      <Text variant="caption" tone="muted">
        Signing out leaves your diary on this phone. It comes back when you sign in again.
      </Text>

      <Eyebrow>Your data</Eyebrow>
      <Ticket>
        {/*
          States it plainly rather than reassuringly. "Backed up" is a promise,
          and the only version of it worth making is one that says so when it is
          behind — a line that always reads "backed up" is a line nobody can
          use to tell whether their diary is actually safe.
        */}
        <Text variant="caption" tone="secondary">
          Your diary lives on this phone and is copied to your account, so it comes back if you
          lose it. Export it as a file whenever you like.
        </Text>
        <Divider />
        <SettingRow
          label="Backed up"
          value={
            backingUp
              ? 'Backing up…'
              : backup.pending > 0
                ? `${backup.pending} waiting`
                : describeBackupAge(backup.at)
          }
          onPress={
            backingUp || !profile
              ? undefined
              : () => {
                  setBackingUp(true);
                  void syncNow(profile.id)
                    .catch(() => {})
                    .finally(() => {
                      setBackingUp(false);
                      readBackupState();
                    });
                }
          }
          inset={false}
        />
        <Divider />
        <SettingRow
          label="Export everything"
          value={exporting ? 'Preparing…' : 'JSON'}
          onPress={handleExport}
          inset={false}
        />
        <Divider />
        <SettingRow
          label="Answer setup again"
          value="Keeps your history"
          onPress={handleRestartOnboarding}
          inset={false}
        />
        <Divider />
        <SettingRow
          label="Delete everything on this phone"
          value=""
          onPress={handleReset}
          inset={false}
          destructive
        />
      </Ticket>

      {/* Required by App Review guideline 5.1.1(v): an app that makes you create
          an account has to let you delete it from inside the app. Kept in its own
          ticket, well away from the local wipe above, because the two are very
          different acts and confusing them is unrecoverable. */}
      <Ticket rule={theme.palette.destructive} label="Danger">
        <Text variant="caption" tone="secondary">
          Deleting your account removes it from our servers and erases this diary from this
          phone. It cannot be undone, and we cannot recover it for you.
        </Text>
        <Divider />
        <SettingRow
          label={deleting ? 'Deleting…' : 'Delete my account'}
          value=""
          onPress={deleting ? undefined : handleDeleteAccount}
          inset={false}
          destructive
        />
      </Ticket>

      {/*
        Said once, plainly, at the bottom — not as a modal nobody reads.

        The app prescribes a calorie target and adjusts it from someone's weight,
        which is close enough to advice that saying what it is not belongs in
        the product rather than only in the store listing. The engine already
        refuses to go below 1,200 kcal; this is the part that has to be in words.
      */}
      <Text variant="caption" tone="muted">
        Daylish is a food diary, not medical advice. Its targets are estimates
        from your own measurements, and they cannot know about a medical
        condition, a medication or a pregnancy. If you are managing any of those,
        talk to a doctor or dietitian before changing how you eat.
      </Text>

      <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        Daylish {APP_VERSION} · your whole day, delicious
      </Text>
    </ScrollView>
  );
}

/**
 * A label-and-value row, tappable only when it actually does something.
 *
 * The chevron and the button role are both tied to `onPress`. Drawing a chevron
 * on a row that does nothing is a small lie that costs a real tap to discover,
 * and announcing it to a screen reader as a button is the same lie told to
 * someone with no way to see that nothing happened. Rows without an action are
 * plain text, and read as one label-and-value pair rather than as a control.
 */
function SettingRow({
  label,
  value,
  onPress,
  inset = true,
  destructive = false,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  inset?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();

  const layout = {
    minHeight: MIN_TAP_TARGET + 6,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: inset ? theme.spacing.lg : 0,
    gap: theme.spacing.md,
  };

  const content = (
    <>
      <Text variant="body" tone={destructive ? 'sun' : 'ink'}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {value}
        </Text>
        {onPress ? (
          <Text variant="caption" tone="muted">
            ›
          </Text>
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View
        style={layout}
        accessible
        accessibilityLabel={value ? `${label}: ${value}` : label}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      style={layout}
    >
      {content}
    </Pressable>
  );
}

/**
 * How long ago the backup ran, in words.
 *
 * Deliberately vague past an hour. The useful question is "is my diary safe",
 * not "was it 71 or 74 minutes"; a precise figure invites people to watch a
 * number that does not reward watching.
 */
function describeBackupAge(at: string | null): string {
  if (!at) return 'Not yet';

  const minutes = Math.floor((Date.now() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'An hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
