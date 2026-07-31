# Recipe generation prompt

**Where to run each half:**

1. **The prompt** — paste it into [claude.ai](https://claude.ai) (a normal chat,
   not the API — the whole point is that this costs nothing). Save the reply as
   `recipes.json`.
2. **The import** — your terminal, from the repo root
   (`/Users/alexmario/Desktop/Daylish`):

```bash
npm run pipeline -- --import ~/Downloads/recipes.json
```

`USDA_API_KEY` is read from the repo's `.env` automatically — nothing to export.

The import runs the **same validation as the paid pipeline**: every ingredient is
resolved against USDA FoodData Central, nutrition is computed from the resolved
weights, and recipes that fail the sanity checks are rejected with a reason. A
hand-generated batch earns exactly the same guarantees as a generated one.

---

## Why the prompt never mentions calories

`GeneratedRecipeSchema` has no calorie or macro field, deliberately — the model
is *structurally unable* to hand us a nutrition number, so it cannot invent one.
Every figure in the app is computed downstream from resolved ingredients.

This matters for the light/hearty variants. You cannot ask for "a 450 kcal
version" and trust the answer. You ask for a **smaller portion of the same dish
with less of the calorie-dense ingredients**, and the pipeline tells you what it
actually came to. The number on the card is then a fact rather than a guess —
which is the whole reason anyone should pick this app over MyFitnessPal.

If a variant lands somewhere unhelpful, adjust the grams and re-import. That
loop costs nothing.

---

## Building a library: run it many times into a folder

**Three dishes per run — nine recipes — is the ceiling**, and it is set by how
much JSON one reply can hold, not by anything in this project. Nine detailed
recipes is already around 8,000 tokens. Asking for more gets you truncated JSON
or thinner recipes, both of which cost more time than a second run.

So a library is built by repetition. Don't concatenate files by hand:

```
recipes/
  01-breakfast.json
  02-lunch-bowls.json
  03-traybakes.json
  …
```

```bash
npm run pipeline -- --import recipes/
```

Importing a directory reads every `.json` in it and validates **one recipe at a
time**, which matters as the folder grows:

- One malformed recipe is skipped by name; the other fifty-nine still import.
- A file that is not valid JSON is skipped, not fatal.
- Repeated titles are skipped, so re-importing the whole folder after adding one
  file is the normal way to work rather than a mistake.

Twenty runs is sixty dishes — a genuinely browsable library — and each one is a
paste, a save, and nothing else.

---

## The prompt

````
You are writing recipes for Daylish, a food diary. I will give you a dish brief;
you return JSON only — no prose before or after, no markdown fence.

## The most important rule

Do not output calories, macros, or any nutrition figure. There is no field for
them. Nutrition is computed downstream from your ingredient weights against USDA
FoodData Central. Your job is the cooking and the grams; the arithmetic is not
yours to do.

This means `grams` must be *right*, because it is the only quantity anything
trusts. `displayQuantity` is cosmetic — cooks read it, the computer ignores it.
"2 tbsp olive oil" is 27 g. "1 medium onion" is 110 g. If you are unsure, give
the weight you would get on a kitchen scale, not a rounded guess.

## What to return for each brief

THREE recipes for the same dish, as three complete entries in the array:

1. **Light** — the same dish, smaller and leaner. Reduce the calorie-dense
   ingredients (oil, butter, cheese, nuts, cream, sugar, fatty cuts) and the
   starch portion. Keep the protein close to the standard version — that is what
   makes a smaller meal still satisfying, and it is what people cutting are
   short of. Bulk it out with vegetables so the plate is not visibly smaller.
2. **Standard** — the dish as you would normally cook it.
3. **Hearty** — the same dish, bigger. More protein and more starch, a little
   more fat. This is for someone gaining or training hard, not a novelty size.

The three must be recognisably *the same meal*: same method, same flavour, same
cuisine. Someone should be able to cook one for themselves and another for their
partner from the same pan. Do not turn the light one into a salad.

Title them exactly:
  "<Dish name>, light"
  "<Dish name>"
  "<Dish name>, hearty"

Vary the ingredients and grams between them. Do not simply scale servings — a
lighter version changes the *ratio*, not just the size. `servings` should
normally stay the same across all three.

## Quality bar

- Real cooking. Something a competent home cook would make on a weeknight and
  want again. No "protein mug cake", no ingredient lists that read like a
  supplement stack.
- Steps must be followable by someone who has not cooked the dish before. Say
  what to look for ("until the onions are soft and translucent"), not just what
  to do.
- Every non-optional ingredient must be used by at least one step. This is
  checked automatically and rejects the recipe if it fails.
- `durationMinutes` on steps should roughly add up to `prepMinutes + cookMinutes`.
  A large mismatch is rejected automatically.
- Set `isPassive: true` for any step where the cook is free — baking, simmering,
  marinating, resting. The prep-day scheduler packs other work into those
  windows, so getting this right makes the app better.
- `storageNotes`, `fridgeDays` and `freezerMonths` should be honest. Say when
  something is best eaten fresh.

## Naming ingredients

Names are matched against USDA FoodData Central, so how you write them decides
whether the nutrition is right.

- **Plain and generic.** "chicken breast, skinless", not "free-range organic
  chicken". Brands and marketing adjectives make matching worse.
- **Singular, ordinary noun first.** "onion", "banana", "walnuts" — the way the
  food is normally named, not a recipe-book flourish.
- **But be specific where it changes the numbers.** "whole milk" and "skimmed
  milk" are a 2× difference in fat; "white bread" and "wholemeal bread" differ
  in fibre. Where a choice materially changes the nutrition, say which one you
  mean. Where it does not, stay plain.
- **Never write a preparation into the name.** "onion", with `preparation:
  "finely diced"` — not "diced onion". The weight is the same either way and the
  extra word only makes the match worse.

## Schema

Return exactly this shape:

{
  "recipes": [
    {
      "title": "string, 3-80 chars",
      "summary": "one or two appetising sentences, 20-300 chars",
      "cuisine": "one of: american, british, french, italian, spanish, greek, turkish, middle_eastern, north_african, west_african, ethiopian, indian, thai, vietnamese, chinese, japanese, korean, mexican, caribbean, brazilian, peruvian, german, polish, scandinavian",
      "mealSlots": ["one or more of: breakfast, lunch, dinner, snack"],
      "servings": 1-12,
      "prepMinutes": 0-240,
      "cookMinutes": 0-480,
      "difficulty": "easy | medium | hard",
      "equipment": ["any of: oven, stovetop, microwave, air_fryer, blender, food_processor, slow_cooker, pressure_cooker, grill, rice_cooker"],
      "dietStyles": ["any of: balanced, high_protein, keto, mediterranean, vegetarian, vegan, pescatarian, halal, kosher, gluten_free, dairy_free, low_fodmap"],
      "ingredients": [
        {
          "name": "plain name, no brand, no preparation",
          "grams": 1-5000,
          "displayQuantity": "2 tbsp",
          "preparation": "finely diced, or null",
          "optional": false
        }
      ],
      "steps": [
        {
          "order": 1,
          "instruction": "5-600 chars",
          "durationMinutes": 0-480, or null,
          "isPassive": false
        }
      ],
      "storageNotes": "how it keeps and reheats, up to 300 chars",
      "fridgeDays": 0-7,
      "freezerMonths": 0-12
    }
  ]
}

Constraints that will reject the recipe if broken:
- 2-30 ingredients, 2-25 steps, at most 10 recipes per batch
- `order` must run 1, 2, 3… with no gaps
- No single ingredient may be more than 75% of total weight (unless the recipe
  has 3 or fewer ingredients) — that pattern is almost always a units mistake
- `dietStyles` must be *true*. Do not tag something vegetarian if it has fish
  sauce in it. This drives allergen and diet filtering.

## The brief

Write all three variants for EACH dish listed below, in one `recipes` array.
Three dishes × three variants = nine recipes. Do not stop early, and do not ask
whether to continue — return the whole array.

[REPLACE THIS WITH THREE DISHES, e.g.

  1. Chicken and chorizo traybake — Spanish, dinner, oven, good for meal prep
  2. Red lentil dal — Indian, dinner, stovetop, vegan
  3. Shakshuka — North African, breakfast or brunch, stovetop, vegetarian
]
````

---

## Suggested briefs for a first batch

Aim for coverage of slots and diets before variety of cuisine — an app with
forty dinners and no breakfasts is less useful than one with a dozen of each.

| Slot | Briefs |
|---|---|
| Breakfast | overnight oats · shakshuka · greek yoghurt bowl · breakfast burrito · congee |
| Lunch | chicken burrito bowl · lentil soup · tuna niçoise · falafel wrap · fried rice |
| Dinner | chicken traybake · beef chilli · salmon and greens · dal with rice · pasta puttanesca · stir fry |
| Snack | hummus and veg · protein smoothie · trail mix · rice cakes and cottage cheese |

Twenty dishes at three variants each is 60 recipes — enough to un-hide the Meals
tab with something worth browsing.

---

## What you get back

Two files in `supabase/seed/`:

- **`recipes.json`** — the accepted recipes, each with the fields you wrote plus
  `nutrientsPerServing` (all 37 nutrients, computed), `allergens` (derived from
  the *resolved* ingredients, never from your `dietStyles` claim), `prepScore`,
  and — per ingredient — the `fdcId` and `matchedDescription` it resolved to.
  That last pair is the audit trail: you can see exactly which USDA entry each
  calorie came from.
- **`rejected.json`** — everything that failed, with reasons and the specific
  ingredients that could not be resolved.

Check a few `matchedDescription` values on the first batch. If "chicken breast,
skinless" matched something odd, the nutrition is wrong in a way no amount of
schema validation would catch, and renaming the ingredient fixes it.

## Common rejections

| Rejection | Fix |
|---|---|
| An ingredient could not be resolved against USDA | Rename it to something plainer — "spring onion" rather than "scallion tops" |
| Step timings contradict the stated cook time | Adjust `prepMinutes` / `cookMinutes`, or the step durations |
| An ingredient is listed but never used in a step | Add it to a step, or remove it |
| One ingredient dominates the total weight | Almost always a units error — check that ingredient's `grams` |

Re-run the prompt for just the failures rather than the whole batch.
