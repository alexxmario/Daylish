import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MealSlot } from '@daylish/core';

import { Chip } from '@/components/Button.tsx';
import { AppliedFilters, FilterSheet } from '@/components/FilterSheet.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { MacroBar } from '@/components/MacroBar.tsx';
import { Text } from '@/components/Text.tsx';
import { DishPhoto } from '@/components/DishPhoto.tsx';
import { Eyebrow, Ticket } from '@/components/Ticket.tsx';
import { isFreeRecipe, libraryFacets, listDishes, type Dish } from '@/data/recipes.ts';
import { listSavedRecipeIds, recipeCookCounts } from '@/data/recipe-interactions.ts';
import { getShoppingList } from '@/data/shopping-list.ts';
import {
  ALLERGEN_LABEL,
  DIET_LABEL,
  EMPTY_FILTERS,
  SORT_LABEL,
  activeFilterCount,
  toRecipeFilters,
  toggle,
  type MealFilterState,
} from '@/lib/meal-filters.ts';
import { suggestMealSlot } from '@/lib/meal-slot.ts';
import { useEntitlements } from '@/state/entitlement.tsx';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

const SLOTS: { value: MealSlot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

/**
 * Meals — the recipe library.
 *
 * Opens filtered to the slot you are plausibly cooking for, because "what shall
 * I make for dinner" is the question people arrive with; browsing everything is
 * what you do when that fails, not before it.
 *
 * The screen is built in three layers, because the questions people arrive with
 * are not equally common. The slot chips and the two or three toggles beside
 * them answer most of them without opening anything. The sheet behind "Filters"
 * holds the long tail — cuisine, macros, kit, ingredients to avoid — which is
 * worth having but not worth spending the top of the screen on. And whatever is
 * applied comes back as removable chips under the search box, so a narrowed list
 * always says why it is narrow.
 *
 * Allergens are applied silently from the profile rather than offered as a
 * filter. Someone who has told the app they cannot eat peanuts should not have
 * to remember to re-tell it here, and a recipe they cannot eat is not a result
 * worth showing with a warning attached. The sheet can add *more* allergens —
 * cooking for a guest is a real thing — but never subtract the profile's.
 */
export default function MealsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, goal } = useSession();
  const { entitlements } = useEntitlements();

  const [state, setState] = useState<MealFilterState>(() => ({
    ...EMPTY_FILTERS,
    slots: [suggestMealSlot()],
  }));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [version, setVersion] = useState(0);

  // The library only changes when the bundle does, but re-reading on focus keeps
  // this consistent with every other screen and costs nothing at this size.
  useFocusEffect(useCallback(() => setVersion((v) => v + 1), []));

  // Re-read on focus as well as on profile change: saving happens on the recipe
  // screen, and coming back to a Meals list still showing the old set would be
  // the app disagreeing with itself.
  const context = useMemo(
    () => ({
      equipment: profile?.equipment ?? [],
      allergens: profile?.allergens ?? [],
      savedIds: profile ? listSavedRecipeIds(profile.id) : [],
      cookedIds: profile ? Object.keys(recipeCookCounts(profile.id)) : [],
    }),
    [profile, version],
  );

  // Grouped into dishes: the browse list is about breadth, and three cards for
  // the same meal reads as a repetitive library rather than a varied one.
  const results = useMemo(
    () => listDishes(toRecipeFilters(state, context)),
    // `version` re-runs this on focus; the state carries everything else.
    [state, context, version],
  );

  const total = useMemo(
    () => listDishes({ avoidAllergens: context.allergens }).length,
    [context, version],
  );

  // Read from the library rather than from the enums, so the sheet only offers
  // filters that can be answered. Cheap, and re-read with the library.
  const facets = useMemo(() => libraryFacets(), [version]);

  const shopping = useMemo(
    () => (profile ? getShoppingList(profile.id) : null),
    [profile, version],
  );

  if (!profile) return null;

  const activeCount = activeFilterCount(state);
  const dietStyle = goal && goal.dietStyle !== 'balanced' ? goal.dietStyle : null;

  // What the quick row is already showing as a selected chip, so the applied
  // row beneath it does not say the same thing a second time.
  const inQuickRow = [
    ...state.slots.map((slot) => `slot:${slot}`),
    ...(state.savedOnly && context.savedIds.length > 0 ? ['saved'] : []),
    ...(state.maxMinutes === 30 ? ['time'] : []),
    ...(state.batchFriendly ? ['batch'] : []),
    ...(dietStyle && state.dietStyles.includes(dietStyle) ? [`diet:${dietStyle}`] : []),
  ];

  return (
    <>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Text variant="display" style={{ flex: 1 }}>
            Meals
          </Text>
          {/* Only once there is something on it. An empty shopping list is not
              a destination, and a permanent zero teaches people to ignore it. */}
          {shopping && shopping.recipes.length > 0 ? (
            <Pressable
              onPress={() => router.push('/shopping-list')}
              accessibilityRole="button"
              accessibilityLabel={`Shopping list, ${shopping.remaining} items to buy`}
              hitSlop={12}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                minHeight: MIN_TAP_TARGET,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radii.sm,
                backgroundColor: theme.palette.surfaceWarm,
              }}
            >
              <Text variant="captionStrong" tone="celeste">
                Shopping
              </Text>
              <Text variant="captionStrong" tone="celeste" tabular>
                {shopping.remaining}
              </Text>
            </Pressable>
          ) : null}
        </View>

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
            value={state.query}
            onChangeText={(query) => setState((s) => ({ ...s, query }))}
            placeholder="Search recipes"
            accessibilityLabel="Search recipes"
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
          {state.query.length > 0 ? (
            <Pressable
              onPress={() => setState((s) => ({ ...s, query: '' }))}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={12}
            >
              <Text variant="caption" tone="muted">
                Clear
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/*
          The quick row. Slots first because the question is nearly always "what
          am I cooking for", then the two toggles that get used without thinking,
          then the diet the person is actually following — offered by name, so it
          reads as a shortcut to their own setting rather than a generic filter.
          Everything else is behind Filters, which carries the count so a narrowed
          list is never a mystery.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.lg }}
        >
          <FilterButton count={activeCount} onPress={() => setSheetOpen(true)} />
          {/* Only offered once there is something to show. A "Saved" filter that
              can only ever return nothing teaches people it is broken. */}
          {context.savedIds.length > 0 ? (
            <Chip
              label="Saved"
              selected={state.savedOnly}
              onPress={() => setState((s) => ({ ...s, savedOnly: !s.savedOnly }))}
            />
          ) : null}
          {SLOTS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={state.slots.includes(option.value)}
              onPress={() => setState((s) => ({ ...s, slots: toggle(s.slots, option.value) }))}
            />
          ))}
          <Chip
            label="Under 30 min"
            selected={state.maxMinutes === 30}
            onPress={() =>
              setState((s) => ({ ...s, maxMinutes: s.maxMinutes === 30 ? null : 30 }))
            }
          />
          <Chip
            label="Batch friendly"
            selected={state.batchFriendly}
            onPress={() => setState((s) => ({ ...s, batchFriendly: !s.batchFriendly }))}
          />
          {dietStyle ? (
            <Chip
              label={DIET_LABEL[dietStyle]}
              selected={state.dietStyles.includes(dietStyle)}
              onPress={() => setState((s) => ({ ...s, dietStyles: toggle(s.dietStyles, dietStyle) }))}
            />
          ) : null}
        </ScrollView>

        <AppliedFilters
          state={state}
          onChange={setState}
          onClear={() => setState((s) => ({ ...EMPTY_FILTERS, query: s.query, sort: s.sort }))}
          omit={inQuickRow}
        />

        <Eyebrow>
          {results.length === total
            ? `${total} dishes`
            : `${results.length} of ${total} dishes`}
          {state.sort === 'name' ? '' : ` · ${SORT_LABEL[state.sort].toLowerCase()}`}
        </Eyebrow>

        {results.length === 0 ? (
          <Ticket rule={theme.palette.hairline}>
            <Illustration name="emptyRecipes" height={112} />
            <Text variant="heading">Nothing matches</Text>
            {/* The way out is different depending on what caused it, and
                "try loosening a filter" is unhelpful to someone who has only
                typed a word. */}
            <Text variant="caption" tone="secondary">
              {activeCount > 0
                ? 'Nothing satisfies all of that at once. Tap a filter above to lift it.'
                : state.query.trim().length > 0
                  ? `Nothing in the library is called “${state.query.trim()}”. Try a shorter word, or an ingredient.`
                  : 'The recipe library is empty on this device.'}
            </Text>
          </Ticket>
        ) : (
          results.map((dish) => (
            <DishCard
              key={dish.dishKey}
              dish={dish}
              // A dish counts as saved when any of its variants is — the card
              // is the dish, and which version was kept is the detail screen's
              // business.
              saved={dish.variants.some((v) => context.savedIds.includes(v.id))}
              // Locked when no variant of it is in the free set, so a dish whose
              // standard version is free never reads as paid.
              locked={
                entitlements.recipeLimit !== null &&
                !dish.variants.some((v) => isFreeRecipe(v.id))
              }
              onPress={() =>
                router.push({ pathname: '/recipe', params: { id: dish.representative.id } })
              }
            />
          ))
        )}

        {profile.allergens.length > 0 ? (
          <Text variant="caption" tone="muted">
            Recipes containing {profile.allergens.map((a) => ALLERGEN_LABEL[a].toLowerCase()).join(', ')}{' '}
            are hidden, because you asked to avoid them.
          </Text>
        ) : null}
      </ScrollView>

      <FilterSheet
        visible={sheetOpen}
        state={state}
        onChange={setState}
        onClose={() => setSheetOpen(false)}
        // Search and sort survive a clear: neither is counted as a filter, and
        // losing the word you just typed is not what "clear all" promises.
        onReset={() => setState({ ...EMPTY_FILTERS, query: state.query, sort: state.sort })}
        facets={facets}
        resultCount={results.length}
        profileAllergens={profile.allergens}
        dislikedIngredients={profile.dislikedIngredients}
        hasKitchen={profile.equipment.length > 0}
      />
    </>
  );
}

/**
 * The way into the rest of the filters.
 *
 * Carries its count, and goes celeste once anything is on. Sitting first in the
 * quick row rather than last is deliberate: it is the only control there whose
 * position should not move as chips are added, and it is where you look when the
 * list is not what you expected.
 */
function FilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  const theme = useTheme();
  const active = count > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        active ? `Filters, ${count} applied` : 'Filters'
      }
      accessibilityHint="Narrow the library by cuisine, nutrition, equipment and more"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: MIN_TAP_TARGET,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radii.sm,
        backgroundColor: active ? theme.palette.celesteSoft : theme.palette.surface,
        borderWidth: 1,
        borderColor: active ? theme.palette.celesteInk : theme.palette.hairline,
      }}
    >
      <Text variant="captionStrong" tone={active ? 'celeste' : 'ink'}>
        Filters
      </Text>
      {active ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.palette.celesteInk,
          }}
        >
          <Text variant="eyebrow" tone="onDark" tabular>
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * One dish in the list.
 *
 * A thumbnail, not a hero. The photograph is the fastest way to tell one dish
 * from another while scrolling, but the reason to use this app over a recipe
 * site is the verified nutrition — so the picture is sized to identify the dish
 * and then get out of the way of the numbers.
 *
 * The calorie figure is the standard version's, with the range across variants
 * shown beneath: someone scanning for something light wants to know a lighter
 * version exists without opening the card.
 */
function DishCard({
  dish,
  saved,
  locked,
  onPress,
}: {
  dish: Dish;
  saved: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const recipe = dish.representative;

  const calories = dish.variants.map((v) => Math.round(v.energyKcal));
  const lowest = Math.min(...calories);
  const highest = Math.max(...calories);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${dish.name}${saved ? ', saved' : ''}${locked ? ', Premium' : ''}, ${dish.variants.length} version${dish.variants.length === 1 ? '' : 's'}, from ${lowest} calories a serving, ${recipe.totalMinutes} minutes`}
    >
      <Ticket
        // A saved dish gets the warm rule rather than a badge. It is the one
        // thing on the card that is about you rather than about the food, and
        // it has to be legible at a glance down a scrolling list.
        rule={saved ? theme.palette.sun : theme.palette.celesteInk}
        label={recipe.cuisine.replace(/_/g, ' ')}
        meta={locked ? 'Premium' : `${recipe.totalMinutes} min`}
      >
        {/*
          The photograph earns its place on a browse card by being the fastest
          way to tell one dish from another — so it sits beside the name rather
          than above it, and stays small enough that a screenful is still a
          list rather than a gallery.
        */}
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <DishPhoto title={recipe.title} variant="thumb" />

          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
              {/* The card stays fully legible when locked — name, photo,
                  calories and macros. Someone deciding whether a subscription
                  is worth it needs to see what they would be getting, and a
                  greyed-out row tells them nothing. */}
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                {saved ? '★ ' : ''}
                {dish.name}
              </Text>
              <Text variant="numericSmall">{Math.round(recipe.energyKcal)}</Text>
              <Text variant="eyebrow" tone="muted">
                kcal
              </Text>
            </View>

            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {recipe.summary}
            </Text>
          </View>
        </View>

        <MacroBar
          nutrients={{ proteinG: recipe.proteinG, carbsG: recipe.carbsG, fatG: recipe.fatG }}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted" tabular>
            {dish.variants.length > 1
              ? `${dish.variants.length} versions · ${lowest}–${highest} kcal`
              : `${Math.round(recipe.proteinG)} g protein · serves ${recipe.servings}`}
          </Text>
          <View style={{ flex: 1 }} />
          {recipe.prepScore >= 60 ? (
            <Text variant="eyebrow" tone="celeste">
              Batch friendly
            </Text>
          ) : null}
        </View>
      </Ticket>
    </Pressable>
  );
}
