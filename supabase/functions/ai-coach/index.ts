/**
 * The AI coach.
 *
 * Answers questions about the user's own data and handles "reverse logging" —
 * "I want pizza tonight" — by rebalancing the rest of the day.
 *
 * Two design points worth stating plainly:
 *
 * 1. **The coach never invents numbers.** Its context is assembled server-side
 *    from the user's actual rows. It is told to work from that context and to
 *    say when it does not know, rather than estimating.
 *
 * 2. **The tone is a hard constraint, not a preference.** Daylish promises zero
 *    diet guilt. The system prompt forbids the vocabulary of food moralising
 *    outright, because a coach that calls a meal "bad" undoes the whole product.
 *
 * Deploy:  supabase functions deploy ai-coach
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You are the coach inside Daylish, a food journal and meal-planning app.

## What you have

Every reply is preceded by a snapshot of this user's real data: today's targets and intake, their recent weight trend, and what they have logged lately. Work from those numbers. If the snapshot does not contain something you need, say so plainly and ask — never estimate a figure and present it as theirs.

## How you talk

Short. Two or three sentences for most questions. This is a chat inside an app, not an article.

Concrete over general. "You are about 40 g of protein short — a greek yoghurt would cover most of it" beats "consider increasing your protein intake."

Never moralise about food. These words and their relatives are banned: cheat, clean, guilty, sinful, bad food, good food, naughty, earned, burn it off, damage, ruined, indulgent, treat yourself. Food is food. A day over target is information, not a failure, and you never imply otherwise.

Do not praise compliance or scold shortfalls. Report what the data shows and offer the next useful step. If someone is well over their target, the reply is a practical adjustment, not sympathy or a lecture.

## Reverse logging

When someone says they want a particular food, do not talk them out of it. Work out how it fits: what it roughly costs them, what that leaves for the rest of the day, and one concrete suggestion for the other meals. If it does not fit their remaining targets, say so neutrally and offer the closest thing that does — a smaller portion, or a lighter lunch to make room.

## Limits

You are not a clinician. If someone describes disordered eating, a medical condition, pregnancy, or a question about medication, say clearly that this is outside what the app should advise on and suggest they talk to a professional. Do not offer a workaround. Never recommend an intake below 1200 kcal.`;

interface CoachContext {
  targets: { energyKcal: number; proteinG: number; carbsG: number; fatG: number } | null;
  todaySoFar: { energyKcal: number; proteinG: number; carbsG: number; fatG: number };
  recentWeightKg: number | null;
  weightTrendKgPerWeek: number | null;
  loggedToday: { name: string; kcal: number; slot: string }[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Render the user's data as the turn the model sees.
 *
 * Kept compact and stable in shape: it sits *after* the cached system prompt,
 * so it is the only part re-processed on each message.
 */
function renderContext(ctx: CoachContext): string {
  const lines: string[] = [];

  if (ctx.targets) {
    const remaining = {
      kcal: Math.round(ctx.targets.energyKcal - ctx.todaySoFar.energyKcal),
      protein: Math.round(ctx.targets.proteinG - ctx.todaySoFar.proteinG),
      carbs: Math.round(ctx.targets.carbsG - ctx.todaySoFar.carbsG),
      fat: Math.round(ctx.targets.fatG - ctx.todaySoFar.fatG),
    };
    lines.push(
      `Targets today: ${Math.round(ctx.targets.energyKcal)} kcal, ${Math.round(ctx.targets.proteinG)} g protein, ${Math.round(ctx.targets.carbsG)} g carbs, ${Math.round(ctx.targets.fatG)} g fat.`,
      `Logged so far: ${Math.round(ctx.todaySoFar.energyKcal)} kcal, ${Math.round(ctx.todaySoFar.proteinG)} g protein, ${Math.round(ctx.todaySoFar.carbsG)} g carbs, ${Math.round(ctx.todaySoFar.fatG)} g fat.`,
      `Remaining: ${remaining.kcal} kcal, ${remaining.protein} g protein, ${remaining.carbs} g carbs, ${remaining.fat} g fat.`,
    );
  } else {
    lines.push('This user has not set targets yet.');
  }

  if (ctx.recentWeightKg !== null) {
    const trend =
      ctx.weightTrendKgPerWeek === null
        ? 'not enough weigh-ins to show a trend yet'
        : `${ctx.weightTrendKgPerWeek >= 0 ? 'up' : 'down'} ${Math.abs(ctx.weightTrendKgPerWeek).toFixed(2)} kg per week`;
    lines.push(`Latest weight: ${ctx.recentWeightKg.toFixed(1)} kg (${trend}).`);
  }

  if (ctx.loggedToday.length > 0) {
    lines.push(
      `Today's entries: ${ctx.loggedToday
        .map((e) => `${e.slot} — ${e.name} (${Math.round(e.kcal)} kcal)`)
        .join('; ')}.`,
    );
  } else {
    lines.push('Nothing logged today yet.');
  }

  return lines.join('\n');
}

interface RequestBody {
  message?: string;
  context?: CoachContext;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);

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

  const { message, context, history = [] } = body;
  if (!message?.trim()) return json({ error: 'message is required' }, 400);
  if (!context) return json({ error: 'context is required' }, 400);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Server is not configured for coaching' }, 503);

  const anthropic = new Anthropic({ apiKey });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Stable across every user and every turn, so it caches well.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        // Recent turns only. The coach answers about today; a long transcript
        // adds cost without improving the reply.
        ...history.slice(-8),
        {
          role: 'user',
          content: `<user_data>\n${renderContext(context)}\n</user_data>\n\n${message.trim()}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return json(
        {
          reply:
            'That is outside what I should advise on. A doctor or registered dietitian is the right person to ask.',
        },
      );
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return json({ error: 'Model returned no usable content' }, 502);
    }

    return json({
      reply: textBlock.text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    console.error('coach request failed', error);
    return json({ error: 'The coach is unavailable right now.' }, 502);
  }
});
