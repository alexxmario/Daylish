import type { ReactNode } from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';

import { RULE_WEIGHT, useTheme } from '@/theme/index.tsx';
import { Text } from './Text.tsx';

export interface TicketProps extends ViewProps {
  children: ReactNode;
  /** Small tracked caps above the content — the ticket's header line. */
  label?: string;
  /** Right-aligned counterpart to `label`, e.g. a time or a count. */
  meta?: string;
  /**
   * The heavy top rule. Defaults to ink; pass a palette colour to encode
   * something (a macro's hue, the fasting band). Set `false` to omit.
   */
  rule?: string | false;
  padded?: boolean;
  sunken?: boolean;
}

/**
 * The core surface: a kitchen ticket.
 *
 * The heavy top rule is the structural signature of the whole app. It is not
 * decoration — it is doing what the rule on a nutrition panel does, which is to
 * say "a discrete block of information starts here". Because it can carry a
 * colour, it also encodes category without needing an icon.
 */
export function Ticket({
  children,
  label,
  meta,
  rule,
  padded = true,
  sunken = false,
  style,
  ...rest
}: TicketProps) {
  const theme = useTheme();
  const ruleColor = rule === false ? null : (rule ?? theme.palette.ink);

  const base: ViewStyle = {
    backgroundColor: sunken ? theme.palette.surfaceSunken : theme.palette.surface,
    borderRadius: theme.radii.md,
    overflow: 'hidden',
    borderWidth: sunken ? 0 : 1,
    borderColor: theme.palette.hairline,
  };

  return (
    <View style={[base, style]} {...rest}>
      {ruleColor ? <View style={{ height: RULE_WEIGHT, backgroundColor: ruleColor }} /> : null}
      <View
        style={{
          padding: padded ? theme.spacing.lg : 0,
          gap: padded ? theme.spacing.md : 0,
        }}
      >
        {label || meta ? (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              // `padded={false}` means "the content manages its own insets" —
              // rows and cells that must run edge to edge. The header is not
              // content, and without this it sits flush against the border while
              // everything beneath it is inset, which reads as a bug.
              paddingHorizontal: padded ? 0 : theme.spacing.lg,
              paddingTop: padded ? 0 : theme.spacing.lg,
            }}
          >
            {label ? (
              <Text variant="eyebrow" tone="muted">
                {label}
              </Text>
            ) : (
              <View />
            )}
            {meta ? (
              <Text variant="eyebrow" tone="muted">
                {meta}
              </Text>
            ) : null}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/** A full-width hairline, for separating rows inside a ticket. */
export function Divider() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.palette.hairline }} />;
}

/** Small tracked caps used as a standalone section heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Text variant="eyebrow" tone="muted">
        {children}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.palette.hairline }} />
    </View>
  );
}
