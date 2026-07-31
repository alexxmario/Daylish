import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FastingProtocol } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import { ChoiceRow } from '@/onboarding/Fields.tsx';
import {
  FASTING_PROTOCOLS,
  describeFast,
  endFast,
  getActiveFast,
  startFast,
} from '@/data/daily.ts';
import { formatTime } from '@/lib/dates.ts';
import { useSession } from '@/state/session.tsx';
import { useTheme } from '@/theme/index.tsx';

/**
 * Fasting.
 *
 * Shows an elapsed count while a fast runs and the protocol list when none does.
 * The timer ticks once a minute rather than once a second: a fast is measured in
 * hours, and a per-second re-render would burn battery on the screen most likely
 * to be left open.
 *
 * Passing the target is not an end state — the count keeps going and the copy
 * shifts to "past your window". Cutting someone off at exactly 16:00 would be
 * arbitrary, and stopping is their decision, not the app's.
 */
export default function FastingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();

  const [session, setSession] = useState(() => (profile ? getActiveFast(profile.id) : null));
  const [now, setNow] = useState(() => new Date());
  const [protocol, setProtocol] = useState<FastingProtocol>('16:8');

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [session]);

  if (!profile) return null;

  const progress = session ? describeFast(session, now) : null;

  const begin = () => {
    const spec = FASTING_PROTOCOLS.find((p) => p.value === protocol);
    if (!spec) return;
    startFast(profile.id, spec.value, spec.hours);
    setSession(getActiveFast(profile.id));
    setNow(new Date());
  };

  const finish = () => {
    if (!session) return;
    endFast(session.id);
    setSession(null);
  };

  const hhmm = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: insets.top + theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
    >
      <Text variant="display">Fasting</Text>

      {progress ? (
        <>
          <Ticket
            label={progress.complete ? 'Window complete' : 'Fasting now'}
            meta={progress.session.protocol}
            rule={theme.palette.sun}
          >
            <View style={{ alignItems: 'flex-start' }}>
              <Text variant="hero">{hhmm(progress.elapsedHours)}</Text>
              <Text variant="eyebrow" tone="muted">
                {progress.complete
                  ? `past your ${progress.session.targetHours}h window`
                  : `${hhmm(progress.remainingHours)} to go`}
              </Text>
            </View>

            <View style={{ height: 4, backgroundColor: theme.palette.ringTrack }}>
              <View
                style={{
                  width: `${progress.fraction * 100}%`,
                  height: '100%',
                  backgroundColor: theme.palette.sun,
                }}
              />
            </View>

            <Divider />
            <Text variant="caption" tone="muted">
              Started {formatTime(progress.session.startedAt)}
            </Text>
          </Ticket>

          <Button label="End fast" variant="secondary" onPress={finish} block />
          <Button label="Back to today" variant="quiet" onPress={() => router.back()} block />
        </>
      ) : (
        <>
          <Eyebrow>Choose a window</Eyebrow>
          <View style={{ gap: theme.spacing.sm }}>
            {FASTING_PROTOCOLS.map((p) => (
              <ChoiceRow
                key={p.value}
                label={p.label}
                blurb={p.blurb}
                selected={protocol === p.value}
                onPress={() => setProtocol(p.value)}
              />
            ))}
          </View>

          <Button label="Start fasting now" onPress={begin} block />

          <Ticket rule={theme.palette.celeste} label="How it shows up">
            <Text variant="caption" tone="secondary">
              Your fasting window appears as a band down the day on Today, so you can see it against
              what you actually ate.
            </Text>
          </Ticket>
        </>
      )}
    </ScrollView>
  );
}
