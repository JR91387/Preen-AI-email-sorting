// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { enqueue } from '../../apps/thunderbird/storage/state.js';
import { setAutomationEnabled, readConsent } from '../../apps/thunderbird/storage/settings.js';

test('setAutomationEnabled writes only automation.enabled, leaving the rest as stored', async () => {
  const env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  await env.messenger.storage.local.set({ settings: { apiKey: 'k', automation: { enabled: false, maxPerRun: 7 } } });
  await Promise.all([setAutomationEnabled(true), env.messenger.storage.local.get('settings')]);
  assert.deepEqual(env.store.settings, { apiKey: 'k', automation: { enabled: true, maxPerRun: 7 } });
});

test('readConsent returns the stored consent in a single storage read, undefined when nothing is stored', async () => {
  const env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  assert.equal(await readConsent(), undefined);
  const consent = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };
  await env.messenger.storage.local.set({ settings: { apiKey: 'k', consent } });
  let reads = 0;
  const get = env.messenger.storage.local.get;
  env.messenger.storage.local.get = (...a) => { reads++; return get(...a); };
  assert.deepEqual(await readConsent(), consent);
  assert.equal(reads, 1);
});

test('enqueue counts only the items that survive the queue limit', async () => {
  const env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  const item = (n, date) => ({ headerMessageId: `m${n}`, accountId: 'a', folderPath: '/INBOX', date });
  assert.equal(await enqueue([item(1, '2026-03-01'), item(2, '2026-03-02')], 2), 2);
  assert.equal(await enqueue([item(3, '2026-01-01'), item(4, '2026-01-02')], 2), 0, 'older than everything queued: trimmed away');
  assert.equal(await enqueue([item(5, '2026-04-01')], 2), 1);
  assert.deepEqual(env.store.queue.map((q) => q.headerMessageId), ['m5', 'm2']);
});
