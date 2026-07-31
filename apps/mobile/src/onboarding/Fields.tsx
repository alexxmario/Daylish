import { Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/Text.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/**
 * Onboarding input primitives.
 *
 * One question per screen means each control gets room to be large and obvious,
 * so these are sized for confident thumbs rather than for density.
 */

/** A full-width choice with a supporting line. The default for single-select. */
export function ChoiceRow({
  label,
  blurb,
  selected,
  onPress,
}: {
  label: string;
  blurb?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={blurb ? `${label}. ${blurb}` : label}
      style={{
        minHeight: 62,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: selected ? theme.palette.celesteSoft : theme.palette.surface,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.palette.celesteInk : theme.palette.hairline,
        gap: 2,
      }}
    >
      <Text variant="bodyStrong" tone={selected ? 'celeste' : 'ink'}>
        {label}
      </Text>
      {blurb ? (
        <Text variant="caption" tone="muted">
          {blurb}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Multi-select tile, used for allergens and equipment. */
export function ToggleTile({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        minHeight: MIN_TAP_TARGET,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radii.sm,
        backgroundColor: selected ? theme.palette.celesteInk : theme.palette.surface,
        borderWidth: 1,
        borderColor: selected ? theme.palette.celesteInk : theme.palette.hairline,
      }}
    >
      <Text variant="captionStrong" tone={selected ? 'onDark' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TileGrid({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>{children}</View>
  );
}

/**
 * A big numeric entry with its unit set inline.
 *
 * The unit sits inside the field rather than in the label so the value reads as
 * a measurement — "178 cm" — instead of a bare number that has to be matched
 * back to a heading.
 */
export function MeasureField({
  label,
  value,
  onChange,
  unit,
  placeholder,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, gap: theme.spacing.xs }}>
      <Text variant="eyebrow" tone="muted">
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radii.md,
          backgroundColor: theme.palette.surface,
          borderWidth: 1,
          borderColor: theme.palette.hairline,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          placeholder={placeholder}
          autoFocus={autoFocus}
          accessibilityLabel={`${label} in ${unit}`}
          placeholderTextColor={theme.palette.inkMuted}
          style={{
            flex: 1,
            paddingVertical: 6,
            fontFamily: theme.fonts.numeric,
            fontSize: 30,
            letterSpacing: -0.5,
            color: theme.palette.ink,
          }}
        />
        <Text variant="eyebrow" tone="muted">
          {unit}
        </Text>
      </View>
    </View>
  );
}

/** Small segmented control, used where the options are short and few. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        borderRadius: theme.radii.md,
        backgroundColor: theme.palette.surfaceSunken,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              minHeight: MIN_TAP_TARGET - 8,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radii.sm,
              backgroundColor: selected ? theme.palette.surface : 'transparent',
            }}
          >
            <Text variant="captionStrong" tone={selected ? 'ink' : 'muted'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
