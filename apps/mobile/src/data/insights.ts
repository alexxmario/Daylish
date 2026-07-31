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

/** The last `days` days of intake against whatever target applied that day. */
export function getAdherence(userId: string, days = 14): DayAdherence[] {
  const start = addDays(today(), -(days - 1));

  const rows = sqlite.getAllSync<{ local_date: string; kcal: number; protein: number }>(
    `SELECT e.local_date,
            SUM(i.energy_kcal) AS kcal,
            SUM(i.protein_g)   AS protein
     FROM journal_entries e
     JOIN journal_entry_items i ON i.entry_id = e.id
     WHERE e.user_id = ? AND e.local_date >= ? AND e.deleted_at IS NULL AND i.deleted_at IS NULL
     GROUP BY e.local_date`,
    [userId, start],
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
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
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
