// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// 0.0.13 settings page building blocks: the value line next to Low/Medium/High
// buttons, and collapsible sections that remember whether they were open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { LEVEL_GROUPS, LEVELS, applyLevel, valueText } from '../../packages/shared/core/levels.js';
import { reveal } from '../../apps/thunderbird/ui/shared/ui.js';

const fmt = (n) => Number(n).toLocaleString();
const dec = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
const words = (parts) => parts.map((p) => (Array.isArray(p) ? `[${p[0]}]` : p)).join('');

test('every level group describes its values, numbers marked for bold', () => {
  const s = mergeWithDefaults({});
  for (const group of Object.keys(LEVEL_GROUPS)) {
    const values = group === 'certainty' ? applyLevel('certainty', 'medium', {}) : s;
    const text = words(valueText(group, values));
    assert.match(text, /\[[^\]]+\]/, `${group}: ${text}`);
    for (const level of LEVELS) assert.ok(valueText(group, applyLevel(group, level, structuredClone(values))).length, `${group} ${level}`);
  }
});

test('value lines read naturally, including "no limit"', () => {
  const s = mergeWithDefaults({});
  assert.equal(words(valueText('allowance', s)), `Up to about [${fmt(500)}] emails a day`);
  const none = mergeWithDefaults({ limits: { dailyMessages: 0 } });
  assert.equal(words(valueText('allowance', none)), 'No limit on emails a day');
  assert.equal(words(valueText('realPerson', s)), `[${dec(0.7)}] on a 0–1 scale`);
  assert.equal(words(valueText('history', s)), '[90] days');
  assert.deepEqual(valueText('history', { history: { retentionDays: NaN } }), [], 'missing value: no line');
});

function fakeSection(id) {
  const listeners = {};
  return {
    id, open: false, tagName: 'DETAILS', parentElement: null,
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    toggle(open) { this.open = open; for (const fn of listeners.toggle ?? []) fn(); },
  };
}

test('reveal opens every collapsible row around an element', () => {
  const card = fakeSection('categories');
  const row = { tagName: 'DETAILS', open: false, parentElement: card };
  const input = { tagName: 'INPUT', parentElement: { tagName: 'DIV', parentElement: row } };
  reveal(input);
  assert.deepEqual([row.open, card.open], [true, true]);
});

test('a price that isn\'t a finite number gives no cost (instead of NaN or Infinity)', async () => {
  const { costFromUsage } = await import('../../packages/shared/core/cost.js');
  assert.equal(costFromUsage({ input_tokens: 1000 }, Infinity), null);
  assert.equal(costFromUsage({ input_tokens: 1000 }, NaN), null);
  assert.deepEqual(costFromUsage({ input_tokens: 1e6 }, 0.042), { usd: 0.042, source: 'user price' });
});

test('Custom allowance: a value as a share of High (#8, P9)', async () => {
  const { percentOfHigh, applyLevel, levelOf } = await import('../../packages/shared/core/levels.js');
  assert.equal(percentOfHigh('allowance', 'limits.dailyMessages', 3000), 150);
  assert.equal(percentOfHigh('allowance', 'limits.dailyMessages', 1), 0.05, 'not rounded here: the page says "less than 1%"');
  assert.equal(percentOfHigh('allowance', 'limits.dailyMessages', -5), null);
  assert.throws(() => percentOfHigh('allowance', 'limits.nope', 5), /No field/);
  assert.equal(percentOfHigh('allowance', 'limits.dailyMessages', 0), null, 'no limit');
  const v = applyLevel('allowance', 'medium', {});
  assert.equal(levelOf('allowance', v), 'medium');
  v.limits.dailyMessages = 50;
  assert.equal(levelOf('allowance', v), 'custom');
});

test('skipSummary: messages skipped at a limit are counted and explained; a full run gives nothing (#20)', async () => {
  const { skipSummary } = await import('../../packages/shared/core/run-summary.js');
  assert.equal(skipSummary([{ tags: [] }, { tags: [] }]), null);
  assert.equal(skipSummary([]), null);
  const s = skipSummary([
    { tags: [] },
    { skipped: 'limit reached', limitReason: 'Daily limit of 500 messages reached' },
    { skipped: 'limit reached', limitReason: 'Daily limit of 500 messages reached' },
    { skipped: 'stopped by you' },
  ]);
  assert.deepEqual({ count: s.count, total: s.total }, { count: 2, total: 4 });
  assert.equal(s.text, '2 of 4 messages were not processed. Daily limit of 500 messages reached');
  assert.equal(s.kind, 'limit');
  // A run that stopped after an error (e.g. a rejected key) is not silent either.
  const e = skipSummary([
    { error: { kind: 'auth', message: 'Invalid API key' } },
    { skipped: 'stopped after an earlier error' },
    { skipped: 'stopped after an earlier error' },
  ]);
  assert.equal(e.kind, 'error');
  assert.equal(e.text, '2 of 3 messages were not processed. Preen stopped after an error: Invalid API key');
  // Unreadable mail and the user's own Stop are not "left undone".
  assert.equal(skipSummary([{ skipped: 'encrypted' }, { skipped: 'stopped by you' }]), null);
});

test('monthly summary: a message kept from the AI counts as a message but not as one with a known cost', async () => {
  const { emptySummary, addToSummary } = await import('../../packages/shared/core/history.js');
  const s = emptySummary('2026-10');
  addToSummary(s, { scores: {}, passes: [], costUsd: 0, inputTokens: 0, category: null, tags: [], sensitive: true });
  addToSummary(s, { scores: { junk: 0.1 }, passes: [{ kind: 'full' }], costUsd: 0.0001, inputTokens: 700, category: 'Work', tags: [] });
  assert.equal(s.messages, 2);
  assert.equal(s.costKnownMessages, 1);
});
