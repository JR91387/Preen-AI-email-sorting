// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The settings page's Statistics section: your own totals. Usage reports have no controls.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, waitForTick } from './page-env.js';
import { appendEntries, appendCorrections, readAll, readCorrections } from '../../apps/thunderbird/storage/activity-log.js';
import { previewReport, TELEMETRY_KEY } from '../../apps/thunderbird/storage/telemetry.js';
import { ACTIVITY_UPDATED } from '../../packages/shared/core/protocol.js';

mock.timers.enable({ apis: ['setTimeout'] });
const { document, env } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
// Keep the page's runtime-message listeners so a test can announce a history change, as the background does.
const announced = [];
env.messenger.runtime.onMessage = { addListener: (f) => announced.push(f) };
const announce = () => announced.forEach((f) => f({ type: ACTIVITY_UPDATED }));
const now = new Date();
const lastYear = new Date(now.getFullYear() - 1, 5, 15).toISOString();
await env.messenger.storage.local.set({
  settings: { apiKey: 'sk-STATS-KEY-1', personalContext: 'ZZSTATS context' },
  [TELEMETRY_KEY]: { firstSeen: Date.now() - 2 * 60 * 60 * 1000 },
});
const entry = (at, extra = {}) => ({ at, scores: {}, inputTokens: 1000, category: 'Work', tags: [], ...extra });
await appendEntries([entry(lastYear), entry(lastYear), entry(now.toISOString(), { category: 'Bills' }),
  { at: now.toISOString(), error: { kind: 'auth', message: 'ZZSTATSERR key refused' } },
  { at: lastYear, error: { kind: 'auth', message: 'ZZSTATSERR' } },
  entry(now.toISOString(), { decidedBy: 'full', provider: 'openrouter', passes: [{ ms: 1500 }], review: true, category: null }),
  { at: now.toISOString(), correction: { key: 'preen_bills', tag: 'Preen/Bills', change: 'removed', from: { category: 'Bills' } } }]);
const correction = { at: now.toISOString(), correction: { key: 'preen_needs_reply', tag: 'Needs reply', change: 'removed', score: 0.7, from: { category: 'Work' } } };
await appendCorrections([correction]);
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type) => Promise.all((node.listeners[type] ?? []).map((fn) => fn({ target: node, preventDefault() {} })));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const stored = async () => (await env.messenger.storage.local.get('settings')).settings;
await waitForTick(() => $('statsTotals').querySelectorAll('tr').length > 1);
await settle();

const row = (label) => [...[...$('statsTotals').querySelectorAll('tr')].find((tr) => text(tr).startsWith(label)).querySelectorAll('td')].map(text);

test('Statistics shows your totals: this month and all time, by category, since first use', () => {
  assert.deepEqual(row('Messages sorted'), ['2', '4']);
  assert.deepEqual(row('Tokens'), ['2k', '4k']);
  assert.deepEqual(row('Your tag corrections'), ['1', '1']);
  assert.match(text($('statsSince')), /Using Preen since/);
  assert.match(text($('statsSince')), /By category: Work 2, Bills 1/);
});

const groupRow = (title, label) => {
  const table = [...$('statsDetail').querySelectorAll('table')].find((t) => text(t.querySelector('caption')) === title);
  return [...[...table.querySelectorAll('tr')].find((tr) => text(tr).startsWith(label)).querySelectorAll('td')].map(text);
};

test('Statistics shows small tables of errors, corrections by tag, depth and response time; no error text', () => {
  const titles = [...$('statsDetail').querySelectorAll('caption')].map(text);
  assert.deepEqual(titles, ['Errors (messages)', 'Skipped or text not sent', 'Runs', 'Corrections by tag', 'Decided without a tag', 'Depth and undo', 'Response time']);
  assert.deepEqual(groupRow('Errors (messages)', 'API key refused'), ['1', '2']);
  assert.deepEqual(groupRow('Corrections by tag', 'Category tags'), ['1', '1']);
  assert.deepEqual(groupRow('Decided without a tag', 'Marked for review (no category)'), ['1', '1']);
  assert.deepEqual(groupRow('Depth and undo', 'Deep (with text)'), ['1', '1']);
  assert.deepEqual(groupRow('Response time', 'OpenRouter 1–2 s'), ['1', '1']);
  assert.equal(text($('statsDetail')).includes('TypeSafe'), false, 'providers with no timings are left out');
  assert.equal(text($('statsDetail')).includes('ZZSTATSERR'), false);
});

test('no usage-report controls or notice exist; nothing is stored as shared', () => {
  for (const id of ['telemetryEnabled', 'shareCategories', 'shareCategoriesRow', 'telemetryShow', 'telemetryNext', 'telemetryLast', 'telemetryNotice', 'noticeShow', 'noticeOff']) {
    assert.equal($(id), null, id);
  }
  assert.doesNotMatch(text(document.body), /anonymous usage statistics|Show what will be sent|Also share my category setup/i);
});

const headers = (table) => [...table.querySelectorAll('th')].filter((th) => th.parentNode.parentNode.tagName === 'THEAD').map(text);
const monthName = (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

test('column headers show the real month and where the totals start; no report column', () => {
  assert.deepEqual(headers($('statsTotals')), ['', monthName(now), `Since ${monthName(new Date(now.getFullYear() - 1, 5, 15))}`]);
  for (const table of $('statsDetail').querySelectorAll('table')) assert.deepEqual(headers(table), headers($('statsTotals')));
  assert.equal(text($('statsTotals')).includes('This month'), false);
  assert.equal(text($('statsTotals')).includes('All time'), false);
});

test('new activity updates the totals; a stored past report is never mentioned', async () => {
  const state = env.store[TELEMETRY_KEY];
  await env.messenger.storage.local.set({ [TELEMETRY_KEY]: { ...state, lastReport: { at: Date.now() - 86400000, totals: { messages: 1, tokens: 500, corrections: 9 } } } });
  await appendEntries([entry(now.toISOString())]);
  announce();
  await waitForTick(() => row('Messages sorted')[0] === '3');
  await settle();
  assert.deepEqual(row('Messages sorted'), ['3', '5']);
  assert.deepEqual(row('Tokens'), ['3k', '5k']);
  assert.doesNotMatch(text($('statsSince')), /report/i);
});

test('Reset my statistics asks first, naming what is kept; declining changes nothing', async () => {
  const pending = fire($('statsReset'), 'click');
  await waitForTick(() => $('preenDialog'));
  assert.match(text($('preenDialog')), /Reset your statistics\?.*activity log and your tag corrections are kept/);
  assert.match(text($('preenDialog')), /Until new mail is sorted, the cost per email .* is a rough guess/);
  await fire($('dialogNo'), 'click');
  await pending;
  assert.equal($('preenDialog'), null);
  assert.deepEqual(row('Messages sorted'), ['3', '5']);
});

test('Reset clears the monthly totals only: log and corrections stay, last report rebased', async () => {
  const logBefore = (await readAll()).length;
  const pending = fire($('statsReset'), 'click');
  await waitForTick(() => $('preenDialog'));
  await fire($('dialogYes'), 'click');
  await pending;
  await settle();
  assert.deepEqual(row('Messages sorted'), ['0', '0']);
  assert.deepEqual(row('Your tag corrections'), ['1', '1'], 'corrections kept');
  assert.equal((await readAll()).length, logBefore, 'activity log kept');
  assert.equal((await readCorrections()).length, 1);
  assert.match(text($('statsSince')), /Statistics reset/);
  assert.match(headers($('statsTotals'))[2], /^Since /);
  const kept = env.store[TELEMETRY_KEY].lastReport.totals;
  assert.equal(kept.messages, 0, 'rebased down to the new totals');
  assert.equal(kept.corrections, 1);
  // New activity after the reset counts in full toward the next report.
  await appendEntries([entry(now.toISOString())]);
  assert.equal((await previewReport()).period.messages, '1-10');
  announce();
});

test('Undo last run in Settings says so next to the button when nothing was applied', async () => {
  await fire($('undoLast'), 'click');
  assert.equal($('preenDialog'), null, 'nothing to ask about');
  assert.match(text($('undoNote')), /no applied changes to undo/);
});

test('Delete corrections asks in a Preen dialog; declining keeps them', async () => {
  let pending = fire($('clearCorrections'), 'click');
  await waitForTick(() => $('preenDialog'));
  assert.match(text($('preenDialog')), /Delete all recorded tag corrections\?/);
  await fire($('dialogNo'), 'click');
  await pending;
  assert.equal((await readCorrections()).length, 1);
  pending = fire($('clearCorrections'), 'click');
  await waitForTick(() => $('preenDialog'));
  await fire($('dialogYes'), 'click');
  await pending;
  assert.equal((await readCorrections()).length, 0);
});

test('Save stores usage reports as off, even over an older stored "on"', async () => {
  await env.messenger.storage.local.set({ settings: { ...(await stored()), telemetry: { enabled: true, shareCategories: true } } });
  await fire($('settings'), 'submit');
  await settle();
  assert.deepEqual((await stored()).telemetry, { enabled: false, shareCategories: false });
});
