/**
 * Turning a set of recipes into one shopping list.
 *
 * The arithmetic that makes a shopping list worth having is combining: four
 * recipes that each want garlic should produce one line for garlic, scaled to
 * however many portions of each you actually intend to cook. Doing that by hand
 * is exactly the tedium that stops people cooking from a plan.
 *
 * It lives in `packages/core` rather than in the app for the usual reason —
 * it is arithmetic over ingredients, it has edge cases worth testing, and the
 * prep-day planner will need the same function when it is built.
 */

export interface ShoppingIngredient {
  readonly name: string;
  readonly grams: number;
  /** What the recipe tells a cook to buy, e.g. "2 cloves". */
  readonly displayQuantity: string;
  readonly optional: boolean;
}

/** One recipe on the list, at the number of portions you mean to cook. */
export interface ShoppingSource {
  readonly recipeId: string;
  readonly title: string;
  /** Portions wanted. */
  readonly servings: number;
  /** What the recipe as written yields. */
  readonly recipeServings: number;
  readonly ingredients: readonly ShoppingIngredient[];
}

/** Which recipe wanted this, and how much of it. */
export interface ShoppingLineSource {
  readonly recipeId: string;
  readonly title: string;
  readonly displayQuantity: string;
  readonly grams: number;
}

export interface ShoppingLine {
  /** Stable key for the ingredient, used to remember what has been ticked off. */
  readonly key: string;
  readonly name: string;
  /** Total across every recipe that wants it, scaled to the portions wanted. */
  readonly grams: number;
  /** Only when *every* recipe that wants it calls it optional. */
  readonly optional: boolean;
  readonly sources: readonly ShoppingLineSource[];
}

/**
 * The identity two ingredients have to share to be added together.
 *
 * Case and spacing only. It is tempting to go further — singularise, strip
 * qualifiers, merge "tomatoes" with "tomatoes, canned" — and every one of those
 * rules eventually adds two things that are not the same thing, which is a
 * worse failure than two lines you have to read. A shopping list with a
 * duplicate on it costs a glance; one that has quietly merged fresh and tinned
 * tomatoes costs a second trip.
 */
export function shoppingItemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Combine several recipes into one list.
 *
 * Each recipe is scaled by the portions wanted over the portions it yields, so
 * half a batch of something contributes half of each ingredient.
 *
 * Optional ingredients stay on the list rather than being dropped: whether to
 * buy the olives is the shopper's call, and a list that silently omits them is
 * one you cannot trust to be complete. They are marked, and sorted last.
 */
export function buildShoppingList(sources: readonly ShoppingSource[]): ShoppingLine[] {
  const lines = new Map<string, {
    name: string;
    grams: number;
    optional: boolean;
    sources: ShoppingLineSource[];
  }>();

  for (const source of sources) {
    if (!Number.isFinite(source.servings) || source.servings <= 0) {
      throw new RangeError(
        `buildShoppingList: servings must be > 0 for ${source.title}, got ${source.servings}`,
      );
    }

    const factor = source.recipeServings > 0 ? source.servings / source.recipeServings : 1;

    for (const ingredient of source.ingredients) {
      const key = shoppingItemKey(ingredient.name);
      if (key.length === 0) continue;

      const grams = ingredient.grams * factor;
      const existing = lines.get(key);

      if (existing) {
        existing.grams += grams;
        // One recipe calling it essential settles it for the whole line.
        existing.optional = existing.optional && ingredient.optional;
        existing.sources.push({
          recipeId: source.recipeId,
          title: source.title,
          displayQuantity: ingredient.displayQuantity,
          grams,
        });
      } else {
        lines.set(key, {
          // The first spelling wins the label, so the list reads in the
          // vocabulary of the recipe you added first rather than in lower case.
          name: ingredient.name.trim(),
          grams,
          optional: ingredient.optional,
          sources: [
            {
              recipeId: source.recipeId,
              title: source.title,
              displayQuantity: ingredient.displayQuantity,
              grams,
            },
          ],
        });
      }
    }
  }

  return [...lines]
    .map(([key, line]) => ({ key, ...line }))
    .sort(
      (a, b) =>
        Number(a.optional) - Number(b.optional) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * A quantity as you would actually buy it.
 *
 * Nobody buys 1,247 g of anything. Precision follows size, the same way it does
 * when a recipe is scaled: whole grams under 100, fives up to a kilo, then
 * kilograms to one decimal.
 */
export function formatShoppingQuantity(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) return '—';
  if (grams < 10) return `${Math.round(grams * 2) / 2} g`;
  if (grams < 100) return `${Math.round(grams)} g`;
  if (grams < 1000) return `${Math.round(grams / 5) * 5} g`;
  return `${(Math.round(grams / 100) / 10).toFixed(1)} kg`;
}
