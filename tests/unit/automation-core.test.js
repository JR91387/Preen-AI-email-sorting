// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountScope, folderInScope, eligibility, cutoffDate, isExcludedFolder } from '../../packages/shared/core/scope.js';
import { dayKey, monthKey, emptyUsage, rollUsage, addUsage, budgetStatus } from '../../packages/shared/core/budget.js';
import { withRetries, backoffMs } from '../../packages/shared/core/retry.js';
import { toCsv, addToSummary, emptySummary, retentionCutoff } from '../../packages/shared/core/history.js';
import { automationRows, dimNote, intervalText } from '../../packages/shared/core/automation.js';
import { mergeWithDefaults, validateSettings, DEFAULT_SETTINGS } from '../../packages/shared/core/settings-schema.js';

const DAY = 24 * 60 * 60 * 1000;
const settings = mergeWithDefaults({
  scope: { accounts: { a1: { enabled: true, folders: 'inbox' }, a2: { enabled: true, folders: 'all' }, a3: { enabled: false, folders: 'all' } } },
});
const folder = (accountId, specialUse = [], extra = {}) => ({ id: `${accountId}-${specialUse[0] ?? 'f'}`, accountId, specialUse, ...extra });

// --- scope ------------------------------------------------------------------

test('accounts are off unless enabled; folder scope defaults to inbox', () => {
  assert.deepEqual(accountScope(settings, 'unknown'), { enabled: false, folders: 'inbox', folderPaths: [] });
  assert.deepEqual(accountScope(settings, 'a2'), { enabled: true, folders: 'all', folderPaths: [] });
});

test('inbox-only accounts cover just the inbox', () => {
  assert.equal(folderInScope(folder('a1', ['inbox']), settings), true);
  assert.equal(folderInScope(folder('a1', []), settings), false);
});

test('"all folders" excludes special folders, root and virtual folders', () => {
  assert.equal(folderInScope(folder('a2', []), settings), true);
  assert.equal(folderInScope(folder('a2', ['inbox']), settings), true);
  for (const use of ['trash', 'junk', 'sent', 'drafts', 'outbox', 'templates', 'archives']) {
    assert.equal(folderInScope(folder('a2', [use]), settings), false, use);
  }
  assert.equal(folderInScope(folder('a2', [], { isRoot: true }), settings), false);
  assert.equal(folderInScope(folder('a2', [], { isVirtual: true }), settings), false);
});

test('disabled and unknown accounts are never in scope', () => {
  assert.equal(folderInScope(folder('a3', ['inbox']), settings), false);
  assert.equal(folderInScope(folder('zz', ['inbox']), settings), false);
  assert.equal(folderInScope({ specialUse: ['inbox'] }, settings), false);
});

test('eligibility: processed, read (when unread-only) and too old', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const fresh = { headerMessageId: 'm@example', date: new Date(now - DAY), read: true, tags: [] };
  assert.deepEqual(eligibility(fresh, settings, { now }), { ok: true, reason: null });
  assert.equal(eligibility(fresh, settings, { now, processed: true }).reason, 'already processed');
  assert.equal(eligibility({ ...fresh, tags: ['preen_processed'] }, settings, { now }).reason, 'already processed');
  const unreadOnly = mergeWithDefaults({ automation: { unreadOnly: true } });
  assert.equal(eligibility(fresh, unreadOnly, { now }).reason, 'already read');
  assert.equal(eligibility({ ...fresh, date: new Date(now - 3 * DAY) }, settings, { now }).reason, 'older than 2 days');
  assert.equal(cutoffDate(settings, now).getTime(), now - 2 * DAY);
});

// --- budget -----------------------------------------------------------------

test('day and month keys use local time', () => {
  const d = new Date(2026, 8, 30, 23, 59); // local
  assert.equal(dayKey(d), '2026-09-30');
  assert.equal(monthKey(d), '2026-09');
});

test('rollUsage resets the day, and the month when it changes', () => {
  const usage = { ...emptyUsage(new Date(2026, 8, 29)), dayMessages: 5, dayTokens: 100, monthMessages: 9, monthTokens: 900 };
  const nextDay = rollUsage(usage, new Date(2026, 8, 30));
  assert.equal(nextDay.dayMessages, 0);
  assert.equal(nextDay.monthTokens, 900);
  const nextMonth = rollUsage(usage, new Date(2026, 9, 1));
  assert.equal(nextMonth.monthTokens, 0);
  assert.equal(nextMonth.month, '2026-10');
  assert.equal(rollUsage(null, new Date(2026, 8, 30)).dayMessages, 0);
});

test('addUsage counts entries that called the API', () => {
  const usage = emptyUsage();
  addUsage(usage, { passes: [{}], inputTokens: 400, costUsd: 0.001 });
  addUsage(usage, { passes: [{}, {}], inputTokens: 1000, costUsd: null });
  addUsage(usage, { skipped: 'encrypted' });
  assert.equal(usage.dayMessages, 2);
  assert.equal(usage.dayTokens, 1400);
  assert.equal(usage.monthCostUsd, 0.001);
  assert.equal(usage.monthCostKnownMessages, 1);
});

test('budgetStatus checks each limit; 0 / null mean no limit', () => {
  const limits = (l) => mergeWithDefaults({ limits: l });
  const usage = { ...emptyUsage(), dayMessages: 10, dayTokens: 5000, monthTokens: 50000, monthCostUsd: 0.5 };
  assert.equal(budgetStatus(usage, limits({ dailyMessages: 10 })).reason,
    'Daily limit of 10 messages reached (change it in Settings → Limits & allowance)');
  // Estimated cost = month tokens × price: 50,000 × $10/M = $0.50. Without a price there's no estimate, so no cost limit.
  const costLimit = (price) => mergeWithDefaults({ pricePerMillionInputTokens: price, limits: { dailyMessages: 0, monthlyCostUsd: 0.5 } });
  assert.match(budgetStatus(usage, costLimit(10)).reason, /Estimated monthly cost limit of \$0\.50/);
  assert.equal(budgetStatus(usage, costLimit(9)).canRun, true);
  assert.equal(budgetStatus(usage, costLimit(null)).canRun, true);
  const open = budgetStatus(usage, limits({ dailyMessages: 0 }));
  assert.equal(open.canRun, true);
  assert.equal(open.remainingMessages, Infinity);
  assert.equal(budgetStatus(usage, limits({ dailyMessages: 25 })).remainingMessages, 15);
});

// --- retries ----------------------------------------------------------------

const err = (kind) => Object.assign(new Error(kind), { kind });

test('retries temporary errors after Preen\'s real 2 s and 4 s delays, then succeeds', async () => {
  let calls = 0;
  const t = Date.now();
  const result = await withRetries(async () => {
    calls++;
    if (calls < 3) throw err('rate_limit');
    return 'ok';
  });
  const took = Date.now() - t;
  assert.equal(result, 'ok');
  assert.ok(took >= 5900 && took < 7500, `waited ${took} ms (expect about 6 s)`);
});

test('gives up after two retries, and never retries auth errors', async () => {
  let calls = 0;
  await assert.rejects(withRetries(async () => { calls++; throw err('server'); }), /server/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(withRetries(async () => { calls++; throw err('auth'); }), /auth/);
  assert.equal(calls, 1);
  assert.deepEqual([0, 1, 2, 10].map(backoffMs), [2000, 4000, 8000, 30000]);
});

// --- history ----------------------------------------------------------------

test('CSV export escapes; it has sender and subject (D126) but never the message text', () => {
  const csv = toCsv([{
    at: '2026-09-30T10:00:00.000Z', runKind: 'applied', category: 'Receipts', tags: ['Preen/Receipts', 'Preen/Service'],
    scores: { categoryChoice: 'Receipts', categoryProbability: 0.9 }, reasons: ['Service (from headers, "not asked")'],
    inputTokens: 700, passes: [{ kind: 'surface', inputTokens: 700 }], applied: { changes: ['+preen_receipts'] },
  }]);
  const [header, row] = csv.trimEnd().split('\r\n');
  assert.ok(header.startsWith('time,time_local,source,run,depth'));
  assert.ok(header.includes(',from,subject'));
  assert.ok(!/body|text/.test(header));
  assert.ok(row.includes('"Service (from headers, ""not asked"")"'));
  assert.ok(row.includes('Preen/Receipts Preen/Service'), 'old entries export unchanged');
});

test('monthly summaries: message counters count classified entries only; a skip counts only as a skip', () => {
  const s = emptySummary('2026-09');
  addToSummary(s, { scores: {}, category: 'Receipts', inputTokens: 500, costUsd: 0.01, runKind: 'applied', applied: { changes: [] } });
  addToSummary(s, { scores: {}, category: null, review: true, inputTokens: 300, costUsd: null });
  addToSummary(s, { skipped: 'encrypted' });
  const { errors, stoppedAfterError, skips, runs, corrected, review, depth, undo, latency, ...base } = s;
  assert.deepEqual(base, {
    month: '2026-09', messages: 2, tokens: 800, costUsd: 0.01, costKnownMessages: 1, byCategory: { Receipts: 1, Review: 1 }, applied: 1,
    person: 0, needsReply: 0, toDo: 0, junk: 0,
  });
  assert.equal(skips.encrypted, 1);
  assert.equal(review, 1);
  assert.ok(errors && stoppedAfterError === 0 && runs && corrected && depth && undo && latency);
});

test('retentionCutoff', () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  assert.equal(retentionCutoff(90, now), new Date(now - 90 * DAY).toISOString());
});

// --- settings ---------------------------------------------------------------

test('automation starts paused, accounts off, with sensible limits', () => {
  assert.equal(DEFAULT_SETTINGS.automation.enabled, false);
  assert.deepEqual(DEFAULT_SETTINGS.scope.accounts, {});
  assert.equal(DEFAULT_SETTINGS.limits.monthlyCostUsd, null);
  assert.deepEqual(validateSettings(mergeWithDefaults({})).errors, []);
});

test('validates Stage 4 settings', () => {
  const ok = (patch) => validateSettings(mergeWithDefaults(patch)).ok;
  assert.equal(ok({ automation: { trigger: 'hourly' } }), false);
  assert.equal(ok({ automation: { intervalMinutes: 2 } }), false);
  assert.equal(ok({ automation: { enabled: 'yes' } }), false);
  assert.equal(ok({ limits: { dailyMessages: -1 } }), false);
  assert.equal(ok({ limits: { dailyMessages: 0 } }), true);
  assert.equal(ok({ limits: { monthlyCostUsd: 2.5 } }), false, 'a cost limit needs a price');
  assert.equal(ok({ pricePerMillionInputTokens: 0.2, limits: { monthlyCostUsd: 2.5 } }), true);
  assert.equal(ok({ limits: { monthlyCostUsd: -1 } }), false);
  assert.equal(ok({ scope: { accounts: { a: { enabled: true, folders: 'inbox' } } } }), true);
  assert.equal(ok({ scope: { accounts: { a: { enabled: true, folders: 'some' } } } }), false);
  assert.equal(ok({ history: { retentionDays: 0 } }), false);
});

test('"only these folders" and "all except these" match by folder path', () => {
  const s = mergeWithDefaults({ scope: { accounts: {
    a1: { enabled: true, folders: 'selected', folderPaths: ['/INBOX', '/Clients'] },
    a2: { enabled: true, folders: 'except', folderPaths: ['/Lists'] },
  } } });
  const f = (accountId, path, specialUse = []) => ({ accountId, path, specialUse });
  assert.equal(folderInScope(f('a1', '/INBOX', ['inbox']), s), true);
  assert.equal(folderInScope(f('a1', '/Clients'), s), true);
  assert.equal(folderInScope(f('a1', '/Other'), s), false);
  assert.equal(folderInScope(f('a2', '/Lists'), s), false);
  assert.equal(folderInScope(f('a2', '/Anything'), s), true);
  // A special folder stays excluded even if its path is listed.
  const withTrash = mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'selected', folderPaths: ['/Trash'] } } } });
  assert.equal(folderInScope(f('a1', '/Trash', ['trash']), withTrash), false);
});

test('isExcludedFolder', () => {
  assert.equal(isExcludedFolder({ specialUse: ['sent'] }), true);
  assert.equal(isExcludedFolder({ specialUse: ['inbox'] }), false);
  assert.equal(isExcludedFolder({ isRoot: true }), true);
  assert.equal(isExcludedFolder({ specialUse: [] }), false);
});

test('validates folder lists; "only these folders" needs at least one when enabled', () => {
  const ok = (a) => validateSettings(mergeWithDefaults({ scope: { accounts: { a: a } } })).ok;
  assert.equal(ok({ enabled: true, folders: 'selected', folderPaths: ['/INBOX'] }), true);
  assert.equal(ok({ enabled: true, folders: 'selected', folderPaths: [] }), false);
  assert.equal(ok({ enabled: false, folders: 'selected', folderPaths: [] }), true);
  assert.equal(ok({ enabled: true, folders: 'except', folderPaths: [] }), true);
  assert.equal(ok({ enabled: true, folders: 'except', folderPaths: [42] }), false);
});

test('CSV neutralises a formula hidden in a stored subject', () => {
  const csv = toCsv([{ at: '2026-10-01T00:00:00Z', subject: '=HYPERLINK("http://x")', from: '+1 <a@example.org>' }]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'+1 <a@example.org>"));
});

test('addUsage never counts negative tokens or cost', () => {
  const u = addUsage(emptyUsage(), { passes: [{}], inputTokens: -500, costUsd: -0.5 });
  assert.equal(u.dayTokens, 0);
  assert.equal(u.monthTokens, 0);
  assert.equal(u.monthCostUsd, 0);
});

// --- automation summary -----------------------------------------------------

test('automationRows: fixed order, plain values, dimmed while off or paused except dry run', () => {
  const a = { trigger: 'scheduled', intervalMinutes: 120, unreadOnly: true, maxAgeDays: 1, dryRun: true };
  const on = automationRows({ ...a, state: 'on' });
  assert.deepEqual(on.map((r) => r.key), ['trigger', 'interval', 'unreadOnly', 'maxAgeDays', 'dryRun']);
  assert.deepEqual(on.map((r) => r.value), ['On a schedule', '2 hours', 'Yes', '1 day', 'On: only logs what it would do']);
  assert.ok(on.every((r) => !r.dim));
  for (const state of ['off', 'paused']) {
    assert.deepEqual(automationRows({ ...a, state }).map((r) => r.dim), [true, true, true, true, false]);
  }
  const manual = automationRows({ ...a, state: 'on', trigger: 'manual', unreadOnly: false, dryRun: false });
  assert.equal(manual[1].value, 'not used (only for a schedule)');
  assert.equal(manual[1].dim, true);
  assert.equal(manual[2].value, 'No');
  assert.equal(manual[4].value, 'Off: changes messages');
});

test('intervalText and dimNote', () => {
  assert.equal(intervalText(15), 'every 15 minutes');
  assert.equal(intervalText(60), 'every 1 hour');
  assert.equal(intervalText(180), 'every 3 hours');
  assert.match(dimNote('off'), /off/);
  assert.match(dimNote('paused'), /resume/);
  assert.equal(dimNote('on'), '');
});
