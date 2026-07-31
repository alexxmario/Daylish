/**
 * Allergen detection from ingredient names.
 *
 * The rule this file exists to enforce: a recipe's allergen tags are derived
 * from its resolved ingredients, never copied from what the language model
 * claimed. An LLM that forgets the fish sauce contains fish is a safety
 * incident, so its opinion on allergens is discarded entirely.
 *
 * The matcher is deliberately eager. A false positive costs a user one
 * irrelevant recipe; a false negative could cost them an anaphylactic reaction.
 * When in doubt, tag it.
 */

import type { Allergen } from './types.ts';

/**
 * Substrings that imply an allergen, matched case-insensitively against a
 * normalised ingredient name. Ordering is irrelevant; all patterns are tested.
 */
const ALLERGEN_PATTERNS: ReadonlyArray<readonly [Allergen, readonly string[]]> = [
  ['gluten', [
    'wheat', 'flour', 'bread', 'pasta', 'spaghetti', 'macaroni', 'penne', 'noodle',
    'couscous', 'bulgur', 'semolina', 'farro', 'spelt', 'barley', 'rye', 'malt',
    'seitan', 'panko', 'breadcrumb', 'cracker', 'tortilla', 'pita', 'naan',
    'soy sauce', 'beer', 'orzo', 'udon', 'ramen', 'phyllo', 'filo', 'puff pastry',
    'cake', 'biscuit', 'cookie', 'pastry', 'crouton', 'bagel', 'brioche',
    // Oats are naturally gluten-free but are named under "cereals containing
    // gluten" in EU/UK Annex II, because milling and transport cross-contaminate
    // them as a matter of course. Certified gluten-free oats exist, and the
    // "gluten free" negation below is what lets those through.
    'oat', 'oats', 'oatmeal', 'porridge', 'granola', 'muesli', 'flapjack',
    // Wheat under other names.
    'durum', 'kamut', 'triticale', 'einkorn', 'emmer', 'freekeh', 'matzo',
    'bran', 'wheatgerm', 'wheat germ', 'pretzel', 'croissant', 'crumpet',
  ]],
  ['crustaceans', [
    'shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'crawfish', 'langoustine', 'krill',
  ]],
  ['eggs', [
    'egg', 'eggs', 'mayonnaise', 'mayo', 'aioli', 'meringue', 'custard', 'hollandaise',
    'albumen', 'frittata', 'omelette', 'omelet',
  ]],
  ['fish', [
    'fish', 'salmon', 'tuna', 'cod', 'haddock', 'halibut', 'anchovy', 'anchovies',
    'sardine', 'mackerel', 'trout', 'bass', 'snapper', 'tilapia', 'pollock',
    'worcestershire', 'fish sauce', 'nam pla', 'bonito', 'dashi', 'caviar', 'roe',
  ]],
  ['peanuts', ['peanut', 'groundnut', 'arachis', 'satay']],
  ['soybeans', [
    'soy', 'soya', 'tofu', 'edamame', 'tempeh', 'miso', 'tamari', 'natto', 'lecithin',
  ]],
  ['milk', [
    'milk', 'butter', 'cream', 'cheese', 'yoghurt', 'yogurt', 'ghee', 'curd', 'whey',
    'casein', 'custard', 'mozzarella', 'parmesan', 'cheddar', 'ricotta', 'mascarpone',
    'feta', 'halloumi', 'gouda', 'brie', 'creme fraiche', 'buttermilk', 'kefir',
    'condensed milk', 'evaporated milk', 'paneer',
  ]],
  ['tree_nuts', [
    'almond', 'walnut', 'cashew', 'pistachio', 'pecan', 'hazelnut', 'macadamia',
    'brazil nut', 'pine nut', 'chestnut', 'praline', 'marzipan', 'nutella', 'frangipane',
  ]],
  ['celery', ['celery', 'celeriac', 'celery salt']],
  ['mustard', ['mustard', 'dijon', 'wholegrain mustard']],
  ['sesame', ['sesame', 'tahini', 'halva', 'benne', 'gomashio', "za'atar", 'zaatar']],
  ['sulphites', ['wine', 'vinegar', 'dried apricot', 'sulphite', 'sulfite', 'sultana']],
  ['lupin', ['lupin', 'lupine']],
  ['molluscs', [
    'mussel', 'clam', 'oyster', 'scallop', 'squid', 'calamari', 'octopus', 'snail',
    'cuttlefish', 'abalone', 'whelk',
  ]],
];

/**
 * Phrases that trip a pattern but are not actually that allergen.
 *
 * These are *stripped from the text* before matching, so they neutralise only
 * themselves. Entries must therefore be complete enough to swallow the word that
 * would otherwise match: `buckwheat flour` rather than `buckwheat`, or the bare
 * `flour` left behind would register as gluten.
 */
const EXCLUSIONS: ReadonlyArray<readonly [Allergen, readonly string[]]> = [
  ['milk', [
    'coconut milk', 'almond milk', 'soy milk', 'soya milk', 'oat milk', 'rice milk',
    'cashew milk', 'hemp milk', 'peanut butter', 'cocoa butter', 'shea butter',
    'apple butter', 'nut butter', 'milk thistle',
    'butternut', 'butterhead', 'butter bean', 'butterfly',

    // Plant yoghurts and creams. These need their own entries because stripping
    // the plant-milk phrase alone is not enough: "Yogurt, coconut milk" — USDA's
    // phrasing — becomes a bare "yogurt" once "coconut milk" is removed, which
    // then matches the dairy marker. Every one of these is unambiguously
    // plant-based, so stripping the whole phrase cannot mask real dairy: a
    // product listing both "coconut yogurt" and "cream" still matches on cream.
    'yogurt coconut milk', 'yoghurt coconut milk',
    'yogurt soy', 'yoghurt soy', 'yogurt almond milk', 'yogurt oat milk',
    'coconut yogurt', 'coconut yoghurt', 'soy yogurt', 'soya yogurt',
    'almond yogurt', 'oat yogurt', 'cashew yogurt', 'tofu yogurt',
    'coconut cream', 'oat cream', 'soy cream', 'cashew cream',
  ]],
  ['tree_nuts', ['nutmeg', 'water chestnut', 'coconut', 'nutritional yeast']],
  ['gluten', [
    'buckwheat flour', 'buckwheat', 'rice flour', 'almond flour',
    'corn flour', 'cornflour', 'coconut flour', 'chickpea flour', 'tamari',
    'rice noodle', 'glass noodle', 'tapioca flour', 'potato flour',
    'rice bran', 'corn bran', 'gluten-free oat', 'gluten free oat',
  ]],
  ['eggs', ['eggplant', 'egg replacer', 'flax egg']],
  ['sulphites', ['wine glass']],
];

/**
 * "Free from" declarations.
 *
 * Unlike an exclusion phrase, a negation applies to the *whole* text: a product
 * labelled gluten-free is gluten-free even though the words after it mention
 * pasta and flour. Checked first, and short-circuits the allergen entirely.
 */
const NEGATIONS: ReadonlyArray<readonly [Allergen, readonly string[]]> = [
  ['gluten', ['gluten-free', 'gluten free', 'wheat-free', 'wheat free']],
  ['milk', ['dairy-free', 'dairy free', 'milk-free', 'milk free', 'lactose-free']],
  ['eggs', ['egg-free', 'egg free', 'eggless']],
  ['fish', ['fish-free', 'fish free', 'fishless', 'vegan fish sauce']],
  ['soybeans', ['soy-free', 'soy free', 'soya-free']],
  ['peanuts', ['peanut-free', 'peanut free']],
  ['tree_nuts', ['nut-free', 'nut free']],
  ['sesame', ['sesame-free', 'sesame free']],
];

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Allergens implied by an ingredient name, or by a whole ingredient list.
 *
 * Exclusions are applied by *removing the excluded phrase from the text* and
 * then matching, rather than by skipping the allergen whenever an exclusion
 * appears anywhere. The difference matters on real product data: a Mars bar
 * lists both "Cocoa Butter" and "Skimmed Milk Powder", and the whole-text form
 * of this check let the cocoa butter suppress the milk — a false negative on a
 * major allergen. Stripping first means "coconut milk" still isn't dairy while
 * "coconut milk, butter" still is.
 */
export function allergensForIngredient(name: string): Allergen[] {
  const text = normalise(name);
  const found = new Set<Allergen>();

  for (const [allergen, patterns] of ALLERGEN_PATTERNS) {
    const negations = NEGATIONS.find(([a]) => a === allergen)?.[1] ?? [];
    if (negations.some((phrase) => text.includes(phrase))) continue;

    // Longest first, so "buckwheat flour" is consumed before the shorter
    // "buckwheat" can leave a bare "flour" behind to match.
    const excluded = [...(EXCLUSIONS.find(([a]) => a === allergen)?.[1] ?? [])].sort(
      (a, b) => b.length - a.length,
    );
    let searchable = text;
    for (const phrase of excluded) {
      searchable = searchable.split(phrase).join(' ');
    }

    for (const pattern of patterns) {
      // Multi-word patterns match as substrings; single words must match whole
      // words, so "creamy" does not imply cream and "ryegrass" does not imply rye.
      const matched = pattern.includes(' ')
        ? searchable.includes(pattern)
        : new RegExp(`\\b${pattern}(s|es)?\\b`).test(searchable);
      if (matched) {
        found.add(allergen);
        break;
      }
    }
  }

  return [...found].sort();
}

/** Union of the allergens across every ingredient in a recipe. */
export function allergensForRecipe(ingredientNames: readonly string[]): Allergen[] {
  const all = new Set<Allergen>();
  for (const name of ingredientNames) {
    for (const allergen of allergensForIngredient(name)) all.add(allergen);
  }
  return [...all].sort();
}

/** True when a recipe is safe for a user avoiding `avoided`. */
export function isRecipeSafeFor(
  recipeAllergens: readonly Allergen[],
  avoided: readonly Allergen[],
): boolean {
  return !recipeAllergens.some((a) => avoided.includes(a));
}
