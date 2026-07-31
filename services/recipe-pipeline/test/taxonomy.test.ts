import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlan,
  MAX_DISHES_PER_CELL,
  planTotal,
  RECIPES_PER_DISH,
} from '../src/taxonomy.ts';

describe('buildPlan', () => {
  /**
   * Regression: rounding each cell's share independently lost ~18% of the
   * target across ~300 cells (500 requested, 408 planned), because every cell
   * below half a recipe rounded to zero. Largest-remainder apportionment fixes it.
   */
  test('plans close to the requested total', () => {
    for (const target of [100, 250, 500]) {
      const total = planTotal(buildPlan(target));
      assert.ok(
        Math.abs(total - target) <= target * 0.01,
        `asked for ${target}, planned ${total}`,
      );
    }
  });

  /**
   * A cell's count is *dishes*, and each one is written three times. The
   * response schema caps out at 10 recipes, so 4 dishes would be 12 and the
   * whole request would come back failing validation.
   */
  test('never asks a single request for more recipes than the batch schema allows', () => {
    for (const cell of buildPlan(500)) {
      assert.ok(cell.count > 0, `cell count ${cell.count} out of range`);
      assert.ok(
        cell.count <= MAX_DISHES_PER_CELL,
        `cell asks for ${cell.count} dishes`,
      );
      assert.ok(
        cell.count * RECIPES_PER_DISH <= 10,
        `cell would return ${cell.count * RECIPES_PER_DISH} recipes, over the schema cap`,
      );
    }
  });

  test('is deterministic, so reruns request the same distribution', () => {
    assert.deepEqual(buildPlan(500), buildPlan(500));
  });

  test('covers every meal slot — Daylish is a whole-day app, not a dinner app', () => {
    const slots = new Set(buildPlan(500).map((c) => c.mealSlot));
    assert.ok(slots.has('breakfast'));
    assert.ok(slots.has('lunch'));
    assert.ok(slots.has('dinner'));
    assert.ok(slots.has('snack'));
  });

  test('is not dominated by any one cuisine', () => {
    const plan = buildPlan(500);
    const total = planTotal(plan);
    const byCuisine = new Map<string, number>();
    for (const cell of plan) {
      byCuisine.set(cell.cuisine, (byCuisine.get(cell.cuisine) ?? 0) + cell.count);
    }
    const largest = Math.max(...byCuisine.values());
    assert.ok(largest / total < 0.15, `one cuisine took ${((largest / total) * 100).toFixed(0)}%`);
    assert.ok(byCuisine.size >= 15, `only ${byCuisine.size} cuisines represented`);
  });
});
