/**
 * Gathering the signals a reminder plan is built from.
 *
 * `planReminders` in `@daylish/core` decides *what* to schedule and is pure so
 * that the policy can be tested without a device. This is the other half: the
 * four reads that turn the local database into the optional half of a
 * `ReminderContext`.
 *
 * It lives beside the repositories rather than in `lib/reminders.ts` because
 * that file is deliberately the thin layer that talks to iOS and nothing else.
 *
 * **A signal this cannot answer is left `undefined`, never defaulted to zero.**
 * The distinction is the one the empty-equipment bug in `rankRecipes` turned on:
 * an absent goal means "we cannot say what is left", not "nothing is left", and
 * a notification built on the second reading would be confidently wrong in an
 * app whose whole claim is that it is not.
 */

import type { MacroTargets, ReminderContext } from '@daylish/core';

import { getDayTotals, loggedSlotsToday } from '@/data/journal.ts';
import { getActiveFast, getLatestWeight } from '@/data/daily.ts';
import { today } from '@/lib/dates.ts';

/** The optional half of a `ReminderContext` — everything beyond `now`. */
export type ReminderSignals = Omit<ReminderContext, 'now' | 'horizonDays'>;

/** Whole days between two `YYYY-MM-DD` local dates. */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Read everything the plan depends on, for today.
 *
 * `target` is the current goal's macros, or null when there is no goal yet — a
 * profile part-way through onboarding, which is a real state on first launch.
 */
export function reminderSignals(
  userId: string,
  target: MacroTargets | null,
): ReminderSignals {
  const date = today();
  const totals = getDayTotals(userId, date);

  // "Logged anything" is asked of the totals rather than the slot list, because
  // water and a snack both count as having shown up today while neither fills a
  // breakfast, lunch or dinner slot.
  const loggedAnythingToday = totals.energyKcal > 0;

  const latest = getLatestWeight(userId, date);
  const active = getActiveFast(userId);

  return {
    loggedToday: loggedSlotsToday(userId, date),
    loggedAnythingToday,
    remaining: target
      ? {
          energyKcal: target.energyKcal - totals.energyKcal,
          proteinG: target.proteinG - totals.proteinG,
        }
      : null,
    // Null means there has never been a weigh-in, which is a state the nudge
    // treats as stale — the trend cannot start until there is a first one.
    daysSinceWeighIn: latest ? daysBetween(latest.localDate, date) : null,
    // The window closes `targetHours` after it opened. Derived from the session
    // rather than from elapsed time so it does not drift each time this runs.
    fastEndsAt: active
      ? new Date(new Date(active.startedAt).getTime() + active.targetHours * 3_600_000)
      : null,
  };
}
