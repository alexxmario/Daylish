import type { MealSlot } from '@daylish/core';

/**
 * Guess which meal someone is logging from the clock.
 *
 * Saves a tap on the overwhelming majority of logs, and is always overridable.
 * The boundaries are deliberately generous at the edges — late dinners are more
 * common than 4pm ones, so the evening window runs long.
 */
export function suggestMealSlot(at: Date = new Date()): MealSlot {
  const hour = at.getHours();
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 23) return 'dinner';
  // Mid-afternoon and the small hours both read as snacking rather than a meal.
  return 'snack';
}
