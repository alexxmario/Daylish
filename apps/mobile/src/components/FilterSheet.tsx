import { useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Allergen, MealSlot } from '@daylish/core';

import { Button, Chip } from './Button.tsx';
import { Text } from './Text.tsx';
import { Divider, Eyebrow } from './Ticket.tsx';
import type { LibraryFacets, RecipeSort } from '@/data/recipes.ts';
import {
  ALLERGEN_LABEL,
  CUISINE_LABEL,
  DIET_LABEL,
  DIFFICULTY_LABEL,
  SLOT_LABEL,
  SORT_LABEL,
  activeFilterCount,
  cycle,
  describeFilters,
  toggle,
  type MealFilterState,
} from '@/lib/meal-filters.ts';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SORTS: RecipeSort[] = ['name', 'quickest', 'lightest', 'most_protein', 'batch'];

/** Time ceilings, in minutes. Chosen against the library: a median recipe is 62. */
const TIMES = [15, 30, 45, 60];
/** Per-serving calorie ceilings. The library's quartiles are 461 / 595 / 773. */
const CALORIES = [400, 500, 600, 800];
const PROTEIN = [20, 30, 40];
const CARBS = [20, 40, 60];

/**
 * The filter sheet.
 *
 * A sheet rather than more chips on the screen. The browse row can hold four or
 * five filters before it becomes a horizontal scroll nobody reaches the end of,
 * and this screen now offers about forty — so the ones you are *using* stay on
 * the screen as removable chips, and the full set lives one tap away.
 *
 * Every facet is drawn from {@link LibraryFacets}, so nothing is offered that
 * the library cannot answer. A filter that always returns nothing is worse than
 * a missing filter: it reads as a broken app rather than a small library.
 *
 * The footer counts results live, which is the whole reason this is a sheet with
 * a "Show 23 dishes" button rather than a form with an Apply button. You should
 * find out that "vegan, under 15 minutes, no oven" is empty *while* you are
 * choosing it, not after dismissing the sheet.
 */
export function FilterSheet({
  visible,
  state,
  onChange,
  onClose,
  onReset,
  facets,
  resultCount,
  profileAllergens,
  dislikedIngredients,
  hasKitchen,
}: {
  visible: boolean;
  state: MealFilterState;
  onChange: (next: MealFilterState) => void;
  onClose: () => void;
  onReset: () => void;
  facets: LibraryFacets;
  resultCount: number;
  /** Already applied from the profile — listed, not offered. */
  profileAllergens: readonly Allergen[];
  dislikedIngredients: readonly string[];
  /** Whether the profile lists any equipment for "fits my kitchen" to mean anything. */
  hasKitchen: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [ingredient, setIngredient] = useState('');

  const set = (patch: Partial<MealFilterState>) => onChange({ ...state, ...patch });
  const count = activeFilterCount(state);

  // Allergens the profile already excludes are not shown as options — they are
  // not a choice, and a chip you cannot turn off invites you to try.
  const offerableAllergens = facets.allergens.filter((a) => !profileAllergens.includes(a));

  const addIngredient = (term: string) => {
    const clean = term.trim().toLowerCase();
    if (clean.length === 0 || state.excludeIngredients.includes(clean)) return;
    set({ excludeIngredients: [...state.excludeIngredients, clean] });
    setIngredient('');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            // A page sheet leaves the status bar alone, so it needs no top inset
            // of its own; Android renders this full screen and does.
            paddingTop: (Platform.OS === 'android' ? insets.top : 0) + theme.spacing.lg,
            paddingBottom: theme.spacing.md,
          }}
        >
          <Text variant="title" style={{ flex: 1 }}>
            Filters
          </Text>
          {count > 0 ? (
            <Pressable
              onPress={onReset}
              accessibilityRole="button"
              accessibilityLabel={`Clear all ${count} filters`}
              hitSlop={12}
            >
              <Text variant="captionStrong" tone="celeste">
                Clear all
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
            hitSlop={12}
          >
            <Text variant="captionStrong" tone="secondary">
              Done
            </Text>
          </Pressable>
        </View>

        <Divider />

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.xxl,
            gap: theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* First, because it is the shortest route to a dish you already know
              you want — and because a library this size is only navigable at
              all if the good ones can be kept. */}
          <Section title="Yours">
            <Wrap>
              <Chip
                label="Saved"
                selected={state.savedOnly}
                onPress={() => set({ savedOnly: !state.savedOnly })}
              />
              <Chip
                label="Cooked before"
                selected={state.cookedOnly}
                onPress={() => set({ cookedOnly: !state.cookedOnly })}
              />
            </Wrap>
          </Section>

          <Section title="Sort by">
            <Wrap>
              {SORTS.map((sort) => (
                <Chip
                  key={sort}
                  label={SORT_LABEL[sort]}
                  selected={state.sort === sort}
                  onPress={() => set({ sort })}
                />
              ))}
            </Wrap>
          </Section>

          <Section title="Meal">
            <Wrap>
              {SLOTS.map((slot) => (
                <Chip
                  key={slot}
                  label={SLOT_LABEL[slot]}
                  selected={state.slots.includes(slot)}
                  onPress={() => set({ slots: toggle(state.slots, slot) })}
                />
              ))}
            </Wrap>
          </Section>

          <Section title="Time" hint="Prep and cooking together.">
            <Wrap>
              {TIMES.map((minutes) => (
                <Chip
                  key={minutes}
                  label={`Under ${minutes} min`}
                  selected={state.maxMinutes === minutes}
                  onPress={() => set({ maxMinutes: cycle(state.maxMinutes, minutes) })}
                />
              ))}
            </Wrap>
          </Section>

          <Section title="Diet" hint="Everything you pick has to be true at once.">
            <Wrap>
              {facets.dietStyles.map((diet) => (
                <Chip
                  key={diet}
                  label={DIET_LABEL[diet]}
                  selected={state.dietStyles.includes(diet)}
                  onPress={() => set({ dietStyles: toggle(state.dietStyles, diet) })}
                />
              ))}
            </Wrap>
          </Section>

          <Section title="Nutrition" hint="Per serving, as the recipe is written.">
            <Label>Calories</Label>
            <Wrap>
              {CALORIES.map((kcal) => (
                <Chip
                  key={kcal}
                  label={`Under ${kcal}`}
                  selected={state.maxCalories === kcal}
                  onPress={() => set({ maxCalories: cycle(state.maxCalories, kcal) })}
                />
              ))}
            </Wrap>

            <Label>Protein</Label>
            <Wrap>
              {PROTEIN.map((grams) => (
                <Chip
                  key={grams}
                  label={`${grams} g or more`}
                  selected={state.minProteinG === grams}
                  onPress={() => set({ minProteinG: cycle(state.minProteinG, grams) })}
                />
              ))}
            </Wrap>

            <Label>Carbs</Label>
            <Wrap>
              {CARBS.map((grams) => (
                <Chip
                  key={grams}
                  label={`Under ${grams} g`}
                  selected={state.maxCarbsG === grams}
                  onPress={() => set({ maxCarbsG: cycle(state.maxCarbsG, grams) })}
                />
              ))}
            </Wrap>
          </Section>

          <Section title="Cuisine">
            <Wrap>
              {facets.cuisines.map((cuisine) => (
                <Chip
                  key={cuisine}
                  label={CUISINE_LABEL[cuisine]}
                  selected={state.cuisines.includes(cuisine)}
                  onPress={() => set({ cuisines: toggle(state.cuisines, cuisine) })}
                />
              ))}
            </Wrap>
          </Section>

          <Section title="Effort">
            <Wrap>
              {facets.difficulties.map((difficulty) => (
                <Chip
                  key={difficulty}
                  label={DIFFICULTY_LABEL[difficulty]}
                  selected={state.difficulties.includes(difficulty)}
                  onPress={() => set({ difficulties: toggle(state.difficulties, difficulty) })}
                />
              ))}
            </Wrap>
          </Section>

          <Section title="Cook once, eat twice">
            <Wrap>
              <Chip
                label="Batch friendly"
                selected={state.batchFriendly}
                onPress={() => set({ batchFriendly: !state.batchFriendly })}
              />
              <Chip
                label="Freezes well"
                selected={state.freezerFriendly}
                onPress={() => set({ freezerFriendly: !state.freezerFriendly })}
              />
            </Wrap>
          </Section>

          <Section
            title="Kitchen"
            hint={
              hasKitchen
                ? 'Only recipes you have the equipment for.'
                : 'Add your equipment in You to filter by what you own.'
            }
          >
            <Wrap>
              {hasKitchen ? (
                <Chip
                  label="Fits my kitchen"
                  selected={state.fitsMyKitchen}
                  onPress={() => set({ fitsMyKitchen: !state.fitsMyKitchen })}
                />
              ) : null}
              <Chip
                label="No oven needed"
                selected={state.noOven}
                onPress={() => set({ noOven: !state.noOven })}
              />
            </Wrap>
          </Section>

          <Section
            title="Avoid"
            hint={
              profileAllergens.length > 0
                ? `${profileAllergens.map((a) => ALLERGEN_LABEL[a]).join(', ')} ${profileAllergens.length === 1 ? 'is' : 'are'} always excluded, from your profile.`
                : undefined
            }
          >
            {offerableAllergens.length > 0 ? (
              <>
                <Label>Allergens</Label>
                <Wrap>
                  {offerableAllergens.map((allergen) => (
                    <Chip
                      key={allergen}
                      label={ALLERGEN_LABEL[allergen]}
                      selected={state.extraAllergens.includes(allergen)}
                      onPress={() => set({ extraAllergens: toggle(state.extraAllergens, allergen) })}
                      accessibilityLabel={`Avoid ${ALLERGEN_LABEL[allergen]}`}
                    />
                  ))}
                </Wrap>
              </>
            ) : null}

            <Label>Ingredients</Label>
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
                value={ingredient}
                onChangeText={setIngredient}
                onSubmitEditing={() => addIngredient(ingredient)}
                placeholder="e.g. mushroom"
                accessibilityLabel="Ingredient to avoid"
                placeholderTextColor={theme.palette.inkMuted}
                autoCapitalize="none"
                returnKeyType="done"
                style={{
                  flex: 1,
                  fontFamily: theme.fonts.body,
                  fontSize: theme.typography.body.fontSize,
                  color: theme.palette.ink,
                  paddingVertical: theme.spacing.sm,
                }}
              />
              {ingredient.trim().length > 0 ? (
                <Pressable
                  onPress={() => addIngredient(ingredient)}
                  accessibilityRole="button"
                  accessibilityLabel={`Avoid ${ingredient.trim()}`}
                  hitSlop={12}
                >
                  <Text variant="captionStrong" tone="celeste">
                    Add
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {state.excludeIngredients.length > 0 ? (
              <Wrap>
                {state.excludeIngredients.map((term) => (
                  <RemovableChip
                    key={term}
                    label={`No ${term}`}
                    onRemove={() =>
                      set({ excludeIngredients: state.excludeIngredients.filter((i) => i !== term) })
                    }
                  />
                ))}
              </Wrap>
            ) : null}

            {/* The profile already knows what they do not like. Retyping it here
                is the kind of small tax that makes a filter go unused. */}
            {dislikedIngredients.length > 0 &&
            !dislikedIngredients.every((d) => state.excludeIngredients.includes(d.toLowerCase())) ? (
              <Pressable
                onPress={() =>
                  set({
                    excludeIngredients: [
                      ...new Set([
                        ...state.excludeIngredients,
                        ...dislikedIngredients.map((d) => d.trim().toLowerCase()),
                      ]),
                    ],
                  })
                }
                accessibilityRole="button"
                style={{ minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
              >
                <Text variant="captionStrong" tone="celeste">
                  Add the {dislikedIngredients.length} thing
                  {dislikedIngredients.length === 1 ? '' : 's'} I said I dislike
                </Text>
              </Pressable>
            ) : null}
          </Section>
        </ScrollView>

        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: Math.max(insets.bottom, theme.spacing.lg),
            borderTopWidth: 1,
            borderTopColor: theme.palette.hairline,
            backgroundColor: theme.palette.surface,
          }}
        >
          {resultCount === 0 ? (
            <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              Nothing matches all of that. Lift a filter to see dishes again.
            </Text>
          ) : null}
          <Button
            label={
              resultCount === 0
                ? 'Back to the list'
                : `Show ${resultCount} dish${resultCount === 1 ? '' : 'es'}`
            }
            onPress={onClose}
            variant={resultCount === 0 ? 'secondary' : 'primary'}
            block
            style={{ marginTop: resultCount === 0 ? theme.spacing.sm : 0 }}
          />
        </View>
      </View>
    </Modal>
  );
}

/**
 * The filters currently applied, on the browse screen.
 *
 * Each one lifts on tap. A filtered list that does not say what it is filtered
 * by is the commonest way to be confused by search results — you forget about a
 * filter, then conclude the library is empty.
 *
 * `omit` drops the ones the quick row is already showing as selected chips.
 * Drawing "Dinner" twice in celeste, eight points apart, reads as a rendering
 * fault rather than as two different controls.
 */
export function AppliedFilters({
  state,
  onChange,
  onClear,
  omit = [],
}: {
  state: MealFilterState;
  onChange: (next: MealFilterState) => void;
  onClear: () => void;
  omit?: readonly string[];
}) {
  const theme = useTheme();
  const chips = describeFilters(state).filter((chip) => !omit.includes(chip.id));
  if (chips.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: theme.spacing.sm,
        paddingRight: theme.spacing.lg,
        alignItems: 'center',
      }}
    >
      {chips.map((chip) => (
        <RemovableChip key={chip.id} label={chip.label} onRemove={() => onChange(chip.remove)} />
      ))}
      {chips.length > 1 ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          style={{ minHeight: MIN_TAP_TARGET, justifyContent: 'center', paddingHorizontal: 4 }}
        >
          <Text variant="captionStrong" tone="celeste">
            Clear all
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

/**
 * An applied filter. Reads as a chip that is on, with the way out attached.
 *
 * The whole chip is the target rather than just the cross — a 13pt glyph is not
 * a tap target, and there is nothing else the chip could plausibly do.
 */
function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onRemove}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to remove this filter`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: MIN_TAP_TARGET,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radii.sm,
        backgroundColor: theme.palette.celesteSoft,
        borderWidth: 1,
        borderColor: theme.palette.celesteInk,
      }}
    >
      <Text variant="captionStrong" tone="celeste">
        {label}
      </Text>
      <Text variant="captionStrong" tone="celeste">
        ✕
      </Text>
    </Pressable>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Eyebrow>{title}</Eyebrow>
      {hint ? (
        <Text variant="caption" tone="muted" style={{ marginTop: -theme.spacing.xs }}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** A sub-heading inside a section, for facets that need more than one row. */
function Label({ children }: { children: ReactNode }) {
  return (
    <Text variant="captionStrong" tone="secondary">
      {children}
    </Text>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>{children}</View>
  );
}
