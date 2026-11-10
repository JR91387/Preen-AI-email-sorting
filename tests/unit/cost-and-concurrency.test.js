// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costFromUsage, costOfTokens, formatUsd, formatTokens, estimateTokens } from '../../packages/shared/core/cost.js';
import { mapWithConcurrency } from '../../packages/shared/core/concurrency.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('uses the provider-reported cost when present, even with a user price', () => {
  assert.deepEqual(costFromUsage({ input_tokens: 1000, cost: 0.0001 }, 5), { usd: 0.0001, source: 'provider' });
});

test('uses the user price when the provider reports no cost', () => {
  const c = costFromUsage({ input_tokens: 2_000_000 }, 0.5);
  assert.deepEqual(c, { usd: 1, source: 'user price' });
});

test('cost is unknown (null) without a reported cost or user price', () => {
  assert.equal(costFromUsage({ input_tokens: 1000 }), null);
  assert.equal(costFromUsage({ input_tokens: 1000 }, null), null);
  assert.equal(costFromUsage(undefined), null);
  assert.equal(costOfTokens(1000, null), null);
  assert.equal(costOfTokens(1_000_000, 2), 2);
});

test('no price is built into the add-on source', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    statSync(`${dir}/${d.name}`).isDirectory() ? walk(`${dir}/${d.name}`) : d.name.endsWith('.js') ? [`${dir}/${d.name}`] : []);
  for (const file of walk(fileURLToPath(new URL('../../apps/thunderbird', import.meta.url)))) {
    const code = readFileSync(file, 'utf8');
    assert.ok(!/0\.042|PER_MILLION_INPUT_TOKENS\s*=/.test(code), `hard-coded price in ${file}`);
  }
});

test('formatUsd and formatTokens', () => {
  assert.equal(formatUsd(null), '–');
  assert.equal(formatUsd(0), '$0');
  assert.equal(formatUsd(1.234), '$1.23');
  assert.equal(formatUsd(0.0000546), '$0.000055');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(12345), '12.3k');
  assert.equal(formatTokens(4_200_000), '4.2M');
  assert.equal(formatTokens(null), '?');
});

test('mapWithConcurrency keeps order and respects the limit', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithConcurrency([30, 10, 20, 5], 2, async (ms, i) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

test('mapWithConcurrency handles an empty list', async () => {
  assert.deepEqual(await mapWithConcurrency([], 2, async () => 1), []);
});

test('estimateTokens', () => {
  assert.equal(estimateTokens('x'.repeat(400)), 100);
  assert.equal(estimateTokens(''), 0);
});

test('negative provider cost and tokens count as 0', () => {
  assert.deepEqual(costFromUsage({ input_tokens: 10, cost: -1 }), { usd: 0, source: 'provider' });
  assert.deepEqual(costFromUsage({ input_tokens: -1000 }, 5), { usd: 0, source: 'user price' });
});
