import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MealSlot, NutrientVector } from '@daylish/core';
import { checkEnergyConsistency, energyFromMacros } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { Ticket } from '@/components/Ticket.tsx';
import { Text } from '@/components/Text.tsx';
import { createCustomFood } from '@/data/foods.ts';
import { logMeal } from '@/data/journal.ts';
import { MealSlotPicker } from './scan.tsx';
import { suggestMealSlot } from '@/lib/meal-slot.ts';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/**
 * Quick add.
 *
 * The escape hatch: when a food is not in any database and the user just knows
 * the numbers off a label. Also where a failed barcode scan lands, carrying the
 * barcode through so the entry can be matched up later.
 *
 * The energy cross-check is the interesting part — if the typed calories
 * disagree with the typed macros, we say so and offer the computed figure. It is
 * a suggestion, never a correction: people mistype, but labels are also
 * genuinely inconsistent, and the user is the authority on what they are holding.
 */
export default function QuickAddScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const params = useLocalSearchParams<{ barcode?: string }>();

  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [grams, setGrams] = useState('100');
  const [slot, setSlot] = useState<MealSlot>(suggestMealSlot());
  const [keep, setKeep] = useState(true);

  const num = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const servingGrams = num(grams) > 0 ? num(grams) : 100;

  /** What the user typed, interpreted as the amount they are logging. */
  const typed: NutrientVector = {
    energyKcal: num(kcal),
    proteinG: num(protein),
    carbsG: num(carbs),
    fatG: num(fat),
  };

  const impliedKcal = Math.round(energyFromMacros(typed));
  const consistency = checkEnergyConsistency(typed);
  const showMismatch = num(kcal) > 0 && !consistency.consistent;

  const valid = name.trim().length > 0 && (num(kcal) > 0 || impliedKcal > 0);

  const handleAdd = () => {
    if (!profile || !valid) return;

    const energyKcal = num(kcal) > 0 ? num(kcal) : impliedKcal;
    const forServing: NutrientVector = { ...typed, energyKcal };

    // `logMeal` scales from a per-100 g basis, so convert what the user typed
    // for this serving back to that basis first.
    const per100g: NutrientVector = {};
    for (const [key, value] of Object.entries(forServing)) {
      if (typeof value === 'number') {
        per100g[key as keyof NutrientVector] = (value * 100) / servingGrams;
      }
    }

    // Keeping the food is what turns a one-off into something searchable, so a
    // homemade lunch is typed once rather than every time it is eaten. The
    // barcode rides along when this screen was reached from a failed scan, so
    // the next scan of that packet resolves instantly.
    const foodItemId = keep
      ? createCustomFood({
          name: name.trim(),
          per100g,
          barcode: params.barcode ?? null,
        })
      : null;

    logMeal({
      userId: profile.id,
      mealSlot: slot,
      logMethod: 'quick_add',
      note: params.barcode ? `Barcode ${params.barcode}` : null,
      items: [
        {
          foodItemId,
          displayName: name.trim(),
          grams: servingGrams,
          per100g,
          source: 'user',
          // The user typed it, so we neither vouch for it nor doubt it.
          confidence: 1,
        },
      ],
    });
    router.dismissAll();
  };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: theme.spacing.lg,
        paddingTop: insets.top + theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">Add it by hand</Text>
        {params.barcode ? (
          <Text variant="caption" tone="secondary">
            We will remember this against barcode {params.barcode}.
          </Text>
        ) : (
          <Text variant="caption" tone="secondary">
            Straight off the label. Leave anything you do not know blank.
          </Text>
        )}
      </View>

      <Field label="What is it?" value={name} onChange={setName} placeholder="e.g. Bakery sourdough" />

      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Field label="Amount" value={grams} onChange={setGrams} suffix="g" numeric />
        <Field label="Calories" value={kcal} onChange={setKcal} suffix="kcal" numeric />
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Field label="Protein" value={protein} onChange={setProtein} suffix="g" numeric />
        <Field label="Carbs" value={carbs} onChange={setCarbs} suffix="g" numeric />
        <Field label="Fat" value={fat} onChange={setFat} suffix="g" numeric />
      </View>

      {showMismatch ? (
        <Ticket sunken rule={false}>
          <View style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
            <Text variant="captionStrong">Those numbers do not quite line up</Text>
            <Text variant="caption" tone="secondary">
              The macros you entered work out to about {impliedKcal} kcal, not {num(kcal)}. Labels
              are often rounded, so this may be fine — but it is worth a second look.
            </Text>
            <Button
              label={`Use ${impliedKcal} kcal`}
              variant="secondary"
              onPress={() => setKcal(String(impliedKcal))}
            />
          </View>
        </Ticket>
      ) : null}

      {num(kcal) === 0 && impliedKcal > 0 ? (
        <Text variant="caption" tone="muted">
          We will record {impliedKcal} kcal, worked out from the macros above.
        </Text>
      ) : null}

      {/* Default on. Someone typing a full label is almost certainly going to
          eat the thing again, and the cost of a stray saved food is one search
          result — far less than re-typing a label. */}
      <Pressable
        onPress={() => setKeep((on) => !on)}
        accessibilityRole="switch"
        accessibilityState={{ checked: keep }}
        accessibilityLabel="Save this food for next time"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: MIN_TAP_TARGET,
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: theme.radii.sm,
            borderWidth: 1.5,
            borderColor: keep ? theme.palette.celesteInk : theme.palette.hairline,
            backgroundColor: keep ? theme.palette.celesteInk : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {keep ? (
            <Text variant="captionStrong" tone="onDark">
              ✓
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="body">Save this food for next time</Text>
          <Text variant="caption" tone="muted">
            It will show up in search, so you only type it once.
          </Text>
        </View>
      </Pressable>

      <MealSlotPicker value={slot} onChange={setSlot} />

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Button label="Cancel" variant="quiet" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button label="Add to journal" onPress={handleAdd} disabled={!valid} style={{ flex: 2 }} />
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  placeholder?: string;
  numeric?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, gap: theme.spacing.xs }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          minHeight: MIN_TAP_TARGET,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radii.md,
          backgroundColor: theme.palette.surfaceSunken,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          keyboardType={numeric ? 'decimal-pad' : 'default'}
          accessibilityLabel={label}
          placeholderTextColor={theme.palette.inkMuted}
          style={{
            flex: 1,
            fontSize: theme.typography.body.fontSize,
            color: theme.palette.ink,
          }}
        />
        {suffix ? (
          <Text variant="caption" tone="muted">
            {suffix}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
