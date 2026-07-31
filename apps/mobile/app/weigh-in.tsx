import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip } from '@/components/Button.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import { getLatestWeight, getWeightForDate, recordWeight } from '@/data/daily.ts';
import { getWeightSeries } from '@/data/insights.ts';
import { recalibrate } from '@/data/user.ts';
import { addDays, formatDayHeading, today } from '@/lib/dates.ts';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/**
 * Weigh-in.
 *
 * The screen that makes adaptive targets possible — without weigh-ins the goal
 * engine has nothing to learn from and every target stays at its formula
 * estimate forever.
 *
 * Two deliberate choices:
 *
 * - **The field is pre-filled with the last known weight.** Day-to-day change is
 *   small, so editing a nearby number is far less work than typing one from
 *   scratch, and it makes an implausible entry obvious.
 * - **Recalibration runs immediately on save**, and its verdict is shown. The
 *   whole promise is that targets respond to real data; making the user wait
 *   until some invisible weekly job fires undersells it.
 */
export default function WeighInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, refresh } = useSession();

  const [date, setDate] = useState(today());
  const existing = profile ? getWeightForDate(profile.id, date) : null;
  const latest = profile ? getLatestWeight(profile.id, date) : null;

  const [value, setValue] = useState(
    existing ? String(existing.weightKg) : latest ? String(latest.weightKg) : '',
  );
  const [outcome, setOutcome] = useState<string | null>(null);

  if (!profile) return null;

  const weight = Number(value);
  const valid = Number.isFinite(weight) && weight > 25 && weight < 400;

  const trend = getWeightSeries(profile.id, 60);

  const save = () => {
    if (!valid) return;
    recordWeight(profile.id, weight, { localDate: date });
    // The engine decides whether there is enough data to move anything; either
    // way it returns a sentence, and that sentence is the point.
    const result = recalibrate(profile.id);
    refresh();
    setOutcome(result.reason);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: insets.top + theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="display">Weigh in</Text>

        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {[0, -1, -2].map((offset) => {
            const d = addDays(today(), offset);
            return (
              <Chip
                key={offset}
                label={formatDayHeading(d)}
                selected={date === d}
                onPress={() => {
                  setDate(d);
                  const forDay = getWeightForDate(profile.id, d);
                  const fallback = getLatestWeight(profile.id, d);
                  setValue(forDay ? String(forDay.weightKg) : fallback ? String(fallback.weightKg) : '');
                  setOutcome(null);
                }}
              />
            );
          })}
        </View>

        <Ticket label={existing ? 'Updating this day' : 'New weigh-in'}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radii.md,
              backgroundColor: theme.palette.surfaceSunken,
            }}
          >
            <TextInput
              value={value}
              onChangeText={(v) => {
                setValue(v);
                setOutcome(null);
              }}
              keyboardType="decimal-pad"
              autoFocus={!existing}
              selectTextOnFocus
              accessibilityLabel="Weight in kilograms"
              placeholder="70.0"
              placeholderTextColor={theme.palette.inkMuted}
              style={{
                flex: 1,
                minHeight: MIN_TAP_TARGET,
                fontFamily: theme.fonts.numeric,
                fontSize: 38,
                letterSpacing: -1,
                color: theme.palette.ink,
              }}
            />
            <Text variant="eyebrow" tone="muted">
              kg
            </Text>
          </View>

          {latest && date === today() ? (
            <Text variant="caption" tone="muted" tabular>
              Last recorded {latest.weightKg.toFixed(1)} kg on {formatDayHeading(latest.localDate)}
            </Text>
          ) : null}
        </Ticket>

        {outcome ? (
          <Ticket rule={theme.palette.celeste} label="Your targets">
            <Text variant="caption" tone="secondary">
              {outcome}
            </Text>
            <Button label="Done" onPress={() => router.back()} block />
          </Ticket>
        ) : (
          <Button label="Save weigh-in" onPress={save} disabled={!valid} block />
        )}

        {trend.points.length >= 2 ? (
          <>
            <Eyebrow>Recent trend</Eyebrow>
            <Ticket
              label={`${trend.points.length} weigh-ins`}
              meta={
                trend.changePerWeekKg !== null
                  ? `${trend.changePerWeekKg >= 0 ? '+' : ''}${trend.changePerWeekKg.toFixed(2)} kg/wk`
                  : undefined
              }
            >
              <Text variant="caption" tone="secondary">
                Daylish follows the smoothed trend, not any single morning — so water, salt and a
                late dinner never read as real change.
              </Text>
              <Divider />
              <Text variant="caption" tone="muted">
                Weigh in at a similar time each day for the cleanest signal.
              </Text>
            </Ticket>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
