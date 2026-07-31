import { View } from 'react-native';

import { macroEnergySplit, type NutrientVector } from '@daylish/core';

import { Text } from './Text.tsx';
import { useTheme } from '@/theme/index.tsx';

export interface MacroBarProps {
  nutrients: NutrientVector;
  /** Height of the bar. The journal uses the default; denser lists can go thinner. */
  height?: number;
  /** Show "P 45 · C 30 · F 25" beneath. Off where space is tight. */
  withLegend?: boolean;
}

/**
 * What a food is *made of*, as one bar.
 *
 * The journal used to state a calorie count and stop there, which makes every
 * entry look alike — a 160 kcal protein drink and a 160 kcal pastry read as the
 * same fact. The split is the interesting part, and it is the thing a number
 * alone cannot show: here it is visible without reading anything.
 *
 * Proportions come from `macroEnergySplit` in core, so this is the same Atwater
 * arithmetic the rest of the app uses rather than a display-only approximation.
 *
 * Segments are drawn in the macro palette, in the same order as the macro meters
 * on Today — protein, carbs, fat, always that order — so position alone
 * identifies them once someone has seen the panel once. Colour is never the only
 * cue: the legend names each figure, which is the documented relief for the
 * palette's weak aqua/orange separation under tritanopia.
 *
 * A food with no macro data renders nothing rather than an empty track. An
 * unfilled bar would imply "zero of everything", when the truth is "not known".
 */
export function MacroBar({ nutrients, height = 6, withLegend = false }: MacroBarProps) {
  const theme = useTheme();
  const split = macroEnergySplit(nutrients);

  const total = split.proteinPct + split.carbsPct + split.fatPct;
  if (total <= 0) return null;

  const segments = [
    { key: 'protein', pct: split.proteinPct, color: theme.palette.macro.protein, initial: 'P' },
    { key: 'carbs', pct: split.carbsPct, color: theme.palette.macro.carbs, initial: 'C' },
    { key: 'fat', pct: split.fatPct, color: theme.palette.macro.fat, initial: 'F' },
  ].filter((segment) => segment.pct > 0);

  return (
    <View
      accessible
      accessibilityLabel={segments
        .map((s) => `${Math.round(s.pct * 100)} percent ${s.key}`)
        .join(', ')}
      style={{ gap: 4 }}
    >
      <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden' }}>
        {segments.map((segment) => (
          <View
            key={segment.key}
            style={{ flex: segment.pct, backgroundColor: segment.color }}
          />
        ))}
      </View>

      {withLegend ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          {segments.map((segment) => (
            <Text key={segment.key} variant="caption" tone="muted" tabular>
              {segment.initial} {Math.round(segment.pct * 100)}%
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
