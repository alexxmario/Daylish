import { View } from 'react-native';

import { useTheme } from '@/theme/index.tsx';
import { Text } from './Text.tsx';

/**
 * The day ribbon — Daylish's signature.
 *
 * Every competitor renders the day as a stack of meal cards grouped under
 * Breakfast / Lunch / Dinner headings. That throws away the thing the product is
 * actually about: a day has a *shape*. Eating at 07:00 and again at 23:00 is a
 * different day from eating twice at noon, and the grouped-card layout cannot
 * show the difference.
 *
 * So entries sit at their true hour on a continuous vertical rail. Gaps are
 * visible as gaps, a fasting window is a real span rather than a badge, and
 * "now" is a live mark you can see yourself approaching. Position carries
 * information here, which is the only reason to impose a structure like this.
 *
 * The rail spans a fixed 05:00–24:00 window rather than auto-fitting the
 * entries: a consistent scale is what makes two days comparable at a glance,
 * and it keeps early mornings and late nights in their honest place.
 */

export const RIBBON_START_HOUR = 5;
export const RIBBON_END_HOUR = 24;
export const RIBBON_WIDTH = 54;

/** Vertical pixels per hour. Tuned so a normal day fits one screen. */
const PX_PER_HOUR = 34;

export const RIBBON_HEIGHT = (RIBBON_END_HOUR - RIBBON_START_HOUR) * PX_PER_HOUR;

/** Convert a clock time to its offset down the rail. */
export function hourToOffset(hours: number): number {
  const clamped = Math.max(RIBBON_START_HOUR, Math.min(RIBBON_END_HOUR, hours));
  return (clamped - RIBBON_START_HOUR) * PX_PER_HOUR;
}

export function instantToOffset(iso: string): number {
  const date = new Date(iso);
  return hourToOffset(date.getHours() + date.getMinutes() / 60);
}

export interface RibbonEntry {
  id: string;
  /** ISO instant. */
  at: string;
  title: string;
  kcal: number;
  /** Rule colour for this entry's marker. */
  accent?: string;
}

export interface FastingWindow {
  startHour: number;
  endHour: number;
}

export interface DayRibbonProps {
  entries: readonly RibbonEntry[];
  /** Shown only when viewing today. */
  nowHours?: number | null;
  fasting?: FastingWindow | null;
}

const HOUR_MARKS = [6, 9, 12, 15, 18, 21, 24];

/**
 * The rail itself: hour marks, the fasting band, entry pips and the now line.
 * Entry *content* is rendered beside it by the journal, so the rail stays a
 * pure time axis.
 */
export function DayRibbon({ entries, nowHours, fasting }: DayRibbonProps) {
  const theme = useTheme();

  return (
    <View
      style={{ width: RIBBON_WIDTH, height: RIBBON_HEIGHT }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* The rail */}
      <View
        style={{
          position: 'absolute',
          left: RIBBON_WIDTH - 12,
          top: 0,
          bottom: 0,
          width: 2,
          backgroundColor: theme.palette.hairline,
        }}
      />

      {/* Fasting window, drawn behind everything as a continuous span. */}
      {fasting ? (
        <View
          style={{
            position: 'absolute',
            left: RIBBON_WIDTH - 16,
            top: hourToOffset(fasting.startHour),
            height: Math.max(2, hourToOffset(fasting.endHour) - hourToOffset(fasting.startHour)),
            width: 10,
            borderRadius: 5,
            backgroundColor: theme.palette.butter,
            opacity: 0.35,
          }}
        />
      ) : null}

      {/* Hour marks */}
      {HOUR_MARKS.map((hour) => (
        <View
          key={hour}
          style={{
            position: 'absolute',
            top: hourToOffset(hour) - 7,
            left: 0,
            width: RIBBON_WIDTH - 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 4,
          }}
        >
          <Text variant="eyebrow" tone="muted">
            {String(hour % 24).padStart(2, '0')}
          </Text>
          <View style={{ width: 5, height: 1, backgroundColor: theme.palette.hairline }} />
        </View>
      ))}

      {/* Entry pips, sitting at their true time */}
      {entries.map((entry) => (
        <View
          key={entry.id}
          style={{
            position: 'absolute',
            top: instantToOffset(entry.at) - 5,
            left: RIBBON_WIDTH - 16,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: entry.accent ?? theme.palette.celesteInk,
            borderWidth: 2,
            borderColor: theme.palette.background,
          }}
        />
      ))}

      {/* Now — the live mark */}
      {nowHours != null ? (
        <View
          style={{
            position: 'absolute',
            top: hourToOffset(nowHours) - 1,
            left: RIBBON_WIDTH - 22,
            right: -8,
            height: 2,
            backgroundColor: theme.palette.sun,
          }}
        />
      ) : null}
    </View>
  );
}
