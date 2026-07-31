import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/index.tsx';
import { CountUp } from './CountUp.tsx';
import { Text } from './Text.tsx';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Long enough to read as movement, short enough not to delay the next tap. */
const SWEEP_MS = 620;

export interface CalorieRingProps {
  consumedKcal: number;
  targetKcal: number;
  size?: number;
  strokeWidth?: number;
}

/**
 * The "remaining today" dial.
 *
 * Deliberate choices:
 *
 * - **Counts down.** The centre number is what is *left*, because that is the
 *   question someone opens the app to answer.
 * - **Going over is not an error.** Past the target the arc completes and a
 *   thinner overshoot arc draws on top; the label switches to "over" in ordinary
 *   text. There is no red, and the palette has no alarm colour to reach for.
 * - **Never colour-alone.** The centre always carries the number and unit, and
 *   the whole dial is one accessibility node with a spoken summary.
 */
export function CalorieRing({
  consumedKcal,
  targetKcal,
  size = 156,
  strokeWidth = 10,
}: CalorieRingProps) {
  const theme = useTheme();

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const safeTarget = targetKcal > 0 ? targetKcal : 1;
  const rawProgress = consumedKcal / safeTarget;
  const progress = Math.max(0, Math.min(1, rawProgress));
  const overshoot = Math.max(0, Math.min(1, rawProgress - 1));

  const remaining = Math.round(targetKcal - consumedKcal);
  const isOver = remaining < 0;

  /**
   * The dial is a fixed circle, so the number fits the ring rather than the ring
   * accommodating the number.
   *
   * `hero` is 54pt in a heavy display face — about 33pt per glyph. Five
   * characters is roughly 167pt against a 156pt circle, so a four-figure target
   * with a thousands separator wrapped onto a second line. The separator is the
   * user's locale, not ours: "2,880" and "2.880" are both five characters, and
   * both have to fit.
   *
   * Stepping by glyph count rather than relying on `adjustsFontSizeToFit` alone
   * keeps the size identical on both platforms and across renders — automatic
   * shrinking is measured per-layout and drifts between similar values, which on
   * a number that ticks down all day would wobble visibly.
   */
  const label = Math.abs(remaining).toLocaleString();
  const heroScale = label.length <= 3 ? 1 : label.length === 4 ? 0.84 : label.length === 5 ? 0.7 : 0.58;
  const heroSize = Math.round(theme.typography.hero.fontSize * heroScale);

  /**
   * The arc sweeps to its new length rather than redrawing at it.
   *
   * Logging a meal is the app's central act, and this is where it lands: the
   * ring closes by the amount you just ate. Driven on the UI thread, so it stays
   * smooth while the journal below is still re-rendering its list.
   */
  const reduceMotion = useReducedMotion();
  const sweep = useSharedValue(progress);
  const overshootSweep = useSharedValue(overshoot);

  useEffect(() => {
    const config = { duration: SWEEP_MS, easing: Easing.out(Easing.cubic) };
    sweep.value = reduceMotion ? progress : withTiming(progress, config);
    overshootSweep.value = reduceMotion ? overshoot : withTiming(overshoot, config);
  }, [progress, overshoot, reduceMotion, sweep, overshootSweep]);

  const fillProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - sweep.value),
  }));
  const overshootProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - overshootSweep.value),
  }));

  const spoken = isOver
    ? `${Math.abs(remaining)} calories over your target of ${Math.round(targetKcal)}. ${Math.round(consumedKcal)} eaten.`
    : `${remaining} calories left of ${Math.round(targetKcal)}. ${Math.round(consumedKcal)} eaten.`;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={spoken}
      accessibilityValue={{ min: 0, max: Math.round(targetKcal), now: Math.round(consumedKcal) }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size}>
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.palette.ringTrack}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.palette.ringFill}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={circumference}
            animatedProps={fillProps}
            fill="none"
          />
          {overshoot > 0 && (
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={theme.palette.butter}
              strokeWidth={strokeWidth / 2}
              strokeLinecap="butt"
              strokeDasharray={circumference}
              animatedProps={overshootProps}
              fill="none"
            />
          )}
        </G>
      </Svg>

      <View
        style={{
          position: 'absolute',
          alignItems: 'center',
          // Bounded by the ring's inner diameter, so the number can never run
          // out under the stroke.
          width: size - strokeWidth * 3,
        }}
      >
        <CountUp
          value={Math.abs(remaining)}
          format={(n) => n.toLocaleString()}
          variant="hero"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontSize: heroSize, lineHeight: heroSize * 1.04 }}
        />
        <Text variant="eyebrow" tone="muted">
          kcal {isOver ? 'over' : 'left'}
        </Text>
      </View>
    </View>
  );
}
