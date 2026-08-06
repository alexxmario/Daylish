# RevenueCat and StoreKit — the setup the code is waiting for

The purchase code in [`entitlement.tsx`](../apps/mobile/src/state/entitlement.tsx)
typechecks, bundles, and until now had never run. This is the list of things that
exist outside the repository and have to match it exactly, in the order they
unblock each other.

**Every name below is load-bearing.** A mismatch does not throw — the SDK
returns "not subscribed" and a paying customer sees a paywall forever.

---

## 0. The one constant

```ts
const ENTITLEMENT_ID = 'premium';
```

That is [entitlement.tsx:50](../apps/mobile/src/state/entitlement.tsx#L50), and it
is compared against the **identifier** of the entitlement in the RevenueCat
dashboard — not its display name. Create the entitlement as `premium` and nothing
in the app has to change. If you would rather it read `daylish_pro`, change this
one line and nothing else: no gate in the app knows the string.

---

## 1. Entitlement

RevenueCat → **Entitlements** → New.

| Field | Value |
|---|---|
| Identifier | `premium` |
| Display name | Anything. "Daylish Pro" is fine — nothing reads it. |

One entitlement, not three. All three products grant the same access, and the
tier is a single boolean everywhere in the app — see
[`entitlements.ts`](../packages/core/src/entitlements.ts), where the whole
free/paid split lives as data.

---

## 2. Products

Created in **App Store Connect first**, then imported into RevenueCat. The
identifiers must match on both sides.

| Product | Product ID | Duration | Reference name (internal) |
|---|---|---|---|
| Monthly | `com.daylish.app.premium.monthly` | 1 month | Daylish Premium Monthly |
| Yearly | `com.daylish.app.premium.yearly` | 1 year | Daylish Premium Yearly |

Both in one subscription group, reference name **Daylish Plans**, group display
name **Daylish Premium** — that last one is user-visible, in Settings →
Subscriptions, and should match what the app calls the tier.

**Product IDs are permanent and cannot be reused, even after deletion**, which is
why they are reverse-DNS rather than a bare `monthly`. Nothing in the app names
them: [`listOfferings`](../apps/mobile/src/state/entitlement.tsx) reads
`pkg.identifier` and takes the price and title from StoreKit, so these strings
only have to agree between App Store Connect and RevenueCat.

**The subscription's localized Display Name is the paywall button.**
`listOfferings` maps `pkg.product.title` into the label rendered as
`{title} · {price}`, so set them to `Monthly` and `Yearly` and nothing longer —
"Daylish Premium Monthly" would render as *Daylish Premium Monthly · £4.99*
inside a ticket already headed "Choose a plan", on a screen already titled
Daylish Premium.

**Both go in one subscription group**, so someone can move between them without
buying twice, and both trigger the auto-renewing-subscription requirements — the
Terms of Use (EULA) and privacy policy URLs, which must be reachable from the
paywall as well as from the store listing. They are: see the `LegalLink` pair in
[`premium.tsx`](../apps/mobile/app/premium.tsx).

Attach both to the `premium` entitlement in RevenueCat.

### Lifetime was dropped from 1.0

A one-time lifetime purchase is a **non-consumable**, which in App Store Connect
is a different product type on a different screen from the other two: no
subscription group, no renewal, no free trial. It also changes what restore
means — a lifetime buyer on a new phone has no subscription for RevenueCat to
look up, so `restorePurchases` becomes their only route back rather than a
courtesy.

None of that is hard, but none of it is needed to launch either. **Adding it
later needs no app update:** the paywall renders whatever `listOfferings`
returns, so a third package added to the `default` offering appears in builds
that already shipped. Nothing in the app names a product identifier.

---

## 3. Offering

RevenueCat → **Offerings** → the `default` offering, with three packages
pointing at the three products.

[`listOfferings`](../apps/mobile/src/state/entitlement.tsx) reads
`offerings.current`, so the offering must be marked **current** or the paywall
renders an empty list. Prices come from StoreKit and are never hardcoded — a
paywall whose stated price differs from StoreKit's is an App Review rejection.

---

## 4. API keys

| Key | Where it goes | When |
|---|---|---|
| `test_…` (Test Store) | `apps/mobile/.env` and the **`development` EAS environment only** | Now — it is the only way to run the flows before the Paid Applications Agreement clears |
| `appl_…` (Apple App Store) | `preview` and `production` | Before any internal, TestFlight or App Store build |

### A Test Store key outside a Debug build is fatal

RevenueCat's SDK raises deliberately — *"Test Store API key used in Release
build"* — and it is a **native** fatal error, so the `try/catch` around
`configure` cannot catch it. `configure` runs during the first render, so the
app crashes on launch, every launch, and stops opening at all.

Which builds are Debug is the whole of it:

| | Build configuration | `test_` key |
|---|---|---|
| Expo Go, simulator, EAS `development` | Debug | fine |
| EAS `preview`, `production` | **Release** | **crashes on launch** |

This is why it went unnoticed until the first `preview` build on a real device
on 6 August 2026 — every prior run had been Debug.

Two things now prevent a repeat. The key is linked to the `development`
environment only, and [`entitlement.tsx`](../apps/mobile/src/state/entitlement.tsx)
discards a `test_` key when `__DEV__` is false, which turns the crash into the
already-handled no-store state: free tier, no purchase buttons, app runs.

**Note that EAS variables are project-wide.** `eas env:delete` removes a
variable outright rather than unlinking it from one environment, so detaching a
key from `preview` means deleting and recreating it against `development`.

The Test Store key exercises purchase, restore and entitlement resolution against
RevenueCat's sandbox with no Apple involvement at all. That is genuinely useful
here, because it retires the "written, never run" status of this integration
before the agreement paperwork finishes.

**It cannot take real money.** Shipping a `test_` key does not error — it returns
no entitlement, so every paying customer looks unsubscribed.

---

## 5. Webhook, for billing notifications

RevenueCat → **Integrations → Webhooks**.

| Field | Value |
|---|---|
| URL | `https://<project>.supabase.co/functions/v1/revenuecat-webhook` |
| Authorization header | The same value as `REVENUECAT_WEBHOOK_SECRET` |

```sh
supabase functions deploy revenuecat-webhook --no-verify-jwt
supabase secrets set REVENUECAT_WEBHOOK_SECRET=<a long random string>
```

`--no-verify-jwt` is required and is not a hole: RevenueCat has no Supabase
session to present, so the function authenticates on the shared secret instead
and rejects anything else with a 401 before reading the body.

The function acts on **two** event types and deliberately ignores the rest —
`BILLING_ISSUE` and `EXPIRATION`. The reasoning, including why `CANCELLATION`
sends nothing, is at the top of
[`revenuecat-webhook/index.ts`](../supabase/functions/revenuecat-webhook/index.ts).

**`app_user_id` is the Supabase user id** because the app calls
`identifyPurchaser` on sign-in. Without that call RevenueCat mints an anonymous
id per install, the webhook carries a string that appears nowhere in the
database, and no notification can be addressed.

---

## 5b. App Store Server Notifications — the *other* webhook

App Store Connect asks for a **Production Server URL** (and a Sandbox one) for
in-app purchase status updates. That field takes **RevenueCat's URL**, copied
from the Apple App Store app configuration in the RevenueCat dashboard. It is
unique per app, so copy it rather than reconstructing it, and select
notification **Version 2**. RevenueCat has an *Apply in App Store Connect*
button that writes it to both the Production and Sandbox fields for you, which
is worth using over a manual paste for a value that fails silently when wrong.

**The URL does not exist until an App Store app is connected.** A project with
only the Test Store has nowhere to send notifications, and the dashboard shows
the Test Store getting-started page instead of an app. Leave the field empty in
the meantime; it is optional and does not block review.

Connecting the app needs, from App Store Connect:

| What | Where | Note |
|---|---|---|
| Bundle id | — | `com.daylish.app` |
| Custom URL scheme | — | `daylish`, already in `app.json` |
| **In-App Purchase Key** | Users and Access → Integrations → In-App Purchase | `SubscriptionKey_*.p8`. **Load-bearing** — see below. The Key ID is in the filename. |
| **App Store Connect API Key** | Users and Access → Integrations → App Store Connect API | `AuthKey_*.p8`. Not the same file. Lets RevenueCat pull product identifiers. |
| App-Specific Shared Secret | — | **Skip it.** StoreKit 1 only, and `react-native-purchases` 10.x is StoreKit 2. |

**The In-App Purchase key is not optional here.** RevenueCat's own warning is
explicit: on StoreKit 2 — which 10.x uses, with no deployment target set and
Expo SDK 54's floor at iOS 15.1 — transactions are not recorded without it. The
failure mode is the `test_` key's: the purchase succeeds at Apple, RevenueCat
never hears, `entitlements.active['premium']` stays empty, and someone who has
just paid still sees the paywall.

**The Issuer ID will not appear until an App Store Connect API key exists.** It
is account-wide rather than per-key, so a team that has never made one sees no
Issuer ID field on the In-App Purchase page at all and no way to produce one.
Generate an API key — any name, any access level — and it materialises. This is
Apple's quirk, not RevenueCat's.

**Do not point it at `revenuecat-webhook`.** The two webhooks are different
links in one chain and speak different protocols:

```
Apple ──(Production Server URL, from RevenueCat)──► RevenueCat
RevenueCat ──(§5 above, shared secret)──► Supabase ──► APNs ──► phone
```

`revenuecat-webhook` authenticates on an `Authorization` header equal to
`REVENUECAT_WEBHOOK_SECRET` and reads `{ type, app_user_id }`. Apple sends
`{ signedPayload: <JWS> }` and no `Authorization` header at all, so it would be
refused with a 401 — and if it were not, `event.type` would be `undefined` and
every notification would fall through the `ignored` branch. Nothing would error
loudly; the billing notifications would simply never arrive.

The field is optional and does not block review. Leaving it empty means
RevenueCat learns about a failed renewal late, which makes `BILLING_ISSUE` and
`EXPIRATION` unreliable in exactly the case they exist for.

---

## 6. Customer Center

RevenueCat → **Customer Center**, which needs its own configuration in the
dashboard before `presentCustomerCenter()` shows anything useful.

It is reachable from **You → Account → Manage subscription**, and is shown to
everyone rather than only to subscribers: someone whose subscription has lapsed
is exactly the person who needs it, and someone reinstalling reaches for restore
from the same place.

**The paywall stays hand-built.** [`premium.tsx`](../apps/mobile/app/premium.tsx)
carries the argument for paying, in the app's own voice, from `PREMIUM_FEATURES`
in core. Customer Center carries no argument at all — it is the manage, cancel,
refund and restore plumbing — so there is nothing to lose by using theirs and a
good deal of edge-case handling to gain.

---

## 7. Order of operations

1. **Paid Applications Agreement.** Weeks of lead time, blocks all revenue, and
   nothing below produces money without it. Start first.
2. `eas init`, then a development build — the SDK and Customer Center are both
   native modules, so neither exists in Expo Go.
3. Entitlement `premium`, then products, then the offering.
4. Swap the `test_` key for `appl_`.
5. Deploy the webhook and set its secret, then paste RevenueCat's server
   notification URL into App Store Connect (§5b) — both links of the chain.

---

## What to verify the first time it runs

The three things listed as specifically unverified in `context.md`, all of which
the Test Store key can now answer without Apple:

- `configure()` accepts the key shape.
- `entitlements.active['premium']` matches the dashboard identifier — this is
  the one that fails silently.
- Purchase and restore complete end to end, and the gates flip.

Then two that need the real key and a device: that a purchase on one phone
restores onto another signed into the same account, and that a `BILLING_ISSUE`
event actually lands as a notification.
