import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';
import { Text } from './Text.tsx';

type Variant = 'primary' | 'secondary' | 'quiet' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  block?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}

/**
 * Persimmon is reserved for `primary`, and there should be at most one primary
 * on screen. It is the only hot colour in the system, so spending it twice on a
 * screen means neither instance reads as the thing to do next.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  block = false,
  accessibilityHint,
  style,
}: ButtonProps) {
  const theme = useTheme();

  const surface: Record<Variant, string> = {
    primary: theme.palette.sun,
    secondary: theme.palette.celesteSoft,
    quiet: 'transparent',
    destructive: theme.palette.destructive,
  };

  const tone = variant === 'primary' || variant === 'destructive' ? 'onDark' : 'celeste';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          minHeight: MIN_TAP_TARGET,
          justifyContent: 'center',
          alignItems: 'center',
          // `lg` rather than `xl`: three buttons in a row on the narrowest
          // supported iPhone have about 342pt between them, and 24pt of padding
          // each side left the longest label without room to sit on one line.
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radii.sm,
          backgroundColor: surface[variant],
          borderWidth: variant === 'quiet' ? 1 : 0,
          borderColor: theme.palette.hairline,
          opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
          alignSelf: block ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {/* A button label never wraps. In a tight row it gives up a little type
          size instead — a two-line "Quick add" reads as a layout fault, whereas
          a percent of font size is invisible. */}
      <Text
        variant="bodyStrong"
        tone={tone}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={{ textAlign: 'center' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A compact action used in dense rows — the scanner's portion presets, the
 * journal's quick actions. Reads as a stamped chip rather than a button.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        minHeight: MIN_TAP_TARGET,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radii.sm,
        backgroundColor: selected ? theme.palette.celesteInk : theme.palette.surfaceSunken,
        borderWidth: 1,
        borderColor: selected ? theme.palette.celesteInk : 'transparent',
      }}
    >
      <Text variant="captionStrong" tone={selected ? 'onDark' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Row({ children, gap }: { children: ReactNode; gap?: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: gap ?? theme.spacing.sm, alignItems: 'center' }}>
      {children}
    </View>
  );
}
