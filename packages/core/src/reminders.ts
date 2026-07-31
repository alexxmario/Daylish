/**
 * Meal reminders.
 *
 * A food diary only works if people open it, and the single largest cause of
 * abandonment is simply forgetting — not deciding to stop. A reminder is the
 * cheapest retention mechanism there is, and unlike almost everything else on
 * the roadmap it needs no server: iOS schedules these on the device.
 *
 * Two rules the scheduling follows, both of which are product decisions rather
 * than technical ones:
 *
 *   1. **Never remind about a meal already logged.** A notification asking for
 *      something you did an hour ago teaches people the notifications are not
 *      worth reading, and the next one gets swiped away too.
 *
 *   2. **Never scold.** The app's whole position is that going over target is
 *      information rather than failure; "You forgot to log lunch!" would undo
 *      that in the one place people see it without opening the app. The copy
 *      below asks a question and gets out of the way.
 *
 * Pure on purpose — no notification API in sight — so the policy can be tested
 * without a device and without mocking a native module.
 */

import type { MealSlot } from './types.ts';

/** Slots that can carry a reminder. Snacks are deliberately absent: nobody needs prompting. */
export const REMINDER_SLOTS = ['breakfast', 'lunch', 'dinner'] as const;

export type ReminderSlot = (typeof REMINDER_SLOTS)[number];

/** "HH:MM", 24-hour. Stored as a string so it survives a timezone change unchanged. */
export type TimeOfDay = string;

export const DEFAULT_REMINDER_TIMES: Readonly<Record<ReminderSlot, TimeOfDay>> = {
  breakfast: '08:30',
  lunch: '13:00',
  dinner: '19:30',
};

/**
 * What a notification is *for*.
 *
 * Every kind here answers the same test: does the app know something true, about
 * you, that you do not already know? A meal reminder passes because only the
 * diary knows lunch is unlogged. "Come back, we miss you" does not pass, and is
 * why there is no re-engagement kind in this union.
 */
export type ReminderKind = 'meal' | 'evening' | 'weigh-in' | 'fast-end';

export interface ReminderSettings {
  /**
   * Off until someone asks for it. Prompting for notification permission before
   * anyone has seen the app is how you get permanently denied.
   */
  readonly enabled: boolean;
  readonly times: Readonly<Record<ReminderSlot, TimeOfDay>>;
  /** Slots the user has switched off individually. */
  readonly disabledSlots: readonly ReminderSlot[];
  /** The evening "here is what is left" nudge. See {@link EVENING_MIN_KCAL}. */
  readonly eveningIdeas: boolean;
  readonly eveningTime: TimeOfDay;
  /** Speak up only once the weight trend has gone quiet. */
  readonly weighIn: boolean;
  readonly weighInTime: TimeOfDay;
  /** Tell me when the fasting window closes. */
  readonly fastEnd: boolean;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  times: DEFAULT_REMINDER_TIMES,
  disabledSlots: [],
  // The sub-toggles default on. `enabled` is the gate that stays off until
  // someone asks, so defaulting these off would mean a person who switches
  // reminders on gets only the weakest of the four.
  eveningIdeas: true,
  eveningTime: '17:30',
  weighIn: true,
  weighInTime: '07:30',
  fastEnd: true,
};

export interface PlannedReminder {
  readonly kind: ReminderKind;
  /** Set on `meal` reminders only; null for everything else. */
  readonly slot: ReminderSlot | null;
  readonly at: Date;
  readonly title: string;
  readonly body: string;
}

export interface ReminderContext {
  readonly now: Date;
  /** Slots already logged today — these are skipped for today only. */
  readonly loggedToday: readonly MealSlot[];
  /** How many days ahead to schedule. Re-planned every time the app opens. */
  readonly horizonDays?: number;

  // ---------------------------------------------------------------------
  // Everything below is optional, and `undefined` means "not told" rather
  // than "none" — the same distinction that the empty-equipment bug in
  // `rankRecipes` turned on. A caller that cannot answer gets silence, not a
  // notification built on a zero it never supplied.
  // ---------------------------------------------------------------------

  /** What is left of today's targets. Null when there is no goal yet. */
  readonly remaining?: { readonly energyKcal: number; readonly proteinG: number } | null;
  /** Whether anything at all has been logged today. */
  readonly loggedAnythingToday?: boolean;
  /** Days since the last weigh-in. Null means there has never been one. */
  readonly daysSinceWeighIn?: number | null;
  /** When the active fast is due to finish. Null when nobody is fasting. */
  readonly fastEndsAt?: Date | null;
}

/**
 * Below this, the evening nudge stays quiet.
 *
 * "80 kcal left" is not an opening for a suggestion, it is a warning dressed as
 * one — and a notification that arrives to tell you that you are nearly out is
 * the scolding this file's second rule exists to prevent. Nothing useful can be
 * suggested under a couple of hundred calories, so nothing is said.
 */
export const EVENING_MIN_KCAL = 200;

/**
 * How quiet the trend has to go before the weigh-in nudge speaks.
 *
 * Adaptive targets read a 14-day trend, so weekly weigh-ins would take a
 * quarter of a year to say anything — but a daily prompt about body weight is
 * exactly the kind of pressure this app has no business applying. Three days is
 * the compromise, and the important property is that it **never fires for
 * someone who is weighing in regularly**. It is a nudge for a stalled trend, not
 * a standing appointment.
 */
export const WEIGH_IN_STALE_DAYS = 3;

/** Copy that asks rather than accuses. See rule 2 at the top of this file. */
const COPY: Readonly<Record<ReminderSlot, { title: string; body: string }>> = {
  breakfast: { title: 'Breakfast', body: 'What did you start the day with?' },
  lunch: { title: 'Lunch', body: 'Add it while you remember what was on the plate.' },
  dinner: { title: 'Dinner', body: 'Round off the day whenever you get a minute.' },
};

/** Parses "HH:MM". Returns null on anything malformed rather than guessing. */
export function parseTimeOfDay(time: TimeOfDay): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

/**
 * Work out exactly which reminders should be scheduled right now.
 *
 * Returns the full set to schedule, not a diff — the caller cancels everything
 * and re-schedules from this list. That is a deliberate simplification: getting
 * incremental notification bookkeeping wrong strands reminders that fire for
 * meals someone already logged, and there is no way for a user to tell you it
 * happened. Rebuilding the whole schedule is cheap and always correct.
 */
export function planReminders(
  settings: ReminderSettings,
  context: ReminderContext,
): PlannedReminder[] {
  if (!settings.enabled) return [];

  const horizon = context.horizonDays ?? 7;
  const logged = new Set(context.loggedToday);
  const disabled = new Set(settings.disabledSlots);
  const planned: PlannedReminder[] = [];

  for (let dayOffset = 0; dayOffset < horizon; dayOffset += 1) {
    for (const slot of REMINDER_SLOTS) {
      if (disabled.has(slot)) continue;

      const parsed = parseTimeOfDay(settings.times[slot]);
      if (!parsed) continue;

      // Today's already-eaten meals are skipped; tomorrow's are not yet known.
      if (dayOffset === 0 && logged.has(slot)) continue;

      const at = new Date(context.now);
      at.setDate(at.getDate() + dayOffset);
      at.setHours(parsed.hours, parsed.minutes, 0, 0);

      // A time that has already passed today would fire immediately.
      if (at.getTime() <= context.now.getTime()) continue;

      planned.push({
        kind: 'meal',
        slot,
        at,
        title: COPY[slot].title,
        body: COPY[slot].body,
      });
    }
  }

  planned.push(...planEvening(settings, context));
  planned.push(...planWeighIn(settings, context));
  planned.push(...planFastEnd(settings, context));

  return planned.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Places `time` on the same day as `now`. Null when the string is malformed. */
function at(now: Date, time: TimeOfDay, dayOffset = 0): Date | null {
  const parsed = parseTimeOfDay(time);
  if (!parsed) return null;

  const when = new Date(now);
  when.setDate(when.getDate() + dayOffset);
  when.setHours(parsed.hours, parsed.minutes, 0, 0);
  return when;
}

/**
 * The evening nudge: what is left of the day, and that Ideas can fill it.
 *
 * The best notification this app can send, because it is the only one carrying
 * a number the person cannot already guess, at the hour they are actually asking
 * the question. It is also the one most likely to sell Premium, since the ideas
 * it points at include recipes.
 *
 * **Today only, never scheduled ahead.** The whole value is the real remaining
 * figure, and tomorrow's is unknowable — a banner promising "620 kcal left" on a
 * day that has not happened would be the confidently-wrong number this app
 * refuses to produce anywhere else.
 *
 * Three conditions, each one load-bearing:
 *
 *   1. **Something has been logged today.** Otherwise "2,100 kcal left" is just
 *      the target read back, and it lands as a complaint about not logging —
 *      which the meal reminders already cover, more kindly.
 *   2. **There is a useful amount left.** See {@link EVENING_MIN_KCAL}.
 *   3. **The hour has not passed.** Handled by the shared future check.
 */
function planEvening(settings: ReminderSettings, context: ReminderContext): PlannedReminder[] {
  if (!settings.eveningIdeas) return [];
  if (!context.loggedAnythingToday) return [];

  const remaining = context.remaining;
  if (!remaining) return [];
  if (remaining.energyKcal < EVENING_MIN_KCAL) return [];

  const when = at(context.now, settings.eveningTime);
  if (!when || when.getTime() <= context.now.getTime()) return [];

  const kcal = Math.round(remaining.energyKcal);
  const protein = Math.round(remaining.proteinG);

  // Protein is named only when there is a meaningful amount of it to place.
  // "and 3g protein" is noise, and padding the sentence to keep a fixed shape
  // is how copy stops being read.
  const body =
    protein >= 15
      ? `${protein}g protein to place. Ideas has a few that fit.`
      : 'Ideas has a few things that fit what is left.';

  return [{ kind: 'evening', slot: null, at: when, title: `${kcal} kcal left today`, body }];
}

/**
 * The weigh-in nudge, which stays silent for anyone already weighing in.
 *
 * Weight logging is free forever precisely so the adaptive target has something
 * to read by the time someone pays for it, and a trend that goes quiet is the
 * one failure mode that makes the headline paid feature blank. This is the
 * cheapest defence against that.
 *
 * **One reminder, not a daily series.** Scheduling the next occurrence only
 * means a single weigh-in clears it on the next foreground. A recurring 07:30
 * prompt about body weight would be a standing judgement, which is not a thing
 * this app does.
 *
 * The copy never mentions a number, a direction, or a goal.
 */
function planWeighIn(settings: ReminderSettings, context: ReminderContext): PlannedReminder[] {
  if (!settings.weighIn) return [];

  const days = context.daysSinceWeighIn;
  // Undefined is "the caller did not say"; null is "there has never been one".
  if (days === undefined) return [];
  if (days !== null && days < WEIGH_IN_STALE_DAYS) return [];

  // Today if the hour is still ahead, otherwise tomorrow morning.
  const todayAt = at(context.now, settings.weighInTime);
  if (!todayAt) return [];
  const when = todayAt.getTime() > context.now.getTime() ? todayAt : at(context.now, settings.weighInTime, 1);
  if (!when) return [];

  return [
    {
      kind: 'weigh-in',
      slot: null,
      at: when,
      title: 'Weigh-in',
      body: 'Your target reads the trend, not the day. Whenever suits.',
    },
  ];
}

/**
 * The end of a fasting window.
 *
 * The only reminder here tied to a clock the person set themselves, which is
 * what makes it welcome rather than intrusive — they asked to be told, and the
 * app is the only thing that knows the moment.
 *
 * Deliberately not marked time-sensitive. Breaking a fast four minutes late
 * costs nothing, and the entitlement that pierces Focus modes is for things that
 * do.
 */
function planFastEnd(settings: ReminderSettings, context: ReminderContext): PlannedReminder[] {
  if (!settings.fastEnd) return [];

  const endsAt = context.fastEndsAt;
  if (!endsAt) return [];
  if (endsAt.getTime() <= context.now.getTime()) return [];

  return [
    {
      kind: 'fast-end',
      slot: null,
      at: new Date(endsAt),
      title: 'Fasting window complete',
      body: 'Eat whenever you are ready.',
    },
  ];
}
