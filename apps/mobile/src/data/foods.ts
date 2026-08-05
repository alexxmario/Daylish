/**
 * Food lookup.
 *
 * Resolution order for a barcode is local cache → Open Food Facts → USDA →
 * user-submitted. The local cache comes first so a rescan of something you eat
 * often resolves with no network at all, which is what makes the sub-five-second
 * cold-start target achievable.
 */

import {
  NUTRIENT_BY_USDA_NUMBER,
  allergensForIngredient,
  checkEnergyConsistency,
  type Allergen,
  type FoodSource,
  type NutrientVector,
} from '@daylish/core';
import { withNutrients } from '@daylish/db';

import { sqlite } from '@/db/client.ts';
import { newId } from '@/lib/ids.ts';
import { USER_AGENT as OFF_USER_AGENT } from '@/lib/links.ts';

export interface ResolvedFood {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: FoodSource;
  confidence: number;
  verified: boolean;
  per100g: NutrientVector;
  portions: { label: string; grams: number; isDefault: boolean }[];
  allergens: Allergen[];
  /** True when this came from the on-device cache, i.e. resolved with no network. */
  fromCache: boolean;
}

// ---------------------------------------------------------------------------
// Open Food Facts
// ---------------------------------------------------------------------------

/**
 * Open Food Facts nutriment keys → our nutrient keys.
 *
 * OFF reports per-100 g under a `_100g` suffix, which is already our storage
 * basis, so no conversion is needed. Energy is taken from `energy-kcal_100g`
 * rather than `energy_100g`, which is kilojoules.
 */
const OFF_NUTRIMENT_MAP: Readonly<Record<string, keyof NutrientVector>> = {
  'energy-kcal_100g': 'energyKcal',
  proteins_100g: 'proteinG',
  carbohydrates_100g: 'carbsG',
  fat_100g: 'fatG',
  fiber_100g: 'fiberG',
  sugars_100g: 'sugarG',
  'saturated-fat_100g': 'satFatG',
  sodium_100g: 'sodiumMg',
  salt_100g: 'sodiumMg',
  calcium_100g: 'calciumMg',
  iron_100g: 'ironMg',
  potassium_100g: 'potassiumMg',
  'vitamin-c_100g': 'vitaminCMg',
};

/** OFF allergen tags are prefixed with a language code, e.g. `en:milk`. */
const OFF_ALLERGEN_MAP: Readonly<Record<string, Allergen>> = {
  gluten: 'gluten',
  milk: 'milk',
  eggs: 'eggs',
  nuts: 'tree_nuts',
  'tree-nuts': 'tree_nuts',
  peanuts: 'peanuts',
  soybeans: 'soybeans',
  fish: 'fish',
  crustaceans: 'crustaceans',
  molluscs: 'molluscs',
  celery: 'celery',
  mustard: 'mustard',
  sesame: 'sesame',
  'sesame-seeds': 'sesame',
  sulphur: 'sulphites',
  'sulphur-dioxide-and-sulphites': 'sulphites',
  lupin: 'lupin',
};

function parseOffNutriments(nutriments: Record<string, unknown>): NutrientVector {
  const out: NutrientVector = {};

  for (const [offKey, ourKey] of Object.entries(OFF_NUTRIMENT_MAP)) {
    const raw = nutriments[offKey];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < 0) continue;

    if (offKey === 'salt_100g') {
      // Only fall back to salt when sodium was not reported directly.
      // Sodium (mg) = salt (g) / 2.5 * 1000.
      if (out.sodiumMg === undefined) out.sodiumMg = (value / 2.5) * 1000;
      continue;
    }
    if (offKey === 'sodium_100g') {
      // OFF reports sodium in grams; we store milligrams.
      out.sodiumMg = value * 1000;
      continue;
    }
    out[ourKey] = value;
  }

  return out;
}

function parseOffAllergens(tags: readonly string[]): Allergen[] {
  const found = new Set<Allergen>();
  for (const tag of tags) {
    const bare = tag.includes(':') ? tag.split(':')[1]! : tag;
    const mapped = OFF_ALLERGEN_MAP[bare];
    if (mapped) found.add(mapped);
  }
  return [...found].sort();
}

/**
 * Confidence for a crowdsourced entry.
 *
 * Open Food Facts is community-edited and its quality genuinely varies, so an
 * OFF record does not get the 1.0 a USDA lab entry gets. Records whose stated
 * calories contradict their own macros are marked down hard — that arithmetic
 * check is the cheapest signal we have that a label was mistyped.
 */
function scoreOffConfidence(per100g: NutrientVector, hasName: boolean): number {
  let score = 0.85;
  if (!hasName) score -= 0.2;

  const macrosPresent = ['proteinG', 'carbsG', 'fatG'].filter(
    (k) => per100g[k as keyof NutrientVector] !== undefined,
  ).length;
  score -= (3 - macrosPresent) * 0.1;

  const energy = checkEnergyConsistency(per100g);
  if (!energy.consistent) score -= 0.3;

  return Math.max(0.1, Math.min(1, score));
}

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

/**
 * Full-text product search.
 *
 * `/api/v2/search` is not one of the options: its `product_name` parameter is a
 * substring filter with no relevance ranking, and searching it for "greek
 * yogurt" returns bottled water. Of the two endpoints that do rank, these are
 * not interchangeable either.
 *
 * `search.openfoodfacts.org` (Search-a-licious) is the purpose-built search
 * service: Elasticsearch-backed, fast, and relevance-ranked. `cgi/search.pl` is
 * the legacy Perl CGI it replaced — it answers 503 with an HTML error page under
 * ordinary load. Measured over five everyday queries, the legacy endpoint
 * returned results for one; Search-a-licious returned results for all five.
 * The old one is kept only as a fallback for when the new one is down.
 */
const OFF_SEARCH_ENDPOINT = 'https://search.openfoodfacts.org/search';
const OFF_SEARCH_FALLBACK = 'https://world.openfoodfacts.org/cgi/search.pl';

/**
 * Open Food Facts asks that clients identify themselves. The string is built in
 * `lib/links.ts` from the real app version, because the one that used to sit
 * here said `0.1` and pointed at a domain that does not serve this app.
 */
const USER_AGENT = OFF_USER_AGENT;

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('json');
}

/**
 * Fields are requested explicitly. OFF product documents can exceed 100 kB with
 * every field included, which is a real cost on mobile data mid-scan.
 */
const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'brands',
  'serving_quantity',
  'serving_size',
  'allergens_tags',
  'ingredients_text',
  'ingredients_text_en',
  'nutriments',
].join(',');

/**
 * The brand, from either shape Open Food Facts uses.
 *
 * The product and legacy-search endpoints return `brands` as a comma-separated
 * string; Search-a-licious returns it as an array. Calling `.split` on the array
 * form throws, which would take out the whole result list.
 */
function firstBrand(brands: unknown): string | null {
  const first = Array.isArray(brands) ? brands[0] : String(brands ?? '').split(',')[0];
  return typeof first === 'string' && first.trim().length > 0 ? first.trim() : null;
}

/**
 * Turn one Open Food Facts product document into a `ResolvedFood`.
 *
 * Shared by the barcode lookup and the text search so both apply the same
 * nutrient conversions, the same allergen recovery and the same confidence
 * scoring — two code paths here would eventually disagree about the same product.
 */
function offProductToFood(
  product: Record<string, unknown>,
  barcode: string | null,
): ResolvedFood | null {
  const name =
    (product.product_name_en as string | undefined) ||
    (product.product_name as string | undefined) ||
    '';
  if (!name.trim()) return null;

  const per100g = parseOffNutriments((product.nutriments as Record<string, unknown>) ?? {});
  if (per100g.energyKcal === undefined) return null;

  // Open Food Facts allergen tags are incomplete often enough to be unsafe on
  // their own — Nutella, for instance, is tagged only `en:nuts` despite
  // containing milk and soy. So the declared tags are treated as a floor and
  // unioned with our own scan of the ingredient text.
  const declared = parseOffAllergens((product.allergens_tags as string[] | undefined) ?? []);
  const ingredientsText =
    (product.ingredients_text_en as string | undefined) ??
    (product.ingredients_text as string | undefined) ??
    '';
  const detected = ingredientsText ? allergensForIngredient(ingredientsText) : [];
  const allergens = [...new Set([...declared, ...detected])].sort() as Allergen[];

  const servingQuantityRaw = product.serving_quantity;
  const servingGrams =
    typeof servingQuantityRaw === 'number'
      ? servingQuantityRaw
      : typeof servingQuantityRaw === 'string'
        ? Number(servingQuantityRaw)
        : NaN;

  const portions: ResolvedFood['portions'] = [{ label: '100 g', grams: 100, isDefault: false }];
  if (Number.isFinite(servingGrams) && servingGrams > 0) {
    portions.unshift({
      label: (product.serving_size as string | undefined) ?? '1 serving',
      grams: servingGrams,
      isDefault: true,
    });
  } else {
    portions[0]!.isDefault = true;
  }

  return {
    id: newId(),
    name: name.trim(),
    brand: firstBrand(product.brands),
    barcode,
    source: 'off',
    confidence: scoreOffConfidence(per100g, true),
    verified: false,
    per100g,
    portions,
    allergens,
    fromCache: false,
  };
}

export async function fetchFromOpenFoodFacts(
  barcode: string,
  signal?: AbortSignal,
): Promise<ResolvedFood | null> {
  const url = `${OFF_ENDPOINT}/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
  const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } });

  if (!response.ok) return null;

  // Under load Open Food Facts answers with an HTML error page rather than
  // JSON, sometimes still on a 200. Parsing that throws, which would surface to
  // the user as "offline" when the network is fine — so check before trusting it.
  if (!isJson(response)) return null;

  const body = (await response.json()) as { status?: number; product?: Record<string, unknown> };
  if (!body.product || body.status === 0) return null;

  return offProductToFood(body.product, barcode);
}


/**
 * Full-text search across Open Food Facts.
 *
 * This is what gives the search screen a real database without any API key —
 * roughly four million products, with the strongest European coverage of any
 * open source. Before it existed, searching with no USDA key returned only
 * foods the user had already scanned.
 *
 * Results with no calorie figure are dropped: a food that cannot be logged is
 * noise in a list whose only purpose is logging.
 */
export async function searchOpenFoodFacts(
  query: string,
  signal?: AbortSignal,
  limit = 20,
): Promise<ResolvedFood[]> {
  try {
    const hits = await searchAlicious(query, limit, signal);
    if (hits.length > 0) return hits;
  } catch (error) {
    // One host being unreachable does not mean both are, so the fallback still
    // gets its turn. If it fails too, that error propagates and the screen says
    // "offline" rather than "nothing found".
    if (signal?.aborted) throw error;
  }
  return searchLegacyCgi(query, limit, signal);
}

/**
 * Reads a JSON body, or returns null when the server answered but not usefully —
 * a 503, or the HTML error page the legacy endpoint serves under load.
 *
 * A thrown `fetch` is *not* caught here. Not reaching the network at all and
 * reaching it to be told nothing are different facts, and the search screen says
 * different things about them; flattening both to "nothing found" would tell a
 * user on a plane that their food does not exist.
 */
async function readJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok || !isJson(response)) return null;
  return (await response.json()) as Record<string, unknown>;
}

async function searchAlicious(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<ResolvedFood[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(limit),
    fields: OFF_FIELDS,
  });

  const body = await readJson(`${OFF_SEARCH_ENDPOINT}?${params.toString()}`, signal);
  return toFoods((body?.hits as Record<string, unknown>[] | undefined) ?? []);
}

async function searchLegacyCgi(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<ResolvedFood[]> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: String(limit),
    fields: OFF_FIELDS,
  });

  const body = await readJson(`${OFF_SEARCH_FALLBACK}?${params.toString()}`, signal);
  return toFoods((body?.products as Record<string, unknown>[] | undefined) ?? []);
}

/** Products with no calorie figure are dropped — they cannot be logged. */
function toFoods(products: Record<string, unknown>[]): ResolvedFood[] {
  return products
    .map((product) => offProductToFood(product, (product.code as string) ?? null))
    .filter((food): food is ResolvedFood => food !== null);
}

// ---------------------------------------------------------------------------
// USDA FoodData Central
// ---------------------------------------------------------------------------


/**
 * Portions for a USDA food.
 *
 * 100 g is always offered because it is the storage basis, but it is a poor
 * default — nobody weighs a bowl of cereal against it. When USDA gives the
 * manufacturer's serving, that leads instead, so logging is one tap rather than
 * a typed gram figure.
 */
function usdaPortions(
  size: number | undefined,
  unit: string | undefined,
): { label: string; grams: number; isDefault: boolean }[] {
  const hundred = { label: '100 g', grams: 100, isDefault: true };
  // GRM and G are both used, and volume units cannot be converted without a
  // density we do not have.
  const isGrams = (unit ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'grm'
    || (unit ?? '').toLowerCase().trim() === 'g';
  if (!isGrams || !size || !Number.isFinite(size) || size <= 0) return [hundred];

  return [
    { label: `1 serving (${Math.round(size)} g)`, grams: size, isDefault: true },
    { ...hundred, isDefault: false },
  ];
}

/**
 * A nutrient entry as USDA returns it.
 *
 * The search and detail endpoints disagree on shape, and both parse without
 * error, so reading only one form yields silently empty nutrition:
 *   - `/foods/search` → flat   `{ nutrientNumber: "208", value: 149 }`
 *   - `/food/{id}`    → nested `{ nutrient: { number: "208" }, amount: 149 }`
 */
export interface UsdaNutrientEntry {
  nutrientNumber?: string;
  value?: number;
  nutrient?: { number?: string };
  amount?: number;
}

/** Convert a USDA `foodNutrients` array into our vector via the shared registry. */
export function parseUsdaNutrients(
  foodNutrients: readonly UsdaNutrientEntry[],
): NutrientVector {
  const out: NutrientVector = {};
  for (const entry of foodNutrients) {
    const number = entry.nutrientNumber ?? entry.nutrient?.number;
    const amount = entry.value ?? entry.amount;
    if (!number || typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    const key = NUTRIENT_BY_USDA_NUMBER[number];
    if (key) out[key] = amount;
  }
  return out;
}

/**
 * Search USDA FoodData Central.
 *
 * Goes through the `usda-search` Edge Function rather than calling FoodData
 * Central directly, because the key is ours rather than the user's. An
 * `EXPO_PUBLIC_` variable is substituted into the bundle at build time, so a key
 * used from the client ships inside the `.ipa` for anyone to read — and one
 * shared key means one extracted copy can exhaust the quota for every install
 * at once, with no way to rotate it short of an App Store review.
 *
 * The function returns USDA's own response shape untouched, so everything below
 * this call is unchanged.
 */
export type UsdaTransport = (query: string, signal?: AbortSignal) => Promise<unknown>;

export async function searchUsda(
  query: string,
  fetchJson: UsdaTransport,
  signal?: AbortSignal,
): Promise<ResolvedFood[]> {
  let payload: unknown;
  try {
    payload = await fetchJson(query, signal);
  } catch {
    return [];
  }
  const response = { ok: true, json: async () => payload };

  if (!response.ok) return [];
  const body = (await response.json()) as {
    foods?: {
      fdcId: number;
      description: string;
      brandOwner?: string;
      gtinUpc?: string;
      dataType?: string;
      ingredients?: string;
      servingSize?: number;
      servingSizeUnit?: string;
      foodNutrients?: UsdaNutrientEntry[];
    }[];
  };

  return (body.foods ?? [])
    .map((food): ResolvedFood | null => {
      const per100g = parseUsdaNutrients(food.foodNutrients ?? []);
      if (per100g.energyKcal === undefined) return null;

      const lab = food.dataType === 'Foundation' || food.dataType === 'SR Legacy';

      // Branded entries are manufacturer-submitted, so their arithmetic gets the
      // same scrutiny as a crowdsourced label. Lab entries are analysed and keep
      // their 1.0.
      let confidence = lab ? 1 : 0.9;
      if (!lab && !checkEnergyConsistency(per100g).consistent) confidence = 0.6;

      return {
        id: newId(),
        name: food.description,
        brand: food.brandOwner ?? null,
        barcode: food.gtinUpc ?? null,
        source: 'usda',
        confidence,
        verified: lab,
        per100g,
        portions: usdaPortions(food.servingSize, food.servingSizeUnit),
        // Scanned from the ingredient list *and* the description, unioned.
        //
        // Two separate holes were closing here. Branded entries carry a printed
        // ingredient list that we were discarding outright, so every USDA food
        // claimed to contain no allergens — which reads identically to "checked
        // and clear", the one thing an allergen field must never do. Lab entries
        // carry no ingredient list at all, so they need the description: without
        // it, "Yogurt, Greek, nonfat, plain" reported no milk.
        allergens: allergensForIngredient(
          `${food.description} ${food.ingredients ?? ''}`,
        ),
        fromCache: false,
      };
    })
    .filter((f): f is ResolvedFood => f !== null);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface FoodRow {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: FoodSource;
  confidence: number;
  verified: number;
  nutrients: string;
  allergens: string;
}

function rowToResolved(row: FoodRow, fromCache: boolean): ResolvedFood {
  const portions = sqlite.getAllSync<{ label: string; grams: number; is_default: number }>(
    'SELECT label, grams, is_default FROM food_portions WHERE food_item_id = ?',
    [row.id],
  );

  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    source: row.source,
    confidence: row.confidence,
    verified: row.verified === 1,
    per100g: JSON.parse(row.nutrients) as NutrientVector,
    portions:
      portions.length > 0
        ? portions.map((p) => ({ label: p.label, grams: p.grams, isDefault: p.is_default === 1 }))
        : [{ label: '100 g', grams: 100, isDefault: true }],
    allergens: JSON.parse(row.allergens) as Allergen[],
    fromCache,
  };
}

export function findCachedByBarcode(barcode: string): ResolvedFood | null {
  const row = sqlite.getFirstSync<FoodRow>(
    `SELECT id, name, brand, barcode, source, confidence, verified, nutrients, allergens
     FROM food_items WHERE barcode = ? AND deleted_at IS NULL LIMIT 1`,
    [barcode],
  );
  return row ? rowToResolved(row, true) : null;
}

/** Local name search, used for the offline path and instant autocomplete. */
export function searchCached(query: string, limit = 25): ResolvedFood[] {
  const rows = sqlite.getAllSync<FoodRow>(
    `SELECT id, name, brand, barcode, source, confidence, verified, nutrients, allergens
     FROM food_items
     WHERE deleted_at IS NULL AND name LIKE ?
     ORDER BY verified DESC, confidence DESC, name ASC
     LIMIT ?`,
    [`%${query}%`, limit],
  );
  return rows.map((row) => rowToResolved(row, true));
}

/**
 * Save a food the user typed, so they never have to type it again.
 *
 * Homemade food, a local bakery, a supplement with no barcode — none of it is in
 * USDA or Open Food Facts, and without this every repeat is a full re-entry.
 * That is the second-biggest source of logging time after searching, and it is
 * why "no custom foods" is a reason people leave a diary.
 *
 * Stored in `food_items` like any other food, marked `user_submitted` with
 * source `'user'`, so `searchCached` finds it from then on with no special case
 * anywhere — and the confidence badge shows "Your entry" rather than implying we
 * verified it.
 */
export function createCustomFood(input: {
  name: string;
  brand?: string | null;
  /** Per 100 g. */
  per100g: NutrientVector;
  barcode?: string | null;
}): string {
  const name = input.name.trim();
  if (name.length === 0) throw new RangeError('createCustomFood: name must not be empty');

  return cacheFood({
    id: newId(),
    name,
    brand: input.brand?.trim() || null,
    barcode: input.barcode ?? null,
    source: 'user',
    // The user is the authority on what they are holding: we neither vouch for
    // these numbers nor doubt them.
    confidence: 1,
    verified: false,
    per100g: input.per100g,
    portions: [],
    allergens: [],
    fromCache: false,
  });
}

/** Persist a resolved food so the next scan of it works offline. */
export function cacheFood(food: ResolvedFood): string {
  const existing = food.barcode
    ? sqlite.getFirstSync<{ id: string }>('SELECT id FROM food_items WHERE barcode = ?', [food.barcode])
    : null;
  if (existing) return existing.id;

  const timestamp = new Date().toISOString();
  const columns = withNutrients(food.per100g);

  sqlite.execSync('BEGIN');
  try {
    sqlite.runSync(
      `INSERT INTO food_items
         (id, name, brand, barcode, source, source_ref, confidence, verified, user_submitted,
          nutrients, energy_kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
          allergens, cached_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        food.id,
        food.name,
        food.brand,
        food.barcode,
        food.source,
        food.barcode,
        food.confidence,
        food.verified ? 1 : 0,
        food.source === 'user' ? 1 : 0,
        JSON.stringify(food.per100g),
        columns.energyKcal,
        columns.proteinG,
        columns.carbsG,
        columns.fatG,
        columns.fiberG,
        columns.sugarG,
        columns.satFatG,
        columns.sodiumMg,
        JSON.stringify(food.allergens),
        timestamp,
        timestamp,
        timestamp,
      ],
    );

    for (const portion of food.portions) {
      sqlite.runSync(
        'INSERT INTO food_portions (id, food_item_id, label, grams, is_default) VALUES (?, ?, ?, ?, ?)',
        [newId(), food.id, portion.label, portion.grams, portion.isDefault ? 1 : 0],
      );
    }

    sqlite.execSync('COMMIT');
  } catch (error) {
    sqlite.execSync('ROLLBACK');
    throw error;
  }

  return food.id;
}

export type BarcodeOutcome =
  | { status: 'found'; food: ResolvedFood }
  | { status: 'not_found'; barcode: string }
  | { status: 'offline'; barcode: string };

/**
 * The scanner's resolution chain.
 *
 * A miss is not an error: it routes the user to quick-add with the barcode
 * already in hand, so a product Open Food Facts has never seen still gets
 * logged in about fifteen seconds. Being offline is reported distinctly from a
 * genuine miss, because the two deserve different wording on screen.
 */
export async function resolveBarcode(
  barcode: string,
  options: { usdaSearch?: UsdaTransport; signal?: AbortSignal } = {},
): Promise<BarcodeOutcome> {
  const cached = findCachedByBarcode(barcode);
  if (cached) return { status: 'found', food: cached };

  try {
    const off = await fetchFromOpenFoodFacts(barcode, options.signal);
    if (off) {
      cacheFood(off);
      return { status: 'found', food: off };
    }

    if (options.usdaSearch) {
      const usdaMatches = await searchUsda(barcode, options.usdaSearch, options.signal);
      const match = usdaMatches.find((f) => f.barcode === barcode) ?? usdaMatches[0];
      if (match) {
        cacheFood({ ...match, barcode });
        return { status: 'found', food: { ...match, barcode } };
      }
    }

    return { status: 'not_found', barcode };
  } catch {
    // Any network failure lands here. The scanner stays usable; the user is
    // offered the manual path instead of being shown a stack trace.
    return { status: 'offline', barcode };
  }
}
