// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Tests for the fixes from the hostile code review (DECISIONS.md D70–D80).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, matchCategory } from '../../packages/shared/core/rules.js';
import { runPasses } from '../../packages/shared/core/depth.js';
import { mergeWithDefaults, validateSettings } from '../../packages/shared/core/settings-schema.js';
import { exportSettings, parseSettingsFile } from '../../packages/shared/core/settings-io.js';
import { planUpdate } from '../../packages/shared/core/actions.js';
import { toCsv } from '../../packages/shared/core/history.js';
import { eligibility } from '../../packages/shared/core/scope.js';
import { testConnection } from '../../packages/shared/providers/index.js';
import { queueItem } from '../../apps/thunderbird/mail/folders.js';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { isProcessedSet, processedKey } from '../../apps/thunderbird/storage/processed.js';
import { getEmailBody, MAX_MESSAGE_BYTES, MAX_RAW_TEXT_CHARS } from '../../apps/thunderbird/mail/messages.js';
import { scan, configureAlarms } from '../../apps/thunderbird/background/scheduler.js';
import { SCHEDULE_ALARM } from '../../packages/shared/core/protocol.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';

// The user has agreed to send mail to the provider.
const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };

installIndexedDB();

const settings = mergeWithDefaults({});
const choice = (label, p = 0.95) => ({ type: 'choice', choice: label, probabilities: { [label]: p }, confidence: 0.9 });

// --- 1b. Unexpected category labels ------------------------------------------

test('1b: a label we did not offer is never acted on, however confident', () => {
  const d = decide({ category: choice('Urgent: wire money now', 0.99) }, settings);
  assert.equal(d.category, null);
  assert.equal(d.review, true);
  assert.deepEqual(d.tags, [], 'review is a decision, not a tag');
  assert.match(d.reasons[0], /Unexpected category from the model/);
});

test('1b: case and spacing differences map to the configured name', () => {
  assert.equal(matchCategory('  bills ', settings), 'Bills');
  assert.equal(matchCategory('OTHER', settings), 'other');
  assert.equal(matchCategory('Invoices', settings), null);
  const d = decide({ category: choice('bills') }, settings);
  assert.equal(d.category, 'Bills');
  assert.ok(d.tags.includes('Preen/Bills'));
});

test('1b: an unexpected label is never used as a category', () => {
  const d = decide({ category: choice('Bogus') }, mergeWithDefaults({ questions: { person: false, needsReply: false } }));
  assert.equal(d.category, null);
  assert.equal(d.review, true);
});

// --- 1c. Unreadable yes/no answers -------------------------------------------

test('1c: missing yes/no answers cost no second request (Surface reads no text at all)', async () => {
  const answersWithoutNouls = { model: 'jev', answers: { category: choice('Receipts') }, usage: { input_tokens: 300 } };
  const calls = [];
  const run = await runPasses({
    mode: 'surface',
    ask: async (body) => { calls.push(body); return answersWithoutNouls; },
    loadBody: async () => { throw new Error('the text must not be read'); },
  });
  assert.equal(calls.length, 1);
  assert.equal(run.decidedBy, 'surface');
  const d = decide(answersWithoutNouls.answers, settings);
  assert.ok(d.reasons.includes('Answer for Real person not understood'));
  assert.ok(d.reasons.includes('Answer for Needs reply not understood'));
});

test('1c: Test connection reports whether yes/no answers can be read', async () => {
  const reply = (answer) => async () => new Response(JSON.stringify({ model: 'jev', answers: { connection_test: answer }, usage: {} }), { status: 200 });
  const s = mergeWithDefaults({ apiKey: 'k' });
  assert.equal((await testConnection(s, reply({ type: 'noul', noul: 0.9 }))).answersUnderstood, true);
  assert.equal((await testConnection(s, reply({ type: 'noul', yes: 0.9 }))).answersUnderstood, false);
});

// --- 1a. API key in imported settings ----------------------------------------

test('1a: an imported file never silently replaces the API key', () => {
  const current = mergeWithDefaults({ apiKey: 'sk-mine-1234' });
  const theirs = JSON.stringify(exportSettings({ ...current, apiKey: 'sk-attacker-9999' }, { includeApiKey: true }));
  const result = parseSettingsFile(theirs, current, []);
  assert.equal(result.settings.apiKey, 'sk-mine-1234', 'current key kept until the user confirms');
  assert.equal(result.incomingApiKey, 'sk-attacker-9999', 'offered to the page, which asks first');
  const same = parseSettingsFile(JSON.stringify(exportSettings(current, { includeApiKey: true })), current, []);
  assert.equal(same.incomingApiKey, null, 'the same key needs no question');
});

// --- 2c. Personal context limit ----------------------------------------------

test('2c: personal context shares the fixed description limit', () => {
  const ok = (personalContext) => validateSettings(mergeWithDefaults({ personalContext })).ok;
  assert.equal(ok('x'.repeat(128)), true);
  assert.equal(ok('x'.repeat(129)), false);
});

// --- 2d. Only Preen's own tags are replaced ----------------------------------

test('2d: a user tag whose key starts with preen_ is kept; a leftover Preen tag is replaced', () => {
  const managed = new Set(['preen_receipts', 'preen_processed', 'preen_old_category']); // as managedTagKeys() would return
  const plan = planUpdate(
    { tags: ['preen_mine', 'preen_old_category'], flagged: false, read: false },
    { category: 'Receipts', tags: ['Preen/Receipts'], scores: {} },
    settings,
    managed,
  );
  assert.ok(plan.after.tags.includes('preen_mine'));
  assert.ok(!plan.after.tags.includes('preen_old_category'));
});

// --- 2e. CSV ---------------------------------------------------------------

test('2e: CSV cells that could run as formulas are neutralised', () => {
  const csv = toCsv([{ at: '2026-09-30T00:00:00Z', notice: '=HYPERLINK("http://evil.example")', reasons: ['+cmd', '@x'], scores: { person: 0.5 } }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"")"`));
  assert.ok(csv.includes("'+cmd; @x"));
  assert.ok(csv.includes(',0.5,'), 'numbers are untouched');
});

// --- 3a / 3c. Message-ID and Date header -------------------------------------

test('3a: messages without a Message-ID are not processed automatically', () => {
  assert.equal(eligibility({ date: new Date(), tags: [] }, settings).reason, 'missing Message-ID');
});

test('3c: a future Date header counts as now in the queue', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const item = queueItem({ headerMessageId: 'm', date: new Date('2030-01-01'), folder: { accountId: 'a', path: '/INBOX' } }, now);
  assert.equal(item.date, new Date(now).toISOString());
});

// --- 3d. Processed record by account ---------------------------------------

test('3d: processed records are per account', () => {
  const set = { record: { [processedKey('a1', 'm1')]: 1 }, dryRunSeen: null };
  assert.equal(isProcessedSet(set, { headerMessageId: 'm1', folder: { accountId: 'a1' } }), true);
  assert.equal(isProcessedSet(set, { headerMessageId: 'm1', folder: { accountId: 'a2' } }), false, 'same message, other account');
});

// --- Thunderbird-facing fixes (fake Thunderbird) -----------------------------

function useMessenger(opts) {
  const env = createMessenger(opts);
  globalThis.messenger = env.messenger;
  return env;
}

test('2a: very large messages are not read; huge text is cut before conversion', async () => {
  const env = useMessenger({ messages: {
    1: { header: { headerMessageId: 'big' }, full: {}, textParts: [{ contentType: 'text/plain', content: 'x' }] },
    2: { header: { headerMessageId: 'html' }, full: {}, textParts: [{ contentType: 'text/html', content: '<p>' + 'y'.repeat(MAX_RAW_TEXT_CHARS * 2) + '</p>' }] },
  } });
  assert.deepEqual(await getEmailBody(1, MAX_MESSAGE_BYTES + 1), { skipped: 'message too large' });
  assert.deepEqual(env.calls.listInlineTextParts, [], 'nothing read for the large message');
  await getEmailBody(2, 1000);
  assert.ok(env.calls.convert[0] <= MAX_RAW_TEXT_CHARS);
});

test('2b: every folder gets a share of the scan, and the starting folder rotates', async () => {
  const folders = ['A', 'B', 'C'].map((n) => ({ id: `f${n}`, accountId: 'a1', specialUse: [], path: `/${n}`, name: n }));
  const messages = {};
  let id = 0;
  // Folder A is busy (1,500 recent messages); B and C have one each.
  for (const [folder, count] of [[folders[0], 1500], [folders[1], 1], [folders[2], 1]]) {
    for (let i = 0; i < count; i++) {
      id++;
      messages[id] = { header: { headerMessageId: `${folder.name}${i}`, date: new Date(), folder, tags: [] }, full: {} };
    }
  }
  const env = useMessenger({ messages, folders });
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'all', folderPaths: [] } } }, automation: { enabled: true } }),
  });
  await scan(mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'all', folderPaths: [] } } }, automation: { enabled: true } }));
  const queued = env.store.queue.map((q) => q.folderPath);
  assert.ok(queued.includes('/B') && queued.includes('/C'), 'the quiet folders are not starved');
  assert.equal(env.store.scanCursor, 1, 'next scan starts at the next folder');
});

test('3e: saving settings does not push back an unchanged schedule', async () => {
  const env = useMessenger({ messages: {} });
  const s = mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } }, automation: { enabled: true, trigger: 'scheduled', intervalMinutes: 15 } });
  await configureAlarms(s);
  const first = env.alarms.get(SCHEDULE_ALARM);
  await configureAlarms(s);
  assert.equal(env.alarms.get(SCHEDULE_ALARM), first, 'same alarm object: not re-created');
  await configureAlarms(mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } }, automation: { enabled: true, trigger: 'scheduled', intervalMinutes: 30 } }));
  assert.equal(env.alarms.get(SCHEDULE_ALARM).periodInMinutes, 30);
});

test('1b end to end: an injected label tags nothing and changes nothing', async () => {
  const msg = {
    header: { headerMessageId: 'phish@example', author: 'x <x@example.com>', subject: 's', date: new Date(), recipients: [], ccList: [], folder: { accountId: 'a1' }, tags: [], flagged: false, read: false },
    full: { headers: {} },
    textParts: [],
  };
  const env = useMessenger({ messages: { 1: msg } });
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, dryRun: false, depth: { default: 'surface', accounts: {} } }) });
  globalThis.fetch = async () => new Response(JSON.stringify({
    model: 'jev', answers: { category: choice('Safe – mark as read'), person: { noul: 0.5 }, needs_reply: { noul: 0.1 } }, usage: { input_tokens: 100 },
  }), { status: 200 });
  const [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.category, null);
  assert.equal(entry.review, true);
  assert.ok(!entry.tags.includes('Preen/Review'), 'no Review tag');
  assert.equal(msg.header.read, false);
  assert.deepEqual(msg.header.tags.filter((t) => t !== 'preen_processed'), []);
});

// --- Follow-up review fixes (D81) ---------------------------------------------

test('follow-up 1: probability is found for a label with stray spaces or different case', () => {
  const cat = { type: 'choice', choice: 'Bills ', probabilities: { Bills: 0.95 }, confidence: 0.9 };
  const d = decide({ category: cat, person: { noul: 0.05 }, needs_reply: { noul: 0.1 } }, settings);
  assert.equal(d.category, 'Bills');
  assert.equal(d.review, false);
});

test('follow-up 2: CSV neutralises formulas hidden behind leading whitespace', () => {
  const csv = toCsv([{ at: '2026-09-30T00:00:00Z', notice: ' =1+1', reasons: ['\t@SUM(A1)'] }]);
  assert.ok(csv.includes("' =1+1"));
  assert.ok(csv.includes("'\t@SUM(A1)"));
});

test('follow-up 4: without an account, the processed key is the plain Message-ID', () => {
  assert.equal(processedKey(undefined, 'm1'), 'm1');
  assert.equal(processedKey('a1', 'm1'), 'a1|m1');
});

test('follow-up 5: turning off the processed tag stops adding it but keeps existing ones', () => {
  const off = mergeWithDefaults({ markProcessed: { tag: false } });
  const plan = planUpdate(
    { tags: ['preen_processed'], flagged: false, read: false },
    { category: 'Receipts', tags: ['Preen/Receipts'], scores: {} },
    off,
  );
  assert.ok(plan.after.tags.includes('preen_processed'), 'existing tag kept');
  const fresh = planUpdate({ tags: [], flagged: false, read: false }, { category: 'Receipts', tags: ['Preen/Receipts'], scores: {} }, off);
  assert.ok(!fresh.after.tags.includes('preen_processed'), 'not added');
});

test('follow-up 6: a failure creating the schedule is reported, not lost', async () => {
  const env = useMessenger({ messages: {} });
  env.messenger.alarms.create = async () => { throw new Error('alarms unavailable'); };
  await assert.rejects(configureAlarms(mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } }, automation: { enabled: true, trigger: 'scheduled' } })), /alarms unavailable/);
});

test('follow-up 7: the same key with stray spaces does not trigger the import prompt', () => {
  const current = mergeWithDefaults({ apiKey: ' sk-mine-1234 ' });
  const file = JSON.stringify(exportSettings({ ...current, apiKey: 'sk-mine-1234' }, { includeApiKey: true }));
  const result = parseSettingsFile(file, current, []);
  assert.equal(result.incomingApiKey, null);
  assert.equal(result.settings.apiKey, 'sk-mine-1234');
});
