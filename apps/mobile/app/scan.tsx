import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MealSlot } from '@daylish/core';
import { nutrientsForGrams } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { Ticket } from '@/components/Ticket.tsx';
import { ConfidenceBadge } from '@/components/ConfidenceBadge.tsx';
import { Text } from '@/components/Text.tsx';
import { resolveBarcode, type ResolvedFood } from '@/data/foods.ts';
import { logMeal } from '@/data/journal.ts';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';
import { suggestMealSlot } from '@/lib/meal-slot.ts';

/** Symbologies actually used on food packaging. Narrowing these speeds up detection. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] as const;

type ScanState =
  | { phase: 'scanning' }
  | { phase: 'looking_up'; barcode: string }
  | { phase: 'found'; food: ResolvedFood; grams: number }
  | { phase: 'missing'; barcode: string; offline: boolean };

/**
 * Barcode scanner.
 *
 * The whole screen is built around one number: time from opening to logged. The
 * camera starts immediately, lookups hit the local cache first, and a successful
 * scan lands on a confirm sheet with a sensible default portion already filled
 * in — one more tap and it is in the journal.
 */
export default function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();

  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>({ phase: 'scanning' });
  const [slot, setSlot] = useState<MealSlot>(suggestMealSlot());

  /**
   * The camera fires this continuously while a barcode is in frame. Without a
   * latch we would launch a network request per frame.
   */
  const busy = useRef(false);

  const handleScan = useCallback(
    async (barcode: string) => {
      if (busy.current) return;
      busy.current = true;
      setState({ phase: 'looking_up', barcode });

      const outcome = await resolveBarcode(barcode);
      if (outcome.status === 'found') {
        const preferred =
          outcome.food.portions.find((p) => p.isDefault) ?? outcome.food.portions[0];
        setState({ phase: 'found', food: outcome.food, grams: preferred?.grams ?? 100 });
      } else {
        setState({
          phase: 'missing',
          barcode,
          offline: outcome.status === 'offline',
        });
      }
    },
    [],
  );

  const resetToScanning = () => {
    busy.current = false;
    setState({ phase: 'scanning' });
  };

  if (!permission) {
    return <Centered><ActivityIndicator color={theme.palette.celesteInk} /></Centered>;
  }

  if (!permission.granted) {
    return (
      <Centered>
        <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
          <Text variant="heading">Camera access</Text>
          <Text variant="caption" tone="secondary">
            Frames are read on your device and discarded.
          </Text>
          <Button label="Allow camera" onPress={requestPermission} />
          <Button label="Not now" variant="quiet" onPress={() => router.back()} />
        </View>
      </Centered>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {state.phase === 'scanning' || state.phase === 'looking_up' ? (
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={({ data }) => void handleScan(data)}
        />
      ) : null}

      {/* Close control, always reachable. */}
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close scanner"
        style={{
          position: 'absolute',
          top: insets.top + theme.spacing.sm,
          right: theme.spacing.lg,
          minWidth: MIN_TAP_TARGET,
          minHeight: MIN_TAP_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radii.pill,
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}
      >
        <Text variant="bodyStrong" tone="onDark">
          ✕
        </Text>
      </Pressable>

      {state.phase === 'looking_up' ? (
        <Sheet>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <ActivityIndicator color={theme.palette.celesteInk} />
            <Text tone="secondary">Looking up {state.barcode}…</Text>
          </View>
        </Sheet>
      ) : null}

      {state.phase === 'found' ? (
        <Sheet>
          <ConfirmPanel
            food={state.food}
            grams={state.grams}
            slot={slot}
            onSlotChange={setSlot}
            onGramsChange={(grams) => setState({ ...state, grams })}
            onCancel={resetToScanning}
            onConfirm={() => {
              if (!profile) return;
              logMeal({
                userId: profile.id,
                mealSlot: slot,
                logMethod: 'barcode',
                items: [
                  {
                    foodItemId: state.food.id,
                    displayName: state.food.brand
                      ? `${state.food.name} (${state.food.brand})`
                      : state.food.name,
                    grams: state.grams,
                    per100g: state.food.per100g,
                    source: state.food.source,
                    confidence: state.food.confidence,
                  },
                ],
              });
              router.back();
            }}
          />
        </Sheet>
      ) : null}

      {state.phase === 'missing' ? (
        <Sheet>
          <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
            <Text variant="heading">
              {state.offline ? 'No connection' : 'We have not seen this one'}
            </Text>
            <Illustration name="scanMiss" height={96} />
            <Text variant="caption" tone="secondary">
              {state.offline
                ? 'Not cached, and we cannot reach the database. Add it by hand.'
                : 'Add it once and it is there for everyone next time.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Button label="Scan again" variant="secondary" onPress={resetToScanning} />
              <Button
                label="Add by hand"
                onPress={() => router.replace({ pathname: '/quick-add', params: { barcode: state.barcode } })}
              />
            </View>
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

function ConfirmPanel({
  food,
  grams,
  slot,
  onGramsChange,
  onSlotChange,
  onCancel,
  onConfirm,
}: {
  food: ResolvedFood;
  grams: number;
  slot: MealSlot;
  onGramsChange: (grams: number) => void;
  onSlotChange: (slot: MealSlot) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const theme = useTheme();
  const scaled = nutrientsForGrams(food.per100g, grams);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View>
        <Text variant="heading">{food.name}</Text>
        {food.brand ? (
          <Text variant="caption" tone="secondary">
            {food.brand}
          </Text>
        ) : null}
      </View>

      <ConfidenceBadge source={food.source} confidence={food.confidence} />

      {food.fromCache ? (
        <Text variant="caption" tone="muted">
          Resolved from your device — no network needed.
        </Text>
      ) : null}

      {/* Portion presets. Grams are the underlying unit in every case. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {food.portions.map((portion) => (
            <Pressable
              key={`${portion.label}-${portion.grams}`}
              onPress={() => onGramsChange(portion.grams)}
              accessibilityRole="button"
              accessibilityState={{ selected: Math.abs(grams - portion.grams) < 0.01 }}
              style={{
                minHeight: MIN_TAP_TARGET,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radii.pill,
                borderWidth: 1,
                borderColor:
                  Math.abs(grams - portion.grams) < 0.01
                    ? theme.palette.celesteInk
                    : theme.palette.hairline,
                backgroundColor:
                  Math.abs(grams - portion.grams) < 0.01
                    ? theme.palette.celesteSoft
                    : theme.palette.surface,
              }}
            >
              <Text variant="caption">
                {portion.label} · {Math.round(portion.grams)} g
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
        {([0.5, 1, 1.5, 2] as const).map((multiple) => {
          const base = food.portions.find((p) => p.isDefault)?.grams ?? 100;
          return (
            <Pressable
              key={multiple}
              onPress={() => onGramsChange(base * multiple)}
              accessibilityRole="button"
              accessibilityLabel={`${multiple} servings`}
              style={{
                flex: 1,
                minHeight: MIN_TAP_TARGET,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radii.md,
                backgroundColor: theme.palette.surfaceSunken,
              }}
            >
              <Text variant="caption">×{multiple}</Text>
            </Pressable>
          );
        })}
      </View>

      <Ticket sunken rule={false}>
        <Text variant="numeric" tabular>
          {Math.round(scaled.energyKcal ?? 0)} kcal
        </Text>
        <Text variant="caption" tone="secondary" tabular>
          {Math.round(scaled.proteinG ?? 0)} g protein · {Math.round(scaled.carbsG ?? 0)} g carbs ·{' '}
          {Math.round(scaled.fatG ?? 0)} g fat · {Math.round(grams)} g total
        </Text>
      </Ticket>

      <MealSlotPicker value={slot} onChange={onSlotChange} />

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Button label="Cancel" variant="quiet" onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Log it" onPress={onConfirm} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

export function MealSlotPicker({
  value,
  onChange,
}: {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
}) {
  const theme = useTheme();
  const slots: { value: MealSlot; label: string }[] = [
    { value: 'breakfast', label: 'Breakfast' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'dinner', label: 'Dinner' },
    { value: 'snack', label: 'Snack' },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
      {slots.map((s) => (
        <Pressable
          key={s.value}
          onPress={() => onChange(s.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === s.value }}
          style={{
            flex: 1,
            minHeight: MIN_TAP_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radii.md,
            backgroundColor:
              value === s.value ? theme.palette.celesteSoft : theme.palette.surfaceSunken,
            borderWidth: 1,
            borderColor: value === s.value ? theme.palette.celesteInk : 'transparent',
          }}
        >
          <Text variant="caption" tone={value === s.value ? 'celeste' : 'secondary'}>
            {s.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.lg,
        backgroundColor: theme.palette.surface,
        borderTopLeftRadius: theme.radii.xl,
        borderTopRightRadius: theme.radii.xl,
      }}
    >
      {children}
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        padding: theme.spacing.xl,
        backgroundColor: theme.palette.background,
      }}
    >
      {children}
    </View>
  );
}
