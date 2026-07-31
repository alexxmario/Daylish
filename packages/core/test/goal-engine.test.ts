import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_MULTIPLIERS,
  KCAL_PER_KG_BODY_MASS,
  MAX_WEEKLY_TARGET_DELTA_KCAL,
  basalMetabolicRate,
  baselineExpenditure,
  computeTargets,
  computeWeightTrend,
  estimateExpenditure,
  recalibrateTargets,
  type IntakeDay,
  type MacroTargets,
  type WeighIn,
} from '../src/goal-engine.ts';

/** Builds `days` of daily weigh-ins starting at `startKg`, changing by `kgPerDay`. */
function syntheticWeighIns(startKg: number, kgPerDay: number, days: number): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    out.push({ date, weightKg: startKg + kgPerDay * i });
  }
  return out;
}

function syntheticIntake(kcal: number, days: number, complete = true): IntakeDay[] {
  const out: IntakeDay[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    out.push({ date, energyKcal: kcal, complete });
  }
  return out;
}

describe('basalMetabolicRate (Mifflin-St Jeor)', () => {
  // Worked by hand: 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
  test('matches the published formula for a male subject', () => {
    const bmr = basalMetabolicRate({
      sex: 'male',
      ageYears: 30,
      heightCm: 180,
      weightKg: 80,
      activityLevel: 'moderate',
    });
    assert.equal(bmr, 1780);
  });

  // 10*65 + 6.25*165 - 5*30 - 161 = 650 + 1031.25 - 150 - 161 = 1370.25
  test('matches the published formula for a female subject', () => {
    const bmr = basalMetabolicRate({
      sex: 'female',
      ageYears: 30,
      heightCm: 165,
      weightKg: 65,
      activityLevel: 'moderate',
    });
    assert.equal(bmr, 1370.25);
  });

  test('unspecified sex falls between the male and female constants', () => {
    const shared = { ageYears: 30, heightCm: 175, weightKg: 70, activityLevel: 'moderate' } as const;
    const male = basalMetabolicRate({ ...shared, sex: 'male' });
    const female = basalMetabolicRate({ ...shared, sex: 'female' });
    const unspecified = basalMetabolicRate({ ...shared, sex: 'unspecified' });
    assert.ok(unspecified < male && unspecified > female);
  });
});

describe('baselineExpenditure', () => {
  test('applies the activity multiplier', () => {
    const input = {
      sex: 'male',
      ageYears: 30,
      heightCm: 180,
      weightKg: 80,
      activityLevel: 'moderate',
    } as const;
    assert.equal(baselineExpenditure(input), 1780 * ACTIVITY_MULTIPLIERS.moderate);
  });
});

describe('computeTargets', () => {
  const base = {
    expenditureKcal: 2500,
    weightKg: 80,
    dietStyle: 'balanced',
  } as const;

  test('a 0.5 kg/week loss applies the right daily deficit', () => {
    const targets = computeTargets({ ...base, goal: 'lose', rateKgPerWeek: -0.5 });
    const expectedDeficit = (0.5 * KCAL_PER_KG_BODY_MASS) / 7; // 550
    assert.equal(targets.energyKcal, Math.round(2500 - expectedDeficit));
  });

  test('maintenance ignores the rate entirely', () => {
    const targets = computeTargets({ ...base, goal: 'maintain', rateKgPerWeek: -0.5 });
    assert.equal(targets.energyKcal, 2500);
  });

  test('protein is set from bodyweight and survives a steep deficit', () => {
    const gentle = computeTargets({ ...base, goal: 'lose', rateKgPerWeek: -0.25 });
    const steep = computeTargets({ ...base, goal: 'lose', rateKgPerWeek: -1 });
    assert.equal(gentle.proteinG, 160, '2.0 g/kg at 80 kg');
    assert.equal(
      steep.proteinG,
      gentle.proteinG,
      'a bigger deficit must come out of carbs and fat, never protein',
    );
    assert.ok(steep.carbsG < gentle.carbsG);
  });

  test('never prescribes below the 1200 kcal floor', () => {
    const targets = computeTargets({
      expenditureKcal: 1400,
      weightKg: 50,
      goal: 'lose',
      rateKgPerWeek: -1.5,
      dietStyle: 'balanced',
    });
    assert.equal(targets.energyKcal, 1200);
  });

  test('macros never go negative even when the floor binds', () => {
    const targets = computeTargets({
      expenditureKcal: 1400,
      weightKg: 50,
      goal: 'lose',
      rateKgPerWeek: -1.5,
      dietStyle: 'balanced',
    });
    assert.ok(targets.carbsG >= 0);
    assert.ok(targets.fatG >= 0);
    assert.ok(targets.proteinG >= 0);
  });

  test('keto pins carbohydrate low and pushes energy into fat', () => {
    const keto = computeTargets({ ...base, goal: 'maintain', rateKgPerWeek: 0, dietStyle: 'keto' });
    const balanced = computeTargets({ ...base, goal: 'maintain', rateKgPerWeek: 0 });
    assert.equal(keto.carbsG, 25);
    assert.ok(keto.fatG > balanced.fatG);
  });

  test('high-protein preset raises protein above the goal default', () => {
    const hp = computeTargets({
      ...base,
      goal: 'maintain',
      rateKgPerWeek: 0,
      dietStyle: 'high_protein',
    });
    assert.equal(hp.proteinG, 176, '2.2 g/kg at 80 kg');
  });

  test('fiber tracks energy at 14 g per 1000 kcal', () => {
    const targets = computeTargets({ ...base, goal: 'maintain', rateKgPerWeek: 0 });
    assert.equal(targets.fiberG, 35);
  });
});

describe('computeWeightTrend', () => {
  test('the trend starts at the first reading', () => {
    const trend = computeWeightTrend(syntheticWeighIns(80, 0, 5));
    assert.equal(trend[0]!.trendKg, 80);
  });

  test('the trend lags a steady decline but follows its direction', () => {
    const trend = computeWeightTrend(syntheticWeighIns(80, -0.1, 20));
    const last = trend[trend.length - 1]!;
    assert.ok(last.trendKg < 80, 'trend should be falling');
    assert.ok(last.trendKg > last.weightKg, 'trend lags behind the raw reading');
  });

  test('smooths out a single-day water-weight spike', () => {
    const flat = syntheticWeighIns(80, 0, 10);
    const spiked = flat.map((w, i) => (i === 5 ? { ...w, weightKg: 82 } : w));
    const trend = computeWeightTrend(spiked);
    const atSpike = trend[5]!;
    assert.ok(
      atSpike.trendKg < 80.3,
      `a 2 kg spike must barely move the trend, got ${atSpike.trendKg}`,
    );
  });

  test('a gap in weigh-ins is weighted by elapsed days, not by sample count', () => {
    const gapped = computeWeightTrend([
      { date: '2026-01-01', weightKg: 80 },
      { date: '2026-01-15', weightKg: 78 },
    ]);
    const consecutive = computeWeightTrend([
      { date: '2026-01-01', weightKg: 80 },
      { date: '2026-01-02', weightKg: 78 },
    ]);
    assert.ok(
      gapped[1]!.trendKg < consecutive[1]!.trendKg,
      'after a fortnight the trend should move much further toward the new reading',
    );
  });

  test('input order does not matter', () => {
    const ordered = syntheticWeighIns(80, -0.1, 10);
    const shuffled = [...ordered].reverse();
    assert.deepEqual(computeWeightTrend(shuffled), computeWeightTrend(ordered));
  });

  test('handles an empty history', () => {
    assert.deepEqual(computeWeightTrend([]), []);
  });
});

describe('estimateExpenditure', () => {
  test('recovers a known expenditure from consistent data', () => {
    // Eat 2000 kcal/day and lose 0.5 kg/week. That deficit is
    // 0.5 * 7700 / 7 = 550 kcal/day, so true expenditure is ~2550.
    const days = 21;
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, -0.5 / 7, days),
      intakeDays: syntheticIntake(2000, days),
      windowDays: 14,
    });

    assert.notEqual(estimate.kcalPerDay, null);
    // Regressing the raw weigh-ins makes this exact on noiseless input. The tight
    // bound is deliberate: an earlier version fitted the smoothed trend instead
    // and landed 130-280 kcal low, which a loose tolerance would have hidden.
    assert.ok(
      Math.abs(estimate.kcalPerDay! - 2550) <= 5,
      `expected ~2550, got ${estimate.kcalPerDay}`,
    );
    assert.equal(estimate.confidence, 'high');
  });

  test('stays close to the truth when weigh-ins are noisy', () => {
    // Real scales wander by a kilo or more with hydration and glycogen. A
    // deterministic pseudo-random walk stands in, so the test is reproducible.
    const days = 28;
    let seed = 12345;
    const noise = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed / 2147483648 - 0.5) * 1.6; // roughly +/- 0.8 kg
    };
    const weighIns: WeighIn[] = syntheticWeighIns(80, -0.5 / 7, days).map((w) => ({
      ...w,
      weightKg: w.weightKg + noise(),
    }));

    const estimate = estimateExpenditure({
      weighIns,
      intakeDays: syntheticIntake(2000, days),
      windowDays: 14,
    });

    assert.ok(
      Math.abs(estimate.kcalPerDay! - 2550) < 400,
      `noisy data should still land near 2550, got ${estimate.kcalPerDay}`,
    );
  });

  test('weight stable at a known intake means expenditure equals intake', () => {
    const days = 21;
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(75, 0, days),
      intakeDays: syntheticIntake(2200, days),
      windowDays: 14,
    });
    assert.equal(estimate.kcalPerDay, 2200);
  });

  test('refuses to guess when there are too few weigh-ins', () => {
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, -0.05, 3),
      intakeDays: syntheticIntake(2000, 14),
    });
    assert.equal(estimate.kcalPerDay, null);
    assert.equal(estimate.confidence, 'none');
    assert.match(estimate.explanation, /weigh-ins/);
  });

  test('refuses to guess when too few days are fully logged', () => {
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, -0.05, 14),
      intakeDays: syntheticIntake(2000, 14, false),
    });
    assert.equal(estimate.kcalPerDay, null);
    assert.match(estimate.explanation, /logged days/);
  });

  test('partially logged days are excluded rather than averaged in', () => {
    const days = 14;
    const mixed: IntakeDay[] = syntheticIntake(2000, days).map((d, i) =>
      i % 2 === 0 ? d : { ...d, energyKcal: 400, complete: false },
    );
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, 0, days),
      intakeDays: mixed,
      windowDays: days,
    });
    assert.equal(
      estimate.averageIntakeKcal,
      2000,
      'the 400 kcal partial days must not drag the average down',
    );
  });

  test('says so plainly when there is no data at all', () => {
    const estimate = estimateExpenditure({ weighIns: [], intakeDays: [] });
    assert.equal(estimate.kcalPerDay, null);
    assert.equal(estimate.confidence, 'none');
    assert.match(estimate.explanation, /No weight or food data/);
  });

  test('data outside the window is ignored', () => {
    const old = syntheticWeighIns(90, 0, 10);
    const recent: WeighIn[] = [];
    for (let i = 0; i < 14; i += 1) {
      const date = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
      recent.push({ date, weightKg: 80 });
    }
    const intake: IntakeDay[] = recent.map((w) => ({
      date: w.date,
      energyKcal: 2100,
      complete: true,
    }));

    const estimate = estimateExpenditure({
      weighIns: [...old, ...recent],
      intakeDays: intake,
      windowDays: 14,
    });
    assert.equal(estimate.weighInCount, 14, 'January readings must not count in a June window');
    assert.equal(estimate.kcalPerDay, 2100);
  });
});

describe('recalibrateTargets', () => {
  const current: MacroTargets = {
    energyKcal: 2000,
    proteinG: 160,
    carbsG: 180,
    fatG: 64,
    fiberG: 28,
  };
  const shared = {
    current,
    weightKg: 80,
    goal: 'lose',
    rateKgPerWeek: -0.5,
    dietStyle: 'balanced',
  } as const;

  test('leaves targets alone when there is no usable estimate', () => {
    const result = recalibrateTargets({
      ...shared,
      estimate: estimateExpenditure({ weighIns: [], intakeDays: [] }),
    });
    assert.equal(result.changed, false);
    assert.equal(result.deltaKcal, 0);
    assert.deepEqual(result.targets, current);
  });

  test('raises the target when the user is losing faster than planned', () => {
    // Losing 1 kg/week while eating 2000 means expenditure is far above target.
    const days = 21;
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, -1 / 7, days),
      intakeDays: syntheticIntake(2000, days),
      windowDays: 14,
    });

    const result = recalibrateTargets({ ...shared, estimate });
    assert.equal(result.changed, true);
    assert.ok(result.deltaKcal > 0, 'target should go up');
    assert.match(result.reason, /raised your target/);
    assert.match(result.reason, /kg per week/);
  });

  test('never moves the target by more than the weekly cap', () => {
    const days = 21;
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, -2 / 7, days),
      intakeDays: syntheticIntake(2000, days),
      windowDays: 14,
    });
    const result = recalibrateTargets({ ...shared, estimate });
    assert.ok(
      Math.abs(result.deltaKcal) <= MAX_WEEKLY_TARGET_DELTA_KCAL,
      `delta ${result.deltaKcal} exceeded the cap`,
    );
  });

  test('holds steady when the estimate agrees with the current target', () => {
    const days = 21;
    // Expenditure ~2550, target for -0.5 kg/wk is 2550-550 = 2000, matching `current`.
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, -0.5 / 7, days),
      intakeDays: syntheticIntake(2000, days),
      windowDays: 14,
    });
    const result = recalibrateTargets({ ...shared, estimate });
    assert.equal(result.changed, false, `unexpected change of ${result.deltaKcal} kcal`);
    assert.match(result.reason, /tracking as expected/);
  });

  test('every outcome carries a non-empty, explainable reason', () => {
    const cases = [
      estimateExpenditure({ weighIns: [], intakeDays: [] }),
      estimateExpenditure({
        weighIns: syntheticWeighIns(80, -1 / 7, 21),
        intakeDays: syntheticIntake(2000, 21),
        windowDays: 14,
      }),
    ];
    for (const estimate of cases) {
      const result = recalibrateTargets({ ...shared, estimate });
      assert.ok(result.reason.length > 10);
      assert.ok(result.reason.trim().endsWith('.'), `reason should be a sentence: ${result.reason}`);
    }
  });

  test('uses neutral, non-judgmental language', () => {
    const estimate = estimateExpenditure({
      weighIns: syntheticWeighIns(80, 0.5 / 7, 21),
      intakeDays: syntheticIntake(2800, 21),
      windowDays: 14,
    });
    const result = recalibrateTargets({ ...shared, estimate });
    const forbidden = /\b(bad|poor|failed|should have|too much|cheat|guilty|over budget)\b/i;
    assert.ok(!forbidden.test(result.reason), `judgmental wording found: ${result.reason}`);
  });
});
