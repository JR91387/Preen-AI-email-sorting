// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planUndo, lastUndoableRun } from '../../packages/shared/core/undo.js';
import { badgeState } from '../../packages/shared/core/badge.js';
import { presetPerson } from '../../packages/shared/core/sender-rules.js';
import { addToSummary, emptySummary } from '../../packages/shared/core/history.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { readAll, clearLog } from '../../apps/thunderbird/storage/activity-log.js';
import { setOverride, readOverrides } from '../../apps/thunderbird/storage/overrides.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { undoEntries } from '../../apps/thunderbird/mail/undo.js';

// The user has agreed to send mail to the provider.
const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };

installIndexedDB();

// --- planUndo ---------------------------------------------------------------

const applied = {
  before: { tags: ['$label1', 'preen_work'], flagged: false, read: false },
  after: { tags: ['$label1', 'preen_receipts', 'preen_processed'], flagged: true, read: true },
};

test('undo reverses tags, flag and read state Preen changed', () => {
  const plan = planUndo(applied.after, applied);
  assert.deepEqual(plan.update, { tags: ['$label1', 'preen_work'], flagged: false, read: false });
  assert.deepEqual(plan.changes, ['-preen_receipts', '-preen_processed', '+preen_work', 'unflagged', 'marked unread']);
});

test('undo keeps the user\'s own tags, and skips a flag or read state they already changed back', () => {
  // The user unflagged it, marked it unread and added their own tag.
  const now = { tags: ['$label1', 'preen_receipts', 'preen_processed', '$label2'], flagged: false, read: false };
  const plan = planUndo(now, applied);
  assert.deepEqual(plan.update, { tags: ['$label1', '$label2', 'preen_work'] });
});

test('undo of an already-reverted message changes nothing', () => {
  const plan = planUndo(applied.before, applied);
  assert.deepEqual(plan.update, {});
});

test('lastUndoableRun picks the newest run with changes not yet undone', () => {
  const e = (runId, at, extra = {}) => ({ runId, at, applied: { changes: ['+x'] }, ...extra });
  const entries = [
    e('r1', '2026-09-30T10:00:00Z'), e('r2', '2026-09-30T11:00:00Z'), e('r2', '2026-09-30T11:00:01Z'),
    e('r3', '2026-09-30T12:00:00Z', { undoneAt: '2026-09-30T12:05:00Z' }),
    { runId: 'r4', at: '2026-09-30T13:00:00Z', applied: { changes: [] } },
  ];
  const last = lastUndoableRun(entries);
  assert.equal(last.runId, 'r2');
  assert.equal(last.entries.length, 2);
  assert.equal(lastUndoableRun([]).runId, null);
});

// --- badge ------------------------------------------------------------------

test('badge: problem, limit, off, paused, queue', () => {
  const ticked = { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } };
  const on = mergeWithDefaults({ automation: { enabled: true }, scope: ticked });
  assert.match(badgeState({ settings: mergeWithDefaults({ automation: { enabled: true } }), queueLength: 0, status: {} }).title, /is off/, 'no mailbox ticked');
  assert.match(badgeState({ settings: mergeWithDefaults({ scope: ticked }), queueLength: 3, status: {} }).title, /is paused/);
  assert.equal(badgeState({ settings: on, queueLength: 0, status: { lastError: 'bad key' } }).text, '!');
  assert.match(badgeState({ settings: on, queueLength: 0, status: { blockedReason: 'Daily limit' } }).title, /Daily limit/);
  assert.equal(badgeState({ settings: mergeWithDefaults({}), queueLength: 5, status: {} }).text, '');
  assert.equal(badgeState({ settings: on, queueLength: 5, status: {} }).text, '5');
  assert.equal(badgeState({ settings: on, queueLength: 150, status: {} }).text, '99+');
});

// --- sender rules and summaries ---------------------------------------------

test('a sender rule presets Real person and says so', () => {
  const s = mergeWithDefaults({});
  assert.equal(presetPerson(s, 'person').person, 'person');
  assert.equal(presetPerson(s, 'service').person, 'service');
  assert.match(presetPerson(s, 'service').reason, /your rule/);
  assert.equal(presetPerson(mergeWithDefaults({ questions: { person: false } }), 'person').person, null);
});

test('monthly summaries count Real person and Needs reply', () => {
  const s = emptySummary('2026-09');
  addToSummary(s, { scores: {}, tags: ['Preen/Receipts'] });
  addToSummary(s, { scores: {}, tags: ['Preen/Real person', 'Preen/Needs reply'] });
  assert.deepEqual([s.person, s.needsReply], [1, 1]);
  const old = { month: '2026-08', messages: 0, tokens: 0, costUsd: 0, costKnownMessages: 0, byCategory: {}, applied: 0 };
  addToSummary(old, { scores: {}, tags: ['Preen/Real person'] });
  assert.equal(old.person, 1, 'works on summaries saved before these counters existed');
});

// --- end to end -------------------------------------------------------------

const inbox = { id: 'f1', accountId: 'a1', specialUse: ['inbox'], path: '/INBOX' };

function setup() {
  const msg = {
    header: {
      headerMessageId: 'm1@example', author: 'Sam <Sam@Example.org>', subject: 'Hi', date: new Date(),
      recipients: ['me@example.com'], ccList: [], folder: inbox, tags: [], flagged: false, read: false,
    },
    full: { contentType: 'text/plain', headers: {}, parts: [] },
    textParts: [{ contentType: 'text/plain', content: 'Hello' }],
  };
  const env = createMessenger({
    messages: { 1: msg }, contacts: ['sam@example.org'], folders: [inbox],
    tags: [{ key: '$label3', tag: 'To do', color: '#008000' }],
  });
  globalThis.messenger = env.messenger;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      model: 'jev',
      answers: {
        category: { type: 'choice', choice: 'Work', probabilities: { Work: 0.95 }, confidence: 0.9 },
        needs_reply: { type: 'noul', noul: 0.9 },
      },
      usage: { input_tokens: 500 },
    }), { status: 200 });
  };
  return { env, msg, requests };
}

const WORK = [{ name: 'Work', description: 'w' }];

test('sender rules: stored by address; the question is not asked; the contact fact is still sent', async () => {
  const { env, requests } = setup();
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, categories: WORK, depth: { default: 'surface', accounts: {} } }),
  });
  await setOverride(['sam@example.org'], 'service');
  assert.deepEqual(await readOverrides(), { 'sam@example.org': 'service' });
  const [entry] = await classifyMessages([1]);
  assert.equal('person' in requests[0].questions, false);
  assert.ok(!entry.tags.includes('Preen/Real person'), 'the "never" rule beats the address book');
  assert.ok(entry.reasons.some((r) => r.startsWith('Not a real person (your rule')));
  assert.deepEqual(env.calls.contactsQuery, ['sam@example.org']);
  assert.equal(requests[0].state.sender_is_contact, true);
  await setOverride(['sam@example.org'], null);
  assert.deepEqual(await readOverrides(), {});
});

test('apply, then undo: the message is back as it was, and the log says so', async () => {
  const { env, msg } = setup();
  await clearLog();
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({
      apiKey: 'k', consent: AGREED, dryRun: false, categories: WORK, depth: { default: 'surface', accounts: {} }, actions: { flagNeedsReply: true },
    }),
  });
  const [entry] = await classifyMessages([1], { apply: true });
  assert.ok(entry.runId);
  assert.equal(msg.header.flagged, true);
  assert.ok(msg.header.tags.includes('preen_work'));

  const [logged] = await readAll();
  const result = await undoEntries([logged]);
  assert.equal(result.undone, 1);
  assert.deepEqual(msg.header.tags, []);
  assert.equal(msg.header.flagged, false);
  assert.ok((await readAll())[0].undoneAt, 'entry marked as undone');
  assert.match((await readAll()).at(-1).notice, /reversed Preen's changes on 1 message/);
});

test('undo leaves alone a flag the user removed themselves', async () => {
  const { env, msg } = setup();
  await clearLog();
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({
      apiKey: 'k', consent: AGREED, dryRun: false, categories: WORK, depth: { default: 'surface', accounts: {} }, actions: { flagNeedsReply: true },
    }),
  });
  await classifyMessages([1], { apply: true });
  msg.header.flagged = false; // the user unflagged it
  msg.header.tags.push('$label3'); // and added their own tag
  const result = await undoEntries([(await readAll())[0]]);
  assert.equal(result.undone, 1);
  assert.deepEqual(msg.header.tags, ['$label3']);
  assert.equal(msg.header.flagged, false);
});
