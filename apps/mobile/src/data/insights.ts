/**
 * Read-only queries behind the Progress tab.
 *
 * Kept apart from the write repositories so the reporting surface can grow
 * without adding weight to the logging path, which is the one that has to be
 * fast.
 */

import { computeWeightTrend, type TrendPoint } from '@daylish/core';

import { sqlite } from '@/db/client.ts';
import { addDays, today } from '@/lib/dates.ts';

export interface DayAdherence {
  localDate: string;
  energyKcal: number;
  proteinG: number;
  /** Null when there is no goal covering that day. */
  targetKcal: number | null;
  logged: boolean;
}

/**
 * Intake per day across `[start, end]`, with the target that applied on each.
 *
 * Shared by the 14-day strip and the history calendar so the two can never
 * disagree about a day they both cover — the same query, the same
 * target-resolution, one range.
 */
function adherenceBetween(userId: string, start: string, end: string): DayAdherence[] {
  const rows = sqlite.getAllSync<{ local_date: string; kcal: number; protein: number }>(
    `SELECT e.local_date,
            SUM(i.energy_kcal) AS kcal,
            SUM(i.protein_g)   AS protein
     FROM journal_entries e
     JOIN journal_entry_items i ON i.entry_id = e.id
     WHERE e.user_id = ? AND e.local_date >= ? AND e.local_date <= ?
       AND e.deleted_at IS NULL AND i.deleted_at IS NULL
     GROUP BY e.local_date`,
    [userId, start, end],
  );
  const byDate = new Map(rows.map((r) => [r.local_date, r]));

  // The goal in force on a given day is the newest one effective on or before
  // it — targets change over time, so comparing every day to today's target
  // would misreport history.
  const goals = sqlite.getAllSync<{ effective_from: string; energy_kcal: number }>(
    `SELECT effective_from, energy_kcal FROM user_goals
     WHERE user_id = ? AND deleted_at IS NULL ORDER BY effective_from ASC`,
    [userId],
  );

  const targetFor = (date: string): number | null => {
    let match: number | null = null;
    for (const goal of goals) {
      if (goal.effective_from <= date) match = goal.energy_kcal;
      else break;
    }
    return match;
  };

  const out: DayAdherence[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const row = byDate.get(date);
    out.push({
      localDate: date,
      energyKcal: row?.kcal ?? 0,
      proteinG: row?.protein ?? 0,
      targetKcal: targetFor(date),
      logged: Boolean(row),
    });
  }
  return out;
}

/** The last `days` days of intake against whatever target applied that day. */
export function getAdherence(userId: string, days = 14): DayAdherence[] {
  const end = today();
  return adherenceBetween(userId, addDays(end, -(days - 1)), end);
}

export interface MonthHistory {
  /** `YYYY-MM`. */
  month: string;
  /**
   * Every day of the month in order, including days after today for the current
   * month — the calendar draws a whole grid, and a missing cell is a hole.
   */
  days: DayAdherence[];
  daysLogged: number;
  /** Days elapsed so far, so the current month is not judged on days that have not happened. */
  daysElapsed: number;
  /** Days that landed within 10% of that day's target. Null when no day had one. */
  onTarget: number | null;
  /** Mean energy across logged days only. Null when nothing was logged. */
  averageKcal: number | null;
}

/** `YYYY-MM` for a `YYYY-MM-DD`. */
export function monthOf(localDate: string): string {
  return localDate.slice(0, 7);
}

/** Shift a `YYYY-MM` by whole months. */
export function addMonths(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const date = new Date(year, mon - 1 + delta, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * One month of the diary, for the history calendar.
 *
 * **`daysElapsed` is not `days.length`.** A calendar for the current month has
 * to draw the whole grid, but judging someone on days that have not happened
 * yet would report every current month as a failure until the 31st. Anything
 * that reads as a score divides by this instead.
 */
export function getMonthHistory(userId: string, month: string): MonthHistory {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const start = `${month}-01`;
  const lastDay = new Date(year, mon, 0, 12).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  const days = adherenceBetween(userId, start, end);
  const now = today();

  const logged = days.filter((d) => d.logged);
  const scoreable = logged.filter((d) => d.targetKcal !== null && d.targetKcal > 0);

  return {
    month,
    days,
    daysLogged: logged.length,
    daysElapsed: days.filter((d) => d.localDate <= now).length,
    onTarget: scoreable.length
      ? scoreable.filter(
          (d) => Math.abs(d.energyKcal - (d.targetKcal as number)) / (d.targetKcal as number) <= 0.1,
        ).length
      : null,
    averageKcal: logged.length
      ? Math.round(logged.reduce((sum, d) => sum + d.energyKcal, 0) / logged.length)
      : null,
  };
}

export interface WeightSeries {
  points: TrendPoint[];
  latestKgs: number | null;
  /** Slope over the window, in kg per week. Null when there is too little data. */
  changePerWeekKg: number | null;
}

export function getWeightSeries(userId: string, days = 90): WeightSeries {
  const start = addDays(today(), -days);
  const rows = sqlite.getAllSync<{ local_date: string; weight_kg: number }>(
    `SELECT local_date, weight_kg FROM weight_entries
     WHERE user_id = ? AND local_date >= ? AND deleted_at IS NULL
     ORDER BY local_date ASC`,
    [userId, start],
  );

  const points = computeWeightTrend(
    rows.map((r) => ({ date: r.local_date, weightKg: r.weight_kg })),
  );

  const first = points[0];
  const last = points[points.length - 1];
  let changePerWeekKg: number | null = null;
  if (first && last && first.date !== last.date) {
    const span =
      (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 86_400_000;
    if (span >= 7) changePerWeekKg = ((last.trendKg - first.trendKg) / span) * 7;
  }

  return { points, latestKgs: last?.weightKg ?? null, changePerWeekKg };
}

/**
 * Consecutive days logged, counting back from today.
 *
 * Today not being logged yet does not break a streak — it is only 9am. The
 * streak breaks on the first *completed* day with nothing in it.
 */
export function getLoggingStreak(userId: string): number {
  const rows = sqlite.getAllSync<{ local_date: string }>(
    `SELECT DISTINCT local_date FROM journal_entries
     WHERE user_id = ? AND deleted_at IS NULL ORDER BY local_date DESC`,
    [userId],
  );
  const logged = new Set(rows.map((r) => r.local_date));

  let streak = 0;
  let cursor = today();
  if (!logged.has(cursor)) cursor = addDays(cursor, -1);

  while (logged.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface NutritionSummary {
  daysLogged: number;
  averageKcal: number | null;
  averageProteinG: number | null;
  /** Share of logged days landing within 10% of target. */
  onTargetShare: number | null;
}

export function summarise(adherence: readonly DayAdherence[]): NutritionSummary {
  const logged = adherence.filter((d) => d.logged);
  if (logged.length === 0) {
    return { daysLogged: 0, averageKcal: null, averageProteinG: null, onTargetShare: null };
  }

  const withTarget = logged.filter((d) => d.targetKcal !== null);
  const onTarget = withTarget.filter(
    (d) => Math.abs(d.energyKcal - d.targetKcal!) / d.targetKcal! <= 0.1,
  );

  return {
    daysLogged: logged.length,
    averageKcal: logged.reduce((sum, d) => sum + d.energyKcal, 0) / logged.length,
    averageProteinG: logged.reduce((sum, d) => sum + d.proteinG, 0) / logged.length,
    onTargetShare: withTarget.length > 0 ? onTarget.length / withTarget.length : null,
  };
}
