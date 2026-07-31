#!/usr/bin/env node
/**
 * Convert the generated dish photographs to WebP for the app bundle.
 *
 *   node scripts/compress-images.mjs
 *   node scripts/compress-images.mjs --quality 80 --force
 *
 * The generator writes PNG because that is what the image API returns, and PNG
 * is the wrong format for a photograph: the full set is ~310 MB, against ~24 MB
 * as WebP at q80 — a twelvefold saving with no visible difference at the size
 * these are displayed. Measured on a shakshuka: 1785 KB → 142 KB.
 *
 * The PNGs are left alone. They are the masters: re-encoding from a lossy WebP
 * later would compound the loss, and they cost real money to generate.
 *
 * Requires `cwebp` (brew install webp).
 */

import { readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const { values } = parseArgs({
  options: {
    quality: { type: 'string', default: '80' },
    src: { type: 'string', default: 'assets/dish-photos' },
    out: { type: 'string', default: 'apps/mobile/assets/dish-photos' },
    force: { type: 'boolean', default: false },
  },
});

const SRC = join(repoRoot, values.src);
const OUT = join(repoRoot, values.out);

try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('cwebp not found. Install it with:  brew install webp');
  process.exit(1);
}

if (!existsSync(SRC)) {
  console.error(`No such directory: ${values.src}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const pngs = readdirSync(SRC).filter((f) => f.endsWith('.png'));
let converted = 0;
let skipped = 0;
let before = 0;
let after = 0;

for (const png of pngs) {
  const webp = png.replace(/\.png$/, '.webp');
  const from = join(SRC, png);
  const to = join(OUT, webp);

  before += statSync(from).size;

  if (!values.force && existsSync(to)) {
    after += statSync(to).size;
    skipped += 1;
    continue;
  }

  execFileSync('cwebp', ['-q', values.quality, '-quiet', from, '-o', to]);
  after += statSync(to).size;
  converted += 1;
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

console.log(`${pngs.length} photographs: ${converted} converted, ${skipped} already done.`);
console.log(`${mb(before)} PNG → ${mb(after)} WebP at q${values.quality} (${(before / after).toFixed(1)}× smaller)`);
console.log(`Written to ${values.out}/`);
