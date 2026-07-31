#!/usr/bin/env node
/**
 * Emit one self-contained prompt file per outsourced batch.
 *
 *   node scripts/build-batch-prompts.mjs
 *
 * Each file is paste-and-go: the whole spec plus a unique assignment. They are
 * generated rather than hand-written for two reasons.
 *
 * The first is that a spec fix should be one command, not twenty-eight edits.
 * `docs/outsourced-recipe-prompt.md` is the single source; everything under
 * `docs/batches/` is derived and safe to delete.
 *
 * The second is collisions. Batches are written independently by something with
 * no memory of the other batches, so "write five dishes we don't have" would
 * produce the same obvious five every time. Assigning each batch a distinct
 * slice of cuisine × slot makes overlap structurally unlikely instead of
 * relying on a don't-repeat list that is already stale by batch three.
 *
 * Allocation is deficit-driven off the weights in `src/taxonomy.ts`: whatever
 * the library is furthest short of gets assigned first. Re-running after an
 * import re-plans against the new coverage.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const specPath = join(repoRoot, 'docs', 'outsourced-recipe-prompt.md');
const seedPath = join(repoRoot, 'supabase', 'seed', 'recipes.json');
const outDir = join(repoRoot, 'docs', 'batches');

/** Distinct titles we are aiming for. 500 recipes ÷ 3 sizes. */
const TARGET_TITLES = 167;
const DISHES_PER_BATCH = 5;

// Mirrors src/taxonomy.ts. Kept as plain data so this script has no TS imports.
const CUISINE_WEIGHTS = {
  italian: 8, indian: 7, mexican: 6, japanese: 5, thai: 5, chinese: 5, french: 5,
  greek: 5, spanish: 4, turkish: 4, middle_eastern: 4, vietnamese: 4, korean: 4,
  american: 4, british: 4, north_african: 3, german: 3, polish: 2,
  scandinavian: 2, caribbean: 2, brazilian: 2, peruvian: 2, west_african: 2,
  ethiopian: 2,
};
const SLOT_WEIGHTS = { dinner: 40, lunch: 28, breakfast: 20, snack: 12 };
const DIET_WEIGHTS = {
  balanced: 40, high_protein: 14, vegetarian: 14, vegan: 10, mediterranean: 8,
  gluten_free: 5, keto: 4, pescatarian: 3, dairy_free: 2,
};

/**
 * Diets that only make sense in some kitchens.
 *
 * Cuisine and diet were allocated independently at first, which produced briefs
 * like "a german dish suitable for a mediterranean diet" — a contradiction, and
 * one that forces whoever writes it either to ignore the assignment or to
 * invent something nobody eats. Mediterranean is a regional eating pattern, not
 * a filter; keto against a cuisine defined by rice or injera means abandoning
 * the cuisine. Anything absent from this map pairs with everything.
 */
const DIET_FITS = {
  mediterranean: new Set([
    'italian', 'greek', 'spanish', 'turkish', 'middle_eastern', 'north_african', 'french',
  ]),
  keto: new Set([
    'american', 'british', 'french', 'german', 'greek', 'italian', 'korean',
    'mexican', 'middle_eastern', 'polish', 'scandinavian', 'spanish', 'turkish',
  ]),
};

const dietFitsCuisine = (diet, cuisine) => !DIET_FITS[diet] || DIET_FITS[diet].has(cuisine);

/** Deficit against a weighted target, largest first, as a flat list of picks. */
function allocate(weights, current, total) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const picks = [];
  for (const [key, weight] of Object.entries(weights)) {
    const target = Math.round((weight / sum) * total);
    const deficit = Math.max(0, target - (current[key] ?? 0));
    for (let i = 0; i < deficit; i += 1) picks.push(key);
  }
  // Interleave so consecutive batches are not all the same cuisine.
  picks.sort((a, b) => (current[a] ?? 0) - (current[b] ?? 0) || a.localeCompare(b));
  const spread = [];
  const byKey = new Map();
  for (const p of picks) byKey.set(p, (byKey.get(p) ?? 0) + 1);
  while (byKey.size > 0) {
    for (const key of [...byKey.keys()]) {
      spread.push(key);
      const left = byKey.get(key) - 1;
      if (left === 0) byKey.delete(key);
      else byKey.set(key, left);
    }
  }
  return spread;
}

const recipes = JSON.parse(readFileSync(seedPath, 'utf8'));
const titles = [...new Set(recipes.map((r) => r.title.replace(/,\s*(light|hearty)$/, '')))];

// Coverage is counted in distinct titles, not recipes: three size variants of
// one dish are one dish's worth of coverage, not three.
const seenTitle = new Set();
const cuisineCount = {};
const slotCount = {};
for (const r of recipes) {
  const base = r.title.replace(/,\s*(light|hearty)$/, '');
  if (seenTitle.has(base)) continue;
  seenTitle.add(base);
  cuisineCount[r.cuisine] = (cuisineCount[r.cuisine] ?? 0) + 1;
  for (const s of r.mealSlots) slotCount[s] = (slotCount[s] ?? 0) + 1;
}

const needed = Math.max(0, TARGET_TITLES - titles.length);
const batches = Math.ceil(needed / DISHES_PER_BATCH);
const slots = needed === 0 ? 0 : batches * DISHES_PER_BATCH;

const cuisinePicks = allocate(CUISINE_WEIGHTS, cuisineCount, TARGET_TITLES);
const slotPicks = allocate(SLOT_WEIGHTS, slotCount, TARGET_TITLES);
const dietPicks = allocate(DIET_WEIGHTS, {}, slots);

const spec = readFileSync(specPath, 'utf8');
const covered = titles.sort().join(' · ');
const specWithCovered = spec.replace(
  /(## Already covered — do not write these dishes again\n\n)[\s\S]*?(?=\n## )/,
  `$1${covered}\n`,
);

// Clear only what this script wrote. An earlier version removed the whole
// directory, which deleted a file the user had put there by hand — the output
// of a completed run, sitting next to the prompts that produced it. Generated
// files are `batch-NN.md` and `README.md`; everything else in here is somebody
// else's and is left alone.
mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(outDir)) {
  if (/^batch-\d+\.md$/.test(name) || name === 'README.md') rmSync(join(outDir, name));
}

// Consumed in order, but a diet that cannot honestly be met by the assigned
// cuisine is skipped rather than forced — it drops to the back of the queue for
// a kitchen that can carry it.
const dietQueue = [...dietPicks];
function takeDiet(cuisine) {
  const at = dietQueue.findIndex((d) => dietFitsCuisine(d, cuisine));
  if (at === -1) return 'balanced';
  return dietQueue.splice(at, 1)[0];
}

for (let b = 0; b < batches; b += 1) {
  const lines = [];
  for (let d = 0; d < DISHES_PER_BATCH; d += 1) {
    const i = b * DISHES_PER_BATCH + d;
    const cuisine = cuisinePicks[i % cuisinePicks.length] ?? 'italian';
    const slot = slotPicks[i % slotPicks.length] ?? 'dinner';
    const diet = takeDiet(cuisine);
    const dietText = diet === 'balanced' ? 'no dietary restriction' : `genuinely suitable for a ${diet.replace(/_/g, ' ')} diet`;
    const label = cuisine.replace(/_/g, ' ');
    const article = /^[aeiou]/.test(label) ? 'An' : 'A';
    lines.push(`${d + 1}. ${article} **${label}** dish for **${slot}** — ${dietText}.`);
  }
  const assignment = [
    'Write five dishes to this brief. Each line is one dish:',
    '',
    ...lines,
    '',
    'The diet requirement must be *true*, not aspirational — tag it in `dietStyles`',
    'and make the ingredients actually satisfy it.',
  ].join('\n');

  const n = String(b + 1).padStart(2, '0');
  writeFileSync(join(outDir, `batch-${n}.md`), specWithCovered.replace('__ASSIGNMENT__', assignment));
}

const index = [
  '# Outsourced recipe batches',
  '',
  `Generated by \`services/recipe-pipeline/scripts/build-batch-prompts.mjs\`.`,
  'Do not edit these by hand — edit `docs/outsourced-recipe-prompt.md` and re-run.',
  '',
  `Library at generation time: **${titles.length} distinct titles**, target **${TARGET_TITLES}**.`,
  `**${batches} batches** of ${DISHES_PER_BATCH} dishes (${slots} dishes, ${slots * 3} recipe objects).`,
  '',
  '## How to use one',
  '',
  '1. Paste the whole of `batch-NN.md` into the AI. Nothing else — it is self-contained.',
  '2. Save the JSON it returns to `recipes/NN-batch-NN.json` in this repo.',
  '3. When you have a few, import and check:',
  '',
  '```sh',
  'npm run pipeline -- --import recipes/',
  'cat supabase/seed/rejected.json          # anything that failed, and why',
  'npm run seed:recipes -w @daylish/mobile  # rebuild the app bundle',
  '```',
  '',
  'Rejections are safe — the recipe is skipped, nothing else is affected. Fix the',
  'named ingredient and re-import.',
  '',
  '## Checking what came back',
  '',
  'The validator catches unresolvable ingredients. It does **not** catch an',
  'ingredient that resolved confidently to the wrong food, which is the failure',
  'that actually reaches users. To check a suspicious name:',
  '',
  '```sh',
  'cd services/recipe-pipeline',
  'node --env-file-if-exists=../../.env --experimental-strip-types \\',
  '  scripts/probe-names.ts "<name>"',
  '```',
  '',
  '## Re-planning',
  '',
  'Re-run the generator after importing. It reads current coverage and re-plans the',
  'remaining batches against it, so finished work drops out of the assignments.',
  '',
  '## Batches',
  '',
  ...Array.from({ length: batches }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    const cs = Array.from({ length: DISHES_PER_BATCH }, (_, d) =>
      (cuisinePicks[(i * DISHES_PER_BATCH + d) % cuisinePicks.length] ?? 'italian').replace(/_/g, ' '),
    );
    return `- [batch-${n}.md](batch-${n}.md) — ${[...new Set(cs)].join(', ')}`;
  }),
].join('\n');

writeFileSync(join(outDir, 'README.md'), `${index}\n`);

console.log(`${titles.length} titles now, target ${TARGET_TITLES}, ${needed} to go.`);
console.log(`Wrote ${readdirSync(outDir).length} files → docs/batches/`);
