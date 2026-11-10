// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// D134/D135 on the settings page: the corrections section counts them and shows a
// suggested level; Apply only fills the field (nothing is saved until Save).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick, setTimeout as sleep } from 'node:timers/promises';
import { setUpPage } from './page-env.js';
import { appendCorrections, clearLog, clearCorrections } from '../../apps/thunderbird/storage/activity-log.js';

const { document, env } = setUpPage('options/options');
const messageListeners = [];
env.messenger.runtime.onMessage = { addListener: (f) => messageListeners.push(f) };
await clearLog();
await clearCorrections();
// Ten Real person tags removed at scores just above the level.
await appendCorrections([0.71, 0.73, 0.75, 0.75, 0.77, 0.79, 0.71, 0.74, 0.76, 0.78]
  .map((score, i) => ({ at: `2026-10-0${1 + (i % 2)}T10:00:00Z`, correction: { key: 'preen_person', tag: 'Preen/Real person', change: 'removed', score } })));
await import('../../apps/thunderbird/ui/options/options.js');
for (let i = 0; i < 10; i++) await tick();
const $ = (id) => document.getElementById(id);
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

test('the corrections count and a Real person suggestion are shown', () => {
  assert.match(text($('correctionsCount')), /^10 corrections recorded since/);
  const row = $('suggestions').querySelector('[data-field="realPerson"]');
  assert.match(text(row), /Real person: you removed it 10×, added it 0× \(level 0\.7\)\. Suggested level 0\.8/);
});

test('Apply fills the Real person field and marks the page unsaved; storage is unchanged', async () => {
  const before = (await env.messenger.storage.local.get('settings')).settings?.thresholds?.toDo;
  const button = $('suggestions').querySelector('[data-field="realPerson"] button');
  for (const fn of button.listeners.click ?? []) fn({ target: button, preventDefault() {} });
  await tick();
  assert.equal($('tRealPerson').value, '0.8');
  assert.equal($('dirty').hidden, false, 'shown as an unsaved change');
  assert.equal((await env.messenger.storage.local.get('settings')).settings?.thresholds?.toDo, before);
  const mark = $('suggestions').querySelector('[data-field="realPerson"] .save-mark');
  assert.equal(mark.hidden, false, 'the "Not saved yet" mark sits beside Apply');
  assert.ok(mark.classList.contains('pending'));
});

test('the card updates while Settings stays open when a new correction is written', async () => {
  await appendCorrections([{ at: '2026-10-02T12:00:00Z', correction: { key: 'preen_person', tag: 'Preen/Real person', change: 'added', score: 0.5 } }]);
  for (const f of messageListeners) f({ type: 'preen-activity-updated' });
  await sleep(100); // the storage answers on later timer ticks, like a browser's database
  assert.match(text($('correctionsCount')), /^11 corrections recorded/);
});

