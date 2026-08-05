# Pricing — Daylish Premium

What the category charges, where Daylish sits in it, and the numbers to enter in
App Store Connect. Researched August 2026.

---

## What competitors charge

| App | Monthly | Yearly | What the money buys |
|---|---|---|---|
| **MyFitnessPal** Premium | $19.99 | $79.99 | Barcode scanner, custom macros, no ads |
| **MyFitnessPal** Premium+ | $24.99 | $99.99 | The above plus meal planning |
| **MacroFactor** | $11.99 | $71.99 | Adaptive targets from your weight trend |
| **Cronometer** Gold | $10.99 | ~$49.99 | Micronutrients, no ads |
| **Lifesum** Premium | $9.99 | $49.99 | Recipes, meal plans, macros |
| **YAZIO** Pro | ~$6.99 | ~$47.90 | Recipes, meal plans, fasting tracker |

Sources disagreed on Cronometer (\$49.99 and \$59.88 both appear) and YAZIO
discounts its annual to roughly \$38 through promo pages often enough that the
list price is close to fiction. Treat the annual column as a **\$48–80 band with
its centre of gravity at \$50**.

**The most useful fact in that table is MyFitnessPal's.** Barcode scanning is
behind their paywall, at \$19.99 a month. It is free in Daylish permanently, and
that is not a concession — it is the single sharpest thing the marketing can say.

## Where Daylish actually sits

Premium is unusually broad for this category, because it covers what three
different competitors each specialise in:

| What Premium unlocks | Who else charges for it |
|---|---|
| Targets that adapt to your weight trend | MacroFactor, $71.99/yr |
| 23 vitamins and minerals against Daily Values | Cronometer Gold, ~$49.99/yr |
| Recipes, fasting timers, water | YAZIO Pro, ~$47.90/yr |
| Trends: weight trajectory, intake over time | MacroFactor, Cronometer |
| One shopping list across several recipes | Lifesum, YAZIO |

Nobody in that list does all five. That justifies pricing at the top of the
mid-band rather than the bottom — but it does **not** justify MacroFactor money,
because they have brand, reviews and a track record, and Daylish has a 1.0.

**One tension worth naming.** RevenueCat's 2026 benchmarks put freemium apps at
a 2.1% median day-35 conversion against 10.7% for hard paywalls — roughly five
times worse. Daylish is deliberately freemium and that is not up for revisiting:
logging is the product's primary metric and gating it is gating the app. The
consequence is simply that the free tier has to create genuine want rather than
frustration, and that the price has to be right first time because there will be
fewer conversions to learn from.

---

## The recommendation

| Plan | Price | Product ID |
|---|---|---|
| **Monthly** | **$9.99** / €10.99 / £9.99 | `com.daylish.app.premium.monthly` |
| **Yearly** | **$49.99** / €54.99 / £44.99 | `com.daylish.app.premium.yearly` |
| **Free trial** | **1 month**, on both plans | Introductory offer |

Yearly works out at $4.17 a month — a **58% saving**, or "five months free",
which is the line to put on the paywall.

**Why $49.99 annual.** It lands exactly on the category anchor that Cronometer
and Lifesum have already taught people, sits comfortably under MacroFactor and
miles under MyFitnessPal, and is defensible because Daylish does what all three
do. Launching at $39.99 would leave money on the table for an app that is
genuinely broader than the $47.90 tier, and raising a price later is far harder
than setting it correctly now.

**Why $9.99 monthly.** Its job is mostly to make the annual obviously right, and
at this ratio it does: annual costs five months of monthly. It also matches
Lifesum exactly and undercuts both Cronometer and MacroFactor, so nobody
comparing month-to-month finds Daylish expensive. Health and fitness sells **68%
annual** anyway, so this is the anchor, not the earner.

### The trial length is decided by the product, not by benchmarks

**Adaptive targets need about 14 days of weigh-ins before they can say
anything.** That is the headline paid feature, and it means a 7-day trial cannot
demonstrate the thing people would be paying for — they would reach the end of it
having seen a screen that says "not enough data yet" and cancel, correctly.

So the trial has to clear 14 days, and Apple's options are 3 days, 1 week,
2 weeks, 1 month, and up. **1 month** is the first option that leaves real margin
after the engine wakes up, and it happens to sit in the best-converting band
RevenueCat measured — trial-to-paid runs 25.5% at ≤4 days, 37.4% at 5–9 days, and
42.5% at 17–32 days. The product requirement and the benchmark agree, which is
rare enough to act on.

Offer it on **both** plans and preselect the yearly.

**Use the trial rather than a discounted launch price.** Apple allows one
introductory offer per subscription group per account, so it is one or the other.
A discount competes on price, which is the only axis where an unknown 1.0 loses;
a trial competes on the product, which is where Daylish is strong. It is also the
only way anyone finds out that the targets really do explain themselves.

---

## What you actually take home

| | Per year | Per month |
|---|---|---|
| List price | $49.99 | $9.99 |
| Apple's cut at 15% (Small Business Program) | −$7.50 | −$1.50 |
| **Proceeds** | **$42.49** | **$8.49** |
| Without the Small Business Program (30%) | $34.99 | $6.99 |

**Enrol in the Small Business Program.** It is worth $7.50 per annual subscriber
per year, for a form. It needs the Paid Applications Agreement active first, and
the enrolment date has to go into RevenueCat afterwards or its revenue charts
will overstate Apple's cut for the life of the app.

In the EU and UK, Apple's displayed price includes VAT and proceeds are computed
after it, so the table above is the US case and European net is lower. Do not
model revenue off the list price.

---

## Regional pricing

Apple will auto-convert from the US price, and its conversions are poor in
exactly the markets that are worth winning early. Set these by hand:

- **CEE, LATAM, India, SEA, Turkey** — auto-conversion lands far above local
  purchasing power for a food diary. Halving the converted price in these
  storefronts typically earns more than it gives up, and Romania is on that list.
- **UK and EU** — check the round numbers. £44.99 and €54.99 read as considered;
  £46.87 reads as a spreadsheet.

---

## What to revisit, and when

- **Do not change the price for at least two quarters.** With freemium conversion
  rates, early numbers are noise, and a price that moves twice teaches people to
  wait for the next drop.
- **Lifetime** was dropped from 1.0. It can be added to the `default` offering
  later without an app update — the paywall renders whatever `listOfferings`
  returns. Price it at three to four years of annual, so around $149, and only
  once churn data shows what a subscriber is actually worth.
- **A weekly plan is a trap here.** It converts well in games, and it would
  contradict everything the app says about not manipulating people.
- **Watch trial-start-to-day-14 drop-off** rather than trial-to-paid alone. If
  people abandon before the adaptive engine has anything to say, the problem is
  onboarding and weigh-in reminders, not the price.
