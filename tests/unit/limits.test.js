// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// No hard-coded caps: right-click runs take every chosen message (asking first
// above 100); the scheduler sizes come from the Speed's run size and the allowance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { CONFIRM_ABOVE, estimatedMonthCostUsd, needsConfirm, schedulerLimits } from '../../packages/shared/core/budget.js';
import { emptyUsage } from '../../packages/shared/core/budget.js';

test('a right-click run is only confirmed above 100 messages, never limited', () => {
  assert.equal(CONFIRM_ABOVE, 100);
  assert.equal(needsConfirm(100), false);
  assert.equal(needsConfirm(2279), true);
  assert.equal(mergeWithDefaults({}).limits.manualMax, undefined);
});

test('scheduler sizes are derived from the Speed\'s run size and the daily allowance', () => {
  assert.deepEqual(schedulerLimits(mergeWithDefaults({})), { perScan: 250, perNewMail: 250, queue: 500 });
  assert.deepEqual(
    schedulerLimits(mergeWithDefaults({ speed: 'off', limits: { dailyMessages: 0 } })),
    { perScan: 1000, perNewMail: 1000, queue: 1000 },
  );
  assert.equal(schedulerLimits(mergeWithDefaults({ limits: { dailyMessages: 5000 } })).queue, 5000);
});

test('the estimated monthly cost uses every counted token, and needs a price', () => {
  const usage = { ...emptyUsage(), monthTokens: 2_000_000, monthCostUsd: 0 };
  assert.equal(estimatedMonthCostUsd(usage, mergeWithDefaults({ pricePerMillionInputTokens: 0.05 })), 0.1);
  assert.equal(estimatedMonthCostUsd(usage, mergeWithDefaults({})), null);
});

test('a corrupted token counter never hides the cost limit or produces NaN', () => {
  const s = mergeWithDefaults({ pricePerMillionInputTokens: 1 });
  assert.equal(estimatedMonthCostUsd({ ...emptyUsage(), monthTokens: Number.NaN }, s), null);
  assert.equal(estimatedMonthCostUsd({ ...emptyUsage(), monthTokens: undefined }, s), null);
});
