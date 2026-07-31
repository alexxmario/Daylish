/**
 * The goal engine.
 *
 * Two layers:
 *   1. A Mifflin-St Jeor baseline, used only until real data exists.
 *   2. An adaptive layer that estimates actual expenditure from the user's own
 *      weight trend and logged intake, and recalibrates weekly.
 *
 * Every adjustment returns a plain-language `reason`. That is a product
 * requirement, not a nicety: the app promises to explain each AI/algorithmic
 * decision in one sentence, so an adjustment that cannot be explained must not
 * be made.
 */

import type { Sex, ActivityLevel, GoalKind, DietStyle } from './types.ts';

/**
 * Energy density of body-mass change, kcal per kg.
 *
 * 7700 is the classic figure for adipose tissue. Real weight change is a mix of
 * fat, lean mass and water, so this is an approximation — which is precisely why
 * the adaptive layer re-estimates from observation instead of trusting it.
 */
export const KCAL_PER_KG_BODY_MASS = 7700;

/** Smoothing factor for the daily weight trend (Hacker's Diet convention, ~6.6 day half-life). */
export const WEIGHT_TREND_ALPHA = 0.1;

export const ACTIVITY_MULTIPLIERS: Readonly<Record<ActivityLevel, number>> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  athlete: 1.9,
};

export interface BaselineInput {
  readonly sex: Sex;
  readonly ageYears: number;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly activityLevel: ActivityLevel;
}

/** Basal metabolic rate, Mifflin-St Jeor. */
export function basalMetabolicRate(input: BaselineInput): number {
  const { sex, ageYears, heightCm, weightKg } = input;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  switch (sex) {
    case 'male':
      return base + 5;
    case 'female':
      return base - 161;
    // Averaging the two constants is the least-wrong option when sex is not
    // disclosed; the adaptive layer corrects it within a fortnight anyway.
    case 'unspecified':
      return base - 78;
  }
}

/** Total daily energy expenditure from the formula baseline. */
export function baselineExpenditure(input: BaselineInput): number {
  return basalMetabolicRate(input) * ACTIVITY_MULTIPLIERS[input.activityLevel];
}

export interface MacroTargets {
  readonly energyKcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly fiberG: number;
}

export interface TargetInput {
  readonly expenditureKcal: number;
  readonly weightKg: number;
  readonly goal: GoalKind;
  /** Desired rate of change in kg/week. Positive means gain, negative means loss. */
  readonly rateKgPerWeek: number;
  readonly dietStyle: DietStyle;
}

/** Protein grams per kg bodyweight, by goal. Higher in a deficit to protect lean mass. */
function proteinPerKg(goal: GoalKind, dietStyle: DietStyle): number {
  if (dietStyle === 'high_protein') return 2.2;
  switch (goal) {
    case 'lose':
      return 2.0;
    case 'recomp':
      return 2.0;
    case 'gain':
      return 1.8;
    case 'maintain':
      return 1.6;
  }
}

/**
 * Turn an expenditure estimate into concrete daily targets.
 *
 * Order of operations matters: protein is set from bodyweight first, fat is
 * given a floor for hormonal health, and carbohydrate absorbs the remainder.
 * That way a deficit never silently eats into protein.
 */
export function computeTargets(input: TargetInput): MacroTargets {
  const { expenditureKcal, weightKg, goal, rateKgPerWeek, dietStyle } = input;

  const dailyDelta = goal === 'maintain' ? 0 : (rateKgPerWeek * KCAL_PER_KG_BODY_MASS) / 7;
  // Never prescribe below a floor that makes adequate micronutrition implausible.
  const energyKcal = Math.max(1200, Math.round(expenditureKcal + dailyDelta));

  const proteinG = Math.round(weightKg * proteinPerKg(goal, dietStyle));
  const proteinKcal = proteinG * 4;

  let fatG: number;
  let carbsG: number;

  if (dietStyle === 'keto') {
    // Carbs pinned low; fat takes the remainder.
    carbsG = 25;
    const remaining = energyKcal - proteinKcal - carbsG * 4;
    fatG = Math.max(Math.round(weightKg * 0.8), Math.round(remaining / 9));
  } else {
    // Fat floor of 0.8 g/kg, or 25% of energy, whichever is greater.
    const fatFloorG = Math.max(weightKg * 0.8, (energyKcal * 0.25) / 9);
    fatG = Math.round(fatFloorG);
    const remaining = energyKcal - proteinKcal - fatG * 9;
    carbsG = Math.max(0, Math.round(remaining / 4));
  }

  // 14 g per 1000 kcal is the standard fiber recommendation.
  const fiberG = Math.round((energyKcal / 1000) * 14);

  return { energyKcal, proteinG, carbsG: Math.max(0, carbsG), fatG, fiberG };
}

// ---------------------------------------------------------------------------
// Adaptive layer
// ---------------------------------------------------------------------------

export interface WeighIn {
  /** ISO date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly weightKg: number;
}

export interface IntakeDay {
  readonly date: string;
  readonly energyKcal: number;
  /**
   * Whether the user logged the whole day. Partial days would bias the
   * expenditure estimate downward, so they are excluded rather than averaged in.
   */
  readonly complete: boolean;
}

export interface TrendPoint {
  readonly date: string;
  readonly weightKg: number;
  readonly trendKg: number;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Exponentially weighted weight trend, gap-aware.
 *
 * A naive EWMA treats consecutive samples as one day apart. Users skip days, so
 * the smoothing factor is compounded over the elapsed interval — otherwise a
 * weigh-in after a two-week break barely moves the trend.
 */
export function computeWeightTrend(
  weighIns: readonly WeighIn[],
  alpha = WEIGHT_TREND_ALPHA,
): TrendPoint[] {
  const sorted = [...weighIns].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let previousDate: string | null = null;

  for (const entry of sorted) {
    if (trend === null) {
      trend = entry.weightKg;
    } else {
      const gap = Math.max(1, daysBetween(previousDate!, entry.date));
      const effectiveAlpha = 1 - (1 - alpha) ** gap;
      trend = trend + effectiveAlpha * (entry.weightKg - trend);
    }
    out.push({ date: entry.date, weightKg: entry.weightKg, trendKg: trend });
    previousDate = entry.date;
  }

  return out;
}

/**
 * Least-squares slope of `values` against `dayOffsets`, in units per day.
 *
 * Preferred over a first-to-last difference because the endpoints are exactly
 * where the smoothed trend is least reliable: one bad final weigh-in would
 * otherwise swing the whole estimate. Returns `null` when the points are all on
 * the same day and no slope is defined.
 */
function leastSquaresSlope(dayOffsets: readonly number[], values: readonly number[]): number | null {
  const n = dayOffsets.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += dayOffsets[i]!;
    sumY += values[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = dayOffsets[i]! - meanX;
    numerator += dx * (values[i]! - meanY);
    denominator += dx * dx;
  }

  if (denominator === 0) return null;
  return numerator / denominator;
}

export type EstimateConfidence = 'none' | 'low' | 'medium' | 'high';

export interface ExpenditureEstimate {
  /** `null` when there is not enough data to say anything honest. */
  readonly kcalPerDay: number | null;
  readonly confidence: EstimateConfidence;
  readonly spanDays: number;
  readonly weighInCount: number;
  readonly completeIntakeDays: number;
  readonly averageIntakeKcal: number | null;
  readonly trendChangeKg: number | null;
  /** Why the estimate is (or isn't) usable, in one sentence. */
  readonly explanation: string;
}

export interface EstimateInput {
  readonly weighIns: readonly WeighIn[];
  readonly intakeDays: readonly IntakeDay[];
  /** How far back to look. 14 days balances responsiveness against noise. */
  readonly windowDays?: number;
  /** Defaults to the most recent date present in the data. */
  readonly asOf?: string;
}

/**
 * Estimate true daily energy expenditure from observed data.
 *
 * The identity: intake − expenditure = energy stored. So expenditure equals
 * average intake minus the energy represented by the change in trend weight.
 * A user losing weight faster than their logged deficit implies is simply
 * burning more than the formula predicted — no judgment, just arithmetic.
 */
export function estimateExpenditure(input: EstimateInput): ExpenditureEstimate {
  const windowDays = input.windowDays ?? 14;

  const allDates = [
    ...input.weighIns.map((w) => w.date),
    ...input.intakeDays.map((d) => d.date),
  ].sort();
  const asOf = input.asOf ?? allDates[allDates.length - 1];

  if (asOf === undefined) {
    return {
      kcalPerDay: null,
      confidence: 'none',
      spanDays: 0,
      weighInCount: 0,
      completeIntakeDays: 0,
      averageIntakeKcal: null,
      trendChangeKg: null,
      explanation: 'No weight or food data yet, so targets still come from the starting estimate.',
    };
  }

  const inWindow = (date: string) => {
    const age = daysBetween(date, asOf);
    return age >= 0 && age < windowDays;
  };

  const completeDays = input.intakeDays.filter((d) => inWindow(d.date) && d.complete);

  const weighIns = [...input.weighIns]
    .filter((w) => inWindow(w.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const first = weighIns[0];
  const last = weighIns[weighIns.length - 1];
  const spanDays = first && last ? daysBetween(first.date, last.date) : 0;

  const averageIntakeKcal =
    completeDays.length > 0
      ? completeDays.reduce((sum, d) => sum + d.energyKcal, 0) / completeDays.length
      : null;

  // The rate of change is regressed from the *raw* weigh-ins, not the smoothed
  // trend.
  //
  // The EWMA exists to give the user a readable weight line, and it is the right
  // tool for that. It is the wrong tool here: least squares already suppresses
  // day-to-day noise, so fitting it to an already-smoothed series just adds the
  // EWMA's lag on top. During warm-up that lag is still growing, which biases the
  // slope toward zero and cost us ~130 kcal/day on a 0.5 kg/week decline. On raw
  // readings the fit is unbiased.
  const slopeKgPerDay =
    first === undefined
      ? null
      : leastSquaresSlope(
          weighIns.map((w) => daysBetween(first.date, w.date)),
          weighIns.map((w) => w.weightKg),
        );
  const trendChangeKg = slopeKgPerDay === null ? null : slopeKgPerDay * spanDays;

  // Guard rails. Each of these makes the arithmetic meaningless, so we say so
  // rather than emitting a confident-looking number built on nothing.
  if (weighIns.length < 4 || spanDays < 7) {
    return {
      kcalPerDay: null,
      confidence: 'none',
      spanDays,
      weighInCount: weighIns.length,
      completeIntakeDays: completeDays.length,
      averageIntakeKcal,
      trendChangeKg,
      explanation:
        'Not enough weigh-ins yet — a week of data lets us start learning your actual burn rate.',
    };
  }

  if (averageIntakeKcal === null || completeDays.length < 5) {
    return {
      kcalPerDay: null,
      confidence: 'none',
      spanDays,
      weighInCount: weighIns.length,
      completeIntakeDays: completeDays.length,
      averageIntakeKcal,
      trendChangeKg,
      explanation:
        'Not enough fully logged days yet — we need a handful to compare intake against your weight trend.',
    };
  }

  const storedKcalPerDay = ((trendChangeKg ?? 0) * KCAL_PER_KG_BODY_MASS) / spanDays;
  const kcalPerDay = Math.round(averageIntakeKcal - storedKcalPerDay);

  // Data density drives confidence: more weigh-ins and more complete logs over a
  // longer span mean the signal outweighs day-to-day water noise.
  const density = Math.min(weighIns.length / windowDays, completeDays.length / windowDays);
  let confidence: EstimateConfidence;
  if (spanDays >= 12 && density >= 0.7) confidence = 'high';
  else if (spanDays >= 10 && density >= 0.5) confidence = 'medium';
  else confidence = 'low';

  return {
    kcalPerDay,
    confidence,
    spanDays,
    weighInCount: weighIns.length,
    completeIntakeDays: completeDays.length,
    averageIntakeKcal,
    trendChangeKg,
    explanation: `Based on ${weighIns.length} weigh-ins and ${completeDays.length} fully logged days over ${spanDays} days.`,
  };
}

/** Largest weekly change we will make to a calorie target, to avoid whiplash. */
export const MAX_WEEKLY_TARGET_DELTA_KCAL = 250;

export interface Recalibration {
  readonly targets: MacroTargets;
  readonly previousEnergyKcal: number;
  readonly deltaKcal: number;
  readonly changed: boolean;
  readonly confidence: EstimateConfidence;
  /** One sentence, shown verbatim in the UI. */
  readonly reason: string;
}

export interface RecalibrateInput {
  readonly current: MacroTargets;
  readonly estimate: ExpenditureEstimate;
  readonly weightKg: number;
  readonly goal: GoalKind;
  readonly rateKgPerWeek: number;
  readonly dietStyle: DietStyle;
}

/**
 * Weekly target update.
 *
 * Deliberately conservative: low-confidence estimates are ignored, and any
 * change is clamped so a single noisy fortnight cannot swing someone's intake
 * dramatically. Wording is neutral throughout — no praise, no scolding.
 */
export function recalibrateTargets(input: RecalibrateInput): Recalibration {
  const { current, estimate, weightKg, goal, rateKgPerWeek, dietStyle } = input;

  if (estimate.kcalPerDay === null || estimate.confidence === 'none') {
    return {
      targets: current,
      previousEnergyKcal: current.energyKcal,
      deltaKcal: 0,
      changed: false,
      confidence: estimate.confidence,
      reason: `Targets unchanged. ${estimate.explanation}`,
    };
  }

  if (estimate.confidence === 'low') {
    return {
      targets: current,
      previousEnergyKcal: current.energyKcal,
      deltaKcal: 0,
      changed: false,
      confidence: estimate.confidence,
      reason:
        'Targets unchanged this week — your data so far is a bit sparse to adjust on with confidence.',
    };
  }

  const proposed = computeTargets({
    expenditureKcal: estimate.kcalPerDay,
    weightKg,
    goal,
    rateKgPerWeek,
    dietStyle,
  });

  const rawDelta = proposed.energyKcal - current.energyKcal;
  const clamped = Math.max(
    -MAX_WEEKLY_TARGET_DELTA_KCAL,
    Math.min(MAX_WEEKLY_TARGET_DELTA_KCAL, rawDelta),
  );

  // Sub-50 kcal moves are inside the noise floor; churning the target weekly for
  // no reason erodes trust in the number.
  if (Math.abs(clamped) < 50) {
    return {
      targets: current,
      previousEnergyKcal: current.energyKcal,
      deltaKcal: 0,
      changed: false,
      confidence: estimate.confidence,
      reason: 'Targets unchanged — your intake and weight trend are tracking as expected.',
    };
  }

  const finalTargets = computeTargets({
    expenditureKcal: estimate.kcalPerDay + (clamped - rawDelta),
    weightKg,
    goal,
    rateKgPerWeek,
    dietStyle,
  });

  const direction = clamped > 0 ? 'raised' : 'lowered';
  const magnitude = Math.abs(clamped);
  const trendPerWeek =
    estimate.trendChangeKg !== null && estimate.spanDays > 0
      ? (estimate.trendChangeKg / estimate.spanDays) * 7
      : null;

  const observation =
    trendPerWeek === null
      ? `your last ${estimate.spanDays} days`
      : `your ${estimate.spanDays}-day trend shows ${
          trendPerWeek < 0 ? 'a loss of' : 'a gain of'
        } ${Math.abs(trendPerWeek).toFixed(2)} kg per week`;

  return {
    targets: finalTargets,
    previousEnergyKcal: current.energyKcal,
    deltaKcal: clamped,
    changed: true,
    confidence: estimate.confidence,
    reason: `We ${direction} your target ${magnitude} kcal because ${observation}.`,
  };
}
