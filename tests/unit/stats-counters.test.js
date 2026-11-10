// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Detail counters in the monthly summaries (errors, skips, runs, corrections, depth,
// undo, response times) and their place in the anonymous report: counting rules,
// exact vs range, the allow-list, and no error text or category name anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { emptySummary, addToSummary, countsInSummary, latencyBucket } from '../../packages/shared/core/history.js';
import { buildReport, assertAllowed, collectTotals, totalsToKeep } from '../../packages/shared/core/telemetry.js';
import { classify } from '../../packages/shared/providers/systemone.js';
import { appendEntries, readSummaries, readAll, clearLog } from '../../apps/thunderbird/storage/activity-log.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { previewReport } from '../../apps/thunderbird/storage/telemetry.js';
import { STOPPED_AFTER_ERROR, LIMIT_REACHED, AWAITING_CONSENT, CORRECTED } from '../../packages/shared/core/run-summary.js';

installIndexedDB();
const AT = '2026-10-20T10:00:00.000Z';
const NOW = Date.parse('2026-10-26T12:00:00Z');
const ERROR_TEXT = 'ZZERRORTEXT provider said something private';
const CATEGORY = 'ZZCATEGORY-Receipts';

const sum = (...entries) => {
  const s = emptySummary('2026-10');
  for (const e of entries) addToSummary(s, { at: AT, ...e });
  return s;
};

test('errors: one per failed message, by kind; stopped-after-error counted separately', () => {
  const s = sum(
    { error: { kind: 'server', message: ERROR_TEXT } },
    { error: { kind: 'auth', message: ERROR_TEXT } },
    { error: { kind: 'auth', message: 'x' } },
    { error: { kind: 'something new', message: 'x' } },
    { skipped: STOPPED_AFTER_ERROR },
    { skipped: STOPPED_AFTER_ERROR },
  );
  assert.deepEqual(s.errors, { auth: 2, rate_limit: 0, server: 1, network: 0, timeout: 0, bad_request: 0, bad_response: 0, internal: 1 });
  assert.equal(s.stoppedAfterError, 2);
  assert.equal(s.skips.other, 0, 'stopped-after-error is not a skip');
  assert.equal(s.messages, 0, 'failed messages are not "sorted"');
  assert.equal(JSON.stringify(s).includes('ZZERRORTEXT'), false);
});

test('skips by reason, including text not sent at Deep', () => {
  const s = sum(
    { skipped: LIMIT_REACHED }, { skipped: AWAITING_CONSENT }, { skipped: 'encrypted' }, { skipped: 'stopped by you' },
    { scores: {}, textSkipped: 'message too large' }, { scores: {}, textSkipped: 'no readable text' }, { scores: {}, textSkipped: 'encrypted' },
    { skipped: CORRECTED },
  );
  assert.deepEqual(s.skips, { limitReached: 1, awaitingConsent: 1, encrypted: 2, tooLarge: 1, noText: 1, corrected: 1, other: 1 });
});

test('runs: counted once per run (the first logged entry), by runKind and by what started it', () => {
  const s = sum(
    { scores: {}, runStart: true, runKind: 'applied', source: 'automatic' },
    { scores: {}, runKind: 'applied', source: 'automatic' },
    { scores: {}, runStart: true, runKind: 'dry run', source: 'manual' },
    { skipped: 'encrypted', runStart: true, runKind: 'preview', source: 'manual' },
  );
  assert.deepEqual(s.runs, { applied: 1, dryRun: 1, preview: 1, automatic: 1, manual: 2 });
});

test('corrections by tag kind; every category tag in one bucket, never its name', () => {
  const fix = (key, tag) => ({ correction: { key, tag, change: 'removed', from: { category: CATEGORY } }, notice: `You removed ${tag}` });
  const s = sum(
    fix('preen_person', 'Preen/Real person'), fix('preen_needs_reply', 'Preen/Needs reply'),
    fix('preen_junk', 'Preen/Junk'), fix('preen_zzcategory_receipts', `Preen/${CATEGORY}`),
    fix('preen_bills', 'Preen/Bills'),
    { scores: {}, review: true }, { scores: {}, review: false },
  );
  assert.deepEqual(s.corrected, { person: 1, needsReply: 1, junk: 1, category: 2 });
  assert.equal(s.review, 1);
  const { byCategory, ...rest } = s;
  assert.deepEqual(byCategory, { Review: 1, none: 1 });
  assert.equal(JSON.stringify(rest).includes('ZZCATEGORY'), false);
});

test('depth used and undo use', () => {
  const s = sum(
    { scores: {}, decidedBy: 'surface' }, { scores: {}, decidedBy: 'full' }, { scores: {}, decidedBy: 'full' },
    { notice: 'Undo: …', undo: { runs: 2, messages: 5 } }, { notice: 'Undo: …', undo: { runs: 0, messages: 0 } },
  );
  assert.deepEqual(s.depth, { surface: 1, deep: 2 });
  assert.deepEqual(s.undo, { runs: 2, messages: 5 });
});

test('response time per message, by provider, in buckets', () => {
  assert.deepEqual([0, 999, 1000, 1999, 2000, 4999, 5000, 9999, 10_000, 60_000].map(latencyBucket),
    ['lt1s', 'lt1s', '1to2s', '1to2s', '2to5s', '2to5s', '5to10s', '5to10s', '10sPlus', '10sPlus']);
  const s = sum(
    { scores: {}, provider: 'openrouter', passes: [{ ms: 400 }] },
    { scores: {}, provider: 'openrouter', passes: [{ ms: 3000 }] },
    { scores: {}, provider: 'typesafe', passes: [{ ms: 12_000 }] },
    { scores: {}, provider: 'typesafe', passes: [{ ms: null }] },
    { scores: {}, provider: 'other', passes: [{ ms: 100 }] },
  );
  assert.deepEqual(s.latency.openrouter, { lt1s: 1, '1to2s': 0, '2to5s': 1, '5to10s': 0, '10sPlus': 0 });
  assert.deepEqual(s.latency.typesafe, { lt1s: 0, '1to2s': 0, '2to5s': 0, '5to10s': 0, '10sPlus': 1 });
});

test('which entries change a summary; old summaries without counters still add up', () => {
  assert.equal(countsInSummary({ notice: 'Model changed' }), false);
  assert.equal(countsInSummary({ error: { kind: 'auth' } }), true);
  const old = { month: '2026-10', messages: 3, tokens: 0, costUsd: 0, costKnownMessages: 0, byCategory: {}, applied: 0 };
  addToSummary(old, { at: AT, error: { kind: 'timeout', message: 'x' } });
  assert.equal(old.errors.timeout, 1);
  const t = collectTotals({ summaries: [old, { month: '2026-09', messages: 1 }], now: new Date(NOW) });
  assert.equal(t.allTime.errors.timeout, 1);
  assert.equal(t.thisMonth.errors.timeout, 1);
  assert.equal(t.allTime.depth.deep, 0);
});

test('the provider call is timed even without debug', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ model: 'jev', answers: {}, usage: {} }), { status: 200 });
  const r = await classify({ baseUrl: 'https://x', apiKey: 'k', body: {}, fetchImpl });
  assert.equal(typeof r.ms, 'number');
  assert.ok(r.ms >= 0);
});

// --- The report ------------------------------------------------------------------

const settings = mergeWithDefaults({});
const totalsOf = (...entries) => collectTotals({ summaries: [sum(...entries)], now: new Date(NOW) }).allTime;

test('report: errors and stopped-after-error exact; other counters as ranges; deltas since the last report', () => {
  const errs = Array.from({ length: 7 }, () => ({ error: { kind: 'rate_limit', message: ERROR_TEXT } }));
  const totals = totalsOf(...errs, { skipped: STOPPED_AFTER_ERROR }, { scores: {}, decidedBy: 'full', provider: 'openrouter', passes: [{ ms: 1500 }] });
  const r = buildReport({ settings, totals, version: '0.0.24', now: NOW });
  assert.equal(r.period.errors.rate_limit, '7');
  assert.equal(r.period.errors.auth, '0');
  assert.equal(r.period.stoppedAfterError, '1');
  assert.equal(r.period.depth.deep, '1-10');
  assert.equal(r.period.latency.openrouter['1to2s'], '1-10');
  const later = buildReport({ settings, totals, previous: { at: NOW - 1, totals: totalsToKeep(totals) }, version: '0.0.24', now: NOW });
  assert.equal(later.period.errors.rate_limit, '0');
  assert.equal(later.period.depth.deep, '0');
});

test('report allow-list still rejects anything else in the new groups', () => {
  const r = buildReport({ settings, totals: totalsOf(), version: '1', now: NOW });
  assert.doesNotThrow(() => assertAllowed(r));
  assert.throws(() => assertAllowed({ ...r, period: { ...r.period, errors: { ...r.period.errors, message: 'x' } } }), /errors.message is not in the allow-list/);
  assert.throws(() => assertAllowed({ ...r, period: { ...r.period, corrected: { ...r.period.corrected, Receipts: '1' } } }), /not in the allow-list/);
  assert.throws(() => assertAllowed({ ...r, period: { ...r.period, latency: { ...r.period.latency, other: {} } } }), /not in the allow-list/);
  assert.throws(() => assertAllowed({ ...r, period: { ...r.period, errors: { ...r.period.errors, auth: 'HTTP 401: bad key' } } }), /allowed form/);
});

test('a distinctive error message and category name never reach the summaries or the report', async () => {
  globalThis.messenger = createMessenger({ messages: {} }).messenger;
  await messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: 'k' }), telemetry: { firstSeen: NOW - 2 * 86_400_000 } });
  await appendEntries([
    { at: new Date(NOW).toISOString(), error: { kind: 'server', message: ERROR_TEXT } },
    { at: new Date(NOW).toISOString(), correction: { key: 'preen_zzcategory', tag: CATEGORY, change: 'added', from: { category: CATEGORY } } },
  ]);
  const summaries = JSON.stringify(await readSummaries());
  assert.equal(summaries.includes('ZZERRORTEXT'), false);
  assert.equal(summaries.includes('ZZCATEGORY'), false);
  const report = JSON.stringify(await previewReport({ now: NOW }));
  assert.equal(report.includes('ZZERRORTEXT'), false);
  assert.equal(report.includes('ZZCATEGORY'), false);
  assert.match(report, /"server":"1"/);
});

// --- Through the pipeline ----------------------------------------------------------

function message(id) {
  return {
    header: {
      headerMessageId: `m${id}@example`, author: 'Sam <sam@example.org>', subject: 'Hi', date: new Date(AT),
      recipients: ['me@example.com'], ccList: [], folder: { accountId: 'acct1' },
    },
    full: { contentType: 'text/plain', headers: {}, parts: [] },
    textParts: [{ contentType: 'text/plain', content: 'Hello there.' }],
  };
}

async function pipelineSetup(count) {
  const env = createMessenger({ messages: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, message(i + 1)])) });
  globalThis.messenger = env.messenger;
  await clearLog();
  await messenger.storage.local.set({
    settings: mergeWithDefaults({
      apiKey: 'k', consent: { sendToProvider: AT, provider: 'openrouter' }, depth: { default: 'deep', accounts: {} }, speed: 'medium',
    }),
  });
}
const current = async () => collectTotals({ summaries: await readSummaries(), now: new Date() }).allTime;

test('pipeline: a message retried after server errors counts one error; an auth stop counts the rest as stopped-after-error', async () => {
  await pipelineSetup(3);
  const before = await current();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls <= 3 ? new Response(ERROR_TEXT, { status: 503 }) : new Response('{"error":{"message":"bad key"}}', { status: 401 });
  };
  const results = await classifyMessages([1, 2, 3]);
  const after = await current();
  assert.equal(calls, 4, 'three tries for the first message, one for the second');
  assert.equal(after.errors.server - before.errors.server, 1);
  assert.equal(after.errors.auth - before.errors.auth, 1);
  assert.equal(after.stoppedAfterError - before.stoppedAfterError, 1);
  assert.equal(results[2].skipped, STOPPED_AFTER_ERROR);
  assert.equal(after.runs.preview - before.runs.preview, 1);
  assert.equal(after.runs.manual - before.runs.manual, 1);
  assert.equal(JSON.stringify(await readSummaries()).includes('ZZERRORTEXT'), false);
});

test('pipeline: a sorted message records its provider and response time, counted by depth and in a time bucket', async () => {
  await pipelineSetup(1);
  const before = await current();
  globalThis.fetch = async () => new Response(JSON.stringify({ model: 'jev', answers: {}, usage: { input_tokens: 10 } }), { status: 200 });
  const [entry] = await classifyMessages([1]);
  assert.equal(entry.provider, 'openrouter');
  assert.equal(typeof entry.passes[0].ms, 'number');
  const after = await current();
  assert.equal(after.depth.deep - before.depth.deep, 1);
  const bucketsBefore = Object.values(before.latency.openrouter).reduce((a, b) => a + b, 0);
  assert.equal(Object.values(after.latency.openrouter).reduce((a, b) => a + b, 0) - bucketsBefore, 1);
  assert.equal((await readAll()).filter((e) => e.runStart).length, 1);
});
