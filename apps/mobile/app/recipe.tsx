import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MealSlot } from '@daylish/core';

import { Button, Chip } from '@/components/Button.tsx';
import { DishPhoto } from '@/components/DishPhoto.tsx';
import { MacroBar } from '@/components/MacroBar.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import { Locked } from '@/components/Locked.tsx';
import {
  getRecipe,
  identifyDish,
  isFreeRecipe,
  listDishes,
  logRecipeAsMeal,
  scaleRecipe,
  servingNutrition,
} from '@/data/recipes.ts';
import {
  isRecipeSaved,
  recipeCookCounts,
  recordRecipeCooked,
  toggleRecipeSaved,
} from '@/data/recipe-interactions.ts';
import {
  ShoppingListLimitError,
  addToShoppingList,
  isOnShoppingList,
  removeFromShoppingList,
} from '@/data/shopping-list.ts';
import { MealSlotPicker } from './scan.tsx';
import { suggestMealSlot } from '@/lib/meal-slot.ts';
import { useEntitlements } from '@/state/entitlement.tsx';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/** Portions someone might actually log. Half is for sharing, three for a batch cook. */
const PORTIONS = [0.5, 1, 1.5, 2, 3];

/**
 * One recipe, end to end.
 *
 * Ordered by what someone standing in a kitchen needs, not by what the database
 * holds: what it is and what it costs them, then what to buy, then what to do.
 * Nutrition sits at the top because deciding whether to cook it at all is the
 * first question, and it is the one this app is meant to answer better than a
 * recipe site.
 *
 * The portion selector recalculates the nutrition live and drives what gets
 * logged. Someone eating half a serving should not have to log a whole one and
 * then go and correct it.
 */
export default function RecipeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const { entitlements } = useEntitlements();
  const { id } = useLocalSearchParams<{ id: string }>();

  // The recipe actually being shown. Switching variant swaps this, which is
  // why it is state rather than derived straight from the route param.
  const [recipeId, setRecipeId] = useState(id ?? '');
  const recipe = useMemo(() => (recipeId ? getRecipe(recipeId) : null), [recipeId]);

  const [portions, setPortions] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(suggestMealSlot());
  const [cookFor, setCookFor] = useState<number | null>(null);

  /**
   * Saving is per variant, not per dish. "Shakshuka, light" and the standard
   * one are different meals with different numbers, and someone who kept the
   * light one meant the light one.
   */
  const [saved, setSaved] = useState(false);
  const [cookCount, setCookCount] = useState(0);
  const [onList, setOnList] = useState(false);

  useEffect(() => {
    if (!profile || !recipeId) return;
    setSaved(isRecipeSaved(profile.id, recipeId));
    setCookCount(recipeCookCounts(profile.id)[recipeId] ?? 0);
    setOnList(isOnShoppingList(profile.id, recipeId));
  }, [profile, recipeId]);

  const handleToggleSaved = useCallback(() => {
    if (!profile || !recipeId) return;
    setSaved(toggleRecipeSaved(profile.id, recipeId));
  }, [profile, recipeId]);

  /** The other ways to cook this dish — lighter, heartier, or for another diet. */
  const siblings = useMemo(() => {
    if (!recipe) return [];
    const key = identifyDish(recipe.title).dishKey;
    return listDishes().find((d) => d.dishKey === key)?.variants ?? [];
  }, [recipe]);

  const scaled = useMemo(
    () => (recipe ? scaleRecipe(recipe, cookFor ?? recipe.servings) : null),
    [recipe, cookFor],
  );

  const nutrition = useMemo(
    () => (recipe ? servingNutrition(recipe, portions) : null),
    [recipe, portions],
  );

  const handleLog = useCallback(() => {
    if (!profile || !recipe) return;
    try {
      logRecipeAsMeal({
        userId: profile.id,
        recipeId: recipe.id,
        mealSlot: slot,
        servings: portions,
      });
      // Logging a recipe is the only evidence the app gets that it was cooked.
      // Recorded after the log rather than before, so a failed log never leaves
      // a cook behind it.
      recordRecipeCooked(profile.id, recipe.id);
      router.back();
    } catch (cause) {
      Alert.alert(
        'Could not log that',
        cause instanceof Error ? cause.message : 'Please try again.',
      );
    }
  }, [profile, recipe, slot, portions, router]);

  /**
   * Add at the portions the "Cook for" control is showing.
   *
   * That control is already on the screen and already means "how much of this
   * am I making", so asking again on the way to the shopping list would be
   * asking the same question twice.
   */
  const handleToggleList = useCallback(() => {
    if (!profile || !recipe) return;
    if (onList) {
      removeFromShoppingList(profile.id, recipe.id);
      setOnList(false);
      return;
    }

    try {
      addToShoppingList(profile.id, recipe.id, cookFor ?? recipe.servings, {
        maxRecipes: entitlements.multiRecipeShopping ? null : 1,
      });
      setOnList(true);
    } catch (cause) {
      if (cause instanceof ShoppingListLimitError) {
        // The limit is the feature, so the prompt describes what buying it does
        // rather than telling someone off for reaching a cap.
        Alert.alert(
          'One recipe at a time',
          'Premium adds several recipes to one list and combines what they share, so four dinners come out as one shop.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See Premium', onPress: () => router.push('/premium') },
          ],
        );
        return;
      }
      throw cause;
    }
  }, [profile, recipe, cookFor, onList, entitlements, router]);

  // Switching variant keeps the portion and slot you already chose — you are
  // still logging the same meal, just a different version of it.
  const switchVariant = useCallback((nextId: string) => {
    setRecipeId(nextId);
    setCookFor(null);
  }, []);

  if (!recipe) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.xl,
          gap: theme.spacing.md,
        }}
      >
        <Text variant="heading">That recipe is not here</Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  /**
   * Locked recipes still show what they are.
   *
   * The photograph, the name and the nutrition are the reason someone tapped,
   * and hiding them would make the lock feel arbitrary — "this dish exists and
   * costs 480 kcal, and cooking it is Premium" is a proposition someone can
   * actually evaluate. What is withheld is the part with the work in it: the
   * ingredient quantities and the method.
   */
  const locked = entitlements.recipeLimit !== null && !isFreeRecipe(recipe.id);

  const activeMinutes =
    recipe.steps
      .filter((step) => !step.isPassive)
      .reduce((sum, step) => sum + (step.durationMinutes ?? 0), 0) || recipe.prepMinutes;

  return (
    <View style={{ flex: 1, paddingTop: insets.top + theme.spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
        }}
      >
        <Text variant="eyebrow" tone="muted" style={{ flex: 1 }}>
          {recipe.cuisine.replace(/_/g, ' ')}
        </Text>

        {/*
          Saving sits in the header rather than beside the log button, because
          the two answer different questions — "I am eating this now" and "I
          want to find this again". Putting them together makes the second look
          like a weaker version of the first.
        */}
        <Pressable
          onPress={handleToggleSaved}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          accessibilityLabel={saved ? 'Saved. Tap to remove from saved' : 'Save this recipe'}
          hitSlop={12}
          style={{
            minHeight: MIN_TAP_TARGET,
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.md,
          }}
        >
          <Text variant="captionStrong" tone={saved ? 'celeste' : 'secondary'}>
            {saved ? '★ Saved' : '☆ Save'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Text tone="secondary">Close</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + 200,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/*
          What it should look like when it is done. The prompt behind each
          photograph was built from this recipe's own ingredient list, so it is
          a reference to cook against rather than decoration.

          Bled to the screen edges and pulled flush under the header: inset,
          with a gutter all round, it read as an image pasted onto the page
          instead of the top of it.
        */}
        <DishPhoto
          title={recipe.title}
          bleed={theme.spacing.lg}
          style={{ marginTop: -theme.spacing.md }}
        />

        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">{recipe.title}</Text>
          <Text variant="caption" tone="secondary">
            {recipe.summary}
          </Text>
          {/* Quiet, and only when it is true. A dish you have cooked before is
              a different proposition from one you have not — you already know
              whether it was worth it. */}
          {cookCount > 0 ? (
            <Text variant="captionStrong" tone="celeste">
              You have cooked this {cookCount === 1 ? 'once' : `${cookCount} times`}
            </Text>
          ) : null}
        </View>

        {siblings.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {siblings.map((variant) => (
              <Chip
                key={variant.id}
                label={variant.variantLabel}
                selected={variant.id === recipe.id}
                onPress={() => switchVariant(variant.id)}
                accessibilityLabel={`${variant.variantLabel} version, ${Math.round(variant.energyKcal)} calories a serving`}
              />
            ))}
          </View>
        ) : null}

        {/* What it costs you, at the portion you actually intend to eat. */}
        <Ticket
          rule={theme.palette.celesteInk}
          label={portions === 1 ? 'One serving' : `${portions} servings`}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
            <Text variant="numeric">{Math.round(nutrition?.energyKcal ?? 0)}</Text>
            <Text variant="eyebrow" tone="muted">
              kcal
            </Text>
            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="muted" tabular>
              {Math.round(nutrition?.proteinG ?? 0)} P · {Math.round(nutrition?.carbsG ?? 0)} C ·{' '}
              {Math.round(nutrition?.fatG ?? 0)} F
            </Text>
          </View>

          <MacroBar nutrients={nutrition ?? {}} withLegend />

          <Divider />
          <Text variant="caption" tone="muted">
            Worked out from this recipe's own ingredients — not estimated.
          </Text>
        </Ticket>

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Fact label="Total" value={`${recipe.totalMinutes} min`} />
          <Fact label="Hands on" value={`${activeMinutes} min`} />
          <Fact label="Makes" value={`${scaled?.servings ?? recipe.servings}`} />
        </View>

        {/* Cooking for a different number of people is arithmetic, not a second
            recipe — so it is a control here rather than another library entry. */}
        <Ticket label="Cook for" meta="quantities below adjust">
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {[1, 2, 4, 6, 8].map((count) => (
              <Pressable
                key={count}
                onPress={() => setCookFor(count)}
                accessibilityRole="button"
                accessibilityState={{ selected: (scaled?.servings ?? recipe.servings) === count }}
                accessibilityLabel={`Cook for ${count}`}
                style={{
                  flex: 1,
                  minHeight: MIN_TAP_TARGET,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radii.md,
                  backgroundColor:
                    (scaled?.servings ?? recipe.servings) === count
                      ? theme.palette.celesteSoft
                      : theme.palette.surfaceSunken,
                }}
              >
                <Text variant="caption" tabular>
                  {count}
                </Text>
              </Pressable>
            ))}
          </View>
          {scaled?.warnings.map((warning) => (
            <Text key={warning} variant="caption" tone="secondary">
              {warning}
            </Text>
          ))}
        </Ticket>

        <Eyebrow>Ingredients</Eyebrow>
        {locked ? (
          <Locked
            title="Cook this recipe"
            teaser={`${recipe.ingredients.length} ingredients · ${recipe.steps.length} steps`}
            blurb="Premium opens all 496 recipes, with the quantities, the method and one combined shopping list for everything you plan to cook."
          />
        ) : (
        <Ticket>
          {(scaled?.ingredients ?? recipe.ingredients).map((ingredient, index) => (
            <View key={`${ingredient.name}-${index}`} style={{ gap: 2 }}>
              {index > 0 ? <Divider /> : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  gap: theme.spacing.md,
                  paddingTop: index > 0 ? theme.spacing.sm : 0,
                }}
              >
                <Text style={{ flex: 1 }}>
                  {ingredient.name}
                  {ingredient.optional ? ' (optional)' : ''}
                </Text>
                <Text variant="caption" tone="secondary" tabular>
                  {'scaledGrams' in ingredient && scaled?.servings !== recipe.servings
                    ? `${ingredient.scaledGrams} g`
                    : ingredient.displayQuantity}
                </Text>
              </View>
              {ingredient.preparation ? (
                <Text variant="caption" tone="muted">
                  {ingredient.preparation}
                </Text>
              ) : null}
            </View>
          ))}
        </Ticket>
        )}
        {!locked ? (
        <Text variant="caption" tone="muted">
          {scaled && scaled.servings !== recipe.servings
            ? `Scaled from the original ${recipe.servings} servings. A portion is the same either way.`
            : `Quantities are for ${recipe.servings} servings, as written.`}
        </Text>
        ) : null}

        {/* Sits with the ingredients rather than with the logging bar, because
            it is about the same question those quantities answer — what do I
            need to buy — and not about what has been eaten. */}
        {!locked ? (
        <Button
          label={
            onList
              ? 'On the shopping list'
              : `Add ${scaled?.servings ?? recipe.servings} portions to shopping`
          }
          variant={onList ? 'quiet' : 'secondary'}
          onPress={handleToggleList}
          accessibilityHint={
            onList
              ? 'Removes this recipe from the shopping list'
              : 'Adds these ingredients to one combined shopping list'
          }
          block
        />
        ) : null}

        {!locked ? <Eyebrow>Method</Eyebrow> : null}
        {(locked ? [] : recipe.steps).map((step) => (
          <Ticket
            key={step.order}
            rule={step.isPassive ? theme.palette.butter : theme.palette.ink}
            label={`Step ${step.order}`}
            meta={
              step.durationMinutes
                ? `${step.durationMinutes} min${step.isPassive ? ' · hands off' : ''}`
                : undefined
            }
          >
            <Text>{step.instruction}</Text>
          </Ticket>
        ))}

        {recipe.storageNotes && !locked ? (
          <>
            <Eyebrow>Keeping it</Eyebrow>
            <Ticket rule={theme.palette.celeste}>
              <Text variant="caption" tone="secondary">
                {recipe.storageNotes}
              </Text>
              <Divider />
              <Text variant="caption" tone="muted" tabular>
                {recipe.fridgeDays} days in the fridge
                {recipe.freezerMonths > 0
                  ? ` · ${recipe.freezerMonths} month${recipe.freezerMonths === 1 ? '' : 's'} in the freezer`
                  : ' · not for freezing'}
              </Text>
            </Ticket>
          </>
        ) : null}

        {recipe.allergens.length > 0 ? (
          <Text variant="caption" tone="muted">
            Contains {recipe.allergens.join(', ').replace(/_/g, ' ')}.
          </Text>
        ) : null}
      </ScrollView>

      {/* Logging bar, pinned like the one on Today. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: insets.bottom + theme.spacing.md,
          gap: theme.spacing.sm,
          backgroundColor: theme.palette.surface,
          borderTopWidth: 1,
          borderTopColor: theme.palette.hairline,
        }}
      >
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {PORTIONS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setPortions(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: portions === option }}
              accessibilityLabel={`${option} servings`}
              style={{
                flex: 1,
                minHeight: MIN_TAP_TARGET,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radii.md,
                backgroundColor:
                  portions === option ? theme.palette.celesteSoft : theme.palette.surfaceSunken,
              }}
            >
              <Text variant="caption" tabular>
                {option === 0.5 ? '½' : option}
              </Text>
            </Pressable>
          ))}
        </View>

        <MealSlotPicker value={slot} onChange={setSlot} />
        <Button label={`Log ${Math.round(nutrition?.energyKcal ?? 0)} kcal`} onPress={handleLog} block />
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Ticket style={{ flex: 1 }} padded>
      <View style={{ gap: 2 }}>
        <Text variant="eyebrow" tone="muted">
          {label}
        </Text>
        <Text variant="numericSmall">{value}</Text>
      </View>
    </Ticket>
  );
}
