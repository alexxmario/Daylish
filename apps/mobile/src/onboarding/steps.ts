import type { ActivityLevel, Allergen, DietStyle, Equipment, GoalKind, Sex } from '@daylish/core';

import type { IllustrationName } from '@/illustrations/registry.ts';

/**
 * The onboarding script.
 *
 * Kept as data rather than as nine hand-written screens so the order, the
 * progress count and the validation all stay in one place — and so adding a
 * question later is an entry here, not another route.
 *
 * Question order is deliberate. It opens with goal, which is the one thing the
 * user actually came to declare, and defers the body measurements that feel like
 * an interrogation until there is some investment. Allergies come last among the
 * required steps because that is the answer people most often want to revise
 * once they see it will actually filter their food.
 */

export type StepId =
  | 'goal'
  | 'rate'
  | 'body'
  | 'birth'
  | 'activity'
  | 'diet'
  | 'allergens'
  | 'kitchen'
  | 'review';

export interface Draft {
  goal: GoalKind;
  rateKgPerWeek: number;
  sex: Sex;
  heightCm: string;
  weightKg: string;
  birthYear: string;
  activityLevel: ActivityLevel;
  dietStyle: DietStyle;
  allergens: Allergen[];
  equipment: Equipment[];
  maxPrepMinutes: number;
}

export const INITIAL_DRAFT: Draft = {
  goal: 'maintain',
  rateKgPerWeek: 0,
  sex: 'unspecified',
  heightCm: '',
  weightKg: '',
  birthYear: '',
  activityLevel: 'moderate',
  dietStyle: 'balanced',
  allergens: [],
  equipment: ['oven', 'stovetop', 'microwave'],
  maxPrepMinutes: 45,
};

export interface StepDef {
  id: StepId;
  /** The question, in the user's words. */
  title: string;
  /** At most one short clause. The illustration carries the rest. */
  help?: string;
  /** Shown in the progress rail. */
  shortLabel: string;
  /** Slot in the illustration registry. */
  art: IllustrationName;
}

export const STEPS: readonly StepDef[] = [
  {
    id: 'goal',
    title: 'What are you here to do?',
    help: 'Change it any time.',
    shortLabel: 'Goal',
    art: 'goal',
  },
  {
    id: 'rate',
    title: 'How fast?',
    help: 'Slower sticks better.',
    shortLabel: 'Pace',
    art: 'pace',
  },
  {
    id: 'body',
    title: 'Your height and weight',
    help: 'Stays on your phone.',
    shortLabel: 'Body',
    art: 'body',
  },
  {
    id: 'birth',
    title: 'What year were you born?',
    help: 'Affects what you burn at rest.',
    shortLabel: 'Age',
    art: 'age',
  },
  {
    id: 'activity',
    title: 'How much do you move?',
    help: 'A rough answer is fine.',
    shortLabel: 'Activity',
    art: 'activity',
  },
  {
    id: 'diet',
    title: 'How do you eat?',
    help: 'Filters every recipe you see.',
    shortLabel: 'Diet',
    art: 'diet',
  },
  {
    id: 'allergens',
    title: 'Anything to keep out?',
    help: 'We hide these, and flag them on scans.',
    shortLabel: 'Avoid',
    art: 'allergens',
  },
  {
    id: 'kitchen',
    title: "What's your kitchen like?",
    help: 'We only suggest what you can cook.',
    shortLabel: 'Kitchen',
    art: 'kitchen',
  },
  {
    id: 'review',
    title: 'Here is where you land',
    shortLabel: 'Done',
    art: 'targets',
  },
];

/** Whether a step has enough of an answer to continue. */
export function canAdvance(step: StepId, draft: Draft): boolean {
  switch (step) {
    case 'body': {
      const h = Number(draft.heightCm);
      const w = Number(draft.weightKg);
      return Number.isFinite(h) && h > 90 && h < 250 && Number.isFinite(w) && w > 25 && w < 400;
    }
    case 'birth': {
      const y = Number(draft.birthYear);
      return Number.isFinite(y) && y > 1900 && y <= new Date().getFullYear() - 13;
    }
    case 'kitchen':
      return draft.equipment.length > 0;
    // Everything else has a usable default, so the user can move straight on.
    default:
      return true;
  }
}

/**
 * The pace step only makes sense when the goal implies a direction, so it is
 * skipped for maintenance and recomposition rather than shown greyed out.
 */
export function isStepRelevant(step: StepId, draft: Draft): boolean {
  if (step === 'rate') return draft.goal === 'lose' || draft.goal === 'gain';
  return true;
}

export function visibleSteps(draft: Draft): StepDef[] {
  return STEPS.filter((s) => isStepRelevant(s.id, draft));
}

export const GOAL_OPTIONS: { value: GoalKind; label: string; blurb: string; rate: number }[] = [
  { value: 'lose', label: 'Lose weight', blurb: 'Eat a little under what you burn', rate: -0.5 },
  { value: 'maintain', label: 'Stay where I am', blurb: 'Hold steady, eat well', rate: 0 },
  { value: 'gain', label: 'Gain weight', blurb: 'Eat a little over what you burn', rate: 0.25 },
  { value: 'recomp', label: 'Recomposition', blurb: 'Hold weight, shift what it is made of', rate: 0 },
];

export const RATE_OPTIONS: { value: number; label: string; blurb: string }[] = [
  { value: 0.25, label: 'Gentle', blurb: '0.25 kg a week' },
  { value: 0.5, label: 'Steady', blurb: '0.5 kg a week' },
  { value: 0.75, label: 'Brisk', blurb: '0.75 kg a week' },
  { value: 1, label: 'Fast', blurb: '1 kg a week — hard to hold' },
];

export const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; blurb: string }[] = [
  { value: 'sedentary', label: 'Mostly sitting', blurb: 'Desk work, little exercise' },
  { value: 'light', label: 'Lightly active', blurb: 'Exercise once or twice a week' },
  { value: 'moderate', label: 'Moderately active', blurb: 'Exercise three to five days' },
  { value: 'very', label: 'Very active', blurb: 'Hard exercise most days' },
  { value: 'athlete', label: 'Athlete', blurb: 'Training twice a day, or a physical job' },
];

export const DIET_OPTIONS: { value: DietStyle; label: string }[] = [
  { value: 'balanced', label: 'No preference' },
  { value: 'high_protein', label: 'High protein' },
  { value: 'mediterranean', label: 'Mediterranean' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'keto', label: 'Keto' },
  { value: 'halal', label: 'Halal' },
  { value: 'gluten_free', label: 'Gluten free' },
  { value: 'dairy_free', label: 'Dairy free' },
];

export const ALLERGEN_OPTIONS: { value: Allergen; label: string }[] = [
  { value: 'gluten', label: 'Gluten' },
  { value: 'milk', label: 'Milk' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'peanuts', label: 'Peanuts' },
  { value: 'tree_nuts', label: 'Tree nuts' },
  { value: 'soybeans', label: 'Soy' },
  { value: 'fish', label: 'Fish' },
  { value: 'crustaceans', label: 'Shellfish' },
  { value: 'sesame', label: 'Sesame' },
  { value: 'celery', label: 'Celery' },
  { value: 'mustard', label: 'Mustard' },
  { value: 'sulphites', label: 'Sulphites' },
];

export const EQUIPMENT_OPTIONS: { value: Equipment; label: string }[] = [
  { value: 'stovetop', label: 'Hob' },
  { value: 'oven', label: 'Oven' },
  { value: 'microwave', label: 'Microwave' },
  { value: 'air_fryer', label: 'Air fryer' },
  { value: 'blender', label: 'Blender' },
  { value: 'food_processor', label: 'Food processor' },
  { value: 'slow_cooker', label: 'Slow cooker' },
  { value: 'pressure_cooker', label: 'Pressure cooker' },
  { value: 'grill', label: 'Grill' },
  { value: 'rice_cooker', label: 'Rice cooker' },
];

export const PREP_TIME_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: 'Under 15 min' },
  { value: 30, label: 'Up to 30 min' },
  { value: 45, label: 'Up to 45 min' },
  { value: 90, label: "I'll take my time" },
];
