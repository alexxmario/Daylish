/**
 * Prepares generated illustrations for the app bundle.
 *
 * Generated art arrives on a large canvas with the subject floating somewhere
 * inside it, at whatever aspect the model felt like. Shipping that directly has
 * two consequences: the art renders far smaller than the layout intends, and it
 * renders at a *different* size on every screen, which is precisely the
 * inconsistency the whole style guide exists to prevent.
 *
 * So each image is trimmed to its visible content, scaled to fit a single
 * standard box, and centred on a transparent canvas of one fixed aspect. After
 * this every illustration occupies the same footprint and the registry needs one
 * aspect value rather than twenty-two.
 *
 * Usage:  node scripts/process-illustrations.mjs <source-dir>
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '..', 'assets', 'illustrations');

/** Every illustration lands on this canvas, so they all render identically. */
const CANVAS = { width: 900, height: 600 };

/**
 * Fraction of the canvas left empty around the art. Without it, trimmed
 * artwork butts against the edge of its box and reads as cropped.
 */
const PADDING = 0.06;

/** Alpha below this is an invisible fringe, not content — ignore it when trimming. */
const ALPHA_FLOOR = 12;

/** The icon and splash are not illustrations and follow their own rules. */
const SPECIAL = new Set(['icon.png', 'splash-icon.png', 'favicon.png']);

const sourceDir = resolve(process.argv[2] ?? '.');
mkdirSync(OUT_DIR, { recursive: true });

const python = `
import sys, json
from PIL import Image

src, out, cw, ch, pad, floor, mode = sys.argv[1:8]
cw, ch, pad, floor = int(cw), int(ch), float(pad), int(floor)

im = Image.open(src).convert('RGBA')

if mode == 'icon':
    # Opaque, square, no trimming — the iOS mask needs the full bleed.
    im = im.resize((1024, 1024), Image.LANCZOS)
    Image.new('RGB', im.size, (251, 239, 192)).paste(im, (0, 0), im) if False else None
    flat = Image.new('RGB', im.size, (251, 239, 192))
    flat.paste(im, (0, 0), im)
    flat.save(out, optimize=True)
    print(json.dumps({'w': 1024, 'h': 1024, 'aspect': 1.0}))
    sys.exit()

# Trim to visible content.
alpha = im.split()[-1]
mask = alpha.point(lambda v: 255 if v >= floor else 0)
box = mask.getbbox()
if box:
    im = im.crop(box)

if mode == 'splash':
    cw = ch = 1024

# Scale to fit the padded box, preserving aspect.
inner_w, inner_h = cw * (1 - pad * 2), ch * (1 - pad * 2)
scale = min(inner_w / im.width, inner_h / im.height)
new = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
im = im.resize(new, Image.LANCZOS)

# Centre on a transparent canvas of the standard size.
canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
canvas.alpha_composite(im, ((cw - new[0]) // 2, (ch - new[1]) // 2))

# Flat art uses few colours, so a palette shrinks it hard with no visible loss.
quantized = canvas.quantize(colors=128, method=Image.FASTOCTREE)
quantized.save(out, optimize=True)
print(json.dumps({'w': cw, 'h': ch, 'aspect': round(cw / ch, 4)}))
`;

const files = readdirSync(sourceDir).filter((f) => f.endsWith('.png'));
let totalBefore = 0;
let totalAfter = 0;

for (const file of files.sort()) {
  const mode = file === 'icon.png' ? 'icon' : file === 'splash-icon.png' ? 'splash' : 'illustration';
  const src = join(sourceDir, file);
  const out = join(OUT_DIR, file);

  const before = Number(execFileSync('stat', ['-f%z', src]).toString().trim());
  execFileSync('python3', [
    '-c',
    python,
    src,
    out,
    String(CANVAS.width),
    String(CANVAS.height),
    String(PADDING),
    String(ALPHA_FLOOR),
    mode,
  ]);
  const after = Number(execFileSync('stat', ['-f%z', out]).toString().trim());

  totalBefore += before;
  totalAfter += after;

  const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
  console.log(
    `${file.padEnd(24)} ${kb(before).padStart(9)} → ${kb(after).padStart(8)}  ${SPECIAL.has(file) ? `(${mode})` : ''}`,
  );
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(
  `\n${files.length} files · ${mb(totalBefore)} → ${mb(totalAfter)} (${(100 - (totalAfter / totalBefore) * 100).toFixed(0)}% smaller)`,
);
console.log(`Written to ${OUT_DIR}`);
