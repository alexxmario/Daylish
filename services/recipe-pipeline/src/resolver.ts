/**
 * Ingredient resolution: name → USDA FoodData Central entry → nutrient vector.
 *
 * This is the component that makes the "never trust the LLM's calories" rule
 * real. Everything nutritional in a Daylish recipe originates here.
 *
 * The resolver is deliberately conservative. An ingredient it cannot match with
 * confidence fails, and a recipe with any failed ingredient is rejected rather
 * than published with a hole in its macros. Silently treating an unmatched
 * ingredient as zero calories is precisely how competitors end up with recipes
 * claiming a carbonara is 300 kcal.
 */

import {
  NUTRIENT_BY_USDA_NUMBER,
  type NutrientVector,
} from '@daylish/core';

/**
 * A nutrient entry as USDA returns it.
 *
 * The two endpoints disagree on shape, and the difference is easy to miss
 * because both parse without error:
 *   - `/foods/search`      → flat   `{ nutrientNumber: "208", value: 149 }`
 *   - `/food/{fdcId}`      → nested `{ nutrient: { number: "208" }, amount: 149 }`
 *
 * Reading only the nested form against the search endpoint yields an empty
 * nutrient vector for every food — no exception, just silently zero nutrition.
 * Both forms are therefore accepted.
 */
export interface UsdaNutrientEntry {
  nutrientNumber?: string;
  value?: number;
  nutrient?: { number?: string };
  amount?: number;
}

export interface UsdaFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients: UsdaNutrientEntry[];
}

export interface ResolvedIngredient {
  name: string;
  grams: number;
  fdcId: number;
  matchedDescription: string;
  dataType: string;
  /** 0–1, from match quality and data provenance. */
  confidence: number;
  per100g: NutrientVector;
}

export interface UnresolvedIngredient {
  name: string;
  grams: number;
  reason: string;
}

/**
 * Aliases from cooking language to database language.
 *
 * USDA descriptions are written for nutritionists, not cooks, so a direct
 * search for "spring onion" or "aubergine" misses. This map covers the common
 * British/American splits and the terms a recipe writer naturally reaches for.
 * It is checked before the search and is the cheapest accuracy win available.
 */
const ALIASES: Readonly<Record<string, string>> = {
  // Pasta shapes. A bare "spaghetti" search returns spaghetti *sauce* and
  // restaurant meals — verified against the live API — so the shapes must be
  // routed to the dry-pasta entry explicitly.
  spaghetti: 'pasta, dry, enriched',
  penne: 'pasta, dry, enriched',
  fusilli: 'pasta, dry, enriched',
  linguine: 'pasta, dry, enriched',
  tagliatelle: 'pasta, dry, enriched',
  macaroni: 'pasta, dry, enriched',
  rigatoni: 'pasta, dry, enriched',
  farfalle: 'pasta, dry, enriched',
  pasta: 'pasta, dry, enriched',

  // "chicken breast" alone surfaces lunchmeat and breaded tenders first.
  'chicken breast': 'chicken, broilers or fryers, breast, meat only, raw',
  'chicken breasts': 'chicken, broilers or fryers, breast, meat only, raw',
  'chicken thigh': 'chicken, broilers or fryers, thigh, meat only, raw',
  'chicken thighs': 'chicken, broilers or fryers, thigh, meat only, raw',

  'spring onion': 'onions, spring or scallions',
  'spring onions': 'onions, spring or scallions',
  coriander: 'coriander (cilantro) leaves',
  'fresh coriander': 'coriander (cilantro) leaves',
  rocket: 'arugula',
  'plain flour': 'wheat flour, white, all-purpose',
  'all-purpose flour': 'wheat flour, white, all-purpose',
  'self-raising flour': 'wheat flour, white, all-purpose, self-rising',
  'caster sugar': 'sugars, granulated',
  'icing sugar': 'sugars, powdered',
  'double cream': 'cream, heavy whipping',
  'heavy cream': 'cream, heavy whipping',
  'single cream': 'cream, light',
  'natural yoghurt': 'yogurt, plain, whole milk',
  'greek yoghurt': 'yogurt, greek, plain, whole milk',
  'greek yogurt': 'yogurt, greek, plain, whole milk',
  'tinned tomatoes': 'tomatoes, canned',
  'chopped tomatoes': 'tomatoes, canned',
  'tomato puree': 'tomato products, canned, paste',
  'tomato paste': 'tomato products, canned, paste',
  'chickpeas': 'chickpeas (garbanzo beans), mature seeds, canned',
  'mangetout': 'peas, edible-podded',
  'chilli': 'peppers, hot chili',
  'chili': 'peppers, hot chili',
  'chilli flakes': 'spices, pepper, red or cayenne',
  'stock': 'soup, stock, chicken, home-prepared',
  'chicken stock': 'soup, stock, chicken, home-prepared',
  'vegetable stock': 'soup, stock, vegetable',
  'streaky bacon': 'pork, cured, bacon',
  'minced beef': 'beef, ground',
  'beef mince': 'beef, ground',
  'prawns': 'crustaceans, shrimp',
  'king prawns': 'crustaceans, shrimp',

  // Staples where the head noun alone still leaves a coin flip. USDA carries
  // dozens of entries whose first token is "milk" or "bread", and picking the
  // wrong one is a silent 2× error rather than a rejection. Naming the ordinary
  // form here is the difference between "verified" meaning something and not.
  milk: 'milk, whole',
  'whole milk': 'milk, whole',
  'semi-skimmed milk': 'milk, reduced fat, fluid, 2% milkfat',
  'skimmed milk': 'milk, nonfat, fluid',
  'skim milk': 'milk, nonfat, fluid',
  egg: 'egg, whole, raw, fresh',
  eggs: 'egg, whole, raw, fresh',
  bread: 'bread, white, commercially prepared',
  'white bread': 'bread, white, commercially prepared',
  'wholemeal bread': 'bread, whole-wheat, commercially prepared',
  'whole wheat bread': 'bread, whole-wheat, commercially prepared',
  'rolled oats': 'oats, raw',
  oats: 'oats, raw',
  'porridge oats': 'oats, raw',
  'red bell pepper': 'peppers, sweet, red, raw',
  'green bell pepper': 'peppers, sweet, green, raw',
  'bell pepper': 'peppers, sweet, red, raw',
  granola: 'cereals ready-to-eat, granola, homemade',
  'olive oil': 'oil, olive, salad or cooking',
  spinach: 'spinach, raw',
  onion: 'onions, raw',
  onions: 'onions, raw',
  banana: 'bananas, raw',
  bananas: 'bananas, raw',
  'red pepper flakes': 'spices, pepper, red or cayenne',
  'crushed red pepper': 'spices, pepper, red or cayenne',
  'black pepper': 'spices, pepper, black',
  'ground black pepper': 'spices, pepper, black',
  walnuts: 'nuts, walnuts, english',
  walnut: 'nuts, walnuts, english',

  // English names whose head noun is the *last* word, where USDA's is the first.
  // "Butter beans" are lima beans; matched on the head alone it resolves to
  // clarified butter, an eleven-fold error in calories.
  'butter beans': 'beans, lima, large, mature seeds, canned',
  butterbeans: 'beans, lima, large, mature seeds, canned',
  courgette: 'squash, summer, zucchini, includes skin, raw',
  courgettes: 'squash, summer, zucchini, includes skin, raw',
  zucchini: 'squash, summer, zucchini, includes skin, raw',
  aubergine: 'eggplant, raw',

  // Staples with dozens of near-identical USDA entries, where the plain one is
  // meant and a variety or preparation would otherwise win on a coin flip.
  potato: 'potatoes, flesh and skin, raw',
  potatoes: 'potatoes, flesh and skin, raw',
  'white rice': 'rice, white, long-grain, regular, raw, unenriched',
  rice: 'rice, white, long-grain, regular, raw, unenriched',
  'brown rice': 'rice, brown, long-grain, raw',

  // Plant staples. USDA files an edible leaf, a wild variety and a cultured
  // product under heads that look right — "sweet potato" resolves to the plant's
  // leaves, "mushrooms" to chanterelles, "tofu" to tofu yoghurt.
  tofu: 'tofu, raw, firm, prepared with calcium sulfate',
  'firm tofu': 'tofu, raw, firm, prepared with calcium sulfate',
  'silken tofu': 'tofu, silken, soft',
  'sweet potato': 'sweet potato, raw, unprepared',
  'sweet potatoes': 'sweet potato, raw, unprepared',
  mushrooms: 'mushrooms, white, raw',
  mushroom: 'mushrooms, white, raw',
  'coconut yogurt': 'yogurt, coconut milk',
  'coconut yoghurt': 'yogurt, coconut milk',
};

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z, -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The head noun — everything before the first comma. */
function headTerm(name: string): string {
  const normalised = normalise(name);
  const head = normalised.split(',')[0]?.trim() ?? normalised;
  return ALIASES[head] ?? ALIASES[normalised] ?? normalised;
}

export function toNutrientVector(food: UsdaFood): NutrientVector {
  const out: NutrientVector = {};
  for (const entry of food.foodNutrients) {
    // Accept both endpoint shapes — see `UsdaNutrientEntry`.
    const number = entry.nutrientNumber ?? entry.nutrient?.number;
    const amount = entry.value ?? entry.amount;
    if (!number || typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    const key = NUTRIENT_BY_USDA_NUMBER[number];
    if (key) out[key] = amount;
  }
  return out;
}

/**
 * USDA qualifiers that describe the *default* form of a food rather than a
 * variant of it. "Spinach, raw" is what someone means by spinach; "Spinach
 * souffle" is not. Tokens in this set are not counted against a candidate.
 */
const NEUTRAL_QUALIFIERS = new Set([
  'raw', 'fresh', 'whole', 'plain', 'unprepared', 'uncooked', 'regular', 'all',
  'commercially', 'unenriched', 'unsalted', 'unsweetened', 'natural',
]);

/** Grammatical filler in USDA descriptions. Neither signal nor noise. */
const STOPWORDS = new Set(['and', 'or', 'with', 'without', 'in', 'of', 'the', 'a', 'to']);

/**
 * USDA shelves many foods under a category first — "Spices, cinnamon, ground",
 * "Nuts, walnuts, english", "Cereals ready-to-eat, granola". The real head noun
 * is the token after the category, and nobody writes "spices" in a recipe, so
 * these are skipped when finding the head and are free of noise penalty.
 */
const CATEGORY_HEADS = new Set([
  'spice', 'herb', 'nut', 'seed', 'cereal', 'beverage', 'snack', 'soup', 'sauce',
  'fish', 'crustacean', 'mollusc', 'mollusk', 'babyfood', 'candie', 'candy',
  'fast', 'restaurant', 'leavening', 'vegetable', 'fruit',
]);

/**
 * Tokens that mean the entry is a *different food made from* the one asked for.
 * Walnut oil is not walnuts; onion powder is not an onion. Penalised far harder
 * than ordinary description noise — and only when the query did not ask for
 * them, so "tomatoes, canned" still matches a canned tomato.
 */
const TRANSFORMING = new Set([
  'oil', 'powder', 'juice', 'sauce', 'paste', 'flour', 'bran', 'souffle',
  'cracker', 'chip', 'bar', 'drink', 'pie', 'cake', 'salad', 'sandwich',
  'pizza', 'extract', 'syrup', 'candied', 'breaded', 'fried', 'sweetened',
  'pancake', 'pickled', 'ghee', 'clarified', 'fritter', 'crisp', 'dip',
  // Cooked states. A recipe's gram weight is the weight of what the cook puts
  // in — dry pasta, raw meat — so a prepared entry is the wrong denominator.
  // Dry couscous is 376 kcal/100 g and cooked is 112: a threefold error that
  // lands well inside the plausibility check and is never seen again.
  'cooked', 'boiled', 'grilled', 'roasted', 'steamed', 'braised', 'baked',
  // Concentrates. "Soup, beef broth, cubed, dry" is a stock cube at 170 kcal
  // per 100 g; the liquid it makes is 13.
  'condensed', 'cubed', 'granule', 'concentrate', 'dehydrated',
  // Analogues. "Bacon, meatless" shares its head noun with bacon and nothing
  // else — and it matched at 0.93 before this line existed.
  'meatless', 'imitation', 'substitute', 'analog', 'analogue',
]);

/**
 * Query tokens that make a "Soup, …" entry the *right* answer.
 *
 * USDA files stocks and broths under `Soup,` — "Soup, stock, beef,
 * home-prepared" is genuinely what a recipe means by beef stock. But it also
 * files actual soups there, and because `soup` sits in `CATEGORY_HEADS` it was
 * skipped when finding the head noun *and* exempt from the noise penalty. That
 * combination scored "Soup, black bean, canned" at 0.93 for `black beans`,
 * "Soup, tortilla" at 0.90 for `tortilla`, and "Soup, rice" at 0.60 for
 * `jasmine rice` — three different foods, each confidently wrong.
 *
 * So `soup` earns its category-head exemption only when the query is asking for
 * something from the same family.
 */
const LIQUID_BASE_QUERY = new Set(['soup', 'stock', 'broth', 'bouillon', 'consomme']);

/**
 * Category words that also name an animal, and so carry real meaning when they
 * appear away from the front of a description. Kept deliberately narrow — see
 * the note at the use site for why `seed` and `nut` are not in here.
 */
const ANIMAL_IDENTITY = new Set(['fish', 'crustacean', 'mollusc', 'mollusk']);

/** Crude but sufficient: USDA pluralises head nouns ("Bananas, raw"), recipes do not. */
function singular(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('oes')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/**
 * Score how well a candidate matches the requested ingredient.
 *
 * **The head noun decides almost everything.** USDA descriptions are written
 * `<food>, <qualifiers…>`, so the first token says what the entry actually *is*.
 * Without checking it, a query for "milk" matches "Crackers, milk" perfectly —
 * every query token is present — and an earlier version of this function scored
 * that 0.9 and used it. Real matches observed before the head-noun rule existed:
 * banana → "Melon, banana", onion → "Spices, onion powder", red bell pepper →
 * "Spices, pepper, red or cayenne", eggs → "…, egg white". Each one produces a
 * confidently wrong calorie figure, which is the one failure this project cannot
 * ship — every number in the app is presented as verified.
 *
 * Beyond that: Foundation and SR Legacy entries are lab-analysed and preferred
 * over Branded ones, which are manufacturer-submitted. Description tokens that
 * were not asked for count against the candidate, so a plain entry beats a
 * heavily qualified one — except for the neutral qualifiers above, which are how
 * USDA spells "the ordinary version of this".
 */
export function scoreMatch(query: string, food: UsdaFood): number {
  const queryTokens = new Set(
    normalise(query).split(/[ ,]+/).filter(Boolean).map(singular),
  );
  const descTokens = normalise(food.description).split(/[ ,]+/).filter(Boolean).map(singular);
  const descSet = new Set(descTokens);

  let overlap = 0;
  for (const token of queryTokens) if (descSet.has(token)) overlap += 1;
  const coverage = queryTokens.size > 0 ? overlap / queryTokens.size : 0;

  let score = coverage * 0.6;

  // The head noun, skipping any category shelf USDA filed it under. Present in
  // the query: this is plausibly the right food. Absent: it is a different food
  // that merely mentions the one asked for.
  const head = descTokens.find((token) => !CATEGORY_HEADS.has(token));

  // …except when the query *named* the category. "fish sauce" against "Sauce,
  // fish, ready-to-serve" skipped both leading tokens and landed the head on
  // "ready", scoring 0.28 — a perfect match rejected because the recipe writes
  // the words in the order a cook would. If every category token the
  // description leads with also appears in the query, that is the head match.
  const leading: string[] = [];
  for (const token of descTokens) {
    if (!CATEGORY_HEADS.has(token)) break;
    leading.push(token);
  }
  const leadingSet = new Set(leading);
  const namedCategory = leading.length > 0 && leading.every((token) => queryTokens.has(token));

  score += (head !== undefined && queryTokens.has(head)) || namedCategory ? 0.2 : -0.45;

  if (food.dataType === 'Foundation') score += 0.25;
  else if (food.dataType === 'SR Legacy') score += 0.2;
  else if (food.dataType === 'Survey (FNDDS)') score += 0.1;

  // Everything the description adds that nobody asked for. This is what
  // separates "Spinach, raw" from "Spinach souffle" — both match on the head.
  // A "Soup, …" entry answers a query for a stock or broth and nothing else.
  const wantsLiquidBase = [...queryTokens].some((token) => LIQUID_BASE_QUERY.has(token));

  let noise = 0;
  let transformed = 0;
  for (const token of descSet) {
    if (queryTokens.has(token) || NEUTRAL_QUALIFIERS.has(token)) continue;
    if (STOPWORDS.has(token)) continue;
    if (token === 'soup' && !wantsLiquidBase) {
      transformed += 1;
      continue;
    }
    // `fish` and friends are category shelves at the front of a description and
    // ordinary content anywhere else. The `fish` in "Soup, stock, fish,
    // home-prepared" is the whole difference between that entry and the
    // vegetable stock someone asked for, and its blanket exemption is how seven
    // recipes tagged vegan came to have their nutrition computed from a fish
    // product. Only the animal words are treated this way: `seed` and `nut`
    // appear mid-description in perfectly ordinary entries ("Beans, black,
    // mature seeds, raw"), and penalising those loses them to novelty matches.
    if (ANIMAL_IDENTITY.has(token) && !leadingSet.has(token)) {
      transformed += 1;
      continue;
    }
    if (CATEGORY_HEADS.has(token)) continue;
    if (TRANSFORMING.has(token)) transformed += 1;
    else noise += 1;
  }
  score -= Math.min(0.3, noise * 0.07);
  score -= Math.min(0.5, transformed * 0.25);

  // An entry that cannot tell us its calories is useless regardless of naming.
  const vector = toNutrientVector(food);
  if (vector.energyKcal === undefined) score -= 0.5;

  return Math.max(0, Math.min(1, score));
}

export interface ResolverOptions {
  apiKey: string;
  /** Below this, an ingredient is treated as unresolved. */
  minConfidence?: number;
  fetchImpl?: typeof fetch;
  /** Retries on 429 / 5xx before giving up on a term. */
  maxRetries?: number;
}

const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/**
 * Look an ingredient up.
 *
 * Results are cached in-process by search term: a 500-recipe run asks about
 * olive oil hundreds of times, and USDA rate-limits by key.
 */
export class IngredientResolver {
  private readonly cache = new Map<string, UsdaFood[]>();
  private readonly minConfidence: number;
  private readonly fetchImpl: typeof fetch;
  // Declared explicitly rather than as a constructor parameter property: Node's
  // type-stripping mode cannot transform those, and the whole pipeline runs
  // under `--experimental-strip-types`.
  private readonly options: ResolverOptions;
  private readonly maxRetries: number;

  constructor(options: ResolverOptions) {
    this.options = options;
    this.minConfidence = options.minConfidence ?? 0.45;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 4;
  }

  /**
   * Search USDA, retrying on rate limits.
   *
   * A 500-recipe run makes thousands of lookups, and USDA throttles by key —
   * `DEMO_KEY` especially, which starts returning 429 within a handful of
   * requests. Without backoff, a run degrades into mass "unresolved" rejections
   * that look like bad recipes but are really just throttling.
   */
  private async search(term: string, attempt = 0): Promise<UsdaFood[]> {
    const cached = this.cache.get(term);
    if (cached) return cached;

    const response = await this.fetchImpl(
      `${USDA_SEARCH}?api_key=${encodeURIComponent(this.options.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: term,
          pageSize: 25,
          dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'],
        }),
      },
    );

    if (response.status === 429 || response.status >= 500) {
      if (attempt < this.maxRetries) {
        const retryAfter = Number(response.headers?.get?.('retry-after') ?? '0');
        const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        await new Promise((done) => setTimeout(done, backoffMs));
        return this.search(term, attempt + 1);
      }
      throw new Error(
        `USDA search for "${term}" still failing after ${this.maxRetries} retries: ${response.status}. ` +
          `If you are using DEMO_KEY, get a free key at https://fdc.nal.usda.gov/api-key-signup.`,
      );
    }

    if (!response.ok) {
      throw new Error(`USDA search failed for "${term}": ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { foods?: UsdaFood[] };
    const foods = body.foods ?? [];
    this.cache.set(term, foods);
    return foods;
  }

  async resolve(
    name: string,
    grams: number,
  ): Promise<ResolvedIngredient | UnresolvedIngredient> {
    const term = headTerm(name);
    if (!term) return { name, grams, reason: 'Ingredient name is empty after normalisation' };

    let candidates: UsdaFood[];
    try {
      candidates = await this.search(term);
    } catch (error) {
      return { name, grams, reason: `Lookup failed: ${String(error)}` };
    }

    if (candidates.length === 0) {
      return { name, grams, reason: `No USDA entry found for "${term}"` };
    }

    let best: UsdaFood | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = scoreMatch(term, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (!best || bestScore < this.minConfidence) {
      return {
        name,
        grams,
        reason: `Best match "${best?.description ?? 'none'}" scored ${bestScore.toFixed(2)}, below the ${this.minConfidence} threshold`,
      };
    }

    const per100g = toNutrientVector(best);
    if (per100g.energyKcal === undefined) {
      return { name, grams, reason: `Matched "${best.description}" but it reports no energy value` };
    }

    return {
      name,
      grams,
      fdcId: best.fdcId,
      matchedDescription: best.description,
      dataType: best.dataType,
      confidence: bestScore,
      per100g,
    };
  }
}

export function isResolved(
  value: ResolvedIngredient | UnresolvedIngredient,
): value is ResolvedIngredient {
  return 'fdcId' in value;
}
