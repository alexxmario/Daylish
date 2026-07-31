/**
 * AI photo meal logging.
 *
 * Takes a photo of a plate and returns the foods it contains with estimated
 * portion weights. The client then resolves each item against the nutrition
 * database and shows a confirm step — the model identifies *what* is on the
 * plate, never *how many calories* it contains.
 *
 * This runs server-side for one non-negotiable reason: the Anthropic API key
 * must never ship inside the app bundle, where anyone can extract it.
 *
 * Deploy:  supabase functions deploy ai-photo-log
 * Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const MODEL = 'claude-opus-5';

/** Guardrail: a plate photo is a few hundred kB. Anything larger is not a meal. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * The response contract.
 *
 * Note what is absent: no calorie, protein, carbohydrate or fat field. The model
 * cannot return a nutrition number because there is nowhere to put one. It
 * returns a name, a weight estimate, and — mandatory — its confidence, which the
 * app renders on every AI-sourced entry.
 */
const RECOGNITION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plain food name, e.g. "scrambled eggs"' },
          estimatedGrams: {
            type: 'number',
            description: 'Estimated edible weight on the plate, in grams',
          },
          confidence: {
            type: 'number',
            description:
              'How sure you are this item is present AND correctly portioned, 0 to 1. Be honest: a partially hidden item or an unfamiliar dish deserves a low number.',
          },
          searchQuery: {
            type: 'string',
            description: 'Plain terms to look this food up in a nutrition database',
          },
          notes: {
            type: ['string', 'null'],
            description: 'Anything uncertain about this item',
          },
        },
        required: ['name', 'estimatedGrams', 'confidence', 'searchQuery', 'notes'],
        additionalProperties: false,
      },
    },
    overallConfidence: { type: 'number' },
    caveat: {
      type: ['string', 'null'],
      description: 'Anything about the image that limits the estimate — poor light, hidden food, no size reference',
    },
  },
  required: ['items', 'overallConfidence', 'caveat'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You identify food in photographs for Daylish, a food journal.

Your job is identification and portion estimation. You do not report nutrition values — the app computes those from a verified database using the weights you give.

How to estimate portions:
- Look for scale references: cutlery, a standard dinner plate (~27 cm), a mug, a hand. Say so in the caveat when there is nothing to judge scale against.
- Give edible weight. Do not include bones, shells, or the plate.
- Estimate each component separately. "Chicken salad" is chicken, leaves, dressing, and whatever else you can see — the user can merge them, but cannot split what you lumped together.

On confidence, be genuinely calibrated rather than reflexively high:
- 0.9+ : unmistakable, clearly visible, good scale reference.
- 0.6-0.9: confident about the food, less so about the amount.
- 0.3-0.6: partly obscured, ambiguous preparation, or no scale reference.
- below 0.3: a guess. Say why in notes.

An honest low number is far more useful than a confident wrong one — the app shows your confidence to the user, and they will correct you.

If the image contains no food, return an empty items array and explain in the caveat.`;

interface RequestBody {
  /** Base64 image data, without the data-URI prefix. */
  imageBase64?: string;
  mediaType?: string;
  /** Optional user hint, e.g. "the rice is about two cups". */
  hint?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST' }, 405);
  }

  // Authenticate. The function runs with the caller's JWT so an anonymous
  // request cannot burn our model budget.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) return json({ error: 'Not signed in' }, 401);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const { imageBase64, mediaType = 'image/jpeg', hint } = body;
  if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400);

  if (!ALLOWED_MEDIA_TYPES.includes(mediaType as (typeof ALLOWED_MEDIA_TYPES)[number])) {
    return json({ error: `mediaType must be one of ${ALLOWED_MEDIA_TYPES.join(', ')}` }, 400);
  }

  // Base64 inflates by ~4/3, so compare against the decoded size.
  const approxBytes = Math.floor((imageBase64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return json({ error: 'Image is too large; resize to under 5 MB' }, 413);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Server is not configured for AI logging' }, 503);

  const anthropic = new Anthropic({ apiKey });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Identical on every request, so it is cached and read back cheaply.
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: RECOGNITION_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            {
              type: 'text',
              text: hint
                ? `Identify the food in this photo. The user adds: ${hint}`
                : 'Identify the food in this photo and estimate portion weights.',
            },
          ],
        },
      ],
    });

    // A refusal arrives as a normal 200, so check before reading content.
    if (response.stop_reason === 'refusal') {
      return json({ error: 'That image could not be processed.' }, 422);
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return json({ error: 'Model returned no usable content' }, 502);
    }

    const parsed = JSON.parse(textBlock.text) as {
      items: { name: string; estimatedGrams: number; confidence: number }[];
    };

    return json({
      ...parsed,
      // Stamped server-side so the client cannot mistake this for verified data.
      source: 'ai_estimate',
      model: MODEL,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    console.error('photo recognition failed', error);
    return json({ error: 'Could not read that photo. Try again, or log it by hand.' }, 502);
  }
});
