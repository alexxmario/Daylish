import { Pressable, View } from 'react-native';

import type { DayAdherence } from '@/data/insights.ts';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';
import { Text } from './Text.tsx';

/** Monday-first, because the app is written for a European week. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export interface HistoryCalendarProps {
  /** Every day of the month in order, from `getMonthHistory`. */
  days: readonly DayAdherence[];
  /** Today, so days that have not happened can be drawn as absent rather than missed. */
  todayDate: string;
  onSelectDay: (localDate: string) => void;
}

/**
 * How a day is filled.
 *
 * Four states, and the distinction that matters is between **not logged** and
 * **not yet** — a blank future day drawn like a missed one tells someone they
 * have already failed at a Thursday that has not happened.
 *
 * There is no red here, as everywhere else: a day over target is not a failure
 * and must not be coloured like one. Over and under both read as "logged, off
 * target", because the app's position is that the number is information. What
 * the calendar rewards is having logged at all, which is the behaviour worth
 * reinforcing.
 */
type DayState = 'future' | 'empty' | 'logged' | 'onTarget';

function stateOf(day: DayAdherence, todayDate: string): DayState {
  if (day.localDate > todayDate) return 'future';
  if (!day.logged) return 'empty';
  if (day.targetKcal === null || day.targetKcal <= 0) return 'logged';
  return Math.abs(day.energyKcal - day.targetKcal) / day.targetKcal <= 0.1
    ? 'onTarget'
    : 'logged';
}

/**
 * A month of the diary as a grid.
 *
 * Cells are tappable and open that day in the journal, which is the feature
 * rather than the decoration: the calendar's job is to get someone back to a
 * Tuesday three weeks ago in one tap instead of eleven presses of a back arrow.
 *
 * Sized so a whole month fits without scrolling. Seven columns of a fixed
 * fraction rather than a fixed width, so it holds together from an SE to a Pro
 * Max, and each cell clears the 44pt minimum on every size the app supports.
 */
export function HistoryCalendar({ days, todayDate, onSelectDay }: HistoryCalendarProps) {
  const theme = useTheme();

  const fills: Record<DayState, { background: string; border: string; tone: 'ink' | 'muted' }> = {
    // A future day is an outline with nothing in it: present, not yet spent.
    future: { background: 'transparent', border: theme.palette.hairline, tone: 'muted' },
    empty: { background: theme.palette.surfaceSunken, border: theme.palette.hairline, tone: 'muted' },
    logged: { background: theme.palette.celesteSoft, border: theme.palette.celeste, tone: 'ink' },
    onTarget: { background: theme.palette.celeste, border: theme.palette.celesteInk, tone: 'ink' },
  };

  // The first of the month, as a Monday-first column index.
  const first = days[0];
  const lead = first ? (new Date(`${first.localDate}T12:00:00`).getDay() + 6) % 7 : 0;

  const cells: (DayAdherence | null)[] = [...Array<null>(lead).fill(null), ...days];

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((label, index) => (
          <View key={`${label}-${index}`} style={{ width: `${100 / 7}%`, alignItems: 'center' }}>
            <Text variant="eyebrow" tone="muted">
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((day, index) => {
          if (!day) {
            // Leading blanks before the 1st. Not interactive, and hidden from
            // VoiceOver so the grid does not read out empty cells.
            return (
              <View
                key={`pad-${index}`}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ width: `${100 / 7}%`, aspectRatio: 1 }}
              />
            );
          }

          const state = stateOf(day, todayDate);
          const fill = fills[state];
          const dayNumber = Number(day.localDate.slice(-2));
          const isToday = day.localDate === todayDate;

          return (
            <View key={day.localDate} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
              <Pressable
                onPress={state === 'future' ? undefined : () => onSelectDay(day.localDate)}
                disabled={state === 'future'}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabelFor(day, state)}
                style={{
                  flex: 1,
                  minWidth: MIN_TAP_TARGET / 2,
                  borderRadius: theme.radii.sm,
                  backgroundColor: fill.background,
                  borderWidth: isToday ? 2 : 1,
                  borderColor: isToday ? theme.palette.ink : fill.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="captionStrong" tone={fill.tone}>
                  {dayNumber}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * What VoiceOver says for a cell.
 *
 * The number alone would be useless — "14" tells a blind user nothing about
 * whether they logged that day, which is the entire content of the grid.
 */
function accessibilityLabelFor(day: DayAdherence, state: DayState): string {
  const date = day.localDate;
  if (state === 'future') return `${date}, not yet`;
  if (state === 'empty') return `${date}, nothing logged`;
  const kcal = `${Math.round(day.energyKcal)} kcal`;
  return state === 'onTarget'
    ? `${date}, ${kcal}, on target`
    : `${date}, ${kcal}, off target`;
}
