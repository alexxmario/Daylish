#!/usr/bin/env node
/**
 * One image prompt per dish, built from that dish's actual ingredients.
 *
 *   node scripts/build-image-prompts.mjs
 *
 * Writes `docs/image-prompts.md` (copy-paste) and `docs/image-prompts.jsonl`
 * (one row per dish, for feeding an API).
 *
 * The prompts are generated rather than written by hand for one reason: the
 * picture has to match what the person will actually cook. A generic "delicious
 * Thai green curry" prompt produces a bowl with a chilli-and-lime-leaf garnish
 * the recipe never mentions, and the cook ends up comparing their pan to a
 * photograph of a different dish. So every visible element is derived from the
 * ingredient list, and — just as important — anything a food photographer would
 * *reflexively* add but the recipe does not contain is named in the negatives.
 *
 * One prompt per dish, not per recipe: light/standard/hearty share a photograph,
 * and the standard version is what it shows.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** Things that sit on top and read as garnish rather than substance. */
const GARNISH = new Set([
  'cilantro', 'basil', 'dill weed', 'thyme', 'parsley', 'mint', 'spring onions',
  'sesame seeds', 'pine nuts', 'cashew nuts', 'chia seeds', 'lime', 'lemon',
  'paprika', 'sour cream', 'greek yogurt', 'chili', 'scallions',
  // Grated over at the end, and usually under the 40 g body threshold — which
  // is how a bolognese finished with parmesan came out described as "no
  // garnish".
  'parmesan cheese', 'feta cheese',
]);

/**
 * Dairy and coconut that is cooked *into* a sauce. Not an object in the frame —
 * listing it as one invites a splash of milk poured over the finished dish —
 * but it decides whether the sauce reads creamy or thin, so it is worth saying.
 */
const ENRICHMENT = new Set(['whole milk', 'heavy cream', 'coconut milk', 'sour cream']);

/**
 * Aromatics and seasoning that dissolve into the dish. Genuinely invisible, so
 * these are the only things allowed to fall out of the prompt unmentioned.
 */
const SEASONING = new Set([
  'garlic', 'ginger', 'salt', 'cumin', 'cinnamon', 'paprika', 'turmeric',
  'allspice', 'cayenne pepper', 'star anise', 'thyme', 'brown sugar', 'vinegar',
  'olive oil', 'vegetable oil', 'sesame oil', 'butter', 'soy sauce',
  'fish sauce', 'sauce, fish, ready-to-serve', 'lemon juice', 'rice wine',
  'green curry paste', 'tomato paste', 'hot sauce', 'water, tap',
]);

/** The starch or bread that the rest of the dish sits on or beside. */
const BASE = new Set([
  'white rice', 'brown rice', 'rice noodles', 'spaghetti', 'couscous', 'quinoa',
  'bulgur', 'potato', 'sweet potato', 'bread', 'pita bread', 'tortilla',
  'rolled oats', 'wheat flour', 'chickpea flour', 'tapioca flour', 'plantain',
]);

/**
 * Cooking liquids. Invisible as objects — they are the medium the dish sits in,
 * and naming them as components produced "Main: chicken stock" for a pho whose
 * main is obviously the chicken. Milks and creams are deliberately *not* here:
 * they change what the sauce looks like, so they stay in the visible list.
 */
const LIQUID = /\b(stock|broth)\b|^water/;

const PROTEIN = /beef|chicken|pork|lamb|salmon|cod|shrimp|fish|eggs?$|tofu|beans|lentils|chickpeas|cowpeas|paneer|halloumi|cheese/i;

/** Vessels that hold one person's share; anything else shows the whole dish. */
const SINGLE_SERVE = /bowl|plate/;

/** What a food photographer adds by reflex. Named as a negative when absent. */
const REFLEX_GARNISHES = [
  ['cilantro', 'chopped coriander/cilantro'],
  ['basil', 'basil leaves'],
  ['parsley', 'chopped parsley'],
  ['lime', 'a lime wedge'],
  ['lemon', 'a lemon wedge'],
  ['sour cream', 'a swirl of cream or yoghurt'],
  ['sesame seeds', 'a scatter of sesame seeds'],
  ['parmesan cheese', 'grated cheese'],
  ['spring onions', 'sliced spring onion'],
];

const clean = (name) => name.replace(/,.*$/, '').trim();

/**
 * How much of the plate a thing takes up, in words.
 *
 * Listing ingredients without proportion produced a yoghurt bowl buried under
 * walnuts: the recipe has 10 g of walnuts against 250 g of yoghurt, but to a
 * generator both were just nouns on a list. A cook comparing their bowl to that
 * photo would think they had done it wrong.
 */
function share(grams, total) {
  const pct = grams / total;
  if (pct >= 0.3) return 'the bulk of the dish';
  if (pct >= 0.15) return 'a generous amount';
  if (pct >= 0.06) return 'a moderate amount';
  if (pct >= 0.02) return 'a small amount';
  return 'a light scattering, barely there';
}

const withShare = (i, total) => `${clean(i.name)} (${share(i.grams, total)})`;

function vessel(recipe) {
  const t = recipe.title.toLowerCase();
  const eq = recipe.equipment;
  if (/soup|stew|broth|pho|dal|chowder|porridge|congee|ful/.test(t)) return 'a wide shallow ceramic bowl, slightly off-centre in frame';
  if (/curry|chilli|chili|ragu|braise/.test(t)) return 'a deep ceramic bowl with the sauce pooling at the edge';
  if (/bowl/.test(t)) return 'a broad low bowl, the components in loose sections rather than neat wedges';
  if (/traybake|roast|bake|gratin/.test(t)) return 'the battered metal roasting tin it was cooked in, straight from the oven';
  if (/skillet|frittata|omelette|hash/.test(t)) return 'a well-used cast-iron skillet, the handle running out of frame';
  if (/salad|plate|platter|mezze|wrap|sandwich|toast/.test(t)) return 'a plain matte ceramic plate, food placed rather than arranged';
  if (/pasta|spaghetti|noodle/.test(t)) return 'a shallow pasta bowl, the strands twisted into a loose nest';
  if (eq.includes('oven') && !eq.includes('stovetop')) return 'the dish it was baked in, edges slightly caught';
  return 'a plain matte ceramic plate, food placed rather than arranged';
}

function angle(recipe) {
  const t = recipe.title.toLowerCase();
  if (/soup|stew|broth|pho|dal|porridge|congee|bowl|curry|chilli|chili/.test(t)) {
    return 'directly overhead, the rim of the bowl complete in frame';
  }
  if (/sandwich|wrap|burger|stack|toast|pancake|roll|pie/.test(t)) {
    return 'close to eye level, so the layers are readable';
  }
  if (/traybake|roast|bake|skillet|salad|platter|mezze/.test(t)) {
    return 'directly overhead, filling most of the frame';
  }
  return 'a three-quarter view from about 40 degrees above the table';
}

/** Fold light/standard/hearty into one entry, keyed on the standard title. */
const recipes = JSON.parse(readFileSync(join(repoRoot, 'supabase', 'seed', 'recipes.json'), 'utf8'));
const dishes = recipes.filter((r) => !/, (light|hearty)$/.test(r.title));

const rows = dishes.map((r) => {
  const byWeight = [...r.ingredients].sort((a, b) => b.grams - a.grams);
  const names = new Set(r.ingredients.map((i) => i.name));

  // Solid weight only — the stock in a soup would otherwise swamp every share.
  const solid = byWeight
    .filter((i) => !LIQUID.test(i.name) && !SEASONING.has(i.name))
    .reduce((s, i) => s + i.grams, 0) || 1;

  // Garnish is a role, not a name. Greek yoghurt spooned onto Turkish eggs is a
  // garnish; the same yoghurt at 43% of a breakfast bowl is the base of it.
  const isGarnish = (i) => GARNISH.has(i.name) && i.grams / solid < 0.1;

  const garnish = byWeight.filter(isGarnish).map((i) => withShare(i, solid));
  const base = byWeight.filter((i) => BASE.has(i.name)).map((i) => withShare(i, solid));
  const liquid = byWeight.filter((i) => LIQUID.test(i.name));
  const protein = byWeight.find(
    (i) => PROTEIN.test(i.name) && !isGarnish(i) && !LIQUID.test(i.name),
  );
  const enrich = byWeight.filter((i) => ENRICHMENT.has(i.name) && !isGarnish(i));
  const body = byWeight
    .filter(
      (i) =>
        !isGarnish(i) &&
        !BASE.has(i.name) &&
        !LIQUID.test(i.name) &&
        !ENRICHMENT.has(i.name) &&
        i.name !== protein?.name &&
        i.grams >= 40,
    )
    .slice(0, 6)
    .map((i) => withShare(i, solid));

  // Anything left over that is neither seasoning nor already placed. Without
  // this a peanut butter porridge came out described as having no topping,
  // because the peanut butter was 32 g and the body threshold is 40.
  const placed = new Set([...base, ...body, ...garnish].map((n) => n.replace(/ \(.*$/, '')));
  const rest = byWeight
    .filter(
      (i) =>
        !SEASONING.has(i.name) &&
        !LIQUID.test(i.name) &&
        !ENRICHMENT.has(i.name) &&
        i.name !== protein?.name &&
        !placed.has(clean(i.name)),
    )
    .map((i) => withShare(i, solid));

  const absent = REFLEX_GARNISHES.filter(([k]) => !names.has(k)).map(([, label]) => label);

  const holder = vessel(r);
  const portion = r.servings === 1 || SINGLE_SERVE.test(holder)
    ? 'one person\'s serving — the amount someone actually eats, not a banquet'
    : `the whole dish, enough for ${r.servings}`;

  const prompt = [
    `Photograph of ${r.title.toLowerCase()}, a ${r.cuisine.replace(/_/g, ' ')} dish. ${r.summary}`,
    '',
    `What is in the frame, and nothing else:`,
    base.length ? `- Base: ${base.join(', ')}` : null,
    protein ? `- Main: ${withShare(protein, solid)}` : null,
    body.length ? `- Through the dish: ${body.join(', ')}` : null,
    liquid.length ? `- The liquid is ${clean(liquid[0].name)} — a medium, not a visible ingredient` : null,
    enrich.length ? `- Enriched with ${enrich.map((i) => clean(i.name)).join(' and ')}, cooked in: the dish reads creamy and opaque rather than thin. Do not show it as a separate pour or swirl` : null,
    rest.length ? `- Also present, in smaller amounts: ${rest.join(', ')}` : null,
    garnish.length
      ? `- Finished with: ${garnish.join(', ')} — sparse and uneven, the way a cook scatters it, not placed`
      : rest.length
        ? null // something is on top, it just isn't a herb — the line above covers it
        : '- No garnish. The dish is finished plain.',
    `- Portion: ${portion}`,
    '',
    `Served in ${holder}. On a worn wooden or plain linen surface. Camera ${angle(r)}.`,
    '',
    'Shot like a real photograph, not a food advertisement: full-frame camera, 50mm lens at f/2.8, one soft window light from the left with a gentle falloff into shadow on the right, no flash, no reflector filling the shadows. Natural colour — the food is the colour cooking makes it, slightly uneven browning, sauce that has separated a little at the edge. Visible texture and steam where the dish is hot. A smear on the rim, a crumb or a drip on the surface, one component sitting slightly askew.',
    '',
    `Avoid: text, watermark, hands, cutlery arranged symmetrically, restaurant plating, tweezered placement, microgreens, edible flowers, chilli flakes, glossy styling varnish, oversaturated colour, steam that looks added afterwards${absent.length ? `, ${absent.join(', ')}` : ''}. Do not add any ingredient not listed above — the cook will compare their pan to this picture.`,
  ].filter((l) => l !== null).join('\n');

  return { title: r.title, cuisine: r.cuisine, servings: r.servings, prompt };
});

const md = [
  '# Dish image prompts',
  '',
  'Generated by `services/recipe-pipeline/scripts/build-image-prompts.mjs` from',
  '`supabase/seed/recipes.json`. Do not edit by hand — edit the script and re-run.',
  '',
  `**${rows.length} dishes**, one prompt each. Light, standard and hearty share a`,
  'photograph; the prompt describes the standard version.',
  '',
  'Every visible element is taken from that dish\'s ingredient list, and anything a',
  'food photographer would reflexively add but the recipe does not contain is named',
  'in the avoid-list. That is what keeps the photo honest against the pan.',
  '',
  '---',
  '',
  ...rows.flatMap((r) => [
    `## ${r.title}`,
    '',
    '```',
    r.prompt,
    '```',
    '',
  ]),
].join('\n');

writeFileSync(join(repoRoot, 'docs', 'image-prompts.md'), md);
writeFileSync(
  join(repoRoot, 'docs', 'image-prompts.jsonl'),
  `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
);

console.log(`${rows.length} prompts → docs/image-prompts.md and .jsonl`);
