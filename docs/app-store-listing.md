# App Store listing — Daylish 1.0

Draft copy for App Store Connect. Character limits are Apple's and are respected
below; each field shows its count.

**Every claim here describes something that is built and running.** Guideline
2.3.1 (accurate metadata) is among the most cited rejection reasons, and a
reviewer who cannot find an advertised feature rejects the build.

> **Changed in this revision.** Signing in is now required. The previous draft
> sold "no account, no sign-up, works on a plane" — all three are now false, and
> the review notes told reviewers there was no sign-in, which would have failed
> review on first contact. See *What changes when Premium ships* at the end for
> the fields to revisit rather than rewrite.

---

## What 1.0 actually is

Worth stating plainly, because it drives every field below:

**An honest food diary behind an account.** Barcode, search and quick-add logging
against verified nutrition data; targets that adapt to your own weight trend and
explain themselves; suggestions ranked from what you already eat; weight, water
and fasting tracking; full micronutrients behind a toggle. An email-and-password
account is required. The diary is held on the device and backed up to the
account, and comes back when you sign in on a new phone.

**Not in 1.0:** recipes, meal plans, prep day, pantry, AI photo or voice logging,
Apple Health, cross-device sync, and Premium. The Meals tab is hidden until the
recipe library exists.

**The account now pays for itself.** An earlier draft of this document noted the
tension in requiring an account that stored nothing — people signing up for a
benefit that arrived later. That is resolved: the diary is backed up to the
account and restored onto a new phone, so the copy can say plainly what it does.

What it still does *not* do is reconcile two phones in use at once. "Backed up
and restored" is the honest claim; "sync" is not, and is deliberately absent
from the description and the keyword field.

---

## App name (30 char limit)

```
Daylish: Calorie & Meal Diary
```
29 characters.

The bare name "Daylish" is unavailable in this category, so a descriptive suffix
is required regardless; it also earns keyword weight, since the app name is the
highest-weighted ASO field.

**Changed once recipes shipped.** The earlier draft read `Daylish: Calorie &
Macro Diary`, written when the recipe library was not in 1.0. "Macro" is jargon
that self-selects people who already track, and it said nothing about the 496
recipes. "Meal" keeps the highest-volume term in the lead while pointing at the
half of the app the old name ignored; "recipes" itself moves to the subtitle,
which indexes nearly as strongly.

| Option | Chars | Note |
|---|---|---|
| **`Daylish: Calorie & Meal Diary`** | 29 | ✅ chosen — keeps "calorie", gestures at recipes |
| `Daylish: Food Diary & Recipes` | 29 | ✅ widest coverage, but drops "calorie" |
| `Daylish: Macros & Meal Ideas` | 28 | ✅ leads on the differentiator, narrowest reach |

**Do not use "planner" or "meal plan" in the name.** Meal plans and prep-day have
tables and no UI. The name is the field a reviewer checks hardest against
guideline 2.3.1, and it is the one field that cannot be changed between releases
without a rename.

---

## Subtitle (30 char limit)

```
Recipes that fit your macros
```
28 characters.

This is where "recipes" earns its place, and it says what Ideas does in one line:
the library is filtered against what is left of your day, not browsed blind.

Alternates within limit:

- `Your whole day, delicious` — 25 ✅ the brand line, now demoted
- `Food diary & fasting tracker` — 28 ✅ keyword-dense, less brand
- `Track food. Trust the numbers.` — 30 ✅ leads on the honesty differentiator

**Recommendation:** launch with `Recipes that fit your macros`, since the name no
longer carries recipes and nothing else on the product page does. A/B against
`Your whole day, delicious` once there is install volume — the brand line is the
better subtitle only when people already know what the app is.

---

## Keyword field (100 char limit, comma-separated, no spaces after commas)

```
food,counter,tracker,barcode,scanner,fasting,timer,weight,nutrition,prep,cooking,healthy,log
```
92 characters.

**Apple builds search phrases from tokens across the name, subtitle and keyword
field combined**, so a word already in either of the first two is wasted here.
`calorie`, `meal`, `diary`, `recipes` and `macros` all now live in the name or
subtitle, which frees the room that "prep", "cooking", "healthy" and "log" moved
into. `food` + `diary` still forms "food diary"; `calorie` + `counter` still
forms "calorie counter". Nothing was lost by unpacking the phrases.

Deliberately absent:

- **"meal planner", "meal plan"** — still unbuildable. Meal plans, prep day and
  pantry have tables and no UI. Ranking for terms you cannot deliver buys
  installs that uninstall the same day, which costs more in ranking than the
  traffic is worth. **"prep" is included** on the strength of the recipe library
  and shopping list, which is a real answer to a prep-shaped search; "planner" is
  not.
- **"daylish"** — the app name is already indexed; repeating it wastes characters.
- **"diet"**, **"health"** — generic tokens with impossible competition that
  combine into nothing the app is trying to rank for. `food` is the exception and
  is kept: it is the missing half of "food diary" and "food tracker", both of
  which the name and subtitle can no longer form alone.
- **Plurals** — Apple stems automatically; "tracker" and "trackers" are one token.
- **"free"** — prohibited in the keyword field.

---

## Promotional text (170 char limit, updatable without review)

```
Ideas ranks your own foods and 496 recipes against what is left of your day, so the answer to "what now" is one tap away. Filtered for your diet, allergens and kit.
```
164 characters.

**The old line said "No recipe browsing, no guesswork."** That was true when Ideas
only ranked your own foods. It now ranks the recipe library too, so the claim was
inverted — and it undercut the subtitle we are now leading with.

Changeable without resubmitting, so this is where seasonal and feature-launch
copy goes. It leads on Ideas because that is the newest thing and the hardest for
a competitor to copy.

---

## Description (4000 char limit)

```
Daylish is a food diary for your whole day — not just the diet part.

Breakfast on a weekday. A snack you didn't plan. Dinner you actually wanted. It
all belongs here, and none of it comes with a lecture.


LOG IN SECONDS, NOT MINUTES

Scan a barcode and it's in. Search a database of verified foods with the ones you
eat most already at the top. Or quick-add the numbers when you already know them.

Ate the same as yesterday? Copy the whole day across in one tap. Got the portion
wrong? Tap the food and fix it — the rest of the meal stays exactly where it is.


NUMBERS YOU CAN ACTUALLY TRUST

Most food apps run on entries anyone can type in and nobody checks. Daylish looks
food up instead. Whole foods come from USDA FoodData Central — the reference
database built on laboratory analysis. Packaged foods come from the barcode, so
the numbers are the ones printed on the packet.

A guess is never dressed up as a fact. When a figure is estimated rather than
looked up, the entry says so and tells you how sure it is. Everything else was
looked up, which is why it needs no badge to say so.


TARGETS THAT LEARN YOU

Calorie formulas are guesses based on averages. You are not an average.

Daylish watches your real weight trend and what you actually eat, then works out
what you're genuinely burning and adjusts your targets. Every change comes with a
plain-English reason — "we raised your target 60 kcal because your 14-day trend
shows faster loss than planned". No mystery numbers, and nothing happens to your
targets that the app won't explain.


WHAT FITS, RIGHT NOW

The hardest question in any food diary is "so what do I eat now?"

Daylish answers it from your own history. It ranks the foods you already eat
against what's left of your day — and when you're short on protein but low on
calories, it puts the protein-dense things first instead of offering you more of
the same. Tap one to log it, at a portion already sized to fit.

It gets better the more you log, and it needs no recipes and no browsing.


THE WHOLE DAY

- Weight trend that follows the trend, not one bad morning
- 14 days of intake against target, at a glance
- Water, with a goal that scales to your bodyweight
- Intermittent fasting timers: 16:8, 18:6, 20:4, 5:2, OMAD
- 37 nutrients tracked, with 23 vitamins and minerals shown against Daily
  Values — all behind a simple/detailed toggle, so it's there when you want it
  and invisible when you don't


NO GUILT. EVER.

No red warnings when you go over. No "cheat day". No moralising about food.
Going over your target is information, not a failure — and Daylish tells you what
it means instead of how to feel.


YOUR DIARY, ON YOUR PHONE

Creating an account takes an email address and a password — that's all we ask
for. Your account holds your diary so it can follow you to your next phone, and
nothing else: no advertising, no tracking, and it is never shared.

Everything you log is kept on your phone, so Daylish keeps working without a
connection and a weak signal never costs you a meal. It's also backed up to your
account, so a lost phone doesn't cost you a year of logs — sign in on a new one
and your diary is there.

You can export the whole diary as a JSON file whenever you like, and you can
delete your account, and everything in it, from inside the app.


Questions: hello@daylish.app
Privacy: daylish.app/privacy
```

~3,080 characters.

The first three lines are what shows before "more" on a phone, so they carry the
positioning on their own.

**Two editorial notes.**

The old copy promised "FREE FOREVER" and "we will never paywall the barcode
scanner". Both are gone. You are building a paid tier; a promise that shipped on
the store page is one users will quote back at you, and Apple will not care that
you have changed your mind.

There is also no "FREE" section any more. The app *is* free today, and the store
page already says so in the price field — restating it in the description buys
nothing and would have to be rewritten the moment Premium lands.

---

## What's New (4000 char limit)

For 1.0:

```
The first release of Daylish.

Log your whole day in seconds by barcode, search or quick-add, against nutrition
data you can actually trust. Get targets that adjust to your real weight trend
instead of a formula, and always explain themselves. Ask "what fits right now"
and get an answer from the foods you already eat.

We'd genuinely like to hear what's missing — hello@daylish.app.
```

---

## Screenshots plan

Ten slots are available on iPhone 6.9". **Eight are used**, because every one has
to show a screen that exists. Apple shows the first three in search results, so
those three carry the value on their own.

**Do not lead with the sign-in screen.** A login wall in slot 1 is among the
most reliable ways to depress conversion — nobody installs an app to see a form.
Sign-in is disclosed in the description and the review notes, which is where that
information belongs.

| # | Screen | Caption | Why here |
|---|---|---|---|
| 1 | Today, mid-afternoon: ring partly filled, three meals on the day ribbon | **Your whole day, in one place** | The screen people will live in. A real day, not an empty state. |
| 2 | Barcode scanner mid-scan with the confirm sheet sliding up | **Logged in five seconds** | The speed claim, shown rather than asserted. |
| 3 | Ideas: ranked suggestions with portions and "why you're seeing this" | **What fits, right now** | The differentiator nothing else does, in the last search-visible slot. |
| 4 | Search results for a common food — several entries, each with calories per 100 g | **Built on reference data, not guesswork** | The MyFitnessPal comparison. |
| 5 | Adaptive target card with its plain-English explanation sentence | **Targets that learn you** | The MacroFactor comparison. The reason line is the hero. |
| 6 | Progress: smoothed weight trend over raw weigh-in dots | **Progress, explained** | Shows the noise and the signal in one image. |
| 7 | Micronutrient panel in detailed mode | **Vitamins and minerals, when you want them** | Cronometer comparison; the toggle answers "is this overwhelming?". |
| 8 | Fasting timer mid-fast, with the band drawn on the day ribbon | **Fasting, in context** | Shows fasting sitting inside the diary rather than beside it. |

**Production notes**

- **There is no "verified" badge to photograph any more.** Source badges used to
  appear on every logged food; they now appear only on entries that carry a
  caveat — something typed in by hand, or copied off a packet. A food from the
  reference database shows no badge at all, which is the point: stamping every
  row taught people to stop reading the stamp, and the only warning that matters
  disappeared into the noise with the rest. Slot 4 therefore argues the case
  with breadth of results rather than with a badge, and the trust claim is made
  in the description instead.

- Use one consistent fictional day across all eight, with the same foods and the
  same targets. Inconsistent numbers between screenshots read as fake.
- Populate with real logged foods from the real database — placeholder text is
  obvious and erodes exactly the trust screenshot 4 claims.
- The app is light-mode only (`userInterfaceStyle: light` in `app.json`), so
  there is no dark variant to shoot.
- No red anywhere in the UI. It would contradict the no-guilt positioning on the
  store page itself.

---

## App Preview video (15–30s)

One continuous day, no narration, captions only. Start after sign-in.

1. (0–5s) Scan a cereal box at breakfast. The ring moves.
2. (5–11s) Search "chicken", tap a result, log it.
3. (11–18s) Afternoon: open Ideas, tap a suggestion that fits the remaining
   macros. It logs, and the remaining number drops.
4. (18–24s) The weekly target adjustment card appears with its explanation.
5. (24–30s) Logo, "Your whole day, delicious."

Every beat is a real interaction that can be filmed on a device today.

---

## Category and age rating

- **Primary category:** Health & Fitness
- **Secondary category:** Food & Drink
- **Age rating:** 4+ — no objectionable content, no user-generated content, no
  web views, no chat surface.

---

## App Privacy answers

**This changed with accounts.** The previous draft answered *Data Not Collected*.
That is no longer true: the app now holds an email address against an identity.

Declare:

| Data type | Linked to identity | Purpose | Used for tracking |
|---|---|---|---|
| **Contact Info → Email Address** | Yes | App Functionality (account) | No |
| **Identifiers → User ID** | Yes | App Functionality (account) | No |
| **Identifiers → Device ID** | Yes | App Functionality (notifications) | No |
| **Health & Fitness → Health** | Yes | App Functionality (backup and restore) | No |
| **Health & Fitness → Fitness** | Yes | App Functionality (backup and restore) | No |

**The Device ID row is the push token.** `push_tokens` stores an APNs token
against the account so billing problems can reach the phone. It is an identifier,
it is linked to identity, and it must be declared — the fact that it is only ever
used to say "your payment did not go through" does not exempt it. It is **not**
used for tracking, and answering otherwise would drag the whole app into App
Tracking Transparency for no reason.

**Nothing else about notifications is declarable**, because nothing else leaves
the phone. Meal reminders, the evening "what is left" nudge, the weigh-in nudge
and the fasting-window alarm are all scheduled locally by `planReminders` and
never reach a server — which is the point of building them that way.

**Guideline 4.5.4 is satisfied by construction.** Push is not required for the
app to work, permission is asked only when someone switches reminders on, and the
only server-sent messages are transactional billing state. There is no
promotional push, no broadcast channel, and therefore no consent toggle to build.

**The health rows are new and are not optional.** The diary — what you ate,
what you weighed, when you fasted — is now copied to the account so it can be
restored onto a new phone. That is collection of health data linked to an
identity, and it must be declared however benign the purpose. Confirm the exact
category split in App Store Connect against the questionnaire wording; the two
rows above are the honest reading of what a food and weight diary contains.

Nothing else. There is no analytics SDK, no crash reporter, no ad network, and no
tracking of any kind. Diary contents are stored in on-device SQLite and copied to
the account so they can be restored — see the health-data row above.

**One judgment call to make deliberately.** The app sends outbound requests to two
third-party APIs while you use it:

- **Open Food Facts** — receives a barcode or a search term
- **USDA FoodData Central** — receives a search term, when a key is configured

These carry no identifier, no account and no diary content. The conservative
reading is to also declare **Search History → not linked to identity, App
Functionality**. It costs nothing on the product page and removes the argument
entirely.

**`daylish.app/privacy` must resolve before submission** — a dead privacy URL is
an automatic rejection. It now has to cover holding email addresses, the legal
basis for doing so, how deletion works, and the two third-party APIs above.

---

## Review notes

```
Daylish requires an account. Please use this demo account:

  Email:    review@daylish.app
  Password: Daylish-Review-87faa21f

After signing in you will be asked six short setup questions (height, weight,
age, activity, goal, food preferences). These take about thirty seconds and
produce your calorie and macro targets. The journal is empty until you log
something — a brand-new account has nothing in it yet, so a fresh install starts
empty by design.

To see the app with data in it, log two or three foods from the Today screen:

  - "Search" finds any food by name — try "chicken breast" or "banana"
  - "Quick add" logs calories and macros directly, with no lookup
  - "Scan" reads the barcode on any packaged grocery item

The Ideas tab ranks foods you have already logged, so it fills in after a few
entries.

Barcode scanning uses the camera and is the only permission the app requests.

Account deletion is in the app: You tab, at the bottom, "Delete my account". It
removes the auth record from our servers and erases the on-device diary.

Food data comes from Open Food Facts (no key required) and USDA FoodData Central.
The diary is held on the device and backed up to the signed-in account so it can
be restored on a new phone; it is not shared with anyone and is not used for
anything else. There is no analytics, no advertising and no tracking.

There are no in-app purchases or subscriptions in this version.
```

**The demo account is not optional.** An app behind a login that ships without
working credentials is rejected under 2.1, and it is one of the most common
avoidable rejections there is.

**Do not promise the reviewer pre-populated data.** The diary is on-device, so
there is no way to seed an account with a history that appears on the reviewer's
phone — signing in on a clean install always lands on onboarding with an empty
journal. The notes above tell them that plainly and hand them three ways to put
food on the screen in under a minute. Claiming otherwise creates exactly the
metadata mismatch that Guideline 2.3.1 exists to catch.

---

## What changes when Premium ships

Fields to revisit, so this is a revision rather than a rewrite:

- **Description** — add a Premium paragraph naming exactly what is in the paid
  tier and what stays free. Apple requires the price, duration and renewal terms
  to be visible before purchase; the store page is the first place they look.
- **Promotional text** — the natural place to announce a launch price.
- **Review notes** — the demo account must have Premium entitled, or the reviewer
  cannot test the paid features and will reject the build.
- **App Privacy** — adding Purchases is likely; a subscription analytics SDK
  (RevenueCat and similar) adds more, so decide before wiring one in.
- **Age rating and category** — unchanged.

Outside this document, Premium also needs: StoreKit products configured in App
Store Connect, and a Terms of Use (EULA) link alongside the privacy policy.
Auto-renewing subscriptions carry the strictest disclosure rules on the store;
budget review time for them.

**Done in the app:** RevenueCat is wired behind `src/state/entitlement.tsx`,
which removes the need to write receipt validation or store an entitlement
against the account — RevenueCat holds both. The **Restore Purchases** control
(3.1.1) is on the Premium screen. Prices are read from StoreKit rather than
hardcoded, so the paywall cannot disagree with the store.

**Still blocking a paid launch, and none of it is code:** an active Paid
Applications Agreement, a RevenueCat account and API key, products created in
App Store Connect, and an EAS development build — purchases are a native module
and cannot run in Expo Go.

---

## Pre-submission checklist

Items outside this document that block submission:

- [x] **Account-deletion function deployed and verified.** `npm run
      verify:delete-account` passes end to end: it creates a throwaway account,
      deletes it through the function, confirms it can no longer sign in, and
      confirms unauthenticated callers are refused. Re-run it after any change to
      the function or to auth settings
- [x] **Demo account created and sign-in verified** — see review notes
- [x] Supabase email confirmation turned **off**, so sign-up is immediate. If it
      is ever turned back on, both items above break: the verify script cannot
      create its throwaway, and new users must leave the app before logging
      anything
- [ ] **Log two or three foods on the demo account from a real device** before
      submitting, so a reviewer who only opens the app sees a populated journal
      rather than the empty state. The diary is on-device, so this has to be done
      on the phone you record the screenshots with — it does not travel with the
      account
- [ ] `app.json` version is `0.1.0` — set to `1.0.0`, and add `ios.buildNumber`
- [ ] `NSMicrophoneUsageDescription` in `app.json` describes voice logging that
      does not exist — remove it. An unused permission string is a review flag
- [ ] Add `ios.config.usesNonExemptEncryption: false` to skip the export
      compliance prompt on every upload
- [ ] `daylish.app/privacy` must resolve, and must now cover email addresses
- [ ] Apple Developer Program enrolment, App ID for `com.daylish.app`
- [ ] An `eas.json` and a real signed build — the app has only ever been bundled
      with `expo export`, never built as an `.ipa`
- [ ] **Paid Applications Agreement** — needed before you can charge for
      anything. Requires a legal entity, bank details and tax forms, and has real
      lead time. Start it in parallel rather than when Premium is code-complete
