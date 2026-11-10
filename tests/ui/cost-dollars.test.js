// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Cost in dollars on the settings page: per 100 / 1,000 emails from the history's average,
// why the monthly limit needs a price, and a starting limit the user adopts with a click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, waitFor } from './page-env.js';
import { appendEntries } from '../../apps/thunderbird/storage/activity-log.js';

const { document, env } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
await env.messenger.storage.local.set({ settings: { apiKey: 'k', pricePerMillionInputTokens: 1 } });
const at = new Date().toISOString();
// Two messages of 1,000 input tokens each.
await appendEntries([1, 2].map(() => ({ at, scores: {}, inputTokens: 1000, category: 'Work', tags: [] })));
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type) => Promise.all((node.listeners[type] ?? []).map((fn) => fn({ target: node, preventDefault() {} })));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
await waitFor(() => !$('costExamples').hidden);
await settle();

test('dollars per 100 and per 1,000 emails come from price × the history average', () => {
  const t = text($('costExamples'));
  assert.match(t, /about \$0\.10 per 100 emails/);
  assert.match(t, /\$1\.00 per 1,000 emails/);
  assert.match(t, /about 1k tokens per email/);
});

test('the dollars follow the price box; without a price they are hidden and the lock explains', async () => {
  $('price').value = '2';
  await fire($('price'), 'input');
  assert.match(text($('costExamples')), /\$0\.20 per 100 emails/);
  $('price').value = '';
  await fire($('price'), 'input');
  assert.equal($('costExamples').hidden, true);
  assert.equal($('monthlyCostLock').hidden, false);
  assert.match(text($('monthlyCostLock')), /needs a price/);
  assert.match(text($('monthlyCostLock')), /Test connection/);
  $('price').value = '1';
  await fire($('price'), 'input');
});

test('"Use $N" offers a starting monthly limit and only fills the box (nothing is saved)', async () => {
  assert.equal($('costSuggest').hidden, false);
  assert.equal(text($('costUse')), 'Use $1.00');
  assert.equal($('monthlyCost').value, '', 'not set on its own');
  await fire($('costUse'), 'click');
  assert.equal($('monthlyCost').value, '1');
  assert.equal($('dirty').hidden, false);
  assert.equal($('costSuggest').hidden, true, 'gone once a limit is in the box');
  assert.equal((await env.messenger.storage.local.get('settings')).settings.limits?.monthlyCostUsd ?? null, null);
});
