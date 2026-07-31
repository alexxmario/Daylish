# daylish.app

The marketing, support and legal pages. Deployed to Railway.

```sh
npm start -w @daylish/site   # http://localhost:3000
```

Zero dependencies. `server.mjs` is `node:http` serving `public/`, and there is no
build step — edit the HTML and reload.

## Why this is not a static host

Two of these pages are App Store submission requirements. A privacy policy or
support URL that fails to resolve is an automatic rejection, and the app links to
both from inside itself. Owning the server means the routes are in this repo,
under review, next to the code whose behaviour they describe.

## Routes

| Path | Page |
|---|---|
| `/` | Home |
| `/support` | Support and FAQ — the **Support URL** in App Store Connect |
| `/legal/privacy` | Privacy policy — the **Privacy Policy URL** |
| `/legal/terms` | Terms of Use — the **EULA** required for auto-renewing subscriptions |
| `/account-deletion` | How to delete an account, for guideline 5.1.1(v) |
| `/healthz` | Railway health check |

`/privacy`, `/terms`, `/eula`, `/delete-account`, `/help` and `/contact` are 301
redirects. **Do not move the four App Store paths** without changing the fields
in App Store Connect first — the Support and Marketing URLs can be edited any
time, but the description's links are frozen until the next app version ships.

## Deploying

Set **Root Directory** to `services/site` in the Railway service's source
settings. [`railway.json`](railway.json) then supplies the start command and the
health check, and no environment variables are needed beyond `PORT`, which
Railway sets.

**Check that setting first when a deploy misbehaves.** Railway builds from the
repo root without it, and the difference is visible in the build log: a correct
build installs nothing and produces a snapshot of a few megabytes, while a
root-context build runs `npm ci` across every workspace and pushes an image
approaching a gigabyte to serve six HTML files.

The root `package.json` has a `start` script that runs this workspace, so a
root-context build still boots rather than dying on a missing script — but it is
a safety net, not the arrangement to aim for. It carries the whole Expo
toolchain into the image for no benefit.

## Keeping it honest

Every factual claim on these pages is checked against the code, and a change in
one of these places is a reason to re-read the site:

- **What gets backed up** — `SYNCED_TABLES` in `apps/mobile/src/data/sync.ts`
  drives the table in the privacy policy.
- **What deletion removes** — `supabase/functions/delete-account/` and
  `apps/mobile/src/data/reset.ts`.
- **What is free and what is paid** — `packages/core/src/entitlements.ts` drives
  the tier lists on the home page.
- **Third parties** — anything new the app talks to belongs in the privacy
  policy's recipients table before it ships.

The site's palette is copied from `apps/mobile/src/theme/tokens.ts`. It has no
red, for the same reason the app has none.
