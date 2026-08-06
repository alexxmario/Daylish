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
| 496 recipes with full filtering | YAZIO Pro, ~$47.90/yr |
| Trends: weight trajectory, intake over time | MacroFactor, Cronometer |
| One shopping list across several recipes | Lifesum, YAZIO |

Nobody in that list does all five. That justifies pricing at the top of the
mid-band rather than the bottom — but it does **not** justify MacroFactor money,
because they have brand, reviews and a track record, and Daylish has a 1.0.

**Fasting and water are free**, which YAZIO charges for. Water was a counter
sitting behind a \$49.99 subscription, and the fasting gate contradicted the
keyword field — `fasting` and `timer` both rank, and paywalling what you rank
for buys installs that uninstall. Giving both away costs nothing anyone was
paying for and removes the two most obvious cheapness signals in the free tier.

**One tension worth naming.** RevenueCat's 2026 benchmarks put freemium apps at
a 2.1% median day-35 conversion against 10.7% for hard paywalls — roughly five
times worse. Daylish is deliberately freemium and that is not up for revisiting:
logging is the product's primary metric and gating it is gating the app. The
consequence is simply that the free tier has to create genuine want rather than
frustration, and that the price has to be right first time because there will be
fewer conversions to learn from.

---

## The recommendation

**Set on 6 August 2026, in USD, as the base tier Apple converts from.**

| Plan | Price | Product ID |
|---|---|---|
| **Monthly** | **$9.99** | `com.daylish.app.premium.monthly` |
| **Yearly** | **$44.99** | `com.daylish.app.premium.yearly` |
| **Free trial** | **1 month**, on both plans | Introductory offer |

Yearly is **4.5 months of monthly** — $3.75 a month, a **62% saving**. "Four
months free" understates it; "over 60% off" is the honest line for the paywall.

**Why this lands well.** $44.99 sits just under the anchor Cronometer and
Lifesum have taught people at $49.99, well under MacroFactor's $71.99 and far
under MyFitnessPal's $79.99 — while Premium covers what all three specialise in.
It is a slightly sharper price than the $49.99 originally proposed here, and the
gap it opens against the monthly is the point: at 4.5 months the annual is not a
discount so much as the obvious choice, which is what you want in a category
that sells 68% annual.

The risk to watch is the reverse of underpricing: a 62% gap trains people to
never take the monthly, so monthly revenue will be thin. That is fine — monthly
exists to anchor the annual, not to earn.

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
| List price | $44.99 | $9.99 |
| Apple's cut at 15% (Small Business Program) | −$6.75 | −$1.50 |
| **Proceeds** | **$38.24** | **$8.49** |
| Without the Small Business Program (30%) | $31.49 | $6.99 |

**Enrol in the Small Business Program.** It is worth $6.75 per annual subscriber
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
- **UK and EU** — check the round numbers Apple derives from the $44.99 base.
  £39.99 and €49.99 read as considered; £42.31 reads as a spreadsheet.

---

## What to revisit, and when

- **Do not change the price for at least two quarters.** With freemium conversion
  rates, early numbers are noise, and a price that moves twice teaches people to
  wait for the next drop.
- **Lifetime** was dropped from 1.0. It can be added to the `default` offering
  later without an app update — the paywall renders whatever `listOfferings`
  returns. Price it at three to four years of annual, so $129–179, and only once
  churn data shows what a subscriber is actually worth.
- **A weekly plan is a trap here.** It converts well in games, and it would
  contradict everything the app says about not manipulating people.
- **Watch trial-start-to-day-14 drop-off** rather than trial-to-paid alone. If
  people abandon before the adaptive engine has anything to say, the problem is
  onboarding and weigh-in reminders, not the price.
