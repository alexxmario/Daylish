import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { HistoryCalendar } from '@/components/HistoryCalendar.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import {
  addMonths,
  getAdherence,
  getLoggingStreak,
  getMonthHistory,
  getWeightSeries,
  monthOf,
  summarise,
  type DayAdherence,
  type MonthHistory,
  type WeightSeries,
} from '@/data/insights.ts';
import { Locked } from '@/components/Locked.tsx';
import { today } from '@/lib/dates.ts';
import { useEntitlements } from '@/state/entitlement.tsx';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/**
 * Progress.
 *
 * Every number here is measured, never projected. Where there is not enough
 * data, the screen says so plainly instead of drawing a flat line and letting
 * it imply something.
 */
export default function ProgressScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, goal } = useSession();
  const { entitlements } = useEntitlements();

  const [adherence, setAdherence] = useState<DayAdherence[]>([]);
  const [weight, setWeight] = useState<WeightSeries>({
    points: [],
    latestKgs: null,
    changePerWeekKg: null,
  });
  const [streak, setStreak] = useState(0);
  const [month, setMonth] = useState(() => monthOf(today()));
  const [history, setHistory] = useState<MonthHistory | null>(null);

  const reload = useCallback(() => {
    if (!profile) return;
    setAdherence(getAdherence(profile.id, 14));
    setWeight(getWeightSeries(profile.id, 90));
    setStreak(getLoggingStreak(profile.id));
    // The calendar is Premium, so a free account never runs the query. It is
    // cheap, but "cheap" is not a reason to read a diary nobody will be shown.
    setHistory(entitlements.trends ? getMonthHistory(profile.id, month) : null);
  }, [profile, month, entitlements.trends]);

  useFocusEffect(reload);

  if (!profile) return null;
  const summary = summarise(adherence);

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: insets.top + theme.spacing.lg,
        paddingBottom: theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Text variant="display">Progress</Text>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <StatTicket
          label="Logging streak"
          value={String(streak)}
          unit={streak === 1 ? 'day' : 'days'}
        />
        <StatTicket
          label="Days logged"
          value={String(summary.daysLogged)}
          unit="of last 14"
        />
      </View>

      {/*
        The last weigh-in is a fact this person typed in, so it is theirs. The
        *trend* — the smoothed line through the noise, and the rate it implies —
        is the analysis, and that is the paid product.

        The locked card still shows their real latest weight rather than a stock
        illustration: a paywall over your own number is far more persuasive than
        one over a picture, and it is honest about exactly what is missing.
      */}
      <Eyebrow>Weight</Eyebrow>
      {entitlements.trends ? (
        <Ticket
          label={weight.latestKgs !== null ? `${weight.latestKgs.toFixed(1)} kg` : 'No weigh-ins yet'}
          meta={
            weight.changePerWeekKg !== null
              ? `${weight.changePerWeekKg >= 0 ? '+' : ''}${weight.changePerWeekKg.toFixed(2)} kg/wk`
              : undefined
          }
        >
          {weight.points.length >= 2 ? (
            <WeightChart series={weight} />
          ) : (
            <>
              <Illustration name="emptyProgress" height={104} />
              <Text variant="caption" tone="secondary">
                Weigh in a few times. We follow the trend, not one morning.
              </Text>
            </>
          )}
        </Ticket>
      ) : (
        <Locked
          title="Weight trend"
          teaser={weight.latestKgs !== null ? `${weight.latestKgs.toFixed(1)} kg` : undefined}
          blurb={
            weight.points.length >= 2
              ? 'You have weigh-ins recorded. Premium draws the trend through them and tells you what it is actually doing, rather than what one morning says.'
              : 'Keep weighing in — Premium follows the trend through the daily noise and tells you what your weight is actually doing.'
          }
        />
      )}

      <Eyebrow>Last 14 days</Eyebrow>
      {!entitlements.trends ? (
        <Locked
          title="Intake against target"
          teaser={summary.daysLogged > 0 ? `${summary.daysLogged} days logged` : undefined}
          blurb="How close you actually came, day by day, with your averages for calories and protein."
        />
      ) : (
      <Ticket
        label="Intake against target"
        meta={
          summary.onTargetShare !== null
            ? `${Math.round(summary.onTargetShare * 100)}% within 10%`
            : undefined
        }
      >
        {summary.daysLogged > 0 ? (
          <>
            <AdherenceChart days={adherence} targetKcal={goal?.energyKcal ?? null} />
            <Divider />
            <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
              <MiniStat
                label="Average"
                value={summary.averageKcal !== null ? Math.round(summary.averageKcal) : null}
                unit="kcal"
              />
              <MiniStat
                label="Protein"
                value={summary.averageProteinG !== null ? Math.round(summary.averageProteinG) : null}
                unit="g/day"
              />
            </View>
          </>
        ) : (
          <Text variant="caption" tone="secondary">
            Log a few days and this fills in.
          </Text>
        )}
      </Ticket>
      )}

      {/*
        History.

        The 14-day strip answers "how is this fortnight going". This answers a
        different question — "what have I actually been doing" — and it is the
        one that needs months rather than a chart. Tapping a day opens it, which
        is the point: getting back to a Tuesday three weeks ago was previously
        eleven presses of a back arrow on Today.
      */}
      <Eyebrow>History</Eyebrow>
      {!entitlements.trends ? (
        <Locked
          title="Your whole diary, month by month"
          teaser={streak > 0 ? `${streak}-day streak` : undefined}
          blurb="Every day you have logged, laid out as a calendar you can tap back into. Premium keeps the whole history, not just the last fortnight."
        />
      ) : (
        <Ticket
          label={monthLabel(month)}
          meta={
            history && history.daysElapsed > 0
              ? `${history.daysLogged}/${history.daysElapsed} days`
              : undefined
          }
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <MonthArrow
              label="Previous month"
              glyph="‹"
              onPress={() => setMonth(addMonths(month, -1))}
            />
            <Text variant="captionStrong" tone="secondary">
              {monthLabel(month)}
            </Text>
            {/*
              There is no next month past this one. A disabled arrow is kept
              rather than removed so the header does not jump sideways when
              someone steps back and forward again.
            */}
            <MonthArrow
              label="Next month"
              glyph="›"
              disabled={month >= monthOf(today())}
              onPress={() => setMonth(addMonths(month, 1))}
            />
          </View>

          <Divider />

          {history ? (
            <HistoryCalendar
              days={history.days}
              todayDate={today()}
              onSelectDay={(date) => router.push({ pathname: '/', params: { date } })}
            />
          ) : null}

          {history && history.daysLogged > 0 ? (
            <>
              <Divider />
              <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
                <MiniStat label="Average" value={history.averageKcal} unit="kcal" />
                <MiniStat
                  label="On target"
                  value={history.onTarget}
                  unit={`of ${history.daysLogged}`}
                />
              </View>
            </>
          ) : (
            <Text variant="caption" tone="secondary">
              Nothing logged this month yet.
            </Text>
          )}
        </Ticket>
      )}
    </ScrollView>
  );
}

/** e.g. "August 2026". */
function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(year, mon - 1, 1, 12).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function MonthArrow({
  label,
  glyph,
  onPress,
  disabled = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={{
        minWidth: MIN_TAP_TARGET,
        minHeight: MIN_TAP_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="title" tone={disabled ? 'muted' : 'celeste'}>
        {glyph}
      </Text>
    </Pressable>
  );
}

function StatTicket({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Ticket label={label} style={{ flex: 1 }}>
      <View style={{ gap: 0 }}>
        <Text variant="numeric">{value}</Text>
        <Text variant="eyebrow" tone="muted">
          {unit}
        </Text>
      </View>
    </Ticket>
  );
}

function MiniStat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="eyebrow" tone="muted">
        {label}
      </Text>
      <Text variant="numericSmall">
        {value !== null ? value.toLocaleString() : '—'}{' '}
        <Text variant="caption" tone="muted">
          {unit}
        </Text>
      </Text>
    </View>
  );
}

const CHART_HEIGHT = 96;

/**
 * The smoothed weight trend.
 *
 * Raw weigh-ins are drawn as faint dots and the trend as the line, so the noise
 * is visible without competing — that is the whole argument for trend-based
 * tracking, made visually.
 */
function WeightChart({ series }: { series: WeightSeries }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const points = series.points;
  const values = points.flatMap((p) => [p.weightKg, p.trendKg]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.5, max - min);

  const x = (i: number) => (points.length <= 1 ? 0 : (i / (points.length - 1)) * width);
  const y = (v: number) => CHART_HEIGHT - ((v - min) / range) * CHART_HEIGHT;

  const trendPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.trendKg).toFixed(1)}`)
    .join(' ');

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
      {width > 0 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          {points.map((p, i) => (
            <Circle
              key={p.date}
              cx={x(i)}
              cy={y(p.weightKg)}
              r={2}
              fill={theme.palette.inkMuted}
              opacity={0.35}
            />
          ))}
          <Path d={trendPath} stroke={theme.palette.celesteInk} strokeWidth={2} fill="none" />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * Intake per day as bars, with the day's own target as a rule across them.
 *
 * Bars are neutral by design: an over-target day is not coloured differently,
 * because the product does not treat it as a failure. The target line gives the
 * comparison without a verdict.
 */
function AdherenceChart({
  days,
  targetKcal,
}: {
  days: DayAdherence[];
  targetKcal: number | null;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const ceiling = Math.max(
    targetKcal ?? 0,
    ...days.map((d) => d.energyKcal),
    ...days.map((d) => d.targetKcal ?? 0),
    1,
  ) * 1.1;

  const gap = 4;
  const barWidth = days.length > 0 ? Math.max(4, (width - gap * (days.length - 1)) / days.length) : 0;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
      {width > 0 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          {targetKcal ? (
            <Line
              x1={0}
              x2={width}
              y1={CHART_HEIGHT - (targetKcal / ceiling) * CHART_HEIGHT}
              y2={CHART_HEIGHT - (targetKcal / ceiling) * CHART_HEIGHT}
              stroke={theme.palette.inkMuted}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ) : null}
          {days.map((day, i) => {
            const height = (day.energyKcal / ceiling) * CHART_HEIGHT;
            return (
              <Path
                key={day.localDate}
                d={`M ${i * (barWidth + gap)} ${CHART_HEIGHT} v ${-Math.max(day.logged ? 2 : 0, height)} h ${barWidth} v ${Math.max(day.logged ? 2 : 0, height)} Z`}
                fill={day.logged ? theme.palette.celesteInk : theme.palette.ringTrack}
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
