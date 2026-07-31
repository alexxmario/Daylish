import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Text } from './Text.tsx';
import { Ticket } from './Ticket.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/**
 * A feature this account does not have yet.
 *
 * Written to be the least annoying version of itself. Three rules it follows,
 * all of them things paywalls usually get wrong:
 *
 *   **Name the thing, do not tease it.** "Weight trend" with a lock is honest;
 *   a blurred chart of someone else's data is a trick, and people can tell.
 *
 *   **Say what it does, not that it is premium.** Nobody wants Premium. They
 *   want to know whether they are actually losing weight. The line under the
 *   title is the feature's job, not its price.
 *
 *   **Never block something already earned.** This stands in for a feature that
 *   was never available, never in front of data someone has already logged.
 *   Taking away a view they had yesterday is how an app gets uninstalled and
 *   reviewed in the same minute.
 */
export function Locked({
  title,
  blurb,
  /** A real figure from this person's own data, when there is one worth showing. */
  teaser,
}: {
  title: string;
  blurb: string;
  teaser?: string;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push('/premium')}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${blurb}. Tap to see what Premium includes.`}
    >
      <Ticket rule={theme.palette.sun} label={title} meta="Premium">
        <View style={{ gap: theme.spacing.xs, minHeight: MIN_TAP_TARGET }}>
          {teaser ? (
            <Text variant="numeric" tone="muted">
              {teaser}
            </Text>
          ) : null}
          <Text variant="caption" tone="secondary">
            {blurb}
          </Text>
        </View>
        <Text variant="captionStrong" tone="sun">
          See what's included
        </Text>
      </Ticket>
    </Pressable>
  );
}
