// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Debug → "Send messages to the Preen developer": only while debug is on, corrected
// messages first, exact preview, confirm naming the count, nothing sent while there is no server.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, waitFor } from './page-env.js';
import { appendEntries, appendDebug } from '../../apps/thunderbird/storage/activity-log.js';
import { debugSubmission, sendSubmission, submissionRows, SUBMIT_URL } from '../../packages/shared/core/debug.js';

mock.timers.enable({ apis: ['setTimeout'] });
const KEY = 'sk-DBG-KEY-4242';
const { document, env } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
let fetched = 0;
globalThis.fetch = async () => { fetched++; return new Response(null, { status: 204 }); };
await env.messenger.storage.local.set({
  settings: {
    apiKey: KEY, personalContext: 'ZZCTX me', debug: { enabled: false },
    scope: { accounts: { a1: { enabled: true, folders: 'inbox', note: 'ZZNOTE' } } },
  },
});
const t = (min) => new Date(Date.UTC(2026, 9, 20, 10, min)).toISOString();
await appendEntries([
  { at: t(0), debugId: 'run1:1', headerMessageId: 'm1@ZZHOST', subject: 'Older corrected', tags: ['Preen/To-do', 'Work'], scores: {}, category: 'Work' },
  { at: t(5), debugId: 'run1:2', headerMessageId: 'm2@ZZHOST', subject: 'Newer plain', tags: ['Bills'], scores: {}, category: 'Bills' },
  { at: t(9), headerMessageId: 'm1@ZZHOST', subject: 'Older corrected', correction: { key: 'preen_to_do', tag: 'Preen/To-do', change: 'removed', score: 0.66 } },
]);
const rec = (entryId, request) => ({
  at: t(1), entryId, key: entryId === 'run1:1' ? 'm1@ZZHOST' : 'm2@ZZHOST', provider: 'openrouter', status: 200, ms: 120, model: 'jev',
  request, response: '{"answers":{"category":{"choice":"Work"}}}', error: null,
  decision: { category: 'Work', tags: ['Preen/To-do', 'Work'], review: false, junk: false, actions: [] },
  settings: { personalContext: 'ZZCTX me', scope: { accounts: { a1: {} } } },
});
await appendDebug([rec('run1:1', `{"model":"jev","state":"text","oops":"${KEY}"}`), rec('run1:2', '{"model":"jev","state":"bill"}')]);
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type) => Promise.all((node.listeners[type] ?? []).map((fn) => fn({ target: node, preventDefault() {} })));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const boxes = () => [...$('debugList').querySelectorAll('input')];
await waitFor(() => $('setupCount').textContent !== '');
await settle();

test('hidden while debug is off', () => {
  assert.equal($('debugSubmit').hidden, true);
});

test('debug on: the list shows corrected messages first, with date, tags before/after and subject', async () => {
  $('debugEnabled').checked = true;
  await fire($('debugEnabled'), 'change');
  await settle();
  assert.equal($('debugSubmit').hidden, false);
  const rows = [...$('debugList').querySelectorAll('label.debug-row')];
  assert.equal(rows.length, 2);
  assert.match(text(rows[0]), /Older corrected/);
  assert.match(text(rows[0]), /Tags: Preen\/To-do, Work → your correction: Work/);
  assert.match(text(rows[1]), /Newer plain/);
  assert.equal(boxes().every((b) => !b.checked), true, 'nothing ticked to start');
});

test('ticking is not an unsaved setting; nothing chosen: Preview and Send only say so', async () => {
  await fire($('debugPreview'), 'click');
  await fire($('debugSend'), 'click');
  assert.equal($('dataDialog').getAttribute('open'), null);
  assert.match(text($('status')), /Tick at least one message/);
  boxes()[0].checked = true;
  await fire($('debugList'), 'change');
  assert.equal($('dirty').hidden, true);
  assert.equal(text($('debugChosen')), '1 message chosen.');
});

test('Preview shows the exact payload: request, answer, decision, correction; no key, account, ids or settings', async () => {
  await fire($('debugPreview'), 'click');
  await settle();
  assert.equal($('dataDialog').getAttribute('open'), '');
  const json = $('dataJson').textContent;
  const shown = JSON.parse(json);
  const rows = submissionRows(
    [{ at: t(0), debugId: 'run1:1', headerMessageId: 'm1@ZZHOST', tags: ['Preen/To-do', 'Work'] },
      { at: t(9), headerMessageId: 'm1@ZZHOST', correction: { tag: 'Preen/To-do', change: 'removed', score: 0.66 } }],
    [rec('run1:1', `{"model":"jev","state":"text","oops":"${KEY}"}`)],
  );
  assert.deepEqual(shown.messages, debugSubmission(rows, { version: shown.preen, apiKey: KEY }).messages);
  assert.equal(shown.messages.length, 1);
  const m = shown.messages[0];
  assert.equal(m.exchanges[0].response, '{"answers":{"category":{"choice":"Work"}}}');
  assert.equal(m.decision.category, 'Work');
  assert.deepEqual(m.correction.changes, [{ tag: 'Preen/To-do', change: 'removed', score: 0.66 }]);
  assert.deepEqual(m.correction.after, ['Work']);
  for (const leak of [KEY, 'ZZCTX', 'ZZNOTE', 'ZZHOST', '"settings"', '"a1"', 'run1:', 'openrouter', '"provider"']) {
    assert.equal(json.includes(leak), false, leak);
  }
  assert.equal($('dataSend').hidden, true, 'a preview sends nothing');
  await fire($('dataClose'), 'click');
  assert.equal(fetched, 0);
});

test('Send asks first, naming the count; with no server it offers Save as file and never fetches', async () => {
  assert.equal(SUBMIT_URL, '');
  await fire($('debugSend'), 'click');
  await settle();
  assert.equal($('dataDialog').getAttribute('open'), '');
  assert.equal(text($('dataTitle')), 'Send 1 message to the Preen developer?');
  assert.match(text($('dataText')), /can't send this yet: no server is set up/);
  assert.equal($('dataSend').hidden, true);
  assert.equal($('dataSave').hidden, false);
  const blobs = [];
  const create = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
  try {
    await fire($('dataSave'), 'click');
  } finally {
    URL.createObjectURL = create;
  }
  assert.equal(blobs.length, 1);
  const saved = JSON.parse(await blobs[0].text());
  assert.equal(saved.format, 'preen-debug-submission');
  assert.equal(JSON.stringify(saved).includes(KEY), false);
  assert.equal($('dataDialog').getAttribute('open'), null);
  assert.equal(fetched, 0, 'nothing was fetched');
});

test('sendSubmission: empty URL never fetches; with a URL one HTTPS POST without credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); };
  assert.deepEqual(await sendSubmission({ a: 1 }, { fetchImpl }), { sent: false, reason: 'no server' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await sendSubmission({ a: 1 }, { url: 'https://dev.example/s', fetchImpl }), { sent: true, reason: null });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal((await sendSubmission({ a: 1 }, { url: 'http://dev.example/s', fetchImpl })).sent, false);
  assert.equal(calls.length, 1);
});

test('a message classified while Settings is open shows up without a reload (on return to the tab)', async () => {
  $('debugEnabled').checked = true;
  await fire($('debugEnabled'), 'change');
  await settle();
  const before = [...$('debugList').querySelectorAll('label.debug-row')].length;
  const countBefore = text($('debugCount'));
  await appendEntries([{ at: t(20), debugId: 'run2:3', headerMessageId: 'm3@ZZHOST', subject: 'Arrived while open', tags: [], scores: {}, category: 'Work' }]);
  await appendDebug([rec('run2:3', '{"model":"jev","state":"new"}')]);
  document.visibilityState = 'visible';
  await fire(document, 'visibilitychange');
  const count = () => $('debugList').querySelectorAll('label.debug-row').length;
  for (let i = 0; i < 200 && count() === before; i++) await tick();
  const rows = [...$('debugList').querySelectorAll('label.debug-row')];
  assert.equal(rows.length, before + 1);
  assert.ok(rows.some((r) => /Arrived while open/.test(text(r))));
  for (let i = 0; i < 200 && text($('debugCount')) === countBefore; i++) await tick();
  assert.notEqual(text($('debugCount')), countBefore, `the count above the list refreshes too (was "${countBefore}")`);
});
