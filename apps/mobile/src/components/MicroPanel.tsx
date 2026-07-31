import { View } from 'react-native';

import { microCoverage, type NutrientVector } from '@daylish/core';

import { Text } from './Text.tsx';
import { Divider } from './Ticket.tsx';
import { useTheme } from '@/theme/index.tsx';

export interface MicroPanelProps {
  totals: NutrientVector;
  /**
   * Nutrients where at least one logged item had no data, so the total
   * undercounts. Surfaced rather than hidden — see the note below.
   */
  incompleteKeys?: readonly string[];
}

/**
 * The micronutrient panel.
 *
 * Hidden behind the simple/detailed toggle, because 25 rows of vitamins is
 * exactly the wall of numbers that makes beginners abandon a tracker — and
 * exactly what a Cronometer user came for. The toggle is the whole feature.
 *
 * Two honesty rules carry over from the rest of the app:
 *
 * - **Incomplete totals say so.** If a logged food had no zinc figure, the day's
 *   zinc is an undercount, and a bar drawn as though it were complete would be a
 *   lie. Those rows are marked.
 * - **Over 100% is not an error.** Vitamin C at 300% of the Daily Value is
 *   normal and harmless. The bar simply fills; nothing turns red, because the
 *   palette has no alarm colour.
 */
export function MicroPanel({ totals, incompleteKeys = [] }: MicroPanelProps) {
  const theme = useTheme();
  const coverage = microCoverage(totals);
  const incomplete = new Set(incompleteKeys);

  if (coverage.length === 0) {
    return (
      <Text variant="caption" tone="secondary">
        Log a few foods with full nutrition data and their vitamins and minerals appear here.
      </Text>
    );
  }

  const sorted = [...coverage].sort((a, b) => a.fraction - b.fraction);
  const lowest = sorted.slice(0, 3).filter((c) => c.fraction < 0.5);

  return (
    <View style={{ gap: theme.spacing.md }}>
      {lowest.length > 0 ? (
        <>
          <Text variant="caption" tone="secondary">
            Furthest from a full day: {lowest.map((c) => c.label.toLowerCase()).join(', ')}.
          </Text>
          <Divider />
        </>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        {sorted.map((entry) => {
          const isIncomplete = incomplete.has(entry.key);
          const pct = Math.round(entry.fraction * 100);
          return (
            <View
              key={entry.key}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={`${entry.label}: ${pct}% of the daily value${isIncomplete ? ', partial data' : ''}`}
              style={{ gap: 3 }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text variant="caption">
                  {entry.label}
                  {isIncomplete ? (
                    <Text variant="caption" tone="muted">
                      {' '}
                      · partial
                    </Text>
                  ) : null}
                </Text>
                <Text variant="caption" tone="muted" tabular>
                  {pct}%
                </Text>
              </View>
              <View style={{ height: 3, backgroundColor: theme.palette.ringTrack }}>
                <View
                  style={{
                    width: `${Math.min(100, entry.fraction * 100)}%`,
                    height: '100%',
                    backgroundColor: isIncomplete
                      ? theme.palette.inkMuted
                      : theme.palette.celesteInk,
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>

      <Text variant="caption" tone="muted">
        Percentages are of the FDA Daily Value. Nutrients without a published value show an amount
        only, and are left out here.
      </Text>
    </View>
  );
}
