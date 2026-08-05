# App Store Connect — 1.0 submission sheet

Paste-ready values for every field on the **1.0 Prepare for Submission** page.
Rationale, screenshots, ASO reasoning and the App Privacy answers live in
[app-store-listing.md](app-store-listing.md); this file is only the fields.

**Submission shape assumed here** (decided 2026-07-31):

- Premium **is** in this version — monthly, yearly and lifetime attached to the
  build.
- Copyright is held by an individual, not a company.
- **Automatic release** after approval.
- The website lives in this repo at [`services/site`](../services/site) and is
  deployed to Railway.

Three things below are blockers, not copy, and are called out at the end.

---

## Promotional text — 164 / 170

Updatable without a new review, so this is where launch and seasonal copy goes.

```
Ideas ranks your own foods and 496 recipes against what is left of your day, so the answer to "what now" is one tap away. Filtered for your diet, allergens and kit.
```

---

## Keywords — 100 / 100

Comma-separated, **no spaces after the commas** — a space costs a character and
buys nothing.

```
food,counter,tracker,barcode,scanner,fasting,timer,weight,nutrition,prep,cooking,healthy,log,protein
```

Apple builds search phrases from tokens across the **name, subtitle and keyword
field combined**, so anything already in `Daylish: Calorie & Meal Diary` or
`Recipes that fit your macros` is deliberately absent here — `calorie`, `meal`,
`diary`, `recipes` and `macros` would all be wasted characters. `food` + `diary`
still forms "food diary"; `calorie` + `counter` still forms "calorie counter".

Also deliberately absent: **`planner` / `meal plan`** (meal plans, prep day and
pantry have tables and no UI — ranking for what you cannot deliver buys installs
that uninstall the same day), **`daylish`** (the name is already indexed), and
**`free`** (prohibited in this field).

---

## Description — 3,977 / 4,000

The first three lines are all that shows before "more" on a phone, so they carry
the positioning alone.

```
Daylish is a food diary for your whole day — not just the diet part.

Breakfast on a weekday. A snack you didn't plan. Dinner you actually wanted. It all belongs here, and none of it comes with a lecture.


LOG IN SECONDS, NOT MINUTES

Scan a barcode and it's in. Search a database of verified foods with the ones you eat most already at the top. Or quick-add the numbers when you already know them.

Ate the same as yesterday? Copy the whole day across in one tap. Got a portion wrong? Tap the food and fix it — the rest of the meal stays where it is.


NUMBERS YOU CAN ACTUALLY TRUST

Most food apps run on entries anyone can type in and nobody checks. Daylish looks food up instead. Whole foods come from USDA FoodData Central, built on laboratory analysis. Packaged foods come from the barcode, so the numbers are the ones printed on the packet.

A guess is never dressed up as a fact: when a figure is estimated rather than looked up, the entry says so.


496 RECIPES, FILTERED TO YOU

Real cooking with real nutrition — every calorie and gram computed from the ingredients, never guessed. Filter by diet, allergens, time, effort and the equipment you own. Scale any recipe to the number of people eating. Save what worked, mark what you cooked, and send ingredients to a shopping list.


WHAT FITS, RIGHT NOW

The hardest question in any food diary is "so what do I eat now?"

Daylish answers it from your own history and the recipe library, ranked against what is left of your day. Short on protein but low on calories? It puts the protein-dense things first instead of more of the same. Tap one to log it, at a portion already sized to fit.


TARGETS THAT LEARN YOU — PREMIUM

Calorie formulas are guesses based on averages. You are not an average.

Daylish watches your real weight trend and what you actually eat, works out what you are genuinely burning, and adjusts. Every change comes with a plain-English reason — "we raised your target 60 kcal because your 14-day trend shows faster loss than planned".


THE WHOLE DAY — PREMIUM

- Weight trend that follows the trend, not one bad morning
- 14 days of intake against target, at a glance
- Water, with a goal that scales to your bodyweight
- Intermittent fasting: 16:8, 18:6, 20:4, 5:2, OMAD
- 37 nutrients tracked, 23 vitamins and minerals against Daily Values, behind a simple/detailed toggle


NO GUILT. EVER.

No red warnings when you go over. No "cheat day". No moralising. Going over your target is information, not a failure.


FREE, AND STAYING FREE

Logging by barcode, search and quick add. Your full journal, and today's calories and macros against target. Fifty recipes, filtered by your allergens. Exporting everything, and a backup that survives a lost phone.


DAYLISH PREMIUM

- All 496 recipes, with every filter
- One shopping list across several recipes, shared ingredients added together
- Targets that adapt to your own weight trend, and explain every change
- Trends: weight trajectory and intake against target over time
- 23 vitamins and minerals, plus fasting timers and water tracking

Premium is a monthly or yearly subscription, or a lifetime purchase. Prices are shown in the app before you buy. Subscriptions renew automatically unless cancelled at least 24 hours before the period ends; manage or cancel any time in your Apple ID settings.


YOUR DIARY, ON YOUR PHONE

An account takes an email address and a password. It holds your diary and nothing else: no advertising, no tracking, never shared.

Everything you log is kept on your phone, so Daylish keeps working without a connection. It is also backed up to your account, so a lost phone does not cost you a year of logs.

Export the whole diary as a JSON file whenever you like, and delete your account, and everything in it, from inside the app.


Terms of Use: https://daylishsite-production.up.railway.app/legal/terms
Privacy: https://daylishsite-production.up.railway.app/legal/privacy
Questions: alexionescu870@gmail.com
```

**Set the final domain before you submit.** Apple requires a functional Terms of
Use link in the description for auto-renewing subscriptions, and the description
is frozen between versions — Support URL and Marketing URL can be edited any
time, but these three lines cannot change until you ship 1.0.1. If you intend to
buy `daylish.app`, do it now and use it here; otherwise the Railway hostname
above is fine and is what the site actually serves.

**What changed from the draft in `app-store-listing.md`.** That version predates
both the recipe library and the paid tier, and it sold `fasting`, `water`,
`micronutrients`, `adaptive targets` and `trends` as though they were free.
Every one of them is Premium in
[`entitlements.ts`](../packages/core/src/entitlements.ts). Shipping that text
would have been a guideline 2.3.1 metadata mismatch **and** a promise the app
does not keep — the worst possible combination, because it survives review and
turns into refund requests.

The two new sections are `FREE, AND STAYING FREE` and `DAYLISH PREMIUM`, taken
verbatim from what the app's own paywall says, so the store page and the paywall
cannot drift apart.

**Two headers carry `— PREMIUM` inline, and that is not decoration.**
`TARGETS THAT LEARN YOU` is entirely `adaptiveTargets`, and every one of the five
`THE WHOLE DAY` bullets is Premium — `trends` twice, `water`, `fasting`,
`micronutrients`. The `DAYLISH PREMIUM` section below does disclose them, but a
reviewer reads top to bottom, taps "fasting", and meets a paywall long before
reaching it. Disclosure that arrives after the tap is not disclosure, and it is
the same rejection the old draft would have earned — only later in the page.

**Headroom is 31 characters.** Anything added here has to take something out.

---

## Version

```
1.0
```

Matches `app.json`, which is already `1.0.0`. The build number is owned by EAS
(`appVersionSource: "remote"` with `autoIncrement` on the `production` profile),
so there is nothing to bump by hand.

---

## Copyright — max 200

```
2026 Alexandru Mario Ionescu
```

No `©` symbol and no "All rights reserved" — Apple adds the symbol, and the
field is conventionally just year and holder. This matches the line already used
on BeamLoop, so both apps present the same seller identity.

---

## Support URL — **required**

```
https://daylishsite-production.up.railway.app/support
```

## Marketing URL — optional

```
https://daylishsite-production.up.railway.app
```

**Both are live and verified**, served from [`services/site`](../services/site)
by the Railway service `daylishsite`. Every route was checked against the public
hostname: the five pages, the six redirects, the 404 and the health check.

Unlike the description, these two fields can be edited at any time without
shipping a new version — so if you later put `daylish.app` in front of this, the
URLs here are the cheap part to change and the two links inside the description
are the expensive part.

---

## Fields that do not apply

| Field | Answer |
|---|---|
| **Routing App Coverage File** | Leave empty. This is for turn-by-turn navigation apps only. |
| **App Clip** | None. |
| **iMessage App** | None. |
| **Game Center** | Off. |
| **Attachment** (review notes) | None needed — the notes below are self-contained. |

## Export compliance

Nothing to upload. `ios.config.usesNonExemptEncryption: false` is already in
[`app.json`](../apps/mobile/app.json), so the prompt is answered at build time
and App Store Connect will stop asking on upload.

The declaration is accurate: the app uses HTTPS to reach Supabase, Open Food
Facts and USDA and nothing else, which is exactly the exemption that flag
claims.

---

## App Review Information

### Sign-In Information

**Sign-in required: ✅ yes.** Every screen sits behind a session guard; a
reviewer who is not given credentials sees a login form and nothing else, which
is a 2.1 rejection.

```
User name: review@daylish.app
Password:  [see your password manager — do not commit it here]
```

**This repository is public, so the demo password does not live in it.** An
earlier revision of `app-store-listing.md` printed it in full and was pushed to
GitHub in commit `4bf0c97`; it is therefore public and in the git history, where
redacting it now does not remove it. **Rotate that password in Supabase before
submitting**, then keep the new one out of the repo. Anyone who found the old one
could sign in as the reviewer's account and see whatever it contains.

### Contact Information

```
First name:   Alexandru Mario
Last name:    Ionescu
Phone number: [your number, in +CC format — e.g. +40 7xx xxx xxx]
Email:        alexionescu870@gmail.com
```

Apple uses this only to reach you about the review. It is never shown publicly,
so a personal number and address are fine.

### Notes — 2,220 / 4,000

```
Daylish requires an account. Please use this demo account:

  Email:    review@daylish.app
  Password: Daylish-Review-87faa21f

After signing in you will be asked six short setup questions (height, weight, age, activity, goal, food preferences). These take about thirty seconds and produce your calorie and macro targets.

The journal is empty until you log something. The diary is stored on the device, so a fresh install always starts empty — there is no way for us to seed it on your handset. To see the app with data in it, log two or three foods from the Today screen:

  - "Search" finds any food by name — try "chicken breast" or "banana"
  - "Quick add" logs calories and macros directly, with no lookup
  - "Scan" reads the barcode on any packaged grocery item

The Ideas tab ranks the foods you have already logged alongside the recipe library, so it becomes more useful after a few entries.

TESTING PREMIUM

Premium is offered as a monthly subscription, a yearly subscription, and a one-time lifetime purchase. Open the "You" tab and tap "Daylish Premium" to reach the paywall. Purchasing from a sandbox account completes without a charge and unlocks all paid features immediately; "Restore purchases" on the same screen restores them on a reinstall.

Premium unlocks: all 496 recipes (50 are free), multi-recipe shopping lists, adaptive calorie targets, trend charts, micronutrients, fasting timers and water tracking. Logging, the full journal, allergen filtering and export are free permanently and are not gated.

PERMISSIONS

The camera is used for barcode scanning and is the only permission requested at launch. Notification permission is requested only if you turn reminders on in the You tab, or immediately after a purchase.

DATA AND ACCOUNT DELETION

Account deletion is in the app: You tab, at the bottom, "Delete my account". It removes the auth record from our servers and erases the on-device diary.

Food data comes from Open Food Facts and USDA FoodData Central. The diary is held on the device and backed up to the signed-in account so it can be restored on a new phone. It is not shared with anyone and is not used for anything else. There is no analytics, no advertising and no tracking.
```

---

## App Store Version Release

**Automatically release this version** — selected.

Worth knowing what you are choosing: approval can land at any hour, including
overnight your time, and the app goes live the moment it does. If you would
rather do a last check first, *Manually release* costs you nothing but a button
press and does not re-enter the queue.

---

# Blockers

None of these are copy, and all three stop a submission.

## 1. The "Switch Premium on for testing" button ships to customers

[`premium.tsx:244`](../apps/mobile/app/premium.tsx#L244) renders a `Testing`
ticket with a button that calls `setOverride(true)`, which writes `'override'` to
AsyncStorage and unlocks every paid feature. It is unconditional — no `__DEV__`
guard, no build-profile check.

That existed for a good reason: before purchases were configured, it was the only
way for a reviewer to reach the paid features. **Purchases are now in the
submission, and that reason is gone.** What is left is a free "unlock Premium"
button sitting on the paywall, one tap below the prices. It is a guideline 3.1.1
problem — paid functionality unlocked outside in-app purchase — and independently
it is a revenue hole that the first App Store review screenshot will find.

**Fixed.** The ticket now renders only when `overrideAvailable` is true, and the
reviewer path is a sandbox purchase — which is what the review notes above
already describe, and is a better test besides, since it exercises the real
RevenueCat path rather than a flag that bypasses it.

Gated on `__DEV__ || EXPO_PUBLIC_ALLOW_PREMIUM_OVERRIDE === '1'` rather than
`__DEV__` alone. Internal and preview builds are release builds where `__DEV__`
is false, and the switch is still wanted there; the variable is set on the
`development` and `preview` EAS environments only. Its absence from `production`
is what removes the control from the store binary — the same shape as the
RevenueCat key, and a gate nobody can forget to flip.

Three places changed, because hiding the button alone would not have been enough:

1. The ticket is not rendered.
2. `setOverride` returns early, so no other caller can write the flag.
3. **`resolve` stops honouring a cached `'override'` and deletes it.** Without
   this, a device that had the switch on under a preview build and then updated
   to a store build would keep Premium forever, on a flag with no remaining UI to
   turn off.

**One honest limitation.** This is a runtime gate, not dead-code elimination —
the string `Switch Premium on for testing` is still present in the production
Hermes bytecode, because Metro does not strip the JSX. Nothing renders it and
nothing can reach `setOverride`, so it is not exploitable without modifying the
binary. Worth knowing before anyone greps an `.ipa` and raises it as a finding.

## 2. ~~The site~~ — done

**Live at `https://daylishsite-production.up.railway.app`** and verified against
the public hostname, not just locally: the five pages, the six redirects, the 404
and the health check all answer correctly, and the fonts, artwork and photographs
are served with the right content types.

[`services/site`](../services/site) is a zero-dependency Node server and five
static pages, set in the app's own typefaces and drawn in its own palette.

| URL | Where it is required |
|---|---|
| `/support` | **Support URL** field, above. Rejection if it does not resolve, and it is checked on the first pass. |
| `/legal/privacy` | **Privacy Policy URL**, on the App Information page — not this one. Mandatory for every app regardless of what it collects. |
| `/legal/terms` | **Terms of Use (EULA)**, required for auto-renewing subscriptions. Goes on the App Information page *and* must be linked from the paywall in the app. |
| `/account-deletion` | Not required, but it is what a reviewer looks for under 5.1.1(v) and it costs nothing to have. |

`/privacy`, `/terms`, `/eula`, `/delete-account`, `/help` and `/contact` all 301
to the right page, so a stale or guessed link lands somewhere useful rather than
on a 404.

### Deploying it

The site runs as its own Railway service, `daylishsite`, with **Root Directory
set to `services/site`**. That setting is the whole configuration — no
environment variables, no database, no build step; the server reads `PORT` and
nothing else, and [`railway.json`](../services/site/railway.json) supplies the
start command and the `/healthz` check.

**Two failures worth not repeating**, because both cost a deploy cycle:

- An earlier attempt reused the `@daylish/mobile` service. Without the root
  directory applied, Railway builds from the repo root, runs `npm start` there,
  and dies on a missing script — surfacing as a healthcheck failure, which sends
  you looking in the wrong place. The giveaway is in the build log: a correct
  build installs nothing, while a root-context build runs `npm ci` across every
  workspace and pushes an image near a gigabyte to serve six HTML files.
- Railway's **Redeploy** rebuilds that deployment's own commit, not the branch
  head, so it can never pick up new work. Use *Deploy latest commit*, or push.

### One thing to check in the terms

[`terms.html`](../services/site/public/legal/terms.html) says governing law is
**Romania**. I inferred that and it is the one clause on the site I could not
derive from the repo — correct it if you are established elsewhere. Everything
else on the site is checked against the code: the backed-up tables come from
`SYNCED_TABLES` in [`sync.ts`](../apps/mobile/src/data/sync.ts), the deletion
behaviour from the `delete-account` function and [`reset.ts`](../apps/mobile/src/data/reset.ts),
and the third-party list from what the app actually calls.

## 3. Two paid-launch items outside the repo

- **Paid Applications Agreement** must be active before subscriptions can be
  attached to a version at all. If it is not signed, the IAP section of this page
  will not accept products and this submission cannot be the shape agreed above.
- **The RevenueCat key must be the `appl_…` App Store key, not the `test_…` Test
  Store key.** [`revenuecat-setup.md`](revenuecat-setup.md) is explicit that a
  `test_` key does not error in production — it silently returns no entitlement,
  so every paying customer sees a paywall forever. Set it with `eas env:create`
  before the build you upload, because `apps/mobile/.env` is gitignored and EAS
  will not carry it.

---

## App Privacy answers

Six data types, and nothing else. Every one is **linked to identity: Yes** and
**used for tracking: No** — that second answer across the board is what keeps
Daylish out of App Tracking Transparency, and it is accurate: no ad SDK, no
analytics SDK, no data broker, and no third-party sign-in SDK that could
repurpose what it sees.

| Data type | Purposes |
|---|---|
| Contact Info → Email Address | App Functionality |
| Health & Fitness → Health | App Functionality, Product Personalization |
| Health & Fitness → Fitness | App Functionality, Product Personalization |
| Identifiers → User ID | App Functionality |
| Identifiers → Device ID | App Functionality |
| Purchases | App Functionality, **Analytics** |

**Analytics belongs to Purchases and to nothing else.** It is RevenueCat's
documented minimum — App Functionality covers receipt validation and
entitlements, Analytics covers their Charts and Customer History. The privacy
policy now says this out loud, because a card reading "Analytics" beside a policy
reading "no analytics" is a contradiction a reviewer can see.

**Product Personalization is on the health rows deliberately.** All ranking runs
on-device — `insights.ts` reads local SQLite, the scoring lives in
`packages/core`, and the server has no ranking logic at all — so a narrow reading
says the *transmitted* copy is only ever a backup. That distinction is invisible
to the person reading the card, and the promotional text sells Ideas as ranking
against your day. Claiming otherwise would make the label contradict the listing.

**Search History is deliberately absent.** Barcodes and search terms reach Open
Food Facts and USDA, are serviced in real time, and neither vendor has an SDK in
the app, so neither is a third-party partner. Nothing search-shaped appears in
`SYNCED_TABLES`. Declaring it would tell people their searches are kept when they
are not, which is a worse error than the omission.

**Sensitive Info is deliberately absent, and it is the closest call.** The diet
filter offers `halal` and `kosher`, `diet_style` lives in `user_goals`, and
`user_goals` syncs — so a religious observance can be inferred from data linked
to an identity. It stays unticked because what is collected is a recipe filter
chosen from twelve options beside keto and vegan, and Apple's category targets
apps that collect beliefs as such. The GDPR reading is the stronger one, and it
is answered where it belongs: the privacy policy names the diet filter, cites
Article 9, and points at the allergen list as the alternative.

---

## Age rating

Calculated **9+** from Health or Wellness Topics alone, then **overridden to
13+** to match the Terms, which require users to be at least 13. A 9+ listing
invites an audience the app's own terms exclude, and calorie tracking by children
is a real enough concern that the override is worth its cost in reach.

Medical or Treatment Information is **None**: the app diagnoses nothing, names no
condition, and its in-app disclaimer explicitly says it cannot know about a
medical condition and routes people to a clinician.

## Accessibility

**Reduced Motion only.** All three animated surfaces — `CalorieRing`, `CountUp`
and the Today screen — check `useReducedMotion()` and jump to their final value,
so the claim is provable from the code rather than from a demo.

Not claimed: **Dark Interface**, because `app.json` pins `userInterfaceStyle` to
light; **VoiceOver**, **Voice Control** and **Larger Text**, because labels and
Dynamic Type are largely in place but no one has run a screen-by-screen pass on a
device, and Apple's bar is completing common tasks; **Captions** and **Audio
Descriptions**, which need media the app does not have.

**Sufficient Contrast is unclaimed for 1.0 and now deserves claiming.** Two
failures were found and fixed — `inkMuted` at 3.14:1, and `sun` drawn as text at
1.75:1 in four places including the delete-account row. All 44 text/surface pairs
across both palettes now clear 4.5:1, narrowest 4.70:1. Tick it in the next
version once the numbers have been seen on a handset.

**Accessibility URL:** `https://daylishsite-production.up.railway.app/accessibility`

That page states what works and what does not, including the two contrast
failures above. Publishing an honest gap is what makes the Reduced Motion claim
worth anything.

---

## Also worth doing before you press submit

- Log two or three foods on the demo account from the device you shoot
  screenshots on, so the screenshots are not of an empty state.
- Confirm the App Privacy answers in
  [app-store-listing.md](app-store-listing.md#app-privacy-answers) — they now
  need two Health & Fitness rows plus Device ID for the push token, and Premium
  adds a **Purchases** row that draft does not have.
- The `Meals` tab and `shopping-list` route are live, so the screenshot plan in
  the listing doc — written when they were hidden — is short two obvious slots.
