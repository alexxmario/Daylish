#!/usr/bin/env node
/**
 * Recipe pipeline CLI.
 *
 *   npm run pipeline -- --dry-run --limit 5     one cell, synchronous, prints the maths
 *   npm run pipeline -- --target 500            submit the full batch
 *   npm run pipeline -- --collect <batch_id>    validate and emit a finished batch
 *   npm run pipeline -- --import recipes/       validate and emit recipes written elsewhere
 *
 * The dry run exists so the validator can be proven on a handful of recipes
 * before committing to a 500-recipe spend.
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { GeneratedRecipeSchema, roundNutrients, type GeneratedRecipe } from '@daylish/core';

import { collectBatch, generateCell, pollBatch, submitBatch } from './generate.ts';
import { IngredientResolver } from './resolver.ts';
import {
  buildPlan,
  planRecipeTotal,
  planTotal,
  RECIPES_PER_DISH,
  type GenerationCell,
} from './taxonomy.ts';
import { validateRecipe, type RejectedRecipe, type ValidatedRecipe } from './validate.ts';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    limit: { type: 'string' },
    target: { type: 'string', default: '500' },
    collect: { type: 'string' },
    import: { type: 'string' },
    out: { type: 'string', default: '../../supabase/seed' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`Daylish recipe pipeline

  --dry-run          Generate a single cell synchronously and print the computed nutrition
  --limit <n>        Recipes to request in a dry run (default 3)
  --target <n>       Total recipes for a full run (default 500). Each dish is
                     written three times, so this is rounded up to whole dishes.
  --collect <id>     Collect, validate and emit a finished batch
  --import <path>    Validate and emit recipes from a JSON file, or every
                     .json file in a directory
  --out <dir>        Output directory (default ../../supabase/seed)
`);
  process.exit(0);
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const USDA_API_KEY = process.env.USDA_API_KEY ?? 'DEMO_KEY';

function requireAnthropicKey(): string {
  if (!ANTHROPIC_API_KEY) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Export it, or run `ant auth login` and export the token.',
    );
    process.exit(1);
  }
  return ANTHROPIC_API_KEY;
}

function formatNutrients(recipe: ValidatedRecipe): string {
  const n = roundNutrients(recipe.nutrients, 1);
  return [
    `${Math.round(n.energyKcal ?? 0)} kcal`,
    `${(n.proteinG ?? 0).toFixed(1)} g protein`,
    `${(n.carbsG ?? 0).toFixed(1)} g carbs`,
    `${(n.fatG ?? 0).toFixed(1)} g fat`,
    `${(n.fiberG ?? 0).toFixed(1)} g fibre`,
  ].join(' · ');
}

/** Print the full derivation for one recipe, so the arithmetic is auditable. */
function printDerivation(validated: ValidatedRecipe): void {
  const { recipe } = validated;
  console.log(`\n  ${recipe.title}`);
  console.log(`  ${recipe.cuisine} · ${recipe.servings} servings · ${recipe.prepMinutes}+${recipe.cookMinutes} min`);
  console.log('  ─ ingredients, as matched against USDA ─');

  for (const ingredient of validated.ingredients) {
    const kcalPer100 = ingredient.per100g.energyKcal ?? 0;
    const contribution = (kcalPer100 * ingredient.grams) / 100;
    console.log(
      `    ${ingredient.grams.toString().padStart(6)} g  ${ingredient.name.padEnd(28).slice(0, 28)}` +
        ` → [${ingredient.fdcId}] ${ingredient.matchedDescription.slice(0, 40).padEnd(40)}` +
        ` ${kcalPer100.toFixed(0).padStart(4)} kcal/100g` +
        ` = ${contribution.toFixed(0).padStart(5)} kcal` +
        ` (match ${ingredient.confidence.toFixed(2)})`,
    );
  }

  console.log(`  ─ per serving ─`);
  console.log(`    ${formatNutrients(validated)}`);
  console.log(`    allergens: ${validated.allergens.length ? validated.allergens.join(', ') : 'none'}`);
  console.log(`    meal-prep score: ${validated.prepScore}/100 (${validated.prepReasons.join('; ') || 'no signals'})`);

  if (validated.incompleteNutrients.length > 0) {
    console.log(
      `    incomplete data for: ${validated.incompleteNutrients.slice(0, 8).join(', ')}` +
        `${validated.incompleteNutrients.length > 8 ? ` (+${validated.incompleteNutrients.length - 8} more)` : ''}`,
    );
  }
  for (const warning of validated.warnings) console.log(`    warning: ${warning}`);
}

async function validateAll(
  recipes: readonly GeneratedRecipe[],
  resolver: IngredientResolver,
): Promise<{ accepted: ValidatedRecipe[]; rejected: RejectedRecipe[] }> {
  const accepted: ValidatedRecipe[] = [];
  const rejected: RejectedRecipe[] = [];

  for (const recipe of recipes) {
    const result = await validateRecipe(recipe, resolver);
    if (result.ok) accepted.push(result.recipe);
    else rejected.push(result.rejection);
  }

  return { accepted, rejected };
}

function emit(accepted: ValidatedRecipe[], rejected: RejectedRecipe[]): void {
  const outDir = resolve(process.cwd(), values.out ?? '../../supabase/seed');
  mkdirSync(outDir, { recursive: true });

  const recipesPath = resolve(outDir, 'recipes.json');
  const reportPath = resolve(outDir, 'rejected.json');

  mkdirSync(dirname(recipesPath), { recursive: true });

  writeFileSync(
    recipesPath,
    JSON.stringify(
      accepted.map((v) => ({
        ...v.recipe,
        nutrientsPerServing: roundNutrients(v.nutrients, 2),
        allergens: v.allergens,
        prepScore: v.prepScore,
        ingredients: v.recipe.ingredients.map((ingredient, index) => ({
          ...ingredient,
          fdcId: v.ingredients[index]?.fdcId ?? null,
          matchedDescription: v.ingredients[index]?.matchedDescription ?? null,
        })),
      })),
      null,
      2,
    ),
  );

  writeFileSync(reportPath, JSON.stringify(rejected, null, 2));

  console.log(`\nWrote ${accepted.length} recipes → ${recipesPath}`);
  console.log(`Wrote ${rejected.length} rejections → ${reportPath}`);
}

async function dryRun(): Promise<void> {
  const client = new Anthropic({ apiKey: requireAnthropicKey() });
  const resolver = new IngredientResolver({ apiKey: USDA_API_KEY });

  const count = Number(values.limit ?? '3');
  const cell: GenerationCell = {
    cuisine: 'italian',
    dietStyle: 'balanced',
    mealSlot: 'dinner',
    count: Number.isFinite(count) && count > 0 ? count : 3,
  };

  console.log(`Dry run: ${cell.count} ${cell.cuisine} ${cell.mealSlot} recipes`);
  console.log(`USDA key: ${USDA_API_KEY === 'DEMO_KEY' ? 'DEMO_KEY (rate limited)' : 'set'}\n`);

  const outcome = await generateCell(client, cell);
  if (outcome.error) {
    console.error(`Generation failed: ${outcome.error}`);
    process.exit(1);
  }
  console.log(`Generated ${outcome.recipes.length} recipes. Resolving ingredients…`);

  const { accepted, rejected } = await validateAll(outcome.recipes, resolver);

  for (const recipe of accepted) printDerivation(recipe);

  for (const rejection of rejected) {
    console.log(`\n  REJECTED: ${rejection.title}`);
    for (const reason of rejection.reasons) console.log(`    - ${reason}`);
    for (const unresolved of rejection.unresolved) {
      console.log(`    - unmatched: ${unresolved.name} (${unresolved.reason})`);
    }
  }

  console.log(`\n${accepted.length} accepted, ${rejected.length} rejected.`);
}

async function fullRun(): Promise<void> {
  const client = new Anthropic({ apiKey: requireAnthropicKey() });
  // `--target` is recipes, which is what anyone thinks in; the plan plans
  // dishes, because each one is written three times.
  const target = Number(values.target ?? '500');
  const plan = buildPlan(Math.ceil(target / RECIPES_PER_DISH));

  console.log(
    `Plan: ${plan.length} cells, ${planTotal(plan)} dishes → ${planRecipeTotal(plan)} recipes.`,
  );
  const batchId = await submitBatch(client, plan);
  console.log(`Submitted batch ${batchId}.`);
  console.log(`Batches usually finish within the hour. Collect with:\n`);
  console.log(`  npm run pipeline -- --collect ${batchId}\n`);

  writeFileSync(
    resolve(process.cwd(), '.last-batch.json'),
    JSON.stringify({ batchId, plan }, null, 2),
  );
}

/**
 * Validate and emit a batch of recipes written anywhere else.
 *
 * Same destination as `--collect`, and — crucially — the same validation. The
 * recipes are resolved against USDA FoodData Central and their nutrition is
 * computed here, so a hand-written batch earns exactly the same guarantees as a
 * generated one: no calorie figure in this project is ever taken on trust,
 * whatever produced the recipe.
 *
 * This is the path that needs no Anthropic key. It needs a USDA one to resolve
 * ingredients at any volume — free, and worth getting for this.
 */
async function importFile(target: string): Promise<void> {
  // `npm run` executes with the cwd set to the workspace package, so a relative
  // path typed at the repo root would resolve inside services/recipe-pipeline.
  // npm records where the command was actually typed in INIT_CWD.
  const from = process.env.INIT_CWD ?? process.cwd();
  const resolved = resolve(from, target);

  if (!existsSync(resolved)) {
    console.error(`No such file or directory: ${resolved}`);
    console.error(`(resolved relative to ${from})`);
    process.exit(1);
  }

  // A directory means "every batch I have generated so far". Building a library
  // takes many runs — one response tops out around ten recipes — so the natural
  // shape is a folder of files, not one hand-concatenated blob.
  const files = statSync(resolved).isDirectory()
    ? readdirSync(resolved)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => resolve(resolved, name))
    : [resolved];

  if (files.length === 0) {
    console.error(`No .json files in ${resolved}`);
    process.exit(1);
  }

  const recipes: GeneratedRecipe[] = [];
  const malformed: { where: string; problem: string }[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      malformed.push({
        where: basename(file),
        problem: `not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    // Accept the batch envelope or a bare array — a hand-assembled file is as
    // likely to be one as the other, and rejecting the array would be a
    // pointless thing to make someone debug.
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { recipes?: unknown }).recipes ?? null);

    if (!Array.isArray(list)) {
      malformed.push({ where: basename(file), problem: 'no "recipes" array found' });
      continue;
    }

    // Validated one recipe at a time rather than through the batch envelope.
    // Two reasons: the envelope caps a batch at ten, which is a limit on what
    // one model call should *produce* and has nothing to do with what a file may
    // contain; and a single bad recipe in a file of sixty should not reject the
    // other fifty-nine.
    list.forEach((entry, index) => {
      const check = GeneratedRecipeSchema.safeParse(entry);
      const label =
        (entry as { title?: unknown })?.title && typeof (entry as { title: unknown }).title === 'string'
          ? `"${(entry as { title: string }).title}"`
          : `recipe ${index + 1}`;

      if (!check.success) {
        const first = check.error.issues[0];
        malformed.push({
          where: `${basename(file)} → ${label}`,
          problem: first ? `${first.path.join('.') || 'root'}: ${first.message}` : 'invalid',
        });
        return;
      }

      // Re-importing a folder after adding one file is the normal case, so a
      // repeated title is expected rather than an error worth stopping for.
      const previous = seen.get(check.data.title.toLowerCase());
      if (previous) {
        malformed.push({
          where: `${basename(file)} → ${label}`,
          problem: `duplicate title, already loaded from ${previous}`,
        });
        return;
      }

      seen.set(check.data.title.toLowerCase(), basename(file));
      recipes.push(check.data);
    });
  }

  console.log(
    `Read ${files.length} file${files.length === 1 ? '' : 's'}: ` +
      `${recipes.length} recipes to validate, ${malformed.length} skipped.`,
  );
  for (const problem of malformed.slice(0, 15)) {
    console.log(`  skipped ${problem.where}: ${problem.problem}`);
  }
  if (malformed.length > 15) console.log(`  …and ${malformed.length - 15} more`);

  if (recipes.length === 0) {
    console.error('\nNothing to import.');
    process.exit(1);
  }

  const resolver = new IngredientResolver({ apiKey: USDA_API_KEY });
  console.log(`\nResolving ingredients against USDA…`);

  const { accepted, rejected } = await validateAll(recipes, resolver);
  emit(accepted, rejected);
}

async function collect(batchId: string): Promise<void> {
  const client = new Anthropic({ apiKey: requireAnthropicKey() });
  const resolver = new IngredientResolver({ apiKey: USDA_API_KEY });

  const progress = await pollBatch(client, batchId);
  console.log(`Batch ${batchId}: ${progress.status} (${progress.succeeded} ok, ${progress.errored} errored)`);
  if (progress.status !== 'ended') {
    console.log('Not finished yet — try again shortly.');
    return;
  }

  // Must reproduce the plan the batch was submitted with, so the same
  // recipes-to-dishes conversion applies here.
  const target = Number(values.target ?? '500');
  const plan = buildPlan(Math.ceil(target / RECIPES_PER_DISH));
  const outcomes = await collectBatch(client, batchId, plan);

  const recipes = outcomes.flatMap((o) => o.recipes);
  const failures = outcomes.filter((o) => o.error);
  console.log(`Collected ${recipes.length} recipes (${failures.length} cells failed). Validating…`);

  const { accepted, rejected } = await validateAll(recipes, resolver);
  emit(accepted, rejected);
}

const command = values.import
  ? importFile(values.import)
  : values.collect
    ? collect(values.collect)
    : values['dry-run']
      ? dryRun()
      : fullRun();

command.catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
