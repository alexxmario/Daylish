/**
 * Where the app sends people on the web, and who it says it is.
 *
 * One base URL, because it will move. The site is served from Railway today and
 * `daylish.app` points at a beta signup page; when that domain is put in front
 * of the site, `SITE_URL` is the only line that changes.
 *
 * **Change these and the store listing together.** Guideline 3.1.2 wants a
 * working Terms of Use link for an auto-renewing subscription, and the App Store
 * description carries the same two links — but the description is frozen between
 * versions, so a URL that moves here without moving there leaves the product
 * page pointing at nothing. `docs/app-store-connect-submission.md` holds the
 * copy those fields were filled from.
 *
 * No path here may 404. A dead privacy or terms link is a review rejection, not
 * a broken link somebody reports later.
 */

import Constants from 'expo-constants';

/** The site root. Everything else is derived from it. */
export const SITE_URL = 'https://daylishsite-production.up.railway.app';

export const PRIVACY_URL = `${SITE_URL}/legal/privacy`;
export const TERMS_URL = `${SITE_URL}/legal/terms`;
export const SUPPORT_URL = `${SITE_URL}/support`;

/**
 * Read from `app.json` rather than typed here.
 *
 * A hardcoded version stops being true at the first release and then identifies
 * nothing — which is exactly what happened to the string this replaces, still
 * claiming `0.1` on the way to a 1.0 submission.
 */
export const APP_VERSION = (Constants.expoConfig?.version ?? '0.0.0') as string;

/**
 * Sent to Open Food Facts, which asks that clients identify themselves so they
 * can get in touch about one that misbehaves. That request is only worth
 * honouring if the version is real and the URL resolves.
 */
export const USER_AGENT = `Daylish/${APP_VERSION} (${SITE_URL})`;
