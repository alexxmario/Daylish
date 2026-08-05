import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme, type TypographyVariant } from '@/theme/index.tsx';

type Tone = 'ink' | 'secondary' | 'muted' | 'celeste' | 'sun' | 'onDark';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: Tone;
  /** Tabular figures, so numbers that tick upward do not shift the layout. */
  tabular?: boolean;
  /** Uppercase, for the eyebrow voice. On by default for `eyebrow`. */
  caps?: boolean;
}

export function Text({
  variant = 'body',
  tone = 'ink',
  tabular,
  caps,
  style,
  children,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const spec = theme.typography[variant];

  const color = {
    ink: theme.palette.ink,
    secondary: theme.palette.inkSecondary,
    muted: theme.palette.inkMuted,
    celeste: theme.palette.celesteInk,
    // `sunInk`, not `sun`: this is text, and the fill colour is unreadable at
    // 1.75:1 on a light surface. See the token's note in `theme/tokens.ts`.
    sun: theme.palette.sunInk,
    onDark: theme.palette.onDark,
  }[tone];

  const isNumeric = variant === 'numeric' || variant === 'numericSmall' || variant === 'hero';
  const useTabular = tabular ?? isNumeric;
  const useCaps = caps ?? variant === 'eyebrow';

  const base: TextStyle = {
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
    fontFamily: spec.font,
    letterSpacing: spec.letterSpacing,
    color,
    ...(useTabular ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
    ...(useCaps ? { textTransform: 'uppercase' as const } : null),
  };

  return (
    <RNText style={[base, style]} {...rest}>
      {children}
    </RNText>
  );
}
