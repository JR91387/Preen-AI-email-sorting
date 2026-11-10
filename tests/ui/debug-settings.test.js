// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The settings page's Debug section: on/off, the banner, count, export, clear,
// and the keep/delete choice when it's turned off.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, manifestVersion } from './page-env.js';
import { appendDebug, countDebug } from '../../apps/thunderbird/storage/activity-log.js';
import { ACTIVITY_UPDATED } from '../../packages/shared/core/protocol.js';

mock.timers.enable({ apis: ['setTimeout'] });
const KEY = 'sk-or-v1-page-SECRET-7781';
const { document, env } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
const listeners = [];
env.messenger.runtime.onMessage = { addListener: (f) => listeners.push(f) };
await env.messenger.storage.local.set({ settings: { apiKey: KEY } });
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type) => Promise.all((node.listeners[type] ?? []).map((fn) => fn({ target: node, preventDefault() {} })));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const stored = async () => (await env.messenger.storage.local.get('settings')).settings;
const toggle = async (on) => {
  $('debugEnabled').checked = on;
  await fire($('debugEnabled'), 'change');
  await settle();
};
const record = (request) => ({ at: new Date().toISOString(), entryId: 'r:1', request, response: '{"answers":{}}', status: 200, settings: { dryRun: true } });

test('debug is off by default: unticked, no banner, no records', async () => {
  await settle();
  assert.equal($('debugEnabled').checked, false);
  assert.equal($('debugBanner').hidden, true);
  assert.equal($('debugOffChoice').hidden, true);
  assert.match(text($('debugCount')), /No debug records/);
});

test('turning debug on saves at once (only that field) and shows the banner', async () => {
  await toggle(true);
  const s = await stored();
  assert.equal(s.debug.enabled, true);
  assert.equal('categories' in s, false, 'only debug.enabled is written');
  assert.equal($('debugBanner').hidden, false);
  assert.match(text($('debugBanner')), /full message text/i);
  assert.match(text($('debugBanner')), /this computer/i);
  assert.equal($('dirty').hidden, true, 'not an unsaved change');
});

test('Save keeps debug on', async () => {
  await fire($('settings'), 'submit');
  await settle();
  assert.equal((await stored()).debug.enabled, true);
});

test('the count follows new records; Export writes { preen, exported, records } with exact strings and no key', async () => {
  const request = '{"model":"jev","state":"Café \\"x\\""}';
  await appendDebug([record(request), record('{"b":1}')]);
  listeners.forEach((f) => f({ type: ACTIVITY_UPDATED }));
  for (let i = 0; i < 100 && !/^2 /.test(text($('debugCount'))); i++) await tick();
  assert.match(text($('debugCount')), /^2 debug records/, `listeners: ${listeners.length}`);
  const blobs = [];
  const create = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
  try {
    await fire($('exportDebug'), 'click');
  } finally {
    URL.createObjectURL = create;
  }
  assert.equal(blobs.length, 1);
  const raw = await blobs[0].text();
  const file = JSON.parse(raw);
  assert.deepEqual(Object.keys(file), ['preen', 'exported', 'records']);
  assert.equal(file.preen, manifestVersion);
  assert.match(file.exported, /Z$/);
  assert.equal(file.records[0].request, request);
  assert.equal(typeof file.records[0].response, 'string');
  assert.ok(!raw.includes(KEY), 'the API key never appears in the export');
});

test('turning debug off asks inline: Keep leaves the records', async () => {
  await toggle(false);
  assert.equal((await stored()).debug.enabled, false);
  assert.equal($('debugBanner').hidden, true);
  assert.equal($('debugOffChoice').hidden, false);
  await fire($('debugKeep'), 'click');
  await settle();
  assert.equal($('debugOffChoice').hidden, true);
  assert.equal(await countDebug(), 2);
});

test('turning debug off asks inline: Delete removes the records', async () => {
  await toggle(true);
  assert.equal($('debugOffChoice').hidden, true);
  await toggle(false);
  await fire($('debugDelete'), 'click');
  await settle();
  assert.equal($('debugOffChoice').hidden, true);
  assert.equal(await countDebug(), 0);
  assert.match(text($('debugCount')), /No debug records/);
});

test('turning debug off with no records asks nothing; Clear debug log empties it', async () => {
  await toggle(true);
  await toggle(false);
  assert.equal($('debugOffChoice').hidden, true);
  await appendDebug([record('{}')]);
  await fire($('clearDebug'), 'click');
  await settle();
  assert.equal(await countDebug(), 0);
});
