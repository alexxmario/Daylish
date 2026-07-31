/**
 * The device side of meal reminders.
 *
 * Everything that decides *which* reminders to schedule lives in
 * `@daylish/core` and is tested there. This file is the thin layer that talks
 * to iOS: permission, cancel, schedule, and where the settings are kept.
 *
 * Settings live in AsyncStorage rather than SQLite, and deliberately do not
 * sync. Notification permission is granted per device, so a reminder someone
 * set up on their phone is meaningless on a tablet they have never allowed
 * notifications on — storing this with the diary would sync a preference that
 * cannot travel.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import {
  DEFAULT_REMINDER_SETTINGS,
  planReminders,
  type MealSlot,
  type ReminderContext,
  type ReminderSettings,
} from '@daylish/core';

const SETTINGS_KEY = 'daylish.reminders.v1';

/**
 * Reminders are quiet: no badge, no sound.
 *
 * A food diary is not urgent. A banner someone sees when they next look at
 * their phone is the whole job; a chime at 13:00 is an interruption, and an
 * app-icon badge that will not clear is a small permanent nag.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_REMINDER_SETTINGS;
    // Merged rather than replaced, so a settings shape added in a later build
    // reads sensibly against a value written by an earlier one.
    return { ...DEFAULT_REMINDER_SETTINGS, ...(JSON.parse(raw) as Partial<ReminderSettings>) };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Ask for permission, once someone has actually asked for reminders.
 *
 * Never called at launch. A permission prompt before anyone has seen what the
 * app does is the reliable way to get denied permanently, and iOS only lets you
 * ask once.
 */
export async function requestReminderPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Rebuild the whole notification schedule.
 *
 * Cancels everything and re-schedules from scratch rather than reconciling.
 * Incremental bookkeeping here fails silently — a stale reminder fires for a
 * meal someone logged hours ago and they simply turn notifications off, with no
 * way for us to learn it happened. Rebuilding is cheap and always correct.
 *
 * Safe to call often; the app calls it whenever it comes to the foreground and
 * after anything that changes what has been logged today.
 */
export async function rescheduleReminders(input: {
  settings: ReminderSettings;
  loggedToday: readonly MealSlot[];
  now?: Date;
  /**
   * The rest of what the plan reads — remaining macros, weigh-in staleness, an
   * open fasting window. Built by `reminderSignals` in `@/data/reminders.ts`.
   *
   * Optional, and omitting it is not the same as passing zeroes: a caller that
   * cannot supply these gets meal reminders only, because `planReminders`
   * treats an absent signal as "not told" and stays quiet.
   */
  signals?: Omit<ReminderContext, 'now' | 'horizonDays' | 'loggedToday'>;
}): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!input.settings.enabled) return 0;

  const granted = (await Notifications.getPermissionsAsync()).granted;
  if (!granted) return 0;

  const planned = planReminders(input.settings, {
    ...input.signals,
    now: input.now ?? new Date(),
    loggedToday: input.loggedToday,
  });

  for (const reminder of planned) {
    await Notifications.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.at,
      },
    });
  }

  return planned.length;
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
