// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Anonymous usage statistics: the allow-list, nothing identifying, ranges, deltas,
// the schedule, and nothing fetched while there is no server or while it is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { mergeWithDefaults, validateSettings, DEFAULT_SETTINGS, MAX_CATEGORIES, MAX_NAME_LENGTH, DESCRIPTION_LIMIT } from '../../packages/shared/core/settings-schema.js';
import { exportSettings, parseSettingsFile } from '../../packages/shared/core/settings-io.js';
import {
  buildReport, assertAllowed, collectTotals, nextReportAt, isDue, sendReport, range, countRange, costRange, levelRange,
  rebaseTotals, totalsToKeep, REPORT_SCHEMA, TELEMETRY_URL, NO_SERVER, REPORT_EVERY_MS, FIRST_REPORT_AFTER_MS,
} from '../../packages/shared/core/telemetry.js';
import {
  runTelemetry, configureTelemetryAlarm, readTelemetryState, TELEMETRY_ALARM, TELEMETRY_KEY,
} from '../../apps/thunderbird/storage/telemetry.js';
import { appendEntries, clearLog, clearCorrections } from '../../apps/thunderbird/storage/activity-log.js';

installIndexedDB();
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-26T12:00:00Z');

// A distinctive string in every free-text setting (and the account and folder ids).
const SECRET = {
  apiKey: 'sk-ZZKEY-0001', model: 'ZZMODEL-name', personalContext: 'ZZCONTEXT freelance', languages: 'ZZLANG-Klingon',
  catName: 'ZZCATNAME', catDesc: 'ZZCATDESC about', catExcl: 'ZZCATEXCL not', account: 'ZZACCOUNT-id', note: 'ZZNOTE text',
  folder: '/ZZFOLDER/path', depthAccount: 'ZZDEPTHACCT', consentAt: '2026-01-02T03:04:05.000Z',
};
const loud = mergeWithDefaults({
  apiKey: SECRET.apiKey,
  model: SECRET.model,
  personalContext: SECRET.personalContext,
  recipientLanguages: SECRET.languages,
  recipientLanguagesSet: true,
  pricePerMillionInputTokens: 0.25,
  categories: [{ name: SECRET.catName, description: SECRET.catDesc, excludes: SECRET.catExcl, threshold: 0.8, actions: { flag: true } }],
  scope: { accounts: { [SECRET.account]: { enabled: true, folders: 'selected', folderPaths: [SECRET.folder], type: 'work', note: SECRET.note } } },
  depth: { default: 'surface', accounts: { [SECRET.depthAccount]: 'deep' } },
  consent: { sendToProvider: SECRET.consentAt, provider: 'openrouter' },
});

const report = (over = {}) => buildReport({
  settings: loud, totals: { messages: 120, tokens: 250_000, costUsd: 0.4, corrections: 3 }, previous: null, firstSeen: NOW - DAY,
  version: '0.0.24', thunderbirdMajor: 140, now: NOW, ...over,
});

test('the report holds only allow-listed keys; anything else fails', () => {
  const r = report();
  assert.doesNotThrow(() => assertAllowed(r));
  assert.throws(() => assertAllowed({ ...r, installId: 'abc' }), /installId is not in the allow-list/);
  assert.throws(() => assertAllowed({ ...r, settings: { ...r.settings, apiKey: 'x' } }), /settings.apiKey is not in the allow-list/);
  assert.throws(() => assertAllowed({ ...r, settings: { ...r.settings, categories: { ...r.settings.categories, names: 'x' } } }), /not in the allow-list/);
  assert.throws(() => assertAllowed({ ...r, period: { ...r.period, messages: 120 } }), /must be a string/);
  assert.throws(() => assertAllowed({ ...r, preen: 'Hello World with spaces' }), /allowed form/);
});

test('no free-text setting, id, path or time appears in the report', () => {
  const json = JSON.stringify(report());
  for (const [what, value] of Object.entries(SECRET)) assert.equal(json.includes(value), false, `${what} leaked`);
  for (const word of ['ZZ', 'Newsletters', 'Receipts', 'openrouter.ai', 'T12:', 'consent']) assert.equal(json.includes(word), false, word);
  assert.doesNotMatch(json, /\d{4}-\d\d-\d\dT/);
  const r = report();
  assert.equal(r.reportDate, '2026-10-26');
  assert.equal(r.settings.model, 'custom');
  assert.equal(r.settings.price, 'set');
  assert.equal(r.settings.accounts.types.work, '1-2');
  assert.equal(r.settings.accounts.folders.selected, '1-2');
  assert.equal(r.settings.categories.withFlag, '1-2');
  assert.equal(r.settings.depthOverrides, '1-2');
});

test('numbers are sent as ranges', () => {
  assert.equal(range(0, [1, 10]), '0');
  assert.equal(countRange(1), '1-10');
  assert.equal(countRange(9), '1-10');
  assert.equal(countRange(120), '100-500');
  assert.equal(countRange(250_000), '100000+');
  assert.equal(costRange(0.004), '<0.01');
  assert.equal(costRange(0.4), '0.1-1');
  assert.equal(levelRange(0.75), '0.7-0.8');
  assert.equal(levelRange(1), '0.9-1.0');
  const r = report();
  assert.deepEqual([r.period.messages, r.period.tokens, r.period.costUsd, r.period.corrections], ['100-500', '100000-1000000', '0.1-1', '1-10']);
  assert.equal(r.settings.automation.intervalMinutes, '15-30');
  assert.equal(r.settings.limits.dailyMessages, '500-1000');
  const leaves = (o) => Object.values(o).flatMap((v) => (typeof v === 'object' ? leaves(v) : [v]));
  for (const v of leaves(r.period)) assert.equal(typeof v, 'string');
});

test('a report carries the change since the last report, never below 0', () => {
  const r = report({ previous: { at: NOW - 7 * DAY, totals: { messages: 115, tokens: 250_000, costUsd: 0, corrections: 9 } } });
  assert.equal(r.period.messages, '1-10');
  assert.equal(r.period.tokens, '0');
  assert.equal(r.period.corrections, '0', 'cleared corrections count as 0, not negative');
  assert.equal(r.periodDays, 7);
  assert.equal(report().periodDays, 1);
});

test('after a statistics reset the delta clamps at 0 (detail counters too) and rebasing counts new activity in full', () => {
  const big = collectTotals({ summaries: [{ month: '2026-09', messages: 50, tokens: 9000, errors: { auth: 4 }, undo: { runs: 2, messages: 7 } }], now: new Date('2026-10-05') }).allTime;
  const kept = totalsToKeep(big);
  const afterReset = collectTotals({ summaries: [], now: new Date('2026-10-06') }).allTime;
  const clamped = report({ totals: afterReset, previous: { at: NOW - DAY, totals: kept } });
  assert.equal(clamped.period.messages, '0');
  assert.equal(clamped.period.errors.auth, '0', 'exact-count group clamps too');
  assert.equal(clamped.period.undo.runs, '0');
  const rebased = rebaseTotals(kept, afterReset);
  assert.equal(rebased.messages, 0);
  assert.equal(rebased.errors.auth, 0);
  assert.equal(rebased.undo.messages, 0);
  // Counters that grew since the last report are left alone.
  assert.equal(rebaseTotals({ messages: 5 }, { messages: 8 }).messages, 5);
  const grown = collectTotals({ summaries: [{ month: '2026-10', messages: 3, errors: { auth: 1 } }], now: new Date('2026-10-07') }).allTime;
  const next = report({ totals: grown, previous: { at: NOW - DAY, totals: rebased } });
  assert.equal(next.period.messages, '1-10');
  assert.equal(next.period.errors.auth, '1');
});

test('collectTotals adds the monthly summaries and corrections', () => {
  const t = collectTotals({
    summaries: [
      { month: '2026-09', messages: 10, tokens: 100, costUsd: 0.1, applied: 4, person: 1, needsReply: 2, toDo: 0, junk: 1, byCategory: { Work: 6 } },
      { month: '2026-10', messages: 5, tokens: 50, costUsd: 0.05, applied: 5, byCategory: { Work: 1, Bills: 4 } },
    ],
    corrections: [{ at: '2026-09-03T00:00:00Z' }, { at: '2026-10-20T00:00:00Z' }],
    now: new Date(NOW),
  });
  assert.equal(t.allTime.messages, 15);
  assert.equal(t.thisMonth.messages, 5);
  assert.equal(t.allTime.corrections, 2);
  assert.equal(t.thisMonth.corrections, 1);
  assert.deepEqual(t.categories, { Work: 7, Bills: 4 });
  assert.equal(t.since, '2026-09');
});

test('schedule: first report 24 h after first run, then every 7 days', () => {
  assert.equal(nextReportAt({}), null);
  assert.equal(nextReportAt({ firstSeen: NOW }), NOW + FIRST_REPORT_AFTER_MS);
  assert.equal(FIRST_REPORT_AFTER_MS, DAY);
  assert.equal(REPORT_EVERY_MS, 7 * DAY);
  assert.equal(isDue({ firstSeen: NOW }, NOW + DAY - 1), false);
  assert.equal(isDue({ firstSeen: NOW }, NOW + DAY), true);
  assert.equal(nextReportAt({ firstSeen: NOW, lastReport: { at: NOW + DAY } }), NOW + 8 * DAY);
});

test('settings: telemetry is off by default, validated, and follows export and import', () => {
  assert.deepEqual(DEFAULT_SETTINGS.telemetry, { enabled: false, shareCategories: false });
  assert.equal(mergeWithDefaults({}).telemetry.enabled, false);
  assert.equal(mergeWithDefaults({ telemetry: { enabled: true } }).telemetry.enabled, true);
  const bad = mergeWithDefaults({ telemetry: { enabled: 'yes' } });
  assert.equal(validateSettings(bad).ok, false);
  const off = mergeWithDefaults({ telemetry: { enabled: false } });
  const file = JSON.stringify(exportSettings(off));
  assert.equal(parseSettingsFile(file, mergeWithDefaults({}), []).settings.telemetry.enabled, false);
});

// --- Optional category setup (separate opt-in) -------------------------------------

const withShare = (over = {}) => mergeWithDefaults({ telemetry: { enabled: true, shareCategories: true }, ...over });
const setupReport = (settings) => buildReport({ settings, totals: {}, previous: null, firstSeen: NOW - DAY, version: '0.0.29', thunderbirdMajor: 140, now: NOW });

test('category setup: off by default, validated as on/off, and the report schema is 2', () => {
  assert.equal(REPORT_SCHEMA, 2);
  assert.equal(DEFAULT_SETTINGS.telemetry.shareCategories, false);
  assert.equal(mergeWithDefaults({ telemetry: { enabled: true } }).telemetry.shareCategories, false);
  assert.equal(validateSettings(mergeWithDefaults({ telemetry: { enabled: true, shareCategories: 'yes' } })).ok, false);
  assert.equal(validateSettings(withShare()).ok, true);
  const file = JSON.stringify(exportSettings(withShare()));
  assert.equal(parseSettingsFile(file, mergeWithDefaults({}), []).settings.telemetry.shareCategories, true);
});

test('category setup: opt-in off sends no categorySetup and no category text', () => {
  const r = setupReport(mergeWithDefaults({ telemetry: { enabled: true, shareCategories: false } }));
  assert.equal('categorySetup' in r, false);
  assert.equal(JSON.stringify(r).includes('Personal'), false);
});

test('category setup: on while statistics are off adds nothing', () => {
  const r = setupReport(mergeWithDefaults({ telemetry: { enabled: false, shareCategories: true } }));
  assert.equal('categorySetup' in r, false);
});

test('category setup: statistics off builds and sends nothing, whatever the opt-in', async () => {
  await setup({ telemetry: { enabled: false, shareCategories: true } }, { firstSeen: NOW - 8 * DAY });
  await runTelemetry({ now: NOW, fetchImpl: failFetch, url: 'https://example.test/r' });
  assert.equal((await readTelemetryState()).lastReport, undefined);
});

test('category setup: on gives exactly the block, with defaults removed and edited', () => {
  const [personal, work] = DEFAULT_SETTINGS.categories;
  const r = setupReport(withShare({
    categories: [
      { ...personal, description: 'My own words for personal mail' },
      { ...work },
      { name: 'Pets', description: 'Vet and pet shop mail', excludes: 'Pet insurance', threshold: 0.9, noToDo: true, actions: { flag: true, markUnread: false } },
    ],
  }));
  assert.deepEqual(r.categorySetup, {
    sortOn: true,
    categories: [
      { name: 'Personal', description: 'My own words for personal mail', excludes: personal.excludes, actions: { flag: false, markUnread: false }, noToDo: false },
      { name: 'Work', description: work.description, excludes: work.excludes, actions: { flag: false, markUnread: false }, noToDo: false },
      { name: 'Pets', description: 'Vet and pet shop mail', excludes: 'Pet insurance', actions: { flag: true, markUnread: false }, noToDo: true, threshold: 0.9 },
    ],
    defaultsRemoved: ['Bills', 'Codes'],
    defaultsEdited: ['Personal'],
  });
  assert.doesNotThrow(() => assertAllowed(r));
  const json = JSON.stringify(r);
  for (const word of ['apiKey', 'personalContext', 'note', 'senderRules']) assert.equal(json.includes(word), false, word);
});

test('category setup: nothing but the setup is added; personal context, notes and the key stay out', () => {
  const r = setupReport(withShare({ apiKey: SECRET.apiKey, personalContext: SECRET.personalContext, model: SECRET.model,
    scope: { accounts: { [SECRET.account]: { enabled: true, folders: 'inbox', note: SECRET.note } } } }));
  assert.deepEqual(Object.keys(r.categorySetup), ['sortOn', 'categories', 'defaultsRemoved', 'defaultsEdited']);
  const json = JSON.stringify(r);
  for (const [what, value] of Object.entries(SECRET)) assert.equal(json.includes(value), false, `${what} leaked`);
});

test('category setup: texts are cut at the schema limits and the list at 20', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `Cat ${i}`, description: 'd'.repeat(300), excludes: 'e'.repeat(300) }));
  many[0].name = 'n'.repeat(90);
  const r = setupReport(withShare({ categories: many }));
  assert.equal(r.categorySetup.categories.length, MAX_CATEGORIES);
  assert.equal(r.categorySetup.categories[0].name.length, MAX_NAME_LENGTH);
  assert.equal(r.categorySetup.categories[1].description.length, DESCRIPTION_LIMIT);
  assert.equal(r.categorySetup.categories[1].excludes.length, DESCRIPTION_LIMIT);
  assert.doesNotThrow(() => assertAllowed(r));
});

test('category setup: assertAllowed rejects unexpected fields, wrong types and too much text inside it', () => {
  const r = setupReport(withShare());
  const bad = (change) => ({ ...r, categorySetup: { ...r.categorySetup, ...change } });
  const cat = r.categorySetup.categories[0];
  const withCat = (extra) => bad({ categories: [{ ...cat, ...extra }] });
  assert.throws(() => assertAllowed(withCat({ notes: 'x' })), /categories\[0\]\.notes is not in the allow-list/);
  assert.throws(() => assertAllowed(withCat({ actions: { ...cat.actions, move: true } })), /actions\.move is not in the allow-list/);
  assert.throws(() => assertAllowed(withCat({ noToDo: 'no' })), /must be a boolean/);
  assert.throws(() => assertAllowed(withCat({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) })), /longer than/);
  assert.throws(() => assertAllowed(withCat({ description: 5 })), /must be a string/);
  assert.throws(() => assertAllowed(bad({ sender: 'a@b.c' })), /categorySetup.sender is not in the allow-list/);
  assert.throws(() => assertAllowed(bad({ defaultsRemoved: 'Bills' })), /must be a list/);
  assert.throws(() => assertAllowed(bad({ defaultsRemoved: [5] })), /must be a string/);
  assert.throws(() => assertAllowed(bad({ categories: Array(MAX_CATEGORIES + 1).fill(cat) })), /more than/);
  assert.throws(() => assertAllowed({ ...r, categorySetup: [] }), /must be an object/);
});

// --- Background: the alarm, building and sending ------------------------------------

let env;
// The report code is exercised with reports switched on; the shipped default is off.
const ON = { telemetry: { enabled: true, shareCategories: false } };
async function setup(settings = {}, state = undefined) {
  env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  await clearLog();
  await clearCorrections();
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ ...ON, ...settings }) });
  if (state) await env.messenger.storage.local.set({ [TELEMETRY_KEY]: state });
}
const failFetch = () => assert.fail('fetch must not be called');

test('there is no server yet: the URL is empty and nothing is fetched, the report is still built', async () => {
  assert.equal(TELEMETRY_URL, '');
  let calls = 0;
  const counting = async () => { calls++; return new Response(null, { status: 204 }); };
  assert.deepEqual(await sendReport(report(), { fetchImpl: counting }), { sent: false, reason: NO_SERVER });
  await setup({}, { firstSeen: NOW - 2 * DAY });
  const out = await runTelemetry({ now: NOW, fetchImpl: counting });
  assert.equal(calls, 0);
  assert.equal(out.result.reason, NO_SERVER);
  assert.equal(out.report.schema, 2);
  const state = await readTelemetryState();
  assert.equal(state.lastResult.sent, false);
  assert.equal(state.lastResult.date, '2026-10-26');
  // Not sent: the period stays open and Preen quietly tries again a day later.
  assert.equal(state.lastReport, undefined);
  assert.equal(nextReportAt(state), NOW + DAY);
});


test('with a URL: one HTTPS POST of exactly the report, no credentials; http is refused', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response(null, { status: 204 }); };
  const r = report();
  assert.deepEqual(await sendReport(r, { url: 'https://stats.example/r', fetchImpl }), { sent: true, reason: null });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.credentials, 'omit');
  assert.deepEqual(JSON.parse(seen[0].init.body), r);
  assert.equal((await sendReport(r, { url: 'http://stats.example/r', fetchImpl })).sent, false);
  assert.equal(seen.length, 1);
});

test('turned off: nothing is built or sent and the alarm is removed', async () => {
  await setup({ telemetry: { enabled: false } }, { firstSeen: NOW - 30 * DAY });
  env.alarms.set(TELEMETRY_ALARM, { when: 1 });
  assert.equal(await runTelemetry({ now: NOW, url: 'https://stats.example/r', fetchImpl: failFetch }), null);
  assert.equal((await readTelemetryState()).lastReport, undefined);
  assert.equal(await configureTelemetryAlarm(mergeWithDefaults({ telemetry: { enabled: false } }), NOW), null);
  assert.equal(env.alarms.has(TELEMETRY_ALARM), false);
});

test('with the default settings the weekly job builds nothing, sends nothing and sets no alarm', async () => {
  env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({}), [TELEMETRY_KEY]: { firstSeen: NOW - 30 * DAY } });
  env.alarms.set(TELEMETRY_ALARM, { when: 1 });
  assert.equal(await runTelemetry({ now: NOW, url: 'https://stats.example/r', fetchImpl: failFetch }), null);
  assert.equal(await configureTelemetryAlarm(mergeWithDefaults({}), NOW), null);
  assert.equal(env.alarms.has(TELEMETRY_ALARM), false);
});

test('not due yet: nothing is built; the alarm is set for 24 h after first run', async () => {
  await setup();
  assert.equal(await runTelemetry({ now: NOW, url: 'https://stats.example/r', fetchImpl: failFetch }), null);
  assert.equal((await readTelemetryState()).firstSeen, NOW, 'first run recorded');
  assert.equal(await configureTelemetryAlarm(mergeWithDefaults(ON), NOW), NOW + DAY);
  assert.equal(env.alarms.get(TELEMETRY_ALARM).when, NOW + DAY);
});

test('catch-up: weeks overdue sends one report, the next is 7 days later', async () => {
  await setup({}, { firstSeen: NOW - 60 * DAY, lastReport: { at: NOW - 40 * DAY, totals: { messages: 0 } } });
  await appendEntries([{ at: new Date(NOW - DAY).toISOString(), scores: {}, inputTokens: 10, category: 'Work' }]);
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(null, { status: 204 }); };
  const out = await runTelemetry({ now: NOW, url: 'https://stats.example/r', fetchImpl });
  assert.equal(calls, 1);
  assert.equal(out.report.period.messages, '1-10');
  assert.equal(out.report.periodDays, 40);
  assert.equal(await runTelemetry({ now: NOW + DAY, url: 'https://stats.example/r', fetchImpl }), null);
  assert.equal(calls, 1);
  assert.equal(nextReportAt(await readTelemetryState()), NOW + 7 * DAY);
  assert.equal((await readTelemetryState()).lastReport.totals.messages, 1);
});

// Last: it adds to the monthly summaries, which (by design) survive clearing the log.
test('a server that can\'t be reached: no throw, nothing lost, tried again a day later', async () => {
  const r = report();
  const refused = async () => { throw new TypeError('NetworkError when attempting to fetch resource.'); };
  assert.deepEqual(await sendReport(r, { url: 'https://stats.example/r', fetchImpl: refused }), { sent: false, reason: 'could not connect' });
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  assert.deepEqual(await sendReport(r, { url: 'https://stats.example/r', fetchImpl: hang, timeoutMs: 20 }), { sent: false, reason: 'no answer in time' });
  assert.deepEqual(await sendReport(r, { url: 'https://stats.example/r', fetchImpl: null }), { sent: false, reason: 'no network' });

  await setup({}, { firstSeen: NOW - 9 * DAY, lastReport: { at: NOW - 8 * DAY, totals: { messages: 0 } } });
  await appendEntries([{ at: new Date(NOW - DAY).toISOString(), scores: {}, inputTokens: 10, category: 'Work' }]);
  const out = await runTelemetry({ now: NOW, url: 'https://stats.example/r', fetchImpl: refused });
  assert.equal(out.result.sent, false);
  let state = await readTelemetryState();
  assert.equal(state.lastReport.at, NOW - 8 * DAY, 'period not moved on');
  assert.equal(nextReportAt(state), NOW + DAY);
  assert.equal(await runTelemetry({ now: NOW + DAY / 2, url: 'https://stats.example/r', fetchImpl: refused }), null, 'no retry storm');

  const ok = async () => new Response(null, { status: 204 });
  const retry = await runTelemetry({ now: NOW + DAY, url: 'https://stats.example/r', fetchImpl: ok });
  assert.equal(retry.result.sent, true);
  assert.equal(retry.report.period.messages, '1-10', 'the unsent period is included');
  assert.equal(retry.report.periodDays, 9);
  state = await readTelemetryState();
  assert.equal(state.retryAt, null);
  assert.equal(nextReportAt(state), NOW + DAY + 7 * DAY);
});
