/**
 * User profile and goal repository.
 *
 * Goals are append-only: each recalibration inserts a row rather than updating
 * one, so "what was my target in March, and why did it change?" is always
 * answerable. `getCurrentGoal` reads the newest row at or before today.
 */

import {
  baselineExpenditure,
  computeTargets,
  estimateExpenditure,
  recalibrateTargets,
  type ActivityLevel,
  type Allergen,
  type DietStyle,
  type Equipment,
  type GoalKind,
  type MacroTargets,
  type Sex,
} from '@daylish/core';

import { sqlite } from '@/db/client.ts';
import { deviceTimezone, today } from '@/lib/dates.ts';
import { newId } from '@/lib/ids.ts';

export interface Profile {
  id: string;
  sex: Sex;
  birthDate: string | null;
  heightCm: number | null;
  activityLevel: ActivityLevel;
  allergens: Allergen[];
  dislikedIngredients: string[];
  equipment: Equipment[];
  maxPrepMinutes: number;
  detailedNutrition: boolean;
  weeklyBudgetMinor: number | null;
  currency: string;
  timezone: string;
  onboardedAt: string | null;
}

export interface CurrentGoal extends MacroTargets {
  id: string;
  goal: GoalKind;
  dietStyle: DietStyle;
  rateKgPerWeek: number;
  effectiveFrom: string;
  reason: string | null;
  estimateConfidence: string | null;
}

interface UserRow {
  id: string;
  sex: Sex;
  birth_date: string | null;
  height_cm: number | null;
  activity_level: ActivityLevel;
  allergens: string;
  disliked_ingredients: string;
  equipment: string;
  max_prep_minutes: number;
  detailed_nutrition: number;
  weekly_budget_minor: number | null;
  currency: string;
  timezone: string;
  onboarded_at: string | null;
}

function rowToProfile(row: UserRow): Profile {
  return {
    id: row.id,
    sex: row.sex,
    birthDate: row.birth_date,
    heightCm: row.height_cm,
    activityLevel: row.activity_level,
    allergens: JSON.parse(row.allergens) as Allergen[],
    dislikedIngredients: JSON.parse(row.disliked_ingredients) as string[],
    equipment: JSON.parse(row.equipment) as Equipment[],
    maxPrepMinutes: row.max_prep_minutes,
    detailedNutrition: row.detailed_nutrition === 1,
    weeklyBudgetMinor: row.weekly_budget_minor,
    currency: row.currency,
    timezone: row.timezone,
    onboardedAt: row.onboarded_at,
  };
}

const USER_COLUMNS = `id, sex, birth_date, height_cm, activity_level, allergens,
  disliked_ingredients, equipment, max_prep_minutes, detailed_nutrition,
  weekly_budget_minor, currency, timezone, onboarded_at`;

/**
 * One specific user's profile.
 *
 * Since signing in is required, more than one account's rows can sit on a device
 * — so the profile has to be fetched by id rather than by "the first row", which
 * would hand the second account the first one's diary. This is what the session
 * provider calls.
 */
export function getUserById(userId: string): Profile | null {
  const row = sqlite.getFirstSync<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [
    userId,
  ]);
  return row ? rowToProfile(row) : null;
}

/**
 * The device's user, creating a local-only one on first launch.
 *
 * Predates accounts, and is now only reached before anyone has signed in — the
 * row it creates is the "anonymous" one that `ensureAccountUser` adopts on first
 * sign-in. Kept because onboarding and the tests still need a user row to exist
 * independently of auth.
 */
export function getOrCreateLocalUser(): Profile {
  const existing = sqlite.getFirstSync<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC LIMIT 1`,
  );
  if (existing) return rowToProfile(existing);

  const id = newId();
  const timestamp = new Date().toISOString();
  sqlite.runSync(
    `INSERT INTO users (id, sex, activity_level, cooking_skill, allergens, disliked_ingredients,
       equipment, currency, max_prep_minutes, detailed_nutrition, timezone, created_at, updated_at)
     VALUES (?, 'unspecified', 'moderate', 'comfortable', '[]', '[]', '[]', 'EUR', 45, 0, ?, ?, ?)`,
    [id, deviceTimezone(), timestamp, timestamp],
  );

  const created = sqlite.getFirstSync<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
    [id],
  );
  if (!created) throw new Error('Failed to create the local user');
  return rowToProfile(created);
}

export interface OnboardingAnswers {
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: GoalKind;
  rateKgPerWeek: number;
  dietStyle: DietStyle;
  allergens: Allergen[];
  maxPrepMinutes: number;
  equipment: Equipment[];
}

function ageFromBirthDate(birthDate: string, asOf: string = today()): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ay, am, ad] = asOf.split('-').map(Number) as [number, number, number];
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age -= 1;
  return age;
}

/**
 * Persist onboarding and write the first goal row.
 *
 * The initial targets are the Mifflin-St Jeor baseline. They are explicitly a
 * starting point — the reason string says so, because the adaptive engine will
 * replace them with observed data inside a fortnight and the user should know
 * that up front rather than wonder why their number moved.
 */
export function completeOnboarding(userId: string, answers: OnboardingAnswers): CurrentGoal {
  const timestamp = new Date().toISOString();
  const date = today();

  const expenditure = baselineExpenditure({
    sex: answers.sex,
    ageYears: ageFromBirthDate(answers.birthDate, date),
    heightCm: answers.heightCm,
    weightKg: answers.weightKg,
    activityLevel: answers.activityLevel,
  });

  const targets = computeTargets({
    expenditureKcal: expenditure,
    weightKg: answers.weightKg,
    goal: answers.goal,
    rateKgPerWeek: answers.rateKgPerWeek,
    dietStyle: answers.dietStyle,
  });

  const goalId = newId();

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `UPDATE users SET sex = ?, birth_date = ?, height_cm = ?, activity_level = ?,
         allergens = ?, equipment = ?, max_prep_minutes = ?, timezone = ?,
         onboarded_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        answers.sex,
        answers.birthDate,
        answers.heightCm,
        answers.activityLevel,
        JSON.stringify(answers.allergens),
        JSON.stringify(answers.equipment),
        answers.maxPrepMinutes,
        deviceTimezone(),
        timestamp,
        timestamp,
        userId,
      ],
    );

    sqlite.runSync(
      `INSERT INTO weight_entries (id, user_id, local_date, weight_kg, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?)
       ON CONFLICT(user_id, local_date) DO UPDATE SET weight_kg = excluded.weight_kg`,
      [newId(), userId, date, answers.weightKg, timestamp, timestamp],
    );

    sqlite.runSync(
      `INSERT INTO user_goals (id, user_id, effective_from, goal, diet_style, rate_kg_per_week,
         energy_kcal, protein_g, carbs_g, fat_g, fiber_g,
         estimated_expenditure_kcal, estimate_confidence, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?)`,
      [
        goalId,
        userId,
        date,
        answers.goal,
        answers.dietStyle,
        answers.rateKgPerWeek,
        targets.energyKcal,
        targets.proteinG,
        targets.carbsG,
        targets.fatG,
        targets.fiberG,
        Math.round(expenditure),
        'Starting estimate from your height, weight, age and activity — this will adjust to your real data within a couple of weeks.',
        timestamp,
        timestamp,
      ],
    );

    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }

  const goal = getCurrentGoal(userId);
  if (!goal) throw new Error('Goal was written but could not be read back');
  return goal;
}

export function getCurrentGoal(userId: string): CurrentGoal | null {
  const row = sqlite.getFirstSync<{
    id: string;
    goal: GoalKind;
    diet_style: DietStyle;
    rate_kg_per_week: number;
    effective_from: string;
    energy_kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    reason: string | null;
    estimate_confidence: string | null;
  }>(
    `SELECT id, goal, diet_style, rate_kg_per_week, effective_from,
            energy_kcal, protein_g, carbs_g, fat_g, fiber_g, reason, estimate_confidence
     FROM user_goals
     WHERE user_id = ? AND deleted_at IS NULL AND effective_from <= ?
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [userId, today()],
  );

  if (!row) return null;
  return {
    id: row.id,
    goal: row.goal,
    dietStyle: row.diet_style,
    rateKgPerWeek: row.rate_kg_per_week,
    effectiveFrom: row.effective_from,
    energyKcal: row.energy_kcal,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    fiberG: row.fiber_g,
    reason: row.reason,
    estimateConfidence: row.estimate_confidence,
  };
}

/**
 * The weekly adaptive recalibration.
 *
 * Reads the user's own weigh-ins and fully logged days, asks the goal engine
 * what their expenditure actually looks like, and writes a new goal row only if
 * the engine decided to move. The engine's `reason` is stored verbatim and shown
 * to the user — no adjustment ships without an explanation.
 */
export function recalibrate(userId: string): { changed: boolean; reason: string } {
  const goal = getCurrentGoal(userId);
  if (!goal) return { changed: false, reason: 'No targets set yet.' };

  const weighIns = sqlite
    .getAllSync<{ local_date: string; weight_kg: number }>(
      `SELECT local_date, weight_kg FROM weight_entries
       WHERE user_id = ? AND deleted_at IS NULL ORDER BY local_date ASC`,
      [userId],
    )
    .map((r) => ({ date: r.local_date, weightKg: r.weight_kg }));

  const latestWeight = weighIns[weighIns.length - 1]?.weightKg;
  if (latestWeight === undefined) {
    return { changed: false, reason: 'Log a few weigh-ins and we can start tuning your targets.' };
  }

  /**
   * A day counts as fully logged only if it has entries in at least three
   * distinct meal slots. Without that bar, a day where someone logged only
   * breakfast would read as a 400 kcal day and drag the expenditure estimate
   * into nonsense.
   */
  const intakeDays = sqlite
    .getAllSync<{ local_date: string; kcal: number; slots: number }>(
      `SELECT e.local_date,
              SUM(i.energy_kcal) AS kcal,
              COUNT(DISTINCT e.meal_slot) AS slots
       FROM journal_entries e
       JOIN journal_entry_items i ON i.entry_id = e.id
       WHERE e.user_id = ? AND e.deleted_at IS NULL AND i.deleted_at IS NULL
       GROUP BY e.local_date`,
      [userId],
    )
    .map((r) => ({ date: r.local_date, energyKcal: r.kcal, complete: r.slots >= 3 }));

  const estimate = estimateExpenditure({ weighIns, intakeDays });
  const result = recalibrateTargets({
    current: goal,
    estimate,
    weightKg: latestWeight,
    goal: goal.goal,
    rateKgPerWeek: goal.rateKgPerWeek,
    dietStyle: goal.dietStyle,
  });

  if (!result.changed) return { changed: false, reason: result.reason };

  const timestamp = new Date().toISOString();
  sqlite.runSync(
    `INSERT INTO user_goals (id, user_id, effective_from, goal, diet_style, rate_kg_per_week,
       energy_kcal, protein_g, carbs_g, fat_g, fiber_g,
       estimated_expenditure_kcal, estimate_confidence, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      userId,
      today(),
      goal.goal,
      goal.dietStyle,
      goal.rateKgPerWeek,
      result.targets.energyKcal,
      result.targets.proteinG,
      result.targets.carbsG,
      result.targets.fatG,
      result.targets.fiberG,
      estimate.kcalPerDay,
      estimate.confidence,
      result.reason,
      timestamp,
      timestamp,
    ],
  );

  return { changed: true, reason: result.reason };
}

/**
 * Flip the simple/detailed nutrition view.
 *
 * Stored on the user rather than held in component state so the choice survives
 * a restart — someone who wants micronutrients wants them every day, not until
 * the app is next killed.
 */
export function setDetailedNutrition(userId: string, detailed: boolean): void {
  sqlite.runSync('UPDATE users SET detailed_nutrition = ?, updated_at = ? WHERE id = ?', [
    detailed ? 1 : 0,
    new Date().toISOString(),
    userId,
  ]);
}
