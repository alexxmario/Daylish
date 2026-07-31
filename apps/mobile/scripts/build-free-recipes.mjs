/**
 * Choose the recipes a free account can cook from.
 *
 * Not a slice. Taking the first 50 of anything — alphabetical, by id, by
 * whatever order the pipeline emitted — leaves whole groups of people with an
 * app that does not work: the first 50 alphabetically contain zero
 * Mediterranean recipes, three pescatarian ones and six breakfasts. Someone
 * whose diet lost that lottery opens the Meals tab, filters to what they eat,
 * finds nothing, and uninstalls. They do not upgrade; they conclude the library
 * is empty.
 *
 * So the free set is built to guarantee coverage instead. It picks greedily,
 * always taking whichever recipe closes the most remaining gaps across meal
 * slots and diet styles, with a cap per cuisine so it cannot become fifty
 * variations on Italian. Ties break towards easy and quick, because these are
 * the fifty dishes that have to make a first impression.
 *
 * Deterministic: the same library always produces the same fifty, so the
 * generated file only changes when the library does and a diff is meaningful.
 *
 *   node scripts/build-free-recipes.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'supabase', 'seed', 'recipes.json');
const outFile = join(here, '..', 'src', 'data', 'free-recipes.generated.ts');

/** Kept in step with `FREE_RECIPE_LIMIT` in `@daylish/core`. */
const LIMIT = 50;

/**
 * Floors, not quotas.
 *
 * Each is roughly proportional to how much of the library that group has, so
 * the free set reads like a smaller version of the whole thing rather than a
 * skewed one. Keto is 18 recipes in 496, so three is its fair share.
 */
const DIET_FLOOR = {
  vegan: 8,
  vegetarian: 10,
  gluten_free: 12,
  dairy_free: 12,
  high_protein: 12,
  keto: 3,
  pescatarian: 6,
  mediterranean: 6,
};

const SLOT_FLOOR = { breakfast: 10, lunch: 14, dinner: 16, snack: 8 };

/** Nobody's free tier should be one cuisine. */
const MAX_PER_CUISINE = 4;

const recipes = JSON.parse(readFileSync(source, 'utf8'));

/** Same derivation as `recipeIdFor` in `src/data/recipes.ts`. */
function recipeId(title) {
  return `seed:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

const diets = Object.keys(DIET_FLOOR);
const slots = Object.keys(SLOT_FLOOR);

const dietHave = Object.fromEntries(diets.map((d) => [d, 0]));
const slotHave = Object.fromEntries(slots.map((s) => [s, 0]));
const cuisineHave = {};
const picked = [];
const taken = new Set();

// Sorted first so the greedy pass is stable regardless of the input order.
const pool = [...recipes].sort((a, b) => a.title.localeCompare(b.title));

while (picked.length < LIMIT) {
  let best = null;
  let bestScore = -1;

  for (const recipe of pool) {
    if (taken.has(recipe.title)) continue;
    if ((cuisineHave[recipe.cuisine] ?? 0) >= MAX_PER_CUISINE) continue;

    let score = 0;
    for (const diet of diets) {
      if (recipe.dietStyles.includes(diet) && dietHave[diet] < DIET_FLOOR[diet]) score += 2;
    }
    for (const slot of slots) {
      if (recipe.mealSlots.includes(slot) && slotHave[slot] < SLOT_FLOOR[slot]) score += 2;
    }
    if (recipe.difficulty === 'easy') score += 0.5;
    if (recipe.prepMinutes + recipe.cookMinutes <= 40) score += 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = recipe;
    }
  }

  if (!best) break;

  picked.push(best);
  taken.add(best.title);
  cuisineHave[best.cuisine] = (cuisineHave[best.cuisine] ?? 0) + 1;
  for (const diet of diets) if (best.dietStyles.includes(diet)) dietHave[diet]++;
  for (const slot of slots) if (best.mealSlots.includes(slot)) slotHave[slot]++;
}

// Fail loudly rather than shipping a free tier that is empty for someone.
const short = diets.filter((d) => dietHave[d] < DIET_FLOOR[d]);
if (short.length > 0) {
  console.error(
    `Could not meet the floor for: ${short.map((d) => `${d} (${dietHave[d]}/${DIET_FLOOR[d]})`).join(', ')}`,
  );
  process.exit(1);
}
if (picked.length < LIMIT) {
  console.error(`Only picked ${picked.length} of ${LIMIT}`);
  process.exit(1);
}

const ids = picked.map((r) => recipeId(r.title)).sort();

writeFileSync(
  outFile,
  `/**
 * GENERATED FILE — do not edit.
 * Produced by scripts/build-free-recipes.mjs from supabase/seed/recipes.json
 *
 * The ${LIMIT} recipes a free account can cook from, chosen to cover every meal
 * slot and every diet style in the library rather than sliced off the front of
 * it. Regenerate after changing the library:
 *
 *   npm run seed:free -w @daylish/mobile
 */

export const FREE_RECIPE_IDS: ReadonlySet<string> = new Set([
${ids.map((id) => `  '${id}',`).join('\n')}
]);
`,
  'utf8',
);

console.log(`Wrote ${ids.length} free recipe ids → ${outFile}`);
console.log('  diets: ' + diets.map((d) => `${d} ${dietHave[d]}`).join(', '));
console.log('  slots: ' + slots.map((s) => `${s} ${slotHave[s]}`).join(', '));
console.log(`  cuisines: ${Object.keys(cuisineHave).length} of 24`);
