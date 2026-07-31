/**
 * The daylish.app static server.
 *
 * Zero dependencies, on purpose. This serves five HTML pages that change a few
 * times a year, and two of them — the privacy policy and the terms — are App
 * Store submission requirements: a URL that fails to resolve is an automatic
 * rejection. A framework here would add a build step, a lockfile and an upgrade
 * treadmill to a job that `node:http` does in eighty lines, and every one of
 * those is a way for the pages to stop resolving on a Tuesday.
 *
 * Deployed on Railway with the service root directory set to `services/site`,
 * which is what keeps `npm install` from pulling the mobile app's dependencies
 * in to serve a stylesheet.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.PORT ?? 3000);

/**
 * Clean URL to file. The App Store fields point at `/support`, `/legal/privacy`
 * and `/legal/terms`, so those three are the ones that must never move.
 */
const ROUTES = new Map([
  ['/', 'index.html'],
  ['/support', 'support.html'],
  ['/legal/privacy', 'legal/privacy.html'],
  ['/legal/terms', 'legal/terms.html'],
  ['/account-deletion', 'account-deletion.html'],
]);

/**
 * Permanent redirects for the shapes people will guess or mistype.
 *
 * `/privacy` and `/terms` are here because they are the obvious guesses and
 * because an earlier draft of the App Store listing used them; a reviewer
 * following a stale link should land on the policy, not on a 404.
 */
const REDIRECTS = new Map([
  ['/privacy', '/legal/privacy'],
  ['/terms', '/legal/terms'],
  ['/legal', '/legal/privacy'],
  ['/eula', '/legal/terms'],
  ['/delete-account', '/account-deletion'],
  ['/delete', '/account-deletion'],
  ['/help', '/support'],
  ['/contact', '/support'],
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Long cache for fingerprint-free assets is wrong; a day is the compromise. */
function cacheFor(ext) {
  if (ext === '.html' || ext === '') return 'public, max-age=0, must-revalidate';
  return 'public, max-age=86400';
}

async function send(res, status, file, extra = {}) {
  const ext = extname(file);
  try {
    const body = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(status, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': cacheFor(ext),
      // The pages load no scripts and no third-party anything, so the strictest
      // useful policy costs nothing here.
      'content-security-policy':
        "default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      ...extra,
    });
    res.end(body);
  } catch {
    if (file === '404.html') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    await send(res, 404, '404.html');
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // Trailing slashes are stripped so `/support/` and `/support` are one page
  // rather than two URLs with the same content.
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  const redirect = REDIRECTS.get(path);
  if (redirect) {
    res.writeHead(301, { location: redirect });
    res.end();
    return;
  }

  const route = ROUTES.get(path);
  if (route) {
    await send(res, 200, route);
    return;
  }

  // Static assets. `normalize` plus the leading-dot check is what stops
  // `/../../etc/passwd` from resolving outside PUBLIC_DIR.
  const asset = normalize(path).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (asset && !asset.startsWith('..') && extname(asset)) {
    await send(res, 200, asset);
    return;
  }

  await send(res, 404, '404.html');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`daylish.app listening on :${PORT}`);
});
