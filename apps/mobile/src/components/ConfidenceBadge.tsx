import { View } from 'react-native';

import type { FoodSource } from '@daylish/core';
import { useTheme } from '@/theme/index.tsx';
import { Text } from './Text.tsx';

export interface ConfidenceBadgeProps {
  source: FoodSource;
  confidence: number;
}

/**
 * Sources that need no stamp.
 *
 * These are the norm — most of what anyone logs comes from a reference
 * database — and a badge on nearly every row is not a signal, it is wallpaper.
 * Naming the database on each item was worse still: it put a supplier's name on
 * a person's dinner, which is our provenance problem rather than theirs.
 *
 * Where the data came from is still recorded on every item and still travels in
 * the export; it simply stops being decoration on the screen.
 */
const UNSTAMPED: readonly FoodSource[] = ['usda', 'off'];

/**
 * The caveat stamp.
 *
 * Now marks only what a person should treat with some doubt: an AI estimate,
 * something typed in by hand, or figures copied off a packet. Silence means the
 * numbers came from a reference database — which is the common case, so it is
 * the one that earns no ink.
 *
 * The inversion is deliberate and is the whole point of the component. Stamping
 * everything trains people to stop reading the stamp, at which point the
 * estimate warning — the only one that actually matters — disappears into the
 * noise along with the rest.
 */
export function ConfidenceBadge({ source, confidence }: ConfidenceBadgeProps) {
  const theme = useTheme();

  if (UNSTAMPED.includes(source)) return null;

  const label: Record<Exclude<FoodSource, 'usda' | 'off'>, string> = {
    branded_manual: 'From the label',
    user: 'Your own figures',
    ai_estimate: `Estimate · ${Math.round(confidence * 100)}% sure`,
  };

  const text = label[source as Exclude<FoodSource, 'usda' | 'off'>];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={text}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: theme.radii.sm,
        backgroundColor: theme.palette.surfaceSunken,
      }}
    >
      <Text variant="eyebrow" tone="muted">
        {text}
      </Text>
    </View>
  );
}
