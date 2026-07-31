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

## Description — 3,974 / 4,000

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


TARGETS THAT LEARN YOU

Calorie formulas are guesses based on averages. You are not an average.

Daylish watches your real weight trend and what you actually eat, works out what you are genuinely burning, and adjusts. Every change comes with a plain-English reason — "we raised your target 60 kcal because your 14-day trend shows faster loss than planned".


THE WHOLE DAY

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

An account takes an email address and a password — that is all we ask for. It holds your diary and nothing else: no advertising, no tracking, never shared.

Everything you log is kept on your phone, so Daylish keeps working without a connection. It is also backed up to your account, so a lost phone does not cost you a year of logs.

Export the whole diary as a JSON file whenever you like, and delete your account, and everything in it, from inside the app.


Terms of Use: https://daylish-production.up.railway.app/legal/terms
Privacy: https://daylish-production.up.railway.app/legal/privacy
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
https://daylish-production.up.railway.app/support
```

## Marketing URL — optional

```
https://daylish-production.up.railway.app
```

**The site is written and in the repo** at [`services/site`](../services/site) —
it just has to be deployed. See *Deploying the site* below. Confirm the hostname
Railway gives the service and correct these two fields if it differs; unlike the
description, both can be edited at any time without a new version.

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

The fix is to render that ticket only under `__DEV__`. The reviewer path becomes
a sandbox purchase, which is free for them and is what the review notes above
already describe.

I have not made this change — say the word and I will.

## 2. The site is written but not deployed

[`services/site`](../services/site) is a zero-dependency Node server and five
static pages, styled from the app's own palette tokens. Every route was
exercised locally — the pages, the redirects, the 404 and the health check.

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

Railway is already pointed at the repo. This is a monorepo, so the service needs
its root set or Railway will try to build the mobile app to serve a stylesheet:

1. In the Railway service → **Settings → Source**, set **Root Directory** to
   `services/site`.
2. Leave build and start commands empty. [`railway.json`](../services/site/railway.json)
   supplies `npm start` and a `/healthz` health check.
3. **Settings → Networking → Generate Domain.**
4. Put the hostname it gives you into the Support and Marketing URL fields above,
   and confirm it matches the two links inside the description.

No environment variables, no database, no build step. The server reads `PORT`
from Railway and nothing else.

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

## Also worth doing before you press submit

- Log two or three foods on the demo account from the device you shoot
  screenshots on, so the screenshots are not of an empty state.
- Confirm the App Privacy answers in
  [app-store-listing.md](app-store-listing.md#app-privacy-answers) — they now
  need two Health & Fitness rows plus Device ID for the push token, and Premium
  adds a **Purchases** row that draft does not have.
- The `Meals` tab and `shopping-list` route are live, so the screenshot plan in
  the listing doc — written when they were hidden — is short two obvious slots.
