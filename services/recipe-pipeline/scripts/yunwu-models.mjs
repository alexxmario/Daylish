#!/usr/bin/env node
/**
 * List what the yunwu.ai key can actually reach.
 *
 *   node --env-file-if-exists=../../.env scripts/yunwu-models.mjs
 *
 * Relay services expose a different model set per account and per tier, and the
 * names drift, so guessing one and getting a 404 tells you nothing useful about
 * whether the key, the base URL or the model name was wrong. Ask first.
 */

const BASE = process.env.YUNWU_BASE_URL ?? 'https://yunwu.ai/v1';
const KEY = process.env.YUNWU_API_KEY;

if (!KEY) {
  console.error('YUNWU_API_KEY is not set. Add it to .env at the repo root:');
  console.error('  YUNWU_API_KEY=sk-...');
  process.exit(1);
}

/** Names that usually mean "this one draws pictures". */
const IMAGE_HINT = /dall-?e|gpt-image|flux|midjourney|^mj|stable-?diffusion|^sd[-_ ]|seedream|nano-?banana|imagen|ideogram|recraft|kolors|hunyuan-image|wan|qwen-image|grok-image/i;

const res = await fetch(`${BASE}/models`, {
  headers: { Authorization: `Bearer ${KEY}` },
});

if (!res.ok) {
  console.error(`GET ${BASE}/models → ${res.status} ${res.statusText}`);
  console.error(await res.text().catch(() => ''));
  console.error('\n401/403 means the key is wrong or not yet active.');
  console.error('404 means the base URL is wrong — try YUNWU_BASE_URL=https://api.apiplus.org/v1');
  process.exit(1);
}

const body = await res.json();
const ids = (body.data ?? body.models ?? []).map((m) => m.id ?? m.name ?? String(m)).sort();

const image = ids.filter((id) => IMAGE_HINT.test(id));

console.log(`${ids.length} models visible to this key.\n`);
console.log(`Likely image models (${image.length}):`);
for (const id of image) console.log(`  ${id}`);

if (image.length === 0) {
  console.log('  none matched the usual naming patterns.');
  console.log('\nFull list, in case an image model is named unusually:');
  for (const id of ids) console.log(`  ${id}`);
}
