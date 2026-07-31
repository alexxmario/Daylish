import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import type { MealSlot } from '@daylish/core';

import { Button, Chip } from '@/components/Button.tsx';
import { CalorieRing } from '@/components/CalorieRing.tsx';
import { ConfidenceBadge } from '@/components/ConfidenceBadge.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { DailyStrip } from '@/components/DailyStrip.tsx';
import { DayRibbon, RIBBON_HEIGHT, instantToOffset } from '@/components/DayRibbon.tsx';
import { MacroBar } from '@/components/MacroBar.tsx';
import { MacroRow } from '@/components/MacroMeter.tsx';
import { MicroPanel } from '@/components/MicroPanel.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import {
  copyDay,
  deleteEntry,
  getDayEntries,
  getDayNutrients,
  getDayTotals,
  loggedSlotsToday,
  type DayEntry,
} from '@/data/journal.ts';
import {
  GLASS_ML,
  describeFast,
  fastingBandForDate,
  getActiveFast,
  getWaterTotal,
  getWeightForDate,
  logWater,
  waterGoalMl,
} from '@/data/daily.ts';
import { saveMealFromEntry } from '@/data/saved-meals.ts';
import { reminderSignals } from '@/data/reminders.ts';
import { loadReminderSettings, rescheduleReminders } from '@/lib/reminders.ts';
import { addDays, formatDayHeading, formatTime, toLocalDate, today, yesterday } from '@/lib/dates.ts';
import { useEntitlements } from '@/state/entitlement.tsx';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/**
 * Today — the journal.
 *
 * Opened five times a day, so it is optimised for glanceability over novelty:
 * the dial answers "how much is left" without scrolling, and logging sits in a
 * fixed bar within thumb reach rather than behind navigation.
 *
 * The day ribbon below is where the product's argument lives — entries at their
 * true hour, on a fixed scale, so the shape of the day is legible.
 */
export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, goal } = useSession();
  const { entitlements } = useEntitlements();

  const [date, setDate] = useState(today());
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [totals, setTotals] = useState({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
  const [micros, setMicros] = useState<{ totals: Record<string, number>; incomplete: string[] }>({
    totals: {},
    incomplete: [],
  });
  const [daily, setDaily] = useState({
    weightKg: null as number | null,
    waterMl: 0,
    fastLabel: null as string | null,
    fastFraction: 0,
    band: null as { startHour: number; endHour: number } | null,
  });

  const reload = useCallback(() => {
    if (!profile) return;
    setEntries(getDayEntries(profile.id, date));
    setTotals(getDayTotals(profile.id, date));

    const fast = getActiveFast(profile.id);
    const progress = fast ? describeFast(fast) : null;
    setDaily({
      weightKg: getWeightForDate(profile.id, date)?.weightKg ?? null,
      waterMl: getWaterTotal(profile.id, date),
      fastLabel: progress
        ? `${Math.floor(progress.elapsedHours)}h ${String(Math.floor((progress.elapsedHours % 1) * 60)).padStart(2, '0')}m`
        : null,
      fastFraction: progress?.fraction ?? 0,
      band: fastingBandForDate(profile.id, date),
    });

    // Only deserialise the full vectors when the panel is actually visible.
    if (profile.detailedNutrition) {
      const summed = getDayNutrients(profile.id, date);
      setMicros({
        totals: summed.totals as Record<string, number>,
        incomplete: [...summed.incompleteKeys],
      });
    }

    // Logging a meal should silence that meal's reminder. Rebuilt here because
    // this runs after every write and every return to the screen — fire and
    // forget, since nothing on screen depends on the result.
    void (async () => {
      const settings = await loadReminderSettings();
      if (!settings.enabled) return;
      const signals = reminderSignals(profile.id, goal);
      await rescheduleReminders({
        settings,
        loggedToday: signals.loggedToday,
        signals,
      });
    })();
  }, [profile, goal, date]);

  useFocusEffect(reload);

  /**
   * Keep a logged meal as a template.
   *
   * Named at the point of saving rather than auto-titled from its first food:
   * "Porridge, banana, whey" is what the app would guess, and "Weekday
   * breakfast" is what the person will actually recognise in a list.
   */
  const promptSaveMeal = useCallback(
    (entry: DayEntry) => {
      if (!profile) return;
      const suggestion = entry.items[0]?.displayName ?? SLOT_LABELS[entry.mealSlot];

      Alert.prompt(
        'Save as a meal',
        'Give it a name you will recognise later.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: (name?: string) => {
              const trimmed = (name ?? '').trim();
              if (trimmed.length === 0) return;
              try {
                saveMealFromEntry(profile.id, entry.id, trimmed);
                Alert.alert('Saved', `"${trimmed}" is now one tap away from Search.`);
              } catch (cause) {
                Alert.alert(
                  'Could not save that meal',
                  cause instanceof Error ? cause.message : 'Please try again.',
                );
              }
            },
          },
        ],
        'plain-text',
        suggestion,
      );
    },
    [profile],
  );

  if (profile && !profile.onboardedAt) return <Redirect href="/onboarding" />;
  if (!profile || !goal) return null;

  const isToday = date === today();
  const now = new Date();
  const nowHours = isToday ? now.getHours() + now.getMinutes() / 60 : null;

  const ribbonEntries = entries.map((entry) => ({
    id: entry.id,
    at: entry.loggedAt,
    title: entry.items[0]?.displayName ?? SLOT_LABELS[entry.mealSlot],
    kcal: Math.round(entry.totals.energyKcal ?? 0),
  }));

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: 160,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <DayHeader date={date} onChange={setDate} />

        {/*
          Weighing in stays free even though the trend is not.

          The adaptive targets someone buys need about a fortnight of weigh-ins
          before they can say anything at all. If free users had no reason to
          step on a scale, the headline paid feature would be blank for two
          weeks after purchase — the worst possible first impression for
          something just paid for. So the free tier still collects it.
        */}
        <DailyStrip
          weightKg={daily.weightKg}
          waterMl={daily.waterMl}
          waterGoalMl={waterGoalMl(daily.weightKg)}
          fastLabel={entitlements.fasting ? daily.fastLabel : null}
          fastFraction={daily.fastFraction}
          lockedWater={!entitlements.water}
          lockedFasting={!entitlements.fasting}
          onWeight={() => router.push('/weigh-in')}
          onWater={() => router.push(entitlements.water ? '/weigh-in' : '/premium')}
          onFast={() => router.push(entitlements.fasting ? '/fasting' : '/premium')}
          onAddGlass={
            entitlements.water
              ? () => {
                  logWater(profile.id, GLASS_ML);
                  reload();
                }
              : () => router.push('/premium')
          }
        />

        {/* The dial and the macro panel, set as one ticket. */}
        <Ticket label="Remaining today" meta={isToday ? 'live' : undefined}>
          <View style={{ alignItems: 'center', paddingVertical: theme.spacing.sm }}>
            <CalorieRing consumedKcal={totals.energyKcal} targetKcal={goal.energyKcal} />
          </View>
          <Divider />
          <MacroRow
            proteinG={totals.proteinG}
            carbsG={totals.carbsG}
            fatG={totals.fatG}
            targets={{ proteinG: goal.proteinG, carbsG: goal.carbsG, fatG: goal.fatG }}
          />
          {profile.detailedNutrition && entitlements.micronutrients ? (
            <>
              <Divider />
              <MicroPanel totals={micros.totals} incompleteKeys={micros.incomplete} />
            </>
          ) : null}
        </Ticket>

        {/* Why the target is what it is. Every algorithmic decision is explained. */}
        {goal.reason ? (
          <Ticket rule={theme.palette.celesteInk} label="Your target" padded>
            <Text variant="caption" tone="secondary">
              {goal.reason}
            </Text>
          </Ticket>
        ) : null}

        <Eyebrow>The day</Eyebrow>

        {entries.length === 0 ? (
          <Ticket rule={theme.palette.hairline}>
            <Illustration name="emptyDay" height={116} />
            <Text variant="heading">Nothing logged yet</Text>
            <Text variant="caption" tone="secondary">
              Scan, search, or bring yesterday across.
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
              <Chip
                label="Copy yesterday"
                onPress={() => {
                  if (copyDay(profile.id, yesterday(date), date) > 0) reload();
                }}
              />
            </View>
          </Ticket>
        ) : (
          <DayTimeline
            entries={entries}
            ribbonEntries={ribbonEntries}
            nowHours={nowHours}
            fasting={daily.band}
            onDeleted={reload}
            onSave={promptSaveMeal}
          />
        )}
      </ScrollView>

      <LogBar
        onScan={() => router.push('/scan')}
        onSearch={() => router.push('/search')}
        onQuickAdd={() => router.push('/quick-add')}
      />
    </View>
  );
}

/**
 * The date control.
 *
 * Arrows for the common case — yesterday, the day before — and the heading
 * itself opens the system calendar for anything further back. Stepping twenty
 * times to reach last month is the kind of thing people give up on, and a picker
 * they already know how to use costs nothing to offer.
 *
 * Future dates are barred in both paths: there is nothing to log on a day that
 * has not happened, and a journal that lets you wander into next week invites
 * entries that quietly break the adherence charts.
 */
function DayHeader({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);
  const atToday = date >= today();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: theme.spacing.md,
      }}
    >
      <Arrow label="Previous day" glyph="‹" onPress={() => onChange(addDays(date, -1))} />

      <Pressable
        onPress={() => setPicking(true)}
        accessibilityRole="button"
        accessibilityLabel={`${formatDayHeading(date)}. Choose a date.`}
        hitSlop={12}
        style={{ alignItems: 'center', minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
      >
        <Text variant="title">{formatDayHeading(date)}</Text>
      </Pressable>

      <Arrow
        label="Next day"
        glyph="›"
        onPress={() => onChange(addDays(date, 1))}
        disabled={atToday}
      />

      <DayPicker
        visible={picking}
        date={date}
        onClose={() => setPicking(false)}
        onPick={(next) => {
          setPicking(false);
          onChange(next);
        }}
      />
    </View>
  );
}

/**
 * The system date picker, in a sheet.
 *
 * iOS renders the inline calendar without any chrome of its own, so it needs a
 * surface and a way out; Android's picker is already a modal dialog, so it is
 * rendered bare and its own buttons do the work.
 */
function DayPicker({
  visible,
  date,
  onClose,
  onPick,
}: {
  visible: boolean;
  date: string;
  onClose: () => void;
  onPick: (localDate: string) => void;
}) {
  const theme = useTheme();
  if (!visible) return null;

  // Midday, so a timezone shift either way cannot roll the date over.
  const value = new Date(`${date}T12:00:00`);

  const picker = (
    <DateTimePicker
      value={value}
      mode="date"
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      maximumDate={new Date(`${today()}T12:00:00`)}
      accentColor={theme.palette.celesteInk}
      // The picker is UIKit, so it follows the *system* appearance, not ours.
      // `userInterfaceStyle` in app.json pins that — but only in a native build;
      // Expo Go ignores it. Without this, a phone in dark mode draws white day
      // numbers onto the white sheet and the calendar disappears.
      themeVariant="light"
      onChange={(event, selected) => {
        if (event.type === 'dismissed') {
          onClose();
          return;
        }
        if (selected) onPick(toLocalDate(selected));
      }}
    />
  );

  if (Platform.OS !== 'ios') return picker;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close the date picker"
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: theme.spacing.lg,
          backgroundColor: 'rgba(11, 26, 38, 0.35)',
        }}
      >
        {/* Stops a tap inside the sheet reaching the dismissing backdrop. */}
        <Pressable onPress={() => {}} style={{ borderRadius: theme.radii.md, overflow: 'hidden' }}>
          <Ticket label="Jump to a day" rule={theme.palette.celesteInk}>
            {picker}
            <Button label="Close" variant="secondary" onPress={onClose} block />
          </Ticket>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Arrow({
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
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={{
        width: MIN_TAP_TARGET,
        height: MIN_TAP_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radii.sm,
        backgroundColor: theme.palette.surface,
        borderWidth: 1,
        borderColor: theme.palette.hairline,
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <Text variant="heading" tone="secondary">
        {glyph}
      </Text>
    </Pressable>
  );
}

/**
 * The ribbon and its entries, laid out together.
 *
 * The rail is a fixed-height absolute canvas; each entry is positioned against
 * the same `instantToOffset` the rail uses, so a card always lines up with its
 * pip. Cards are nudged apart when two meals fall within the same slot of the
 * scale, since overlapping cards would be unreadable — but the *pips* stay at
 * their true time, which is what preserves the honest shape of the day.
 */
function DayTimeline({
  entries,
  ribbonEntries,
  nowHours,
  fasting,
  onDeleted,
  onSave,
}: {
  entries: DayEntry[];
  ribbonEntries: { id: string; at: string; title: string; kcal: number }[];
  nowHours: number | null;
  fasting: { startHour: number; endHour: number } | null;
  onDeleted: () => void;
  onSave: (entry: DayEntry) => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  /**
   * Measured card heights, keyed by entry id.
   *
   * Cards are variable height — a two-line food name plus a source badge is
   * nearly twice a one-liner — so a fixed minimum gap cannot keep them apart.
   * The previous constant was 96pt, and anything taller than that overlapped the
   * card below it, clipping the badge and gram row off the bottom.
   *
   * Heights arrive after the first paint, so the estimate below is what the
   * first frame uses. Positions settle on the following frame.
   */
  const [heights, setHeights] = useState<Record<string, number>>({});
  const CARD_GAP = theme.spacing.md;
  const ESTIMATED_CARD_HEIGHT = 148;

  let lastBottom = -Infinity;
  const positioned = entries.map((entry) => {
    const natural = instantToOffset(entry.loggedAt);
    // Never above its own hour, and never overlapping the card before it.
    const top = Math.max(natural, lastBottom + CARD_GAP);
    lastBottom = top + (heights[entry.id] ?? ESTIMATED_CARD_HEIGHT);
    return { entry, top };
  });

  const contentHeight = Math.max(RIBBON_HEIGHT, lastBottom + CARD_GAP);

  return (
    <View style={{ flexDirection: 'row', minHeight: contentHeight }}>
      <DayRibbon entries={ribbonEntries} nowHours={nowHours} fasting={fasting} />

      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        {positioned.map(({ entry, top }, index) => (
          <Animated.View
            key={entry.id}
            /* Cards arrive in the order they were eaten, briefly. The stagger is
               capped so a full day does not turn opening the app into a wait. */
            entering={
              reduceMotion
                ? undefined
                : FadeInDown.springify().damping(18).delay(Math.min(index, 5) * 55)
            }
            style={{ position: 'absolute', top, left: 0, right: 0 }}
            onLayout={(event) => {
              const measured = Math.round(event.nativeEvent.layout.height);
              // Only write on a real change, or this re-renders forever.
              setHeights((previous) =>
                previous[entry.id] === measured
                  ? previous
                  : { ...previous, [entry.id]: measured },
              );
            }}
          >
            <EntryTicket entry={entry} onDeleted={onDeleted} onSave={() => onSave(entry)} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/**
 * One logged meal.
 *
 * Each food is tappable through to the portion editor. That is the correction
 * path for a mis-logged amount, and it is on the food rather than the meal
 * because portions are wrong per-item — the rest of the meal was fine.
 */
function EntryTicket({
  entry,
  onDeleted,
  onSave,
}: {
  entry: DayEntry;
  onDeleted: () => void;
  onSave: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Ticket
      label={SLOT_LABELS[entry.mealSlot]}
      meta={formatTime(entry.loggedAt)}
      rule={theme.palette.celesteInk}
    >
      {entry.items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => router.push({ pathname: '/edit-item', params: { id: item.id } })}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.displayName}, ${Math.round(item.grams)} grams`}
          accessibilityHint="Opens the portion editor"
          style={{ gap: 4, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
            <Text style={{ flex: 1 }} numberOfLines={2}>
              {item.displayName}
            </Text>
            <Text variant="numericSmall">{Math.round(item.nutrients.energyKcal ?? 0)}</Text>
          </View>
          {/* What this food is made of. Two entries with the same calories can
              be completely different meals, and the number alone hides that. */}
          <MacroBar nutrients={item.nutrients} />
          {/* A spacer rather than `space-between`: most foods carry no badge at
              all now, and space-between would swing the weight across to the
              left the moment the badge is absent. */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ConfidenceBadge source={item.source} confidence={item.confidence} />
            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="muted" tabular>
              {Math.round(item.grams)} g ›
            </Text>
          </View>
        </Pressable>
      ))}

      <Divider />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="caption" tone="secondary" tabular>
          {Math.round(entry.totals.energyKcal ?? 0)} kcal · {Math.round(entry.totals.proteinG ?? 0)} g protein
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
          {/* Offered on the meal, not buried in a menu: the moment someone
              recognises they eat this often is the moment they have just logged
              it, and that is the only moment they will act on. */}
          <Pressable
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel={`Save ${SLOT_LABELS[entry.mealSlot]} as a meal`}
            hitSlop={10}
          >
            <Text variant="eyebrow" tone="celeste">
              Save as meal
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              deleteEntry(entry.id);
              onDeleted();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${SLOT_LABELS[entry.mealSlot]}`}
            hitSlop={10}
          >
            <Text variant="eyebrow" tone="muted">
              Remove
            </Text>
          </Pressable>
        </View>
      </View>
    </Ticket>
  );
}

/**
 * The logging bar.
 *
 * Pinned above the tab bar, ordered by speed: scan is fastest, so it gets the
 * one persimmon on the screen. Logging is never more than one tap away from the
 * screen people already have open.
 */
function LogBar({
  onScan,
  onSearch,
  onQuickAdd,
}: {
  onScan: () => void;
  onSearch: () => void;
  onQuickAdd: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.lg,
        backgroundColor: theme.palette.surface,
        borderTopWidth: 1,
        borderTopColor: theme.palette.hairline,
      }}
    >
      {/* Weighted by label width, not by importance alone: "Quick add" is the
          longest word here, so an equal share is the one that overflows. Scan
          still reads as primary through colour rather than size. */}
      <Button label="Scan" onPress={onScan} style={{ flex: 1 }} />
      <Button label="Search" variant="secondary" onPress={onSearch} style={{ flex: 1 }} />
      <Button label="Quick add" variant="quiet" onPress={onQuickAdd} style={{ flex: 1.25 }} />
    </View>
  );
}
