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

| Product | Identifier | App Store Connect type |
|---|---|---|
| Monthly | `monthly` | Auto-Renewable Subscription |
| Yearly | `yearly` | Auto-Renewable Subscription |
| Lifetime | `lifetime` | **Non-Consumable** |

**Lifetime is not a subscription, and this is the part that catches people out.**
In App Store Connect it is created under *In-App Purchases → Non-Consumable*, a
different section of a different screen from the other two. It also does not sit
in a subscription group, has no renewal, and cannot offer a free trial.

Consequences worth knowing before you price it:

- **Only the monthly and yearly** trigger the auto-renewing-subscription
  requirements — the Terms of Use (EULA) URL and the privacy policy URL, both
  already on the blocked-on-owner list in [`context.md`](../context.md).
- **Restore stops being a courtesy.** A lifetime buyer on a new phone has no
  subscription for RevenueCat to look up; `restorePurchases` is their only route
  back. It is wired, and it is now also reachable from Customer Center.
- Monthly and yearly go in one subscription group, so people can move between
  them without buying twice.

Attach all three to the `premium` entitlement in RevenueCat.

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
| `test_…` (Test Store) | `apps/mobile/.env`, already set | Now — it is the only way to run the flows before the Paid Applications Agreement clears |
| `appl_…` (Apple App Store) | Replaces it, and `eas env:create` | Before any TestFlight or App Store build |

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
is exactly the person who needs it, and a lifetime buyer restoring on a new phone
has no other route.

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
