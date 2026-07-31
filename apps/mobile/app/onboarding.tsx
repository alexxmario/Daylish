import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { baselineExpenditure, computeTargets } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Ticket } from '@/components/Ticket.tsx';
import { completeOnboarding } from '@/data/user.ts';
import {
  ACTIVITY_OPTIONS,
  ALLERGEN_OPTIONS,
  DIET_OPTIONS,
  EQUIPMENT_OPTIONS,
  GOAL_OPTIONS,
  INITIAL_DRAFT,
  PREP_TIME_OPTIONS,
  RATE_OPTIONS,
  canAdvance,
  visibleSteps,
  type Draft,
  type StepId,
} from '@/onboarding/steps.ts';
import { ChoiceRow, MeasureField, Segmented, TileGrid, ToggleTile } from '@/onboarding/Fields.tsx';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/**
 * Onboarding — one question per screen.
 *
 * A single long form asks someone to absorb nine decisions at once and makes
 * every one of them feel like paperwork. Walking through them puts one decision
 * on screen at a time with room to explain why it is being asked, and the
 * progress rail keeps the length honest so it never feels open-ended.
 *
 * The last step is not a confirmation — it is the payoff: the actual targets,
 * with the arithmetic named, before the user has committed to anything.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, refresh } = useSession();

  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [index, setIndex] = useState(0);

  const steps = useMemo(() => visibleSteps(draft), [draft]);
  const step = steps[Math.min(index, steps.length - 1)]!;
  const isLast = index >= steps.length - 1;

  if (!profile) return null;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const back = () => (index === 0 ? router.back() : setIndex((i) => i - 1));
  const next = () => setIndex((i) => Math.min(i + 1, steps.length - 1));

  const finish = () => {
    completeOnboarding(profile.id, {
      sex: draft.sex,
      birthDate: `${Number(draft.birthYear)}-06-15`,
      heightCm: Number(draft.heightCm),
      weightKg: Number(draft.weightKg),
      activityLevel: draft.activityLevel,
      goal: draft.goal,
      rateKgPerWeek: draft.goal === 'lose' ? -draft.rateKgPerWeek : draft.rateKgPerWeek,
      dietStyle: draft.dietStyle,
      allergens: draft.allergens,
      maxPrepMinutes: draft.maxPrepMinutes,
      equipment: draft.equipment,
    });
    refresh();
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + theme.spacing.sm }}>
        <ProgressRail steps={steps.length} current={index} onBack={back} />

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.xl,
            paddingBottom: theme.spacing.xxl,
            gap: theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Illustration name={step.art} height={140} />

          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="display">{step.title}</Text>
            {step.help ? (
              <Text variant="caption" tone="muted">
                {step.help}
              </Text>
            ) : null}
          </View>

          <StepBody step={step.id} draft={draft} set={set} />
        </ScrollView>

        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: insets.bottom + theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.palette.hairline,
            backgroundColor: theme.palette.surface,
          }}
        >
          <Button
            label={isLast ? 'Start logging' : 'Continue'}
            onPress={isLast ? finish : next}
            disabled={!canAdvance(step.id, draft)}
            block
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Progress as a row of segments rather than a percentage bar.
 *
 * Discrete marks answer "how many more?" — the question people actually have —
 * where a continuous bar only answers "roughly how far?".
 */
function ProgressRail({
  steps,
  current,
  onBack,
}: {
  steps: number;
  current: number;
  onBack: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={12}
        style={{
          width: MIN_TAP_TARGET,
          height: MIN_TAP_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="heading" tone="secondary">
          ‹
        </Text>
      </Pressable>

      <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: steps }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor:
                i < current
                  ? theme.palette.celesteInk
                  : i === current
                    ? theme.palette.sun
                    : theme.palette.surfaceSunken,
            }}
          />
        ))}
      </View>

      <Text variant="eyebrow" tone="muted">
        {current + 1}/{steps}
      </Text>
    </View>
  );
}

function StepBody({
  step,
  draft,
  set,
}: {
  step: StepId;
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const theme = useTheme();

  switch (step) {
    case 'goal':
      return (
        <View style={{ gap: theme.spacing.sm }}>
          {GOAL_OPTIONS.map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              blurb={option.blurb}
              selected={draft.goal === option.value}
              onPress={() => {
                set('goal', option.value);
                set('rateKgPerWeek', Math.abs(option.rate));
              }}
            />
          ))}
        </View>
      );

    case 'rate':
      return (
        <View style={{ gap: theme.spacing.sm }}>
          {RATE_OPTIONS.map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              blurb={option.blurb}
              selected={draft.rateKgPerWeek === option.value}
              onPress={() => set('rateKgPerWeek', option.value)}
            />
          ))}
        </View>
      );

    case 'body':
      return (
        <View style={{ gap: theme.spacing.xl }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <MeasureField
              label="Height"
              value={draft.heightCm}
              onChange={(v) => set('heightCm', v)}
              unit="cm"
              placeholder="175"
              autoFocus
            />
            <MeasureField
              label="Weight"
              value={draft.weightKg}
              onChange={(v) => set('weightKg', v)}
              unit="kg"
              placeholder="70"
            />
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="eyebrow" tone="muted">
              Sex
            </Text>
            <Segmented
              options={[
                { value: 'female' as const, label: 'Female' },
                { value: 'male' as const, label: 'Male' },
                { value: 'unspecified' as const, label: 'Rather not' },
              ]}
              value={draft.sex}
              onChange={(v) => set('sex', v)}
            />

          </View>
        </View>
      );

    case 'birth':
      return (
        <View style={{ flexDirection: 'row' }}>
          <MeasureField
            label="Year of birth"
            value={draft.birthYear}
            onChange={(v) => set('birthYear', v)}
            unit=""
            placeholder="1995"
            autoFocus
          />
        </View>
      );

    case 'activity':
      return (
        <View style={{ gap: theme.spacing.sm }}>
          {ACTIVITY_OPTIONS.map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              blurb={option.blurb}
              selected={draft.activityLevel === option.value}
              onPress={() => set('activityLevel', option.value)}
            />
          ))}
        </View>
      );

    case 'diet':
      return (
        <TileGrid>
          {DIET_OPTIONS.map((option) => (
            <ToggleTile
              key={option.value}
              label={option.label}
              selected={draft.dietStyle === option.value}
              onPress={() => set('dietStyle', option.value)}
            />
          ))}
        </TileGrid>
      );

    case 'allergens':
      return (
        <View style={{ gap: theme.spacing.md }}>
          <TileGrid>
            {ALLERGEN_OPTIONS.map((option) => {
              const on = draft.allergens.includes(option.value);
              return (
                <ToggleTile
                  key={option.value}
                  label={option.label}
                  selected={on}
                  onPress={() =>
                    set(
                      'allergens',
                      on
                        ? draft.allergens.filter((a) => a !== option.value)
                        : [...draft.allergens, option.value],
                    )
                  }
                />
              );
            })}
          </TileGrid>

        </View>
      );

    case 'kitchen':
      return (
        <View style={{ gap: theme.spacing.xl }}>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="eyebrow" tone="muted">
              What you can cook with
            </Text>
            <TileGrid>
              {EQUIPMENT_OPTIONS.map((option) => {
                const on = draft.equipment.includes(option.value);
                return (
                  <ToggleTile
                    key={option.value}
                    label={option.label}
                    selected={on}
                    onPress={() =>
                      set(
                        'equipment',
                        on
                          ? draft.equipment.filter((e) => e !== option.value)
                          : [...draft.equipment, option.value],
                      )
                    }
                  />
                );
              })}
            </TileGrid>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="eyebrow" tone="muted">
              Time you want to spend on a weeknight
            </Text>
            <TileGrid>
              {PREP_TIME_OPTIONS.map((option) => (
                <ToggleTile
                  key={option.value}
                  label={option.label}
                  selected={draft.maxPrepMinutes === option.value}
                  onPress={() => set('maxPrepMinutes', option.value)}
                />
              ))}
            </TileGrid>
          </View>
        </View>
      );

    case 'review':
      return <Review draft={draft} />;
  }
}

/**
 * The payoff screen.
 *
 * Shows the computed targets *and* says plainly that they are a starting
 * estimate the app will correct. Setting that expectation now is what stops the
 * first weekly adjustment from reading as the app changing its mind.
 */
function Review({ draft }: { draft: Draft }) {
  const theme = useTheme();

  const weight = Number(draft.weightKg);
  const targets = computeTargets({
    expenditureKcal: baselineExpenditure({
      sex: draft.sex,
      ageYears: new Date().getFullYear() - Number(draft.birthYear),
      heightCm: Number(draft.heightCm),
      weightKg: weight,
      activityLevel: draft.activityLevel,
    }),
    weightKg: weight,
    goal: draft.goal,
    rateKgPerWeek: draft.goal === 'lose' ? -draft.rateKgPerWeek : draft.rateKgPerWeek,
    dietStyle: draft.dietStyle,
  });

  const macros = [
    { label: 'Protein', value: targets.proteinG, color: theme.palette.macro.protein },
    { label: 'Carbs', value: targets.carbsG, color: theme.palette.macro.carbs },
    { label: 'Fat', value: targets.fatG, color: theme.palette.macro.fat },
  ];

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Ticket label="Daily target">
        <View style={{ alignItems: 'flex-start', gap: 2 }}>
          <Text variant="hero">{targets.energyKcal.toLocaleString()}</Text>
          <Text variant="eyebrow" tone="muted">
            kcal a day
          </Text>
        </View>

        <Divider />

        <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
          {macros.map((macro) => (
            <View key={macro.label} style={{ flex: 1, gap: 5 }}>
              <View style={{ height: 3, backgroundColor: macro.color }} />
              <Text variant="numericSmall">{macro.value} g</Text>
              <Text variant="eyebrow" tone="muted">
                {macro.label}
              </Text>
            </View>
          ))}
        </View>
      </Ticket>

      <Ticket rule={theme.palette.celeste} label="A starting point">
        <Text variant="caption" tone="secondary">
          Daylish adjusts this from your real data within a couple of weeks, and tells you why each
          time.
        </Text>
      </Ticket>
    </View>
  );
}
