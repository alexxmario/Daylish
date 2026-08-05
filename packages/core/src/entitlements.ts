/**
 * What each tier includes.
 *
 * The whole tier definition lives here, as data, for one reason: it will change.
 * Prices move, features move across the line, a limit turns out to be too tight.
 * Every one of those is a one-file edit here rather than a hunt through fifteen
 * screens for scattered `if (isPremium)` branches — and it means the tier can be
 * tested, and read by someone deciding what to buy without reading the app.
 *
 * The line is deliberate and worth stating, because it is what makes the answer
 * to "should this be free" obvious in future arguments:
 *
 *   **Free is a calorie tracker. Premium is a health app and a planner.**
 *
 * Recording what you ate and seeing it against a target is free, and always will
 * be — that is the thing people install the app to do, and gating it is how you
 * make them uninstall it. Understanding what is happening to you over time, and
 * planning what happens next, is the product.
 *
 * Three things are free regardless of where that line falls, and none of them
 * are up for negotiation later:
 *
 *   - **Logging.** Barcode, search, quick-add. Logging speed is the product's
 *     primary metric; a paywall in front of it is a paywall in front of the app.
 *   - **Allergen filtering.** It is a safety feature. Charging for it is
 *     indefensible whatever it does to conversion.
 *   - **Export and backup.** Someone's diary is theirs. Holding data hostage to
 *     a subscription is the one thing that would make the privacy promise a lie.
 */

/** How many of the bundled recipes a free account can cook from. */
export const FREE_RECIPE_LIMIT = 50;

export interface Entitlements {
  /** Recipes that can be opened and cooked. `null` means every one of them. */
  readonly recipeLimit: number | null;
  /**
   * Charts, trends and averages on Progress.
   *
   * Free still sees its own logging streak, days logged and latest weight —
   * those are facts a calorie tracker states, not analysis it performs.
   */
  readonly trends: boolean;
  /** Targets that follow the weight trend, rather than a fixed formula. */
  readonly adaptiveTargets: boolean;
  /** The 23 vitamins and minerals behind the detailed toggle. */
  readonly micronutrients: boolean;
  /** Combining several recipes into one list. One recipe at a time is free. */
  readonly multiRecipeShopping: boolean;
  /**
   * The fasting timer and its five protocols. **Free**, and kept in the
   * interface because the *analysis* of fasting — history, streaks, the band
   * drawn across past days — lives behind `trends` with the rest of the
   * analysis.
   */
  readonly fasting: boolean;
  /** Water logging and its bodyweight-scaled goal. **Free**. */
  readonly water: boolean;
}

/**
 * Fasting and water became free on 2026-08-05, and the reasons are different.
 *
 * **Water** was indefensible at the price. It is a counter, every free tracker
 * has one, and its lock sat on the Today screen where it was the first thing a
 * new free user met. Nobody has ever subscribed to anything for water tracking;
 * people do leave reviews about being charged for it.
 *
 * **Fasting** was a strategy conflict rather than a generosity one. `fasting`
 * and `timer` are both in the App Store keyword field, and the listing document
 * already rejects ranking for terms the app cannot deliver, on the grounds that
 * such installs uninstall the same day and cost more in ranking than the traffic
 * is worth. Ranking for a term and then paywalling it is the same trade. Either
 * the keywords went or the gate did, and the gate was worth less.
 *
 * What is left paid is what people actually buy: targets that adapt and explain
 * themselves, the trends behind them, the micronutrient panel, and the rest of
 * the recipe library.
 */
const FREE: Entitlements = {
  recipeLimit: FREE_RECIPE_LIMIT,
  trends: false,
  adaptiveTargets: false,
  micronutrients: false,
  multiRecipeShopping: false,
  fasting: true,
  water: true,
};

const PREMIUM: Entitlements = {
  recipeLimit: null,
  trends: true,
  adaptiveTargets: true,
  micronutrients: true,
  multiRecipeShopping: true,
  fasting: true,
  water: true,
};

export function entitlementsFor(isPremium: boolean): Entitlements {
  return isPremium ? PREMIUM : FREE;
}

/**
 * The paid tier in one sentence each, for the paywall.
 *
 * Kept beside the flags so the two cannot drift — a paywall that promises
 * something the flags do not grant is both a refund and a review.
 */
export const PREMIUM_FEATURES: readonly { readonly title: string; readonly blurb: string }[] = [
  {
    title: 'Every recipe',
    blurb: `All ${496} dishes with full filtering, not the ${FREE_RECIPE_LIMIT} you start with.`,
  },
  {
    title: 'One shopping list for the week',
    blurb: 'Add several recipes and the ingredients they share are added together.',
  },
  {
    title: 'Targets that learn you',
    blurb: 'Worked out from your own weight trend, and they explain every change.',
  },
  {
    title: 'Your trends, explained',
    blurb: 'Weight trajectory, intake against target, and what actually changed.',
  },
  {
    title: 'Every day you have logged',
    blurb: 'Your whole diary as a calendar, month by month, tappable back into any day.',
  },
  {
    title: 'The full picture',
    blurb: '23 vitamins and minerals against daily values, not just the macros.',
  },
];
