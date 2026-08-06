# Context

Handover notes for picking this up in a fresh session. Not a changelog — the
point is the decisions and the traps, so neither gets re-litigated or re-stepped-in.

Start with [README.md](README.md) for what the project is and how to run it, and
[docs/architecture.md](docs/architecture.md) for why it is shaped the way it is.

---

## Where it stands

Feature-complete for a 1.0 as scoped, **and it builds** — an EAS `development`
build finished on 31 July 2026, so the native side compiles: the modules, the
config plugins and the new architecture. That was the critical path and it is
no longer open.

What is still untested is narrower than "does it build": the app has never been
*used* on a handset, so purchases, notifications and the history calendar have
never run outside a simulator. Note the build took three and a half hours
wall-clock, nearly all of it queue time — budget for that, not for compile time.

| | State |
|---|---|
| Journal, barcode, search, quick-add, copy-day | Shipped |
| Meals: 496 recipes, ~40 filters, variants, scaling | Shipped |
| Save / cooked recipes, shopping list | Shipped |
| Ideas: own foods **and** recipes ranked against remaining macros | Shipped |
| Backup to account + restore on a new device | Shipped, verified live |
| Free/Premium tier with gates | Shipped |
| Purchases (RevenueCat) | Written; a Test Store key is now set so it can be run |
| Notifications: 4 local kinds + billing push | Shipped, never run on a device |
| Two phones in use at once | Deliberately not built |

Verification: `npm test` (153 mobile, 143 core, 42 pipeline) ·
`npm run test:rls` (15, real Postgres via PGlite) ·
`npm run verify:sync` (live Supabase, throwaway accounts) ·
`npx expo export --platform ios`.

---

## Decisions — do not re-open without new information

**Free is a calorie tracker. Premium is a health app and a planner.**
The whole tier lives in [`packages/core/src/entitlements.ts`](packages/core/src/entitlements.ts)
as data, so moving a feature across the line is a one-file edit. Three things are
free permanently and are not negotiable: **logging** (it is the product's primary
metric), **allergen filtering** (safety), and **export/backup** (someone's diary
is theirs).

**Weight *logging* stays free even though the trend is paid.** Adaptive targets
need ~14 days of weigh-ins before they can say anything. If free users had no
reason to weigh in, the headline paid feature would be blank for a fortnight
after purchase.

**The free 50 recipes are curated, not sliced.** A naive first-50 gives a
Mediterranean user *zero* recipes and a pescatarian *three*; they uninstall
rather than upgrade. [`build-free-recipes.mjs`](apps/mobile/scripts/build-free-recipes.mjs)
picks greedily against per-diet and per-slot floors and fails the build if it
cannot meet them. Browse stays free for all 496 — hiding them means nobody
learns what they are missing.

**Ideas never suggests a locked recipe.** Pushing something and charging at the
tap is the most resented shape a paywall takes. Locks belong in browse, which is
a place someone chose to go.

**AI photo logging is scrapped, not deferred.** The Edge Function exists and is
unreachable on purpose. The model supplies the *portion mass*, and calories
scale linearly with mass — so it is the one feature that can produce a
confidently wrong number in an app whose entire claim is that it does not.

**Notifications are local by default and push only where they cannot be.**
Anything derived from the diary — remaining macros, a moved target, a stale
weight trend, a fasting window — is scheduled on the device by `planReminders`,
because the goal engine runs there. Computing any of it server-side would be a
second implementation of the same maths, and the first time the two disagreed the
app would push a number it does not show. Push therefore carries exactly two
things, both from the RevenueCat webhook: `BILLING_ISSUE` and `EXPIRATION`.

**There is no marketing push, and that is a decision, not an omission.**
`CANCELLATION` deliberately sends nothing — someone who just cancelled knows they
cancelled, and a message at that moment is a win-back. The test every notification
has to pass is in the `ReminderKind` docstring: does this tell someone something
true, about them, that they do not already know? Re-engagement never passes it,
and notification permission is one-shot on iOS, so spending goodwill on nagging
costs the transactional messages too.

**Backup and restore, not sync.** One active device. The store copy avoids the
word "sync" deliberately. Restore only runs on a phone holding nothing for that
account, which is what makes it merge-free and safe to do silently.

**Source badges mark the exception, not the norm.** "USDA verified" used to
appear on nearly every row; a stamp on everything trains people to stop reading
stamps, and the estimate warning — the only one that matters — vanished with it.
Now only unverified entries are badged.

**Recipe references are text keys with no foreign key** (migration 0006). Device
recipe ids are `seed:shakshuka-light`, derived from the title so re-seeding is
idempotent; the server's `recipes.id` is a uuid. The FK could never have
matched. The library ships in the bundle and the server does not own it.

---

## Bugs found and fixed — do not reintroduce

Each of these was live in the codebase and is now covered by a test.

- **`saved_meals` was in neither the reset nor the account-delete list.** The app
  would have destroyed saved meals on request while being unable to hand them
  over. There is now a test that enumerates the **live schema** for every table
  with a `user_id` and asserts a reset empties all of them — it fails if someone
  adds a table and forgets the lists.
- **`user.ts` never enqueued anything**, so a new account's profile, first
  weigh-in and first goal — everything a new phone needs — were invisible to the
  backup. The push now derives pending work from `synced_at` **on the rows**, not
  from `sync_outbox`, so a repository that forgets to enqueue still gets pushed.
- **`recordWeight` queued a discarded id.** Its upsert keeps the original row on a
  same-day correction, but the code enqueued a freshly minted UUID matching no
  row, so every weight correction silently failed to back up.
- **Millisecond timestamps cannot order two writes in the same millisecond**, so
  an edit made as the push stamped a row would never be backed up.
  [`nowIso()` in `lib/dates.ts`](apps/mobile/src/lib/dates.ts) is now monotonic
  and shared by all five repositories.
- **JSON columns were sent to Postgres as text.** `'["peanuts"]'` was stored as a
  JSON *string*, so a restored allergen list stopped being a list — while
  `.includes('peanuts')` still returned true by substring coincidence. **Only
  found by running against the live database**; a fake echoes back whatever it is
  given. Guarded by `npm run verify:sync`.
- **`rankRecipes` excludes the entire library when equipment is empty** (every
  recipe needs at least a hob). An empty profile kit means "not told", not "owns
  nothing".
- **Recipe affinity had saving weighted above cooking**, contradicting its own
  docstring. Now named constants.

---

## Traps

- **Expo Go cannot run purchases.** `react-native-purchases` is a native module.
  The SDK is loaded through a guarded dynamic import so Expo Go degrades to the
  free tier instead of crashing — do not convert it to a top-level import.
- **`apps/mobile/.env` is gitignored, so EAS will not upload it.** Set the
  variables with `eas env:create` or the first build boots to the
  missing-credentials screen.
- **The adoption path in `account.ts` is dead code.** It predates mandatory
  sign-in and nothing can reach it. Kept, but do not rely on it.
- **`sync_outbox.payload` is partial and inconsistent** across repositories and
  cannot rebuild a row. The worker reads the current row instead. Do not start
  trusting the payload.
- **Regenerate the free 50 after changing the library:**
  `npm run seed:free -w @daylish/mobile`.
- **expo-doctor reports 17/18.** The metro config "failure" is a deliberate,
  documented monorepo override — not a fault.

---

## Traps added with notifications

- **`aps-environment` must not be set in `app.json`.** EAS writes it per build
  profile — `development` for a dev build, `production` for a release. Pinning it
  by hand ships a development APNs entitlement to the App Store, where push then
  fails silently for everyone.
- **A push token is unique on `token` alone, never on `(user_id, token)`.**
  Two accounts on one handset get the same token from APNs; keyed the other way
  both rows stand, and the first account's billing messages arrive on a phone the
  second account is now holding. Covered by a test in `npm run test:rls`.
- **`getExpoPushTokenAsync` needs the EAS `projectId`**, so token registration is
  a documented no-op until `eas init` has run. `registerPushToken` reports
  `no-project-id` rather than failing.
- **Registration never prompts.** Permission is requested in exactly two places,
  both of them moments someone has asked for the thing: turning reminders on in
  the You tab, and immediately after a successful purchase
  (`enableBillingAlerts`). iOS allows one prompt ever, and spending it on a
  background call at launch is how an app becomes permanently unable to notify.
  Both are preceded by a plain-words explanation, because the system prompt gives
  no context beyond the app's name.
- **`react-native-purchases-ui` is a native module too**, and is loaded through
  the same guarded dynamic import as the SDK for the same reason. Do not convert
  it to a top-level import.

---

## The one piece of unverified code

**RevenueCat integration in [`entitlement.tsx`](apps/mobile/src/state/entitlement.tsx).**
It typechecks and bundles; not one line has run. Specifically unverified: that
`configure()` accepts the key shape, that `entitlements.active['premium']`
matches the entitlement identifier in the dashboard, and the purchase and restore
flows end to end.

**A Test Store key is now set in `apps/mobile/.env`**, which retires most of that
list without waiting for the Paid Applications Agreement — see
[`docs/revenuecat-setup.md`](docs/revenuecat-setup.md). The entitlement does not
exist in the dashboard yet; create it as `premium` and no code changes.

**The notification work is in the same position.** All four local kinds and the
billing push are written, tested against the policy in `@daylish/core` and a real
Postgres for the token table, and have never run on a handset — token
registration cannot even be attempted until `eas init` supplies a `projectId`.

Everything else this session was checked against a fake, a real Postgres, or the
live project.

---

## Blocked on the owner — none of it is code

1. **Paid Applications Agreement** — legal entity, bank, tax. Weeks of lead time,
   and it now blocks nearly everything else: the subscription products, the
   Small Business Program enrolment, and any build that can take money.
2. **StoreKit products** in App Store Connect — `com.daylish.app.premium.monthly`
   and `…yearly`, both auto-renewable, one subscription group. Lifetime was
   dropped from 1.0; it can be added to the offering later without an app
   update. Prices are decided: see [`docs/pricing.md`](docs/pricing.md).
3. **Swap the RevenueCat key.** `development` and `preview` carry a `test_` key;
   `production` deliberately carries none, so the paywall shows the argument for
   Premium without buttons that cannot charge. The `appl_` key goes on
   `production` only, once products exist.
4. **`supabase functions deploy revenuecat-webhook --no-verify-jwt`** +
   `supabase secrets set REVENUECAT_WEBHOOK_SECRET=…`, then point RevenueCat at
   it. Until then billing notifications simply do not send.
5. **`supabase functions deploy usda-search`** + `supabase secrets set USDA_API_KEY=…`
   Until then food search falls back to Open Food Facts and the local library,
   which is the intended degradation.
6. **Use the app on a handset.** Nothing below the build has been exercised in
   anger: purchases, the four local notification kinds, barcode scanning against
   real packets, and the history calendar's layout. A `preview` build is the one
   to install — `production` has neither the RevenueCat key nor the premium
   override, so the paid surfaces stay locked on TestFlight.

**Done since this list was written:** `eas init` and the first builds; the
repository and its GitHub remote; the RevenueCat App Store app, its in-app
purchase key and its server-notification URL; the site at
[`services/site`](services/site), which serves the privacy policy, the Terms of
Use required for auto-renewing subscriptions, support and an accessibility
statement.

---

## Store listing

[`docs/app-store-listing.md`](docs/app-store-listing.md) is current for the
backup/restore change and the badge removal. **App Privacy now needs two
Health & Fitness rows** — the diary is transmitted, which it was not before.
Confirm the exact category split against App Store Connect's own wording.

Still stale and deliberately parked: it says recipes are not in 1.0 and the Meals
tab is hidden, and the keyword field excludes "recipes" and "meal prep" because
the app could not deliver them. It can now, and those are high-volume terms.

---

## Not done, by choice

Pantry, meal plans and prep-day (tables exist, no UI) · Apple Watch, widgets,
HealthKit (need native targets) · live multi-device sync · AI photo and voice
logging (scrapped — see above).

The free experience has **never been used on a device**. Flip the testing switch
off in Premium and live with it for a day before committing to the tier shape;
the line between "appropriately limited" and "crippled" is a feel judgement.
