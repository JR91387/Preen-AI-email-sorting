// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The Activity page while debug mode is on: the banner, and "View raw exchange"
// on rows that have a debug record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, waitFor } from './page-env.js';
import { appendEntries, appendDebug } from '../../apps/thunderbird/storage/activity-log.js';
import { ACTIVITY_UPDATED } from '../../packages/shared/core/protocol.js';

const { document, env } = setUpPage('activity/activity');
const REQUEST = '{"model":"jev","state":{"email":{"body":"Hello ☕ \\"there\\""}}}';
const RESPONSE = '{ "model": "jev",\n  "answers": {} }';
const row = (messageId, debugId) => ({
  at: new Date().toISOString(), runId: 'r', messageId, debugId, dryRun: true, runKind: 'preview', source: 'manual',
  subject: `Message ${messageId}`, from: 'a@example.org', tags: [], reasons: [], passes: [], scores: null,
});
await env.messenger.storage.local.set({ settings: { debug: { enabled: true } } });
await appendEntries([row(1, 'r:1'), row(2, undefined), row(3, 'r:3')]);
await appendDebug([{ at: new Date().toISOString(), entryId: 'r:1', status: 200, ms: 12, model: 'jev', request: REQUEST, response: RESPONSE }]);
const messageListeners = [];
env.messenger.runtime.onMessage = { addListener: (f) => messageListeners.push(f) };
await import('../../apps/thunderbird/ui/activity/activity.js');
await waitFor(() => document.getElementById('rows').children.length === 3 && document.getElementById('status').children.length > 0);
const $ = (id) => document.getElementById(id);
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

test('while debug is on, the banner says full message text is stored locally', () => {
  assert.equal($('debugBanner').hidden, false);
  assert.match(text($('debugBanner')), /full message text/i);
  assert.match(text($('debugBanner')), /this computer/i);
});

test('only a row with a debug record gets "View raw exchange", showing the stored strings exactly', () => {
  const raws = [...$('rows').querySelectorAll('details.raw')];
  assert.equal(raws.length, 1, 'rows without records (or with no debugId) get none');
  const [raw] = raws;
  assert.equal(text(raw.querySelector('summary')), 'View raw exchange');
  assert.equal(raw.querySelector('pre.raw-request').textContent, REQUEST);
  assert.equal(raw.querySelector('pre.raw-response').textContent, RESPONSE);
  assert.match(raw.textContent, /HTTP 200/);
});

test('turning debug off hides the banner', async () => {
  await env.messenger.storage.local.set({ settings: { debug: { enabled: false } } });
  env.storageChanged({ settings: { newValue: { debug: { enabled: false } } } });
  for (let i = 0; i < 100 && !$('debugBanner').hidden; i++) await tick();
  assert.equal($('debugBanner').hidden, true);
});

test('a failing debug-record read still renders the rows and is logged', async () => {
  const { IDBKeyRange } = globalThis;
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a);
  globalThis.IDBKeyRange = { bound() { throw new Error('read failed'); } };
  try {
    messageListeners.forEach((f) => f({ type: ACTIVITY_UPDATED }));
    await waitFor(() => warns.length > 0);
  } finally {
    globalThis.IDBKeyRange = IDBKeyRange;
    console.warn = warn;
  }
  assert.ok(warns.some((a) => String(a[0]).includes('debug record')));
  for (let i = 0; i < 10; i++) await tick();
  assert.equal($('rows').children.length, 3);
});
