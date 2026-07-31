import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nutrientsForGrams } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { ConfidenceBadge } from '@/components/ConfidenceBadge.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import { deleteEntryItem, getEntryItem, updateEntryItemGrams } from '@/data/journal.ts';
import { formatTime } from '@/lib/dates.ts';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/** Nudges either side of the logged amount — corrections are usually small. */
const STEPS = [-50, -25, 25, 50];

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/**
 * Correct a logged portion.
 *
 * The most common thing anyone does to a food diary after logging, and until now
 * the app had no path to it at all — the only recourse was deleting the entry
 * and starting again, which threw away the original time and any other food in
 * the same meal.
 *
 * The screen leads with steppers rather than a keyboard because corrections are
 * nearly always small and relative ("a bit more than I said"). The exact field
 * is there for the person who weighed it.
 */
export default function EditItemScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Read once: the row is the starting point, and every later number on this
  // screen is derived from `grams` so the preview cannot drift from what saves.
  const item = useMemo(() => (id ? getEntryItem(id) : null), [id]);
  const [grams, setGrams] = useState(() => (item ? String(Math.round(item.grams)) : ''));

  const parsed = Number.parseFloat(grams);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const changed = valid && item !== null && Math.round(parsed) !== Math.round(item.grams);

  const preview = useMemo(
    () => (item && valid ? nutrientsForGrams(item.per100g, parsed) : null),
    [item, valid, parsed],
  );

  const nudge = useCallback(
    (delta: number) => {
      const base = Number.isFinite(parsed) ? parsed : 0;
      setGrams(String(Math.max(1, Math.round(base + delta))));
    },
    [parsed],
  );

  const handleSave = useCallback(() => {
    if (!item || !valid) return;
    updateEntryItemGrams(item.id, parsed);
    router.back();
  }, [item, valid, parsed, router]);

  const handleRemove = useCallback(() => {
    if (!item) return;
    Alert.alert(
      `Remove ${item.displayName}?`,
      item.isOnlyItem
        ? 'This is the only food in the meal, so the whole meal goes with it.'
        : 'The rest of the meal stays where it is.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            deleteEntryItem(item.id);
            router.back();
          },
        },
      ],
    );
  }, [item, router]);

  if (!item) {
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
        <Text variant="heading">That food is no longer here</Text>
        <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          It was removed while this screen was open.
        </Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

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
        <Text variant="title">Edit portion</Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={12}
        >
          <Text tone="secondary">Cancel</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Ticket
          rule={theme.palette.celesteInk}
          label={SLOT_LABELS[item.mealSlot] ?? item.mealSlot}
          meta={formatTime(item.loggedAt)}
        >
          <Text variant="bodyStrong">{item.displayName}</Text>
          <ConfidenceBadge source={item.source} confidence={item.confidence} />
        </Ticket>

        <Eyebrow>How much</Eyebrow>
        <Ticket>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <TextInput
              value={grams}
              onChangeText={(next) => setGrams(next.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel="Portion in grams"
              placeholderTextColor={theme.palette.inkMuted}
              style={{
                flex: 1,
                minHeight: MIN_TAP_TARGET,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radii.md,
                backgroundColor: theme.palette.surfaceSunken,
                color: theme.palette.ink,
                fontFamily: theme.fonts.numeric,
                fontSize: theme.typography.numeric.fontSize,
              }}
            />
            <Text variant="eyebrow" tone="muted">
              grams
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {STEPS.map((step) => (
              <Pressable
                key={step}
                onPress={() => nudge(step)}
                accessibilityRole="button"
                accessibilityLabel={`${step > 0 ? 'Add' : 'Remove'} ${Math.abs(step)} grams`}
                style={{
                  flex: 1,
                  minHeight: MIN_TAP_TARGET,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radii.md,
                  backgroundColor: theme.palette.surfaceSunken,
                }}
              >
                <Text variant="caption" tabular>
                  {step > 0 ? `+${step}` : step}
                </Text>
              </Pressable>
            ))}
          </View>

          <Divider />

          {/* What it was, against what it would become. The comparison is the
              point of the screen — a bare new number tells you nothing. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="eyebrow" tone="muted">
                Logged
              </Text>
              <Text variant="numericSmall" tone="muted">
                {Math.round(item.grams)} g
              </Text>
              <Text variant="caption" tone="muted" tabular>
                {Math.round(nutrientsForGrams(item.per100g, item.grams).energyKcal ?? 0)} kcal
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="eyebrow" tone={changed ? 'celeste' : 'muted'}>
                {changed ? 'After' : 'Unchanged'}
              </Text>
              <Text variant="numericSmall">{valid ? `${Math.round(parsed)} g` : '—'}</Text>
              <Text variant="caption" tone="secondary" tabular>
                {preview
                  ? `${Math.round(preview.energyKcal ?? 0)} kcal · ${Math.round(preview.proteinG ?? 0)} g protein`
                  : 'Enter a portion'}
              </Text>
            </View>
          </View>
        </Ticket>

        <Button label="Save portion" onPress={handleSave} disabled={!changed} block />
        <Button label="Remove this food" variant="quiet" onPress={handleRemove} block />
      </ScrollView>
    </View>
  );
}
