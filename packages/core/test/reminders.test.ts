import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REMINDER_SETTINGS,
  parseTimeOfDay,
  planReminders,
  type ReminderContext,
  type ReminderSettings,
} from '../src/reminders.ts';

/** A fixed local noon, so "already passed today" cases are unambiguous. */
const NOON = new Date(2026, 6, 28, 12, 0, 0, 0);

function settings(overrides: Partial<ReminderSettings> = {}): ReminderSettings {
  return { ...DEFAULT_REMINDER_SETTINGS, enabled: true, ...overrides };
}

describe('parseTimeOfDay', () => {
  test('accepts valid times', () => {
    assert.deepEqual(parseTimeOfDay('08:30'), { hours: 8, minutes: 30 });
    assert.deepEqual(parseTimeOfDay('7:05'), { hours: 7, minutes: 5 });
    assert.deepEqual(parseTimeOfDay('23:59'), { hours: 23, minutes: 59 });
  });

  test('rejects anything malformed rather than guessing', () => {
    for (const bad of ['', '8', '25:00', '12:60', 'noon', '12:5', '-1:00']) {
      assert.equal(parseTimeOfDay(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});

describe('planReminders', () => {
  test('schedules nothing while reminders are off', () => {
    const planned = planReminders(DEFAULT_REMINDER_SETTINGS, { now: NOON, loggedToday: [] });
    assert.deepEqual(planned, []);
  });

  test('is off by default, so nobody is asked for permission unprompted', () => {
    assert.equal(DEFAULT_REMINDER_SETTINGS.enabled, false);
  });

  /**
   * The rule that decides whether people keep notifications on: a reminder for
   * something already done teaches them the notifications are not worth reading.
   */
  test('skips a meal already logged today, but still schedules it tomorrow', () => {
    const planned = planReminders(settings(), {
      now: new Date(2026, 6, 28, 6, 0, 0, 0), // before every reminder time
      loggedToday: ['breakfast'],
      horizonDays: 2,
    });

    const today = planned.filter((p) => p.at.getDate() === 28);
    const tomorrow = planned.filter((p) => p.at.getDate() === 29);

    assert.deepEqual(
      today.map((p) => p.slot),
      ['lunch', 'dinner'],
      'breakfast is skipped today',
    );
    assert.ok(
      tomorrow.some((p) => p.slot === 'breakfast'),
      'tomorrow is not affected by what was eaten today',
    );
  });

  test('never schedules a time that has already passed', () => {
    // Noon is past the 08:30 breakfast reminder.
    const planned = planReminders(settings(), { now: NOON, loggedToday: [], horizonDays: 1 });

    assert.deepEqual(planned.map((p) => p.slot), ['lunch', 'dinner']);
    for (const reminder of planned) {
      assert.ok(reminder.at.getTime() > NOON.getTime());
    }
  });

  test('honours individually disabled slots', () => {
    const planned = planReminders(settings({ disabledSlots: ['lunch', 'dinner'] }), {
      now: new Date(2026, 6, 28, 6, 0, 0, 0),
      loggedToday: [],
      horizonDays: 1,
    });

    assert.deepEqual(planned.map((p) => p.slot), ['breakfast']);
  });

  test('uses the configured times', () => {
    const planned = planReminders(
      settings({ times: { breakfast: '06:15', lunch: '11:45', dinner: '21:00' } }),
      { now: new Date(2026, 6, 28, 5, 0, 0, 0), loggedToday: [], horizonDays: 1 },
    );

    const breakfast = planned.find((p) => p.slot === 'breakfast')!;
    assert.equal(breakfast.at.getHours(), 6);
    assert.equal(breakfast.at.getMinutes(), 15);
  });

  test('a malformed time is skipped rather than firing at midnight', () => {
    const planned = planReminders(
      settings({ times: { breakfast: 'quarter past six', lunch: '13:00', dinner: '19:30' } }),
      { now: new Date(2026, 6, 28, 5, 0, 0, 0), loggedToday: [], horizonDays: 1 },
    );

    assert.deepEqual(planned.map((p) => p.slot), ['lunch', 'dinner']);
  });

  test('covers the whole horizon, in chronological order', () => {
    const planned = planReminders(settings(), {
      now: new Date(2026, 6, 28, 0, 30, 0, 0),
      loggedToday: [],
      horizonDays: 7,
    });

    assert.equal(planned.length, 21, '3 reminders × 7 days');
    for (let i = 1; i < planned.length; i += 1) {
      assert.ok(
        planned[i]!.at.getTime() >= planned[i - 1]!.at.getTime(),
        'reminders come back in the order they will fire',
      );
    }
  });

  /** The no-guilt rule, enforced rather than trusted to review. */
  test('the copy never scolds', () => {
    const planned = planReminders(settings(), {
      now: new Date(2026, 6, 28, 0, 30, 0, 0),
      loggedToday: [],
      horizonDays: 1,
    });

    const banned = /forgot|missed|failed|behind|should have|don't forget|remember to log/i;
    for (const reminder of planned) {
      assert.doesNotMatch(reminder.title, banned);
      assert.doesNotMatch(reminder.body, banned);
    }
  });

  /**
   * The distinction that the empty-equipment bug in `rankRecipes` turned on:
   * a caller that says nothing is not a caller reporting zero.
   */
  test('a context that omits the optional signals plans meals only', () => {
    const planned = planReminders(settings(), { now: NOON, loggedToday: [], horizonDays: 1 });
    assert.ok(planned.length > 0);
    assert.ok(
      planned.every((p) => p.kind === 'meal'),
      'silence is the correct answer to being told nothing',
    );
  });
});

describe('the evening nudge', () => {
  const evening = (context: Partial<ReminderContext>) =>
    planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 1,
      loggedAnythingToday: true,
      remaining: { energyKcal: 620, proteinG: 38 },
      ...context,
    }).filter((p) => p.kind === 'evening');

  test('carries the real number, at the hour the question gets asked', () => {
    const [nudge] = evening({});
    assert.equal(nudge?.title, '620 kcal left today');
    assert.match(nudge!.body, /38g protein/);
    assert.equal(nudge!.at.getHours(), 17);
    assert.equal(nudge!.at.getMinutes(), 30);
  });

  test('stays quiet until something has been logged', () => {
    // Otherwise the "remaining" figure is just the target read back, and it
    // lands as a complaint about not logging.
    assert.deepEqual(evening({ loggedAnythingToday: false }), []);
  });

  test('stays quiet when there is nothing useful left to place', () => {
    assert.deepEqual(evening({ remaining: { energyKcal: 120, proteinG: 4 } }), []);
  });

  test('never warns about being over', () => {
    assert.deepEqual(evening({ remaining: { energyKcal: -300, proteinG: 0 } }), []);
  });

  test('is never scheduled for a day whose remaining figure is unknowable', () => {
    const planned = planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 7,
      loggedAnythingToday: true,
      remaining: { energyKcal: 620, proteinG: 38 },
    }).filter((p) => p.kind === 'evening');

    assert.equal(planned.length, 1, 'today only — tomorrow’s remaining does not exist yet');
  });

  test('drops the protein clause rather than padding it with noise', () => {
    const [nudge] = evening({ remaining: { energyKcal: 400, proteinG: 3 } });
    assert.doesNotMatch(nudge!.body, /protein/);
  });
});

describe('the weigh-in nudge', () => {
  const weighIn = (daysSinceWeighIn: number | null | undefined) =>
    planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 1,
      daysSinceWeighIn,
    }).filter((p) => p.kind === 'weigh-in');

  test('says nothing to someone weighing in regularly', () => {
    // The property that keeps this from becoming a standing judgement.
    for (const days of [0, 1, 2]) assert.deepEqual(weighIn(days), []);
  });

  test('speaks once the trend has gone quiet', () => {
    assert.equal(weighIn(3).length, 1);
    assert.equal(weighIn(30).length, 1);
  });

  test('speaks to someone who has never weighed in', () => {
    assert.equal(weighIn(null).length, 1);
  });

  test('says nothing when the caller did not say', () => {
    assert.deepEqual(weighIn(undefined), []);
  });

  test('schedules one, not a daily series', () => {
    const planned = planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 7,
      daysSinceWeighIn: 10,
    }).filter((p) => p.kind === 'weigh-in');

    assert.equal(planned.length, 1);
  });

  test('mentions no number, direction or goal', () => {
    const [nudge] = weighIn(5);
    assert.doesNotMatch(`${nudge!.title} ${nudge!.body}`, /kg|lb|lose|gain|weight loss|goal|\d/i);
  });
});

describe('the fasting window', () => {
  test('lands on the moment the person chose', () => {
    const endsAt = new Date(2026, 6, 28, 20, 15, 0, 0);
    const planned = planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 1,
      fastEndsAt: endsAt,
    }).filter((p) => p.kind === 'fast-end');

    assert.equal(planned.length, 1);
    assert.equal(planned[0]!.at.getTime(), endsAt.getTime());
  });

  test('does not fire for a window that has already closed', () => {
    const planned = planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 1,
      fastEndsAt: new Date(2026, 6, 28, 9, 0, 0, 0),
    }).filter((p) => p.kind === 'fast-end');

    assert.deepEqual(planned, []);
  });

  test('nobody fasting means nothing scheduled', () => {
    const planned = planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 1,
      fastEndsAt: null,
    }).filter((p) => p.kind === 'fast-end');

    assert.deepEqual(planned, []);
  });
});

describe('every kind of reminder', () => {
  /** The no-guilt rule again, now across the three kinds added for push. */
  test('never scolds, whatever the kind', () => {
    const planned = planReminders(settings(), {
      now: new Date(2026, 6, 28, 0, 30, 0, 0),
      loggedToday: [],
      horizonDays: 1,
      loggedAnythingToday: true,
      remaining: { energyKcal: 620, proteinG: 38 },
      daysSinceWeighIn: 9,
      fastEndsAt: new Date(2026, 6, 28, 20, 0, 0, 0),
    });

    assert.equal(new Set(planned.map((p) => p.kind)).size, 4, 'all four kinds are exercised');

    const banned = /forgot|missed|failed|behind|should have|don't forget|remember to log|slipping|streak/i;
    for (const reminder of planned) {
      assert.doesNotMatch(reminder.title, banned);
      assert.doesNotMatch(reminder.body, banned);
    }
  });

  test('only meal reminders carry a slot', () => {
    const planned = planReminders(settings(), {
      now: NOON,
      loggedToday: [],
      horizonDays: 1,
      loggedAnythingToday: true,
      remaining: { energyKcal: 620, proteinG: 38 },
      daysSinceWeighIn: 9,
      fastEndsAt: new Date(2026, 6, 28, 20, 0, 0, 0),
    });

    for (const reminder of planned) {
      assert.equal(reminder.slot === null, reminder.kind !== 'meal');
    }
  });
});
