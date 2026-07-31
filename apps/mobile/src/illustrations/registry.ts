import type { ImageSourcePropType } from 'react-native';

/**
 * The illustration registry.
 *
 * Every image slot in the app is named here exactly once, alongside the
 * procedural placeholder to draw if its asset is ever missing. That fallback is
 * what lets a slot be added before its artwork exists, and what stops a dropped
 * or corrupt file from leaving a blank hole on a screen.
 *
 * Source files are generated to `docs/illustration-brief.md`, then run through
 * `scripts/process-illustrations.mjs`, which trims and normalises them onto one
 * canvas. Do not add raw generated output here — it arrives at inconsistent
 * sizes and roughly 2 MB each.
 */

export type IllustrationName =
  // Onboarding, one per step
  | 'welcome'
  | 'goal'
  | 'pace'
  | 'body'
  | 'age'
  | 'activity'
  | 'diet'
  | 'allergens'
  | 'kitchen'
  | 'targets'
  // Empty states
  | 'emptyDay'
  | 'emptyRecipes'
  | 'emptyPantry'
  | 'emptyPlan'
  | 'emptyProgress'
  | 'emptySearch'
  // Feature moments
  | 'scanMiss'
  | 'prepDay'
  | 'reverseLogging'
  | 'cookFromPantry'
  | 'weeklyReport'
  | 'premium';

export interface IllustrationMeta {
  /** File to drop into `assets/illustrations/`. */
  readonly file: string;
  /**
   * Width ÷ height. Uniform across the set: `scripts/process-illustrations.mjs`
   * trims each generated file to its visible content and centres it on one
   * standard 900×600 canvas, so every illustration occupies the same footprint
   * and no screen's art reads larger than its neighbour's.
   */
  readonly aspect: number;
  /** Spoken description. Always present, whether or not an asset is loaded. */
  readonly alt: string;
  /** Which procedural placeholder to draw until the asset arrives. */
  readonly motif: Motif;
}

/**
 * Placeholder motifs.
 *
 * Deliberately abstract — a few shapes in celeste and butter. They are not
 * pretending to be the final art; they are there so a screen without art still
 * has a considered shape and colour instead of a grey box.
 */
export type Motif = 'plate' | 'sun' | 'ribbon' | 'basket' | 'steam' | 'leaf' | 'chart';

export const ILLUSTRATIONS: Readonly<Record<IllustrationName, IllustrationMeta>> = {
  welcome: {
    file: 'welcome.png',
    aspect: 1.5,
    alt: 'A bright table set for a whole day of eating',
    motif: 'plate',
  },
  goal: {
    file: 'goal.png',
    aspect: 1.5,
    alt: 'Three plates of different sizes side by side',
    motif: 'plate',
  },
  pace: {
    file: 'pace.png',
    aspect: 1.5,
    alt: 'A gentle slope descending from left to right',
    motif: 'chart',
  },
  body: {
    file: 'body.png',
    aspect: 1.5,
    alt: 'A tape measure curled beside a set of scales',
    motif: 'ribbon',
  },
  age: { file: 'age.png', aspect: 1.5, alt: 'A slice of birthday cake', motif: 'sun' },
  activity: {
    file: 'activity.png',
    aspect: 1.5,
    alt: 'A pair of trainers beside a bicycle wheel',
    motif: 'ribbon',
  },
  diet: {
    file: 'diet.png',
    aspect: 1.5,
    alt: 'A spread of vegetables, grains and fish',
    motif: 'leaf',
  },
  allergens: {
    file: 'allergens.png',
    aspect: 1.5,
    alt: 'A small bowl set gently to one side',
    motif: 'basket',
  },
  kitchen: {
    file: 'kitchen.png',
    aspect: 1.5,
    alt: 'A hob, an oven and a blender on a counter',
    motif: 'steam',
  },
  targets: {
    file: 'targets.png',
    aspect: 1.5,
    alt: 'A full day of meals laid out in a row',
    motif: 'sun',
  },

  emptyDay: {
    file: 'empty-day.png',
    aspect: 1.5,
    alt: 'An empty plate and a fork, waiting',
    motif: 'plate',
  },
  emptyRecipes: {
    file: 'empty-recipes.png',
    aspect: 1.5,
    alt: 'A closed recipe book',
    motif: 'leaf',
  },
  emptyPantry: {
    file: 'empty-pantry.png',
    aspect: 1.5,
    alt: 'Open shelves with a few jars',
    motif: 'basket',
  },
  emptyPlan: {
    file: 'empty-plan.png',
    aspect: 1.5,
    alt: 'A blank week laid out as seven columns',
    motif: 'chart',
  },
  emptyProgress: {
    file: 'empty-progress.png',
    aspect: 1.5,
    alt: 'A line beginning to rise across a chart',
    motif: 'chart',
  },
  emptySearch: {
    file: 'empty-search.png',
    aspect: 1.5,
    alt: 'A magnifying glass over an open larder',
    motif: 'basket',
  },

  scanMiss: {
    file: 'scan-miss.png',
    aspect: 1.5,
    alt: 'A barcode with one bar missing',
    motif: 'ribbon',
  },
  prepDay: {
    file: 'prep-day.png',
    aspect: 1.5,
    alt: 'Containers filled and lined up on a counter',
    motif: 'steam',
  },
  reverseLogging: {
    file: 'reverse-logging.png',
    aspect: 1.5,
    alt: 'A slice of pizza on a plate with room around it',
    motif: 'plate',
  },
  cookFromPantry: {
    file: 'cook-from-pantry.png',
    aspect: 1.5,
    alt: 'Ingredients gathered from a cupboard onto a board',
    motif: 'basket',
  },
  weeklyReport: {
    file: 'weekly-report.png',
    aspect: 1.5,
    alt: 'A week of days summarised on a card',
    motif: 'chart',
  },
  premium: {
    file: 'premium.png',
    aspect: 1.5,
    alt: 'A generously filled table seen from above',
    motif: 'sun',
  },
};

/**
 * The real assets.
 *
 * A slot listed here renders its image; a slot omitted falls back to the
 * procedural placeholder, so removing a line is a safe way to pull one image
 * without breaking a screen.
 */
export const ILLUSTRATION_SOURCES: Partial<Record<IllustrationName, ImageSourcePropType>> = {
  welcome: require('../../assets/illustrations/welcome.png'),
  goal: require('../../assets/illustrations/goal.png'),
  pace: require('../../assets/illustrations/pace.png'),
  body: require('../../assets/illustrations/body.png'),
  age: require('../../assets/illustrations/age.png'),
  activity: require('../../assets/illustrations/activity.png'),
  diet: require('../../assets/illustrations/diet.png'),
  allergens: require('../../assets/illustrations/allergens.png'),
  kitchen: require('../../assets/illustrations/kitchen.png'),
  targets: require('../../assets/illustrations/targets.png'),
  emptyDay: require('../../assets/illustrations/empty-day.png'),
  emptyRecipes: require('../../assets/illustrations/empty-recipes.png'),
  emptyPantry: require('../../assets/illustrations/empty-pantry.png'),
  emptyPlan: require('../../assets/illustrations/empty-plan.png'),
  emptyProgress: require('../../assets/illustrations/empty-progress.png'),
  emptySearch: require('../../assets/illustrations/empty-search.png'),
  scanMiss: require('../../assets/illustrations/scan-miss.png'),
  prepDay: require('../../assets/illustrations/prep-day.png'),
  reverseLogging: require('../../assets/illustrations/reverse-logging.png'),
  cookFromPantry: require('../../assets/illustrations/cook-from-pantry.png'),
  weeklyReport: require('../../assets/illustrations/weekly-report.png'),
  premium: require('../../assets/illustrations/premium.png'),
};
