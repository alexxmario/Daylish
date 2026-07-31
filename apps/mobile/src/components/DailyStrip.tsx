import { Pressable, View } from 'react-native';

import { Text } from './Text.tsx';
import { Divider, Ticket } from './Ticket.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

export interface DailyStripProps {
  weightKg: number | null;
  waterMl: number;
  waterGoalMl: number;
  /** Null when no fast is running. */
  fastLabel: string | null;
  fastFraction: number;
  /**
   * Cells this account cannot use yet.
   *
   * A locked cell reads "Premium" rather than showing a zero. "0 of 8 glasses"
   * for someone who is not allowed to log water is not a lock, it is a lie
   * about their day — and it looks identical to having drunk nothing.
   */
  lockedWater?: boolean;
  lockedFasting?: boolean;
  onWeight: () => void;
  onWater: () => void;
  onFast: () => void;
  onAddGlass: () => void;
}

/**
 * The three things a day has besides meals.
 *
 * One ticket rather than three, because these are glanceable facts rather than
 * destinations — the journal already has the screen's attention, and three more
 * cards would compete with it. Each cell is tappable; water additionally gets a
 * direct add so the most frequent action is a single tap from the home screen.
 */
export function DailyStrip({
  weightKg,
  waterMl,
  waterGoalMl,
  fastLabel,
  fastFraction,
  lockedWater = false,
  lockedFasting = false,
  onWeight,
  onWater,
  onFast,
  onAddGlass,
}: DailyStripProps) {
  const theme = useTheme();
  const glasses = Math.round(waterMl / 250);
  const goalGlasses = Math.max(1, Math.round(waterGoalMl / 250));

  return (
    <Ticket label="Today" rule={theme.palette.celeste} padded={false}>
      <View style={{ flexDirection: 'row', paddingVertical: theme.spacing.md }}>
        <Cell
          label="Weight"
          value={weightKg !== null ? weightKg.toFixed(1) : '—'}
          unit={weightKg !== null ? 'kg' : 'not today'}
          onPress={onWeight}
          accessibilityLabel={
            weightKg !== null ? `Weight ${weightKg.toFixed(1)} kilograms. Edit.` : 'Add a weigh-in'
          }
        />
        <Hairline />
        <Cell
          label="Water"
          value={lockedWater ? '—' : String(glasses)}
          unit={lockedWater ? 'Premium' : `of ${goalGlasses} glasses`}
          onPress={onWater}
          accessibilityLabel={
            lockedWater
              ? 'Water tracking is part of Premium. See what is included.'
              : `Water ${glasses} of ${goalGlasses} glasses. Open water log.`
          }
          trailing={
            lockedWater ? undefined : (
            <Pressable
              onPress={onAddGlass}
              accessibilityRole="button"
              accessibilityLabel="Add a glass of water"
              hitSlop={8}
              style={{
                width: 30,
                height: 30,
                borderRadius: theme.radii.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.palette.celesteSoft,
              }}
            >
              <Text variant="captionStrong" tone="celeste">
                +
              </Text>
            </Pressable>
            )
          }
        />
        <Hairline />
        <Cell
          label="Fast"
          value={lockedFasting ? '—' : (fastLabel ?? '—')}
          unit={lockedFasting ? 'Premium' : fastLabel ? 'elapsed' : 'not fasting'}
          onPress={onFast}
          accessibilityLabel={
            lockedFasting
              ? 'Fasting timers are part of Premium. See what is included.'
              : fastLabel
                ? `Fasting, ${fastLabel} elapsed`
                : 'Start a fast'
          }
        />
      </View>

      {fastLabel ? (
        <>
          <Divider />
          <View style={{ height: 3, backgroundColor: theme.palette.ringTrack }}>
            <View
              style={{
                width: `${fastFraction * 100}%`,
                height: '100%',
                backgroundColor: theme.palette.sun,
              }}
            />
          </View>
        </>
      ) : null}
    </Ticket>
  );
}

function Hairline() {
  const theme = useTheme();
  return <View style={{ width: 1, backgroundColor: theme.palette.hairline }} />;
}

function Cell({
  label,
  value,
  unit,
  onPress,
  accessibilityLabel,
  trailing,
}: {
  label: string;
  value: string;
  unit: string;
  onPress: () => void;
  accessibilityLabel: string;
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        flex: 1,
        minHeight: MIN_TAP_TARGET,
        paddingHorizontal: theme.spacing.md,
        gap: 2,
      }}
    >
      <Text variant="eyebrow" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        <Text variant="numericSmall">{value}</Text>
        {trailing ?? null}
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {unit}
      </Text>
    </Pressable>
  );
}
