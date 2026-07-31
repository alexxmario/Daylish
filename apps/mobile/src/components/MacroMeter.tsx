import { View } from 'react-native';

import { useTheme } from '@/theme/index.tsx';
import { Text } from './Text.tsx';

export interface MacroMeterProps {
  label: string;
  consumedG: number;
  targetG: number;
  color: string;
}

/**
 * One macro, set as a nutrition-panel row rather than a progress bar with a
 * caption: name on the left, figure on the right, a rule beneath carrying the
 * fill. It reads the way the back of a packet reads, which is a format people
 * already know how to scan.
 *
 * Label and both numbers are always visible. That is not styling — the palette
 * validator flagged light-mode aqua at 2.55:1 against this paper and weak
 * aqua/orange separation under tritanopia in dark, and the documented relief for
 * both is visible direct labels. Colour is a secondary cue here, never the only
 * one.
 */
export function MacroMeter({ label, consumedG, targetG, color }: MacroMeterProps) {
  const theme = useTheme();

  const safeTarget = targetG > 0 ? targetG : 1;
  const fraction = Math.max(0, Math.min(1, consumedG / safeTarget));
  const consumed = Math.round(consumedG);
  const target = Math.round(targetG);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${consumed} of ${target} grams`}
      style={{ flex: 1, gap: 5 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text variant="eyebrow" tone="muted">
          {label}
        </Text>
        <Text variant="numericSmall">{consumed}</Text>
      </View>

      <View style={{ height: 4, backgroundColor: theme.palette.ringTrack, overflow: 'hidden' }}>
        <View style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: color }} />
      </View>

      <Text variant="caption" tone="muted" tabular>
        of {target} g
      </Text>
    </View>
  );
}

export interface MacroRowProps {
  proteinG: number;
  carbsG: number;
  fatG: number;
  targets: { proteinG: number; carbsG: number; fatG: number };
}

export function MacroRow({ proteinG, carbsG, fatG, targets }: MacroRowProps) {
  const theme = useTheme();
  const { macro } = theme.palette;

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
      <MacroMeter label="Protein" consumedG={proteinG} targetG={targets.proteinG} color={macro.protein} />
      <MacroMeter label="Carbs" consumedG={carbsG} targetG={targets.carbsG} color={macro.carbs} />
      <MacroMeter label="Fat" consumedG={fatG} targetG={targets.fatG} color={macro.fat} />
    </View>
  );
}
