/**
 * Recipe generation via the Claude API.
 *
 * Two deliberate choices:
 *
 * - **Batch API.** Generating hundreds of recipes is not latency-sensitive, and
 *   the Batch API is half price. A 500-recipe run is a single submission that
 *   we poll.
 * - **Prompt caching on the system prompt.** Every request shares the same long
 *   instruction block, so it is written to cache once and read thereafter.
 *
 * `output_config.format` pins the response to the recipe schema, so parsing is
 * guaranteed rather than hopeful — and, critically, the schema has no nutrition
 * fields for the model to fill in.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { GeneratedRecipeBatchSchema, type GeneratedRecipe } from '@daylish/core';

import { buildCellPrompt, RECIPE_SYSTEM_PROMPT } from './prompts.ts';
import type { GenerationCell } from './taxonomy.ts';

export const MODEL = 'claude-opus-5';

/** JSON Schema for `output_config.format`, derived from the same Zod schema we parse with. */
function recipeBatchJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(GeneratedRecipeBatchSchema, { io: 'output' }) as Record<string, unknown>;
}

function requestParams(cell: GenerationCell) {
  return {
    model: MODEL,
    max_tokens: 16000,
    system: [
      {
        type: 'text' as const,
        text: RECIPE_SYSTEM_PROMPT,
        // The whole instruction block is identical across every request in the
        // run, so it is cached once and read back on the rest.
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    output_config: {
      format: { type: 'json_schema' as const, schema: recipeBatchJsonSchema() },
    },
    messages: [{ role: 'user' as const, content: buildCellPrompt(cell) }],
  };
}

export interface GenerationOutcome {
  cell: GenerationCell;
  recipes: GeneratedRecipe[];
  error?: string;
}

/** Parse and validate one model response into recipes. */
function parseResponse(text: string): GeneratedRecipe[] {
  const parsed = GeneratedRecipeBatchSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Response did not match the recipe schema: ${parsed.error.message}`);
  }
  return parsed.data.recipes;
}

/**
 * Generate one cell synchronously. Used by `--dry-run`, where the point is to
 * see the whole pipeline work on a handful of recipes without waiting on a batch.
 */
export async function generateCell(
  client: Anthropic,
  cell: GenerationCell,
): Promise<GenerationOutcome> {
  try {
    const response = await client.messages.create(requestParams(cell));

    if (response.stop_reason === 'refusal') {
      return { cell, recipes: [], error: 'Request was declined by safety classifiers' };
    }

    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') {
      return { cell, recipes: [], error: 'No text block in response' };
    }

    return { cell, recipes: parseResponse(text.text) };
  } catch (error) {
    return { cell, recipes: [], error: String(error) };
  }
}

/**
 * Submit the whole plan as one batch.
 *
 * Returns the batch id; results are collected separately once processing ends.
 * Each request's `custom_id` encodes its cell so results can be attributed —
 * batch results come back in arbitrary order.
 */
export async function submitBatch(
  client: Anthropic,
  plan: readonly GenerationCell[],
): Promise<string> {
  const batch = await client.messages.batches.create({
    requests: plan.map((cell, index) => ({
      custom_id: `${index}-${cell.cuisine}-${cell.dietStyle}-${cell.mealSlot}`,
      params: requestParams(cell),
    })),
  });
  return batch.id;
}

export interface BatchProgress {
  status: string;
  succeeded: number;
  errored: number;
  processing: number;
}

export async function pollBatch(client: Anthropic, batchId: string): Promise<BatchProgress> {
  const batch = await client.messages.batches.retrieve(batchId);
  return {
    status: batch.processing_status,
    succeeded: batch.request_counts.succeeded,
    errored: batch.request_counts.errored,
    processing: batch.request_counts.processing,
  };
}

/** Collect a finished batch, keyed back to the cells that produced it. */
export async function collectBatch(
  client: Anthropic,
  batchId: string,
  plan: readonly GenerationCell[],
): Promise<GenerationOutcome[]> {
  const outcomes: GenerationOutcome[] = [];

  for await (const result of await client.messages.batches.results(batchId)) {
    const index = Number(result.custom_id.split('-')[0]);
    const cell = plan[index];
    if (!cell) continue;

    if (result.result.type !== 'succeeded') {
      outcomes.push({ cell, recipes: [], error: `Batch request ${result.result.type}` });
      continue;
    }

    const message = result.result.message;
    if (message.stop_reason === 'refusal') {
      outcomes.push({ cell, recipes: [], error: 'Declined by safety classifiers' });
      continue;
    }

    const text = message.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') {
      outcomes.push({ cell, recipes: [], error: 'No text block in response' });
      continue;
    }

    try {
      outcomes.push({ cell, recipes: parseResponse(text.text) });
    } catch (error) {
      outcomes.push({ cell, recipes: [], error: String(error) });
    }
  }

  return outcomes;
}
