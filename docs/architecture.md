# Daylish — architecture

## The three ideas everything else follows from

**1. The device is the source of truth.**
SQLite on the phone holds the user's data; the server is a replica. Every read
the UI performs hits local storage and nothing else. This is not a performance
optimisation — it is what makes "log a meal on a plane" work, and logging speed
is the product's primary metric.

**2. The language model never produces a number.**
It writes recipes, identifies food in photographs, and talks to the user. It
does not calculate nutrition. Every calorie and gram in Daylish is computed from
USDA FoodData Central by code in `packages/core`. This is enforced structurally:
the recipe generation schema has no nutrition fields for a model to fill in.

**3. Uncertainty is displayed, not hidden.**
Every food carries a `source` and a `confidence`, both `NOT NULL`. An AI
estimate renders as "AI estimate · 72% sure". A missing micronutrient is
reported as unknown rather than summed as zero. Competitors present guesses as
facts; not doing so is the product's main claim.

---

## Layout

```
apps/mobile/              Expo app (expo-router, TypeScript)
packages/core/            goal engine, nutrition math, schemas, allergens
packages/db/              Drizzle schema + generated SQLite migrations
services/recipe-pipeline/ Node batch job: generate → resolve → compute → validate
supabase/                 Postgres migrations, RLS, Edge Functions
docs/
```

`packages/core` is a shared package rather than app code for one specific
reason: the recipe pipeline and the phone must compute a recipe's macros
*identically*. Two implementations would drift, and the drift would be invisible
— both would produce plausible numbers.

---

## Stack, and why

| Choice | Why | What it costs |
|---|---|---|
| **Expo / React Native (SDK 54)** | Buildable and testable without Xcode; EAS builds iOS in the cloud; one codebase reaches Android later. Pinned to 54 to match the Expo Go build on the App Store — Expo Go speaks exactly one SDK, and a mismatch fails with an unhelpful screen rather than a usable error. | Apple Watch and Lock Screen widgets need native Swift targets — see *Deferred* below. Moving SDKs is a dependency bump (`npx expo install expo@^55 --fix`); no application code is SDK-specific. |
| **Supabase (Postgres)** | The shared recipe library, household mode and social challenges all need multi-user reads. CloudKit cannot serve those. Postgres RLS gives per-row isolation without an application server. | Costs money; we own auth and GDPR export/delete. |
| **SQLite + Drizzle on device** | Offline-first, and one schema definition compiles to both SQLite and Postgres so the shapes cannot diverge. | A sync layer to build and maintain. |
| **Claude via Edge Functions** | The API key never enters the client bundle. Deno functions sit next to the database, so the coach's context is one local query away. | Cold starts on the AI paths. |

---

## Data model

Nineteen tables on device, seventeen on the server (the two `sync_*` tables are
local-only). Full definitions: [`packages/db/src/schema.ts`](../packages/db/src/schema.ts)
and [`supabase/migrations/`](../supabase/migrations/).

Four decisions are load-bearing.

### Nutrients are stored twice, on purpose

Each row carries the full 35-nutrient vector as JSON **and** eight macro columns
as real numbers. The columns exist so a day's totals are one indexed `SUM` —
the ring re-reads on every write and must not deserialise JSON per row. The JSON
exists because micronutrients are a detail view that does not need to be fast.

The redundancy is only safe because exactly one function writes both:
`withNutrients()` in `packages/db/src/nutrient-columns.ts`. `findMacroDrift()`
exists to catch any write that bypasses it.

### Every entry stores an instant *and* a local date

`logged_at` is a timestamp with offset; `local_date` is the `YYYY-MM-DD` the
user considers that moment to belong to. A meal eaten at 00:30 in Berlin belongs
to the Berlin day, and "today's ring" is a `local_date` query. Deriving one from
the other at read time gets this wrong across timezone changes and DST.

### Journal items snapshot their nutrition

`journal_entry_items.nutrients` is frozen at log time. Correcting a `food_items`
row later — a better USDA match, a fixed crowdsourced label — must not silently
rewrite what somebody ate last March. The `food_item_id` link survives for
provenance and re-logging.

### Goals are append-only

Each weekly recalibration inserts a new `user_goals` row carrying the plain-
language `reason` that produced it. "What was my target in March, and why did it
change?" is always answerable.

---

## Appearance

Daylish is a light-themed app, unconditionally. That is a product decision, not
a missing feature: the palette is built from daylight — celeste and butter on
pale blue paper — and rendering that identity dark half the time, based on a
setting someone changed for unrelated reasons, would make it two products
sharing a codebase.

`darkPalette` is retained in `tokens.ts` and stays validated (its macro colours
clear every contrast and colour-vision check against a dark surface), but no
runtime path selects it. Turning dark mode on later means changing three things
together: the palette choice in `src/theme/index.tsx`, `userInterfaceStyle` in
`app.json`, and the `StatusBar` style in the root layout. All three currently
pin native chrome to light so keyboards, alerts and sheets match the app.

## The daily loop

Meals are only part of a day. Weight, water and fasting live in `src/data/daily.ts`,
separate from the journal, because they are not meals — the timeline unions them
at read time. Keeping them apart is what lets `journal_entries` stay append-only
while a weigh-in can be corrected in place.

Three details worth knowing:

- **One weigh-in per day, upserted.** Weighing twice in a morning is a
  correction, not two data points; a unique index on `(user_id, local_date)`
  enforces it. Two rows would double-count that day in the trend regression.
- **The weigh-in screen recalibrates immediately** and shows the verdict. The
  promise is that targets respond to real data, so making someone wait for an
  invisible weekly job undersells it.
- **Fasting bands are clipped to the day being viewed.** A fast crosses midnight
  by design, so a 16-hour fast from 20:00 renders as 20:00–24:00 on one day and
  00:00–12:00 on the next. The lookup prefers an *open* session over a recently
  closed one — ordering by start time alone made an ongoing overnight fast lose
  to one ended earlier the same day, and its band silently vanished.

## The goal engine

Two layers, in `packages/core/src/goal-engine.ts`.

**Baseline.** Mifflin-St Jeor × activity multiplier. Used only until real data
exists, and the onboarding copy says so explicitly.

**Adaptive.** The identity is `intake − expenditure = energy stored`, so
expenditure is average intake minus the energy represented by the weight change.
A user losing faster than their logged deficit implies is simply burning more
than the formula predicted.

Three details that matter more than they look:

- **The rate of change is regressed from raw weigh-ins, not the smoothed
  trend.** The EWMA exists to give the user a readable weight line. Fitting a
  least-squares slope to an already-smoothed series adds the EWMA's lag on top;
  during warm-up that lag is still growing, which biases the slope toward zero.
  This cost 130–280 kcal/day on a 0.5 kg/week decline before it was fixed, and
  it is now pinned by a test asserting exact recovery to within 5 kcal.
- **A day counts as "fully logged" only with three or more meal slots.** Without
  that bar, a day where someone logged only breakfast reads as a 400 kcal day
  and drags the estimate into nonsense.
- **No adjustment ships without an explanation.** `recalibrateTargets` returns a
  `reason` string on every path, including the ones where nothing changed, and
  the UI renders it verbatim. An adjustment that cannot be explained in one
  sentence is not made.

Adjustments are clamped to ±250 kcal per week and suppressed below 50 kcal, so
one noisy fortnight cannot swing someone's intake.

---

## Food resolution

Barcode: **local cache → Open Food Facts → USDA → user submission.** The cache
comes first so a rescan of a habitual food needs no network.

Text search: **Open Food Facts (always) + USDA (when a key is present), in
parallel**, merged lab-verified-first then by confidence. OFF needs no key, so
search works on a fresh install with nothing configured.

Three things learned from hitting the real APIs:

- **Open Food Facts has three search endpoints and only one is usable.**
  `/api/v2/search?product_name=` is a substring filter with no relevance
  ranking — it answers "greek yogurt" with bottled water. `cgi/search.pl` ranks
  properly but is the legacy Perl CGI and returns 503 with an *HTML* body under
  ordinary load: across five everyday queries it answered one.
  `search.openfoodfacts.org` (Search-a-licious, Elasticsearch-backed) answered
  all five, fast. It is the primary; `search.pl` is kept as a fallback. Every
  response is content-type checked, because an HTML error page parsed as JSON
  would surface to the user as "you are offline".
- **USDA returns ingredient lists and serving sizes that were being discarded.**
  Every USDA food therefore reported *no allergens* — which on screen reads
  identically to "checked and clear", the one thing an allergen field must never
  mean. Branded entries carry the printed ingredient list; lab entries carry none
  at all, so the description is scanned too ("Yogurt, Greek, nonfat, plain"
  reported no milk before this). Both are scanned and unioned. Manufacturer
  serving sizes now lead the portion list, because nobody weighs cereal against
  100 g.
- **The two working endpoints disagree on the `brands` shape** — an array from
  Search-a-licious, a comma-separated string from the CGI. `.split` on the array
  form throws and takes out the entire result list.

- **USDA's search and detail endpoints disagree on nutrient shape.** Search
  returns flat `{nutrientNumber, value}`; detail returns nested
  `{nutrient:{number}, amount}`. Both parse without error, so reading only one
  form yields *silently empty nutrition* for every food. Both are accepted.
- **Open Food Facts allergen tags are incomplete enough to be unsafe alone.**
  Nutella is tagged `en:nuts` on one record and `en:gluten` on another, and
  neither mentions the milk or the soya lecithin in its own printed ingredient
  list. Declared tags are therefore treated as a floor and unioned with our own
  scan of the ingredient text.

Oats are tagged as gluten. They are naturally gluten-free but are named under
"cereals containing gluten" in EU/UK Annex II, because milling and transport
cross-contaminate them as a matter of course — and an oat-milk-heavy product
catalogue makes this a common case, not an edge one. Certified gluten-free oats
pass through the existing "gluten free" negation.

Crowdsourced entries are scored, not trusted: `checkEnergyConsistency` compares
stated calories against the macros on the same label, and a mismatch drops
confidence sharply.

---

## The recipe pipeline

```
taxonomy → generate (Batch API) → resolve (USDA) → compute → validate → emit
```

**Generate.** Cuisine × diet × meal-slot cells, submitted as one Batch API job
(50% cost) sharing one cached system prompt. Largest-remainder apportionment
hits the requested total — rounding each cell independently lost 18% of a
500-recipe target. `output_config.format` pins the response to a schema that
contains no nutrition fields.

**Resolve.** Each ingredient name → USDA entry, scored on token overlap and data
provenance (Foundation and SR Legacy beat Branded). An alias map handles the gap
between cooking language and database language — a bare search for "spaghetti"
returns *spaghetti sauce* and restaurant meals, and "double cream" returns
cheeseburgers. Both verified against the live API.

**An unresolved ingredient rejects the whole recipe.** Treating it as zero
calories is exactly how competitors end up publishing a carbonara at 300 kcal.

**Validate.** Plausibility bounds on the *computed* result catch the failure that
reads perfectly and is nutritionally absurd: a gram weight off by a factor of
ten. Allergens are derived from resolved ingredient names, never from the
model's claim, and a recipe tagged vegan that resolves to dairy is rejected —
the diet filter is a promise to the user.

---

## Sync

Local-authoritative, last-write-wins on `updated_at`, except `journal_entries`
which are append-only and cannot conflict.

Every mutation writes its row and enqueues a `sync_outbox` entry **in the same
transaction**, so a crash cannot leave a saved-but-never-queued entry. A
background worker drains the outbox; rows that fail repeatedly keep their
`last_error`. Deletes are soft (`deleted_at`) so a deletion made offline
propagates rather than being resurrected by the next pull.

---

## Security

RLS on all 17 server tables, verified by
[`supabase/test/rls.test.mjs`](../supabase/test/rls.test.mjs), which runs the
real migrations against real Postgres (PGlite, WASM — no Docker needed) and
proves with two users that:

- each user sees only their own journal and weight history;
- the food library is shared, because a barcode lookup must resolve for everyone;
- a user cannot attribute an entry to someone else;
- a user cannot mark their own submission `verified` — otherwise the badge means
  nothing;
- child rows inherit ownership through their parent.

**RLS and GRANT are separate gates and both must be open.** A table with perfect
policies and no GRANT returns "permission denied" — found by running the tests,
and now explicit in the migration so it applies to a bare Postgres identically.

Other properties:

- The Anthropic key lives only in Edge Function secrets.
- Progress photos have no server table. They stay on the device.
- The `anon` role is granted nothing; Daylish works offline before sign-in.

---

## Deferred, and honestly so

| Feature | Why not yet |
|---|---|
| **Apple Watch app, Lock Screen widget** | Need native Swift targets (WidgetKit/watchOS). Reachable from Expo via `@bacons/apple-targets` + EAS, but require a paid Apple Developer account and are a separate workstream. |
| **HealthKit** | Needs a development build; cannot run in Expo Go. The journal is written against an adapter interface so it drops in once EAS builds exist. |
| **Meal-plan generator, prep-day copilot, household mode, restaurant mode, food-mood correlation, social challenges** | Specified here and modelled in the schema (`meal_plans`, `meal_plan_slots`, `pantry_items`, `mood_entries` all exist); not built in this pass. |
| **Recipe library** | The pipeline is built and tested, but needs an `ANTHROPIC_API_KEY` to run. Until it does, the **Meals tab is hidden** (`href: null` in `app/(tabs)/_layout.tsx`) — every control on it depends on recipes, so it would ship as four sections of dead buttons. The screen is kept, not deleted: once the pipeline has populated the library, restoring the tab is one line. Ideas does not depend on it, and ranks the user's own logging history instead. |
| **Voice logging** | The Edge Function contract is the same shape as photo logging; the on-device speech capture is not wired up. |

---

## Verification

Everything below runs on a machine with no Xcode and no Docker:

```bash
npm run typecheck     # tsc --noEmit across all workspaces
npm test              # core + pipeline unit tests
npm run test:rls      # migrations + RLS against real Postgres (WASM)
npm run mobile        # Metro; scan the QR with Expo Go
npm run pipeline -- --dry-run --limit 3   # needs ANTHROPIC_API_KEY
```

`cd apps/mobile && npx expo export --platform ios` proves the whole app bundles
without a device.
