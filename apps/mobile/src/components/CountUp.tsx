import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { Text, type TextProps } from './Text.tsx';

export interface CountUpProps extends Omit<TextProps, 'children'> {
  value: number;
  /** Milliseconds for the whole run. Kept short — this is feedback, not a show. */
  duration?: number;
  /** Wraps the settled number, e.g. thousands separators. */
  format?: (value: number) => string;
}

/** Fast out, slow in. Movement is obvious immediately, then eases to rest. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * A number that travels to its new value instead of jumping.
 *
 * This is the payoff for logging: you scan a barcode and watch the calories left
 * come down. A number that simply swaps is a fact; a number that moves is a
 * consequence, and the difference is most of what makes the app feel alive.
 *
 * Driven from JS on `requestAnimationFrame` rather than by Reanimated, because
 * Reanimated animates *props* on the UI thread and text content is not a prop it
 * can drive without swapping the element for a TextInput. On one small isolated
 * component, a few dozen renders over half a second costs nothing — which is why
 * this is its own component rather than state on the ring.
 *
 * Respects Reduce Motion: with it on, the value is simply set. Someone who has
 * asked the system for less movement has asked this component too.
 */
export function CountUp({ value, duration = 520, format, ...text }: CountUpProps) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(value);

  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = from.current;
    if (start === value) return;

    const began = Date.now();
    const step = () => {
      const progress = Math.min(1, (Date.now() - began) / duration);
      const eased = easeOutCubic(progress);
      const next = Math.round(start + (value - start) * eased);

      setShown(next);

      if (progress < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        from.current = value;
        frame.current = null;
      }
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      // Whatever was on screen is the new starting point, so an interrupted run
      // continues from where it stopped rather than snapping back.
      from.current = shown;
    };
    // `shown` is deliberately excluded: including it would restart the animation
    // on every frame it sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduceMotion]);

  return <Text {...text}>{format ? format(shown) : String(shown)}</Text>;
}
