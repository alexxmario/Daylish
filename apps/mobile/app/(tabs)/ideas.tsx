import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Equipment, MealSlot } from '@daylish/core';
import { rankFoods, rankRecipes } from '@daylish/core';

import { CountUp } from '@/components/CountUp.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import { getDayTotals, getFoodHistory, logMeal, type FoodHistoryRow } from '@/data/journal.ts';
import { identifyDish, listRecipes, type RecipeSummary } from '@/data/recipes.ts';
import { recipeAffinity } from '@/data/recipe-interactions.ts';
import { MealSlotPicker } from '../scan.tsx';
import { suggestMealSlot } from '@/lib/meal-slot.ts';
import { today } from '@/lib/dates.ts';
import { useEntitlements } from '@/state/entitlement.tsx';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

const SLOT_TITLE: Record<MealSlot, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'a snack',
};

/** How many suggestions to show. Long enough to choose from, short enough to read. */
const SUGGESTION_COUNT = 6;

/** Fewer than the food suggestions: choosing what to cook is a bigger decision. */
const RECIPE_IDEA_COUNT = 3;

/**
 * Every kind of kit the library actually calls for.
 *
 * The fallback when a profile lists no equipment. Deliberately not the full
 * `Equipment` enum — this is "assume they have what a recipe might ask for",
 * and padding it with kit no recipe uses would make the fallback look like a
 * claim about the person.
 */
const LIBRARY_EQUIPMENT: Equipment[] = [
  'stovetop',
  'oven',
  'grill',
  'blender',
  'food_processor',
  'rice_cooker',
  'microwave',
];

/** How long a row stays marked as logged before returning to normal. */
const CONFIRMATION_MS = 2200;

/**
 * Ideas — what to eat next.
 *
 * The organising question is "what fits, right now", so the screen opens with
 * what is actually left of today and ranks everything below against it.
 *
 * The suggestions are the person's own foods, not a catalogue. That is a
 * deliberate choice rather than a stopgap for the missing recipe library: the
 * thing someone is most likely to actually eat tonight is something they have
 * eaten before, and ranking it by protein density against their remaining
 * targets is advice a generic recipe feed cannot give. Tapping a row logs it
 * outright — the whole point is to answer the question, not open a browser.
 */
export default function IdeasScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, goal } = useSession();
  const { entitlements } = useEntitlements();

  const [totals, setTotals] = useState({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
  const [history, setHistory] = useState<FoodHistoryRow[]>([]);
  const [craving, setCraving] = useState('');
  const [slot, setSlot] = useState<MealSlot>(suggestMealSlot());
  const [justLogged, setJustLogged] = useState<string | null>(null);

  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    },
    [],
  );

  const reload = useCallback(() => {
    if (!profile) return;
    setTotals(getDayTotals(profile.id, today()));
    setHistory(getFoodHistory(profile.id, { mealSlot: slot, localDate: today() }));
  }, [profile, slot]);

  // Re-runs on focus and whenever `reload` changes identity — which is what
  // picking a different slot does. Slot affinity is counted in SQL, so a slot
  // change has to re-read the history rather than merely re-sort it.
  useFocusEffect(reload);

  const remaining = useMemo(
    () => ({
      kcal: Math.round((goal?.energyKcal ?? 0) - totals.energyKcal),
      protein: Math.round((goal?.proteinG ?? 0) - totals.proteinG),
    }),
    [goal, totals],
  );

  const suggestions = useMemo(() => {
    const term = craving.trim().toLowerCase();
    const pool = term
      ? history.filter((food) => food.displayName.toLowerCase().includes(term))
      : history;

    const ranked = rankFoods(
      pool.map((food) => ({
        key: food.key,
        per100g: food.per100g,
        typicalGrams: food.typicalGrams,
        uses: food.uses,
        usesInSlot: food.usesInSlot,
        usesToday: food.usesToday,
      })),
      { remaining: { energyKcal: remaining.kcal, proteinG: remaining.protein }, mealSlot: slot },
    );

    const byKey = new Map(pool.map((food) => [food.key, food]));
    return ranked
      .slice(0, SUGGESTION_COUNT)
      .flatMap((r) => {
        const food = byKey.get(r.key);
        return food ? [{ ...r, food }] : [];
      });
  }, [history, craving, remaining, slot]);

  /**
   * Recipes worth cooking for this slot, ranked against what is left of today.
   *
   * Two guards, both learned from the data rather than assumed:
   *
   * `rankRecipes` treats equipment as a hard filter, so a profile that lists no
   * equipment would exclude the entire library — every recipe needs at least a
   * hob. An empty kit means "not told", not "owns nothing", so it falls back to
   * everything the library uses.
   *
   * The prep-time ceiling is the user's own stated limit, and it is a real
   * constraint — but the median recipe is 62 minutes against a default ceiling
   * of 45, so on a restrictive diet it can empty the section entirely. Rather
   * than show nothing, it retries without the ceiling and says so.
   */
  const recipeIdeas = useMemo(() => {
    if (!profile || !goal) return { recipes: [], relaxed: false };

    /*
      Only what this account can actually cook.

      Ranking a locked recipe into "cook something tonight" and then charging at
      the tap is the single most resented shape a paywall takes — the app pushed
      it, the person did not go looking for it. Browsing is where locked recipes
      belong, because that is a place someone chose to go.
    */
    const library = listRecipes({ freeOnly: entitlements.recipeLimit !== null });
    const kit = profile.equipment.length > 0 ? profile.equipment : LIBRARY_EQUIPMENT;

    const rankable = library.map((recipe) => ({
      id: recipe.id,
      // `rankRecipes` reads only energy and protein, and building the full
      // 37-nutrient vector for 496 recipes to hand over two numbers would be
      // work done to be thrown away.
      perServing: { energyKcal: recipe.energyKcal, proteinG: recipe.proteinG },
      allergens: recipe.allergens,
      dietStyles: recipe.dietStyles,
      equipment: recipe.equipment,
      totalMinutes: recipe.totalMinutes,
      mealSlots: recipe.mealSlots,
      // Empty rather than the real list: the pantry-coverage term only means
      // something once a pantry exists, and reading every ingredient row to
      // score it against nothing is pure cost.
      ingredientNames: [],
    }));

    const context = {
      remaining: { energyKcal: remaining.kcal, proteinG: remaining.protein },
      avoidedAllergens: profile.allergens,
      dietStyle: goal.dietStyle,
      availableEquipment: kit,
      pantryIngredientNames: [],
      mealSlot: slot,
      affinityByRecipeId: recipeAffinity(profile.id),
    };

    let relaxed = false;
    let ranked = rankRecipes(rankable, { ...context, maxPrepMinutes: profile.maxPrepMinutes });
    if (ranked.length === 0) {
      ranked = rankRecipes(rankable, { ...context, maxPrepMinutes: Number.POSITIVE_INFINITY });
      relaxed = ranked.length > 0;
    }

    const byId = new Map(library.map((recipe) => [recipe.id, recipe]));

    // One card per dish. Three variants of the same shakshuka is a worse answer
    // to "what shall I cook" than three different meals, however well each fits.
    const seen = new Set<string>();
    const recipes: { recipe: RecipeSummary; reason: string }[] = [];
    for (const entry of ranked) {
      const recipe = byId.get(entry.id);
      if (!recipe) continue;
      const { dishKey } = identifyDish(recipe.title);
      if (seen.has(dishKey)) continue;
      seen.add(dishKey);
      recipes.push({ recipe, reason: entry.topReason });
      if (recipes.length === RECIPE_IDEA_COUNT) break;
    }

    return { recipes, relaxed };
  }, [profile, goal, remaining, slot, entitlements]);

  const totalRecipes = useMemo(
    () => listRecipes({ freeOnly: entitlements.recipeLimit !== null }).length,
    [entitlements],
  );

  const handleLog = useCallback(
    (food: FoodHistoryRow, grams: number) => {
      if (!profile) return;
      logMeal({
        userId: profile.id,
        mealSlot: slot,
        logMethod: 'suggestion',
        items: [
          {
            foodItemId: food.foodItemId,
            displayName: food.displayName,
            grams,
            per100g: food.per100g,
            source: food.source,
            confidence: food.confidence,
          },
        ],
      });

      setJustLogged(food.key);
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
      confirmationTimer.current = setTimeout(() => setJustLogged(null), CONFIRMATION_MS);
      reload();
    },
    [profile, slot, reload],
  );

  if (!profile || !goal) return null;

  const overTarget = remaining.kcal < 0;

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: insets.top + theme.spacing.lg,
        paddingBottom: theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text variant="display">Ideas</Text>

      {/* The number everything else is ranked against. */}
      <Ticket label={`For ${SLOT_TITLE[slot]}`} meta={overTarget ? 'over target' : 'remaining today'}>
        {/* These are the feedback for tapping a suggestion — Ideas has no ring,
            so the drop in what is left is the only confirmation the log landed. */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
          <CountUp
            value={Math.abs(remaining.kcal)}
            format={(n) => n.toLocaleString()}
            variant="numeric"
          />
          <Text variant="eyebrow" tone="muted">
            kcal {overTarget ? 'over' : ''}
          </Text>
          <View style={{ flex: 1 }} />
          <CountUp value={remaining.protein} variant="numeric" />
          <Text variant="eyebrow" tone="muted">
            g protein
          </Text>
        </View>
        <Divider />
        <MealSlotPicker value={slot} onChange={setSlot} />
      </Ticket>

      {/* One label, not two. The section eyebrow already names this; a ticket
          label beneath it repeated the idea in the same all-caps voice, which is
          noise rather than structure. Where the suggestions come from is said by
          the reason line on every row — "one of your regulars" — which earns it
          per item instead of asserting it once at the top. */}
      <Eyebrow>What fits right now</Eyebrow>
      <Ticket rule={theme.palette.sun}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radii.md,
            backgroundColor: theme.palette.surfaceSunken,
            minHeight: MIN_TAP_TARGET,
          }}
        >
          <TextInput
            value={craving}
            onChangeText={setCraving}
            placeholder="Anything you fancy? e.g. eggs"
            accessibilityLabel="Filter suggestions by what you fancy"
            placeholderTextColor={theme.palette.inkMuted}
            returnKeyType="search"
            style={{
              flex: 1,
              fontFamily: theme.fonts.body,
              fontSize: theme.typography.body.fontSize,
              color: theme.palette.ink,
              paddingVertical: theme.spacing.sm,
            }}
          />
          {craving.length > 0 ? (
            <Pressable
              onPress={() => setCraving('')}
              accessibilityRole="button"
              accessibilityLabel="Clear"
              hitSlop={12}
            >
              <Text variant="caption" tone="muted">
                Clear
              </Text>
            </Pressable>
          ) : null}
        </View>

        {history.length === 0 ? (
          <>
            <Illustration name="reverseLogging" height={104} />
            <Text variant="caption" tone="secondary">
              Log a few meals and this fills with the ones that fit what is left of your day.
            </Text>
          </>
        ) : suggestions.length === 0 ? (
          <Text variant="caption" tone="secondary">
            Nothing you have logged before matches “{craving.trim()}”. Search for it instead and it
            will show up here next time.
          </Text>
        ) : (
          suggestions.map(({ food, ...ranked }, index) => (
            <View key={food.key} style={{ gap: theme.spacing.md }}>
              {index > 0 ? <Divider /> : null}
              <SuggestionRow
                name={food.displayName}
                grams={ranked.grams}
                energyKcal={ranked.energyKcal}
                proteinG={ranked.proteinG}
                reason={ranked.topReason}
                // Past the target there is no headroom left to take a share of,
                // so the rule fills — which is the honest reading of "this costs
                // more than you have".
                share={remaining.kcal > 0 ? ranked.energyKcal / remaining.kcal : 1}
                leading={index === 0}
                logged={justLogged === food.key}
                onPress={() => handleLog(food, ranked.grams)}
              />
            </View>
          ))
        )}
      </Ticket>

      {/*
        The other half of the question. Everything above is something you have
        eaten before, which is the right answer to "what now" and the wrong one
        to "what shall I cook" — nobody's own history is a varied week. These are
        ranked against the same remaining targets, from the same library the
        Meals tab browses, so the two screens cannot disagree about what fits.
      */}
      <Eyebrow>Cook something</Eyebrow>
      <Ticket
        rule={theme.palette.celesteInk}
        label={`For ${SLOT_TITLE[slot]}`}
        meta={recipeIdeas.relaxed ? 'over your usual time' : undefined}
      >
        {recipeIdeas.recipes.length === 0 ? (
          <Text variant="caption" tone="secondary">
            Nothing in the library fits {SLOT_TITLE[slot]} with your allergens and diet. The Meals
            tab browses all {totalRecipes} of them.
          </Text>
        ) : (
          <>
            {recipeIdeas.relaxed ? (
              <Text variant="caption" tone="muted">
                These take longer than the {profile.maxPrepMinutes} minutes you said you usually
                have — nothing quicker fits the rest of your day.
              </Text>
            ) : null}
            {recipeIdeas.recipes.map(({ recipe, reason }, index) => (
              <View key={recipe.id} style={{ gap: theme.spacing.md }}>
                {index > 0 ? <Divider /> : null}
                <RecipeIdeaRow
                  recipe={recipe}
                  reason={reason}
                  onPress={() => router.push({ pathname: '/recipe', params: { id: recipe.id } })}
                />
              </View>
            ))}
          </>
        )}
      </Ticket>

      {/*
        A "Later" card used to sit here listing four unbuilt features. It earned
        its place when Ideas had one section and the recipe library was months
        away — it explained why the screen looked thin. Ideas now answers the
        question twice over, from your own history and from the library, so the
        card was the only place left in the app that advertised an absence.
      */}
    </ScrollView>
  );
}

/**
 * One suggestion, tappable to log.
 *
 * Set as a nutrition-panel row, following `MacroMeter`: name on the left, figure
 * on the right, a rule beneath carrying the fill. The list is about numbers you
 * can trust, so it should read the way the back of a packet reads.
 *
 * The rule is not decoration — it is the share of what is left of the day that
 * this portion would take, which is the question behind "does this fit". A food
 * that would use most of the remaining budget shows a nearly full rule before
 * anyone has done any arithmetic.
 *
 * Only the leading row gets the warm wash and the hot action. This list is
 * *ranked*, and an earlier pass drew every row identically — so the ordering,
 * which is the entire product of the scoring, was invisible. Persimmon is also
 * reserved for one primary per screen (see `Button.tsx`); three sun-coloured
 * actions in one list is why the section read as flat.
 *
 * The portion is stated before the tap rather than after, because the row is a
 * commitment — someone needs to see "180 g" and disagree with it *first*. The
 * reason line is the same contract the target card keeps on Today: nothing is
 * ranked without saying why.
 */
function SuggestionRow({
  name,
  grams,
  energyKcal,
  proteinG,
  reason,
  share,
  leading,
  logged,
  onPress,
}: {
  name: string;
  grams: number;
  energyKcal: number;
  proteinG: number;
  reason: string;
  /** How much of what is left today this portion would use, 0–1. */
  share: number;
  leading: boolean;
  logged: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fill = leading ? theme.palette.sun : theme.palette.celesteInk;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${leading ? 'Best fit. ' : ''}Log ${Math.round(grams)} grams of ${name}, ${Math.round(energyKcal)} calories`}
      accessibilityHint={reason}
      style={{
        minHeight: MIN_TAP_TARGET,
        gap: theme.spacing.xs,
        justifyContent: 'center',
        // The one place this list raises its voice.
        backgroundColor: leading ? theme.palette.surfaceWarm : 'transparent',
        borderRadius: leading ? theme.radii.md : 0,
        padding: leading ? theme.spacing.md : 0,
        margin: leading ? -theme.spacing.xs : 0,
      }}
    >
      {leading ? (
        <Text variant="eyebrow" tone="secondary">
          Best fit
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.md }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
          {name}
        </Text>
        <Text variant={leading ? 'numeric' : 'numericSmall'}>{Math.round(energyKcal)}</Text>
        <Text variant="eyebrow" tone="muted">
          kcal
        </Text>
      </View>

      {/* Share of what is left. Same 4pt rule as the macro meters. */}
      <View style={{ height: 4, backgroundColor: theme.palette.ringTrack, overflow: 'hidden' }}>
        <View
          style={{
            width: `${Math.max(2, Math.min(100, share * 100))}%`,
            height: '100%',
            backgroundColor: fill,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text variant="caption" tone="muted" tabular style={{ flex: 1 }} numberOfLines={1}>
          {Math.round(grams)} g · {Math.round(proteinG)} g protein
        </Text>
        <Text variant="captionStrong" tone={logged ? 'celeste' : leading ? 'sun' : 'celeste'}>
          {logged ? 'Logged' : 'Log it'}
        </Text>
      </View>

      <Text variant="caption" tone="secondary">
        {reason}
      </Text>
    </Pressable>
  );
}

/**
 * One recipe worth cooking.
 *
 * Opens the recipe rather than logging it, which is the one place this list
 * has to differ from the one above. Tapping a food you have eaten before is a
 * safe bet — you know what it is, and the row states the portion. Cooking is a
 * commitment of forty minutes and a shopping list, and logging it before it is
 * cooked would put a meal in the diary that nobody has eaten.
 */
function RecipeIdeaRow({
  recipe,
  reason,
  onPress,
}: {
  recipe: RecipeSummary;
  reason: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${recipe.title}, ${Math.round(recipe.energyKcal)} calories a serving, ${recipe.totalMinutes} minutes`}
      accessibilityHint={reason}
      style={{ minHeight: MIN_TAP_TARGET, gap: theme.spacing.xs, justifyContent: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.md }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
          {recipe.title}
        </Text>
        <Text variant="numericSmall">{Math.round(recipe.energyKcal)}</Text>
        <Text variant="eyebrow" tone="muted">
          kcal
        </Text>
      </View>

      <Text variant="caption" tone="muted" tabular>
        {recipe.totalMinutes} min · {Math.round(recipe.proteinG)} g protein · serves{' '}
        {recipe.servings}
      </Text>

      <Text variant="caption" tone="secondary">
        {reason}
      </Text>
    </Pressable>
  );
}
