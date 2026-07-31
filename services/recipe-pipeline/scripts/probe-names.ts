#!/usr/bin/env node
/**
 * Ingredient name probe.
 *
 * The resolver rejects a recipe outright if any ingredient fails to match USDA,
 * so a badly chosen name costs three recipes at a time (light/standard/hearty).
 * This checks candidate names *before* they are written into a recipe file.
 *
 *   npm run probe -w @daylish/recipe-pipeline -- "fish sauce" "sauce, fish"
 *
 * Prints the winning USDA description and score for each candidate, so you can
 * see both whether it resolves and what it resolved *to* — a name that matches
 * the wrong food is worse than one that fails loudly.
 */

import { IngredientResolver } from '../src/resolver.ts';

const names = process.argv.slice(2);

if (names.length === 0) {
  console.error('Usage: probe-names.ts "<name>" ["<name>" …]');
  process.exit(1);
}

const resolver = new IngredientResolver({ apiKey: process.env.USDA_API_KEY ?? 'DEMO_KEY' });

for (const name of names) {
  const result = await resolver.resolve(name, 100);

  if ('fdcId' in result) {
    console.log(
      `  OK   ${name.padEnd(28)} → ${result.matchedDescription}  (${result.confidence.toFixed(2)})`,
    );
  } else {
    console.log(`  FAIL ${name.padEnd(28)} → ${result.reason}`);
  }
}
