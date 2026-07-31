# Daylish

**Your whole day, delicious.**

A meal-prep and nutrition app: food journal, barcode scanning, AI-generated
recipes with real nutrition, adaptive calorie targets, and a prep-day planner.

The rule the architecture is built around: **the language model never produces a
nutrition number.** It writes recipes and identifies food in photos; every
calorie and gram is computed from USDA FoodData Central by shared code.

---

## Quick start

```bash
npm install
npm run typecheck     # all workspaces
npm test              # unit tests + app runtime smoke test
npm run test:rls      # migrations + RLS against real Postgres (WASM, no Docker)
npm run verify:sync   # backup + restore against the live project (throwaway accounts)
```

`npm test` includes a **runtime smoke test** (`apps/mobile/test/`) that mocks the
two native modules and then *executes* the real repositories — migrations,
onboarding, logging, copy-day, adaptive recalibration — against in-process
SQLite. It exists because type-checking and bundling both pass on code that
throws the instant it runs; see [the note on Hermes globals](apps/mobile/src/lib/ids.ts).

Run the app on your phone:

```bash
npm run mobile        # then scan the QR code with Expo Go
```

**Signing in is required.** The app needs `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `apps/mobile/.env` to get past the
sign-in screen; without them it boots to an error explaining exactly that.

Past sign-in it needs nothing else. The diary is on-device SQLite, so onboarding,
journal, barcode scanning and logging all work without a connection and without
any other API key — barcode lookups hit Open Food Facts, which needs no key.

Two properties worth knowing before changing anything here:

- **Signing out never deletes local data.** Rows stay, scoped by user id, and
  come back when that account signs in again.
- **The diary is backed up to the account, and restored onto a fresh device.**
  Reads still come from local SQLite only — the push runs behind the app on
  sign-in and on foreground, and the restore runs once, on a device holding
  nothing for that account. Two populated devices are deliberately *not*
  reconciled; see `apps/mobile/src/data/sync.ts`.
- **The adoption path in `account.ts` is unreachable.** It rewrites a
  pre-account diary onto the auth id, and dates from when the app worked before
  sign-in. Every screen now sits behind a session guard and nothing calls
  `getOrCreateLocalUser`, so no anonymous diary can exist. Kept in case
  pre-sign-in use ever returns; do not rely on it in the meantime.

### Building the app

Expo Go cannot run this any more once purchases are enabled — `react-native-purchases`
is a native module and Expo Go contains a fixed set. The app still *starts* in
Expo Go and simply stays on the free tier, which keeps the fast dev loop usable
for everything except the store.

```bash
npm i -g eas-cli && eas login
eas init                     # writes the project id into app.json
eas build --profile simulator --platform ios   # runs in the iOS simulator
eas build --profile development --platform ios # a real device
```

`eas.json` uses `appVersionSource: "remote"`, so EAS owns the build number and
`production` auto-increments it — there is no `buildNumber` to bump by hand.

**Set the environment variables on EAS before the first build.** `apps/mobile/.env`
is gitignored and therefore not uploaded, so a build without them produces an app
that boots to the missing-credentials screen:

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://…
eas env:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_…
```

### Expo SDK version

**The project is pinned to Expo SDK 54** so it runs in the Expo Go build
currently on the App Store. Expo Go supports exactly one SDK at a time: a
project on SDK 57 simply will not open in an Expo Go that speaks 54, and the
failure is an unhelpful "incompatible" screen rather than an error you can act
on.

If the App Store offers you an older Expo Go than expected, the usual cause is
your iOS version — Apple serves the newest build your device can run, so an
older iOS pins you to an older Expo Go.

To move the project to a newer SDK later:

```bash
cd apps/mobile
npx expo install expo@^55 --fix   # substitute the SDK you want
npx expo install --check          # confirm every package aligns
npm run typecheck && npx expo export --platform ios
```

Nothing in `app/` or `src/` is SDK-specific — the upgrade is a dependency
change, not a rewrite.

---

## Layout

| Path | What it is |
|---|---|
| `apps/mobile/` | Expo app (expo-router, TypeScript) |
| `packages/core/` | Goal engine, nutrition math, schemas, allergen detection |
| `packages/db/` | Drizzle schema + generated SQLite migrations |
| `services/recipe-pipeline/` | Batch recipe generation, USDA resolution, validation |
| `supabase/` | Postgres migrations, RLS policies, AI Edge Functions |
| `docs/` | [Architecture](docs/architecture.md) · [App Store listing](docs/app-store-listing.md) |

---

## Environment

None of these are needed to run the app locally; each unlocks a layer.

| Variable | Unlocks | Where |
|---|---|---|
| `USDA_API_KEY` | Full food search, via the `usda-search` function | Supabase secrets |
| `USDA_API_KEY` | Ingredient resolution at volume | shell, for the pipeline |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | In-app purchases (needs a dev build) | `apps/mobile/.env` |
| `ANTHROPIC_API_KEY` | Recipe generation, photo logging, coach | shell / Supabase secrets |
| Supabase URL + anon key | Sync, auth, shared recipe library | `apps/mobile/.env` |

A free USDA key: <https://fdc.nal.usda.gov/api-key-signup>. `DEMO_KEY` works but
rate-limits within a handful of requests.

---

## The recipe pipeline

```bash
# Prove the nutrition maths on 3 recipes before spending a batch
npm run pipeline -- --dry-run --limit 3

# Submit the full 500-recipe run (Batch API, 50% cost)
npm run pipeline -- --target 500

# Collect and validate once the batch finishes
npm run pipeline -- --collect <batch_id>
```

The dry run prints each ingredient, the USDA entry it resolved to, and its
contribution to the total — so the arithmetic behind every published macro is
auditable before anything ships.

---

## Regenerating the database schema

```bash
npm run generate -w @daylish/db   # drizzle-kit generate + inline for the bundle
```

React Native cannot read `.sql` files at runtime, so migrations are inlined into
`packages/db/src/migrations.generated.ts` by that script.

---

## What is not built yet

Apple Watch app and Lock Screen widget (need native Swift targets), HealthKit,
and the meal-plan generator, prep-day copilot, pantry, household mode and
restaurant mode. All are specified in
[the architecture doc](docs/architecture.md#deferred-and-honestly-so) and the
schema already models them.

**Deliberately not built:** AI photo logging. The Edge Function exists and is
unreachable from the app on purpose — the model would supply the portion weight,
and calories scale linearly with mass, so it is the one feature that can produce
a confidently wrong number in an app whose entire claim is that it does not.

**Reconciling two phones in use at once.** Backup and restore are built; live
multi-device sync is not, and the store copy deliberately avoids the word.
