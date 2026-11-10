// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { readAll, clearLog, clearCorrections, readDebugAll, readDebug, clearDebug } from '../../apps/thunderbird/storage/activity-log.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { RUN_PROGRESS_KEY } from '../../packages/shared/core/protocol.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

// The user has agreed to send mail to the provider.
const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };

const idb = installIndexedDB();

function makeMessage(accountId, { encrypted = false } = {}) {
  return {
    header: {
      headerMessageId: `msg-${accountId}@example`,
      author: 'Sam <sam@example.org>',
      subject: 'Invoice 42',
      date: new Date('2026-09-30T10:00:00Z'),
      recipients: ['me@example.com'],
      ccList: [],
      folder: { accountId },
    },
    full: encrypted
      ? { contentType: 'multipart/encrypted', headers: {}, parts: [] }
      : { contentType: 'text/plain', headers: { from: ['Sam <sam@example.org>'] }, parts: [] },
    textParts: [{ contentType: 'text/plain', content: 'Please pay invoice 42 by Friday.' }],
  };
}

function answers(p, person = 0.05, reply = 0.1) {
  return {
    category: { type: 'choice', choice: 'Bills', probabilities: { Bills: p }, confidence: 0.8 },
    person: { type: 'noul', noul: person },
    needs_reply: { type: 'noul', noul: reply },
  };
}

// Queues fake API responses and records each request body.
function mockFetch(...responses) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    const data = responses.shift();
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return requests;
}

let env;
async function useMessenger(m) {
  env = m;
  globalThis.messenger = env.messenger;
  await clearLog();
  await clearCorrections();
}

async function setup(depth, messages = { 1: makeMessage('acct1') }) {
  await useMessenger(createMessenger({ messages }));
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, depth }),
  });
}

beforeEach(() => {
  delete globalThis.messenger;
});

test('Surface account: one request without body; message text never read', async () => {
  await setup({ default: 'deep', accounts: { acct1: 'surface' } });
  const requests = mockFetch({ model: 'jev', answers: answers(0.5), usage: { input_tokens: 380 } });
  const [entry] = await classifyMessages([1]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].state.email.body_included, false);
  assert.equal('body' in requests[0].state.email, false);
  assert.deepEqual(env.calls.listInlineTextParts, [], 'body must not be read');
  assert.equal(entry.mode, 'surface');
  assert.equal(entry.decidedBy, 'surface');
  assert.equal(entry.review, true);
  assert.ok(!entry.tags.includes('Preen/Review'), 'Review is recorded, never tagged');
});

test('Deep account: one request that includes the body', async () => {
  await setup({ default: 'deep', accounts: {} });
  const requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].state.email.body_included, true);
  assert.equal(entry.decidedBy, 'full');
});

test('encrypted messages are skipped with no request, never decrypted', async () => {
  await setup({ default: 'deep', accounts: {} }, { 1: makeMessage('acct1', { encrypted: true }) });
  const requests = mockFetch();
  const [entry] = await classifyMessages([1]);
  assert.equal(requests.length, 0);
  assert.equal(entry.skipped, 'encrypted');
  assert.ok(env.calls.getFull.every((c) => c.options?.decrypt === false));
});

test('results are logged with sender and subject (D126), never the message text', async () => {
  await setup({ default: 'deep', accounts: {} });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  const [entry] = (await readAll());
  assert.equal(entry.subject, 'Invoice 42');
  assert.match(entry.from, /sam@example\.org/);
  assert.ok(!JSON.stringify((await readAll())).includes('Please pay'), 'no message text');
});

test('missing permission stops before any request', async () => {
  await useMessenger(createMessenger({ messages: { 1: makeMessage('acct1') }, permissionGranted: false }));
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED }) });
  const requests = mockFetch();
  await assert.rejects(classifyMessages([1]), /needs permission/);
  assert.equal(requests.length, 0);
});

// --- Stage 3: applying changes ----------------------------------------------

async function setupApply(patch, { contacts = [], tags = [], header = {}, folders = [], optionalGranted = [] } = {}) {
  const msg = makeMessage('acct1');
  Object.assign(msg.header, { tags: [], flagged: false, read: false }, header);
  await useMessenger(createMessenger({ messages: { 1: msg }, contacts, tags, folders, optionalGranted }));
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, depth: { default: 'deep', accounts: {} }, ...patch }),
  });
  return msg;
}

test('dry run on: Classify changes nothing and is logged as a dry run', async () => {
  await setupApply({ dryRun: true });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1], { apply: true });
  assert.deepEqual(env.calls.update, []);
  assert.deepEqual(env.calls.tagsCreate, []);
  assert.equal(entry.runKind, 'dry run');
  assert.equal(entry.applied, null);
});

test('dry run off: creates tags, applies them, keeps user tags, records processed', async () => {
  const msg = await setupApply({ dryRun: false }, { tags: [{ key: '$label1', tag: 'Important', color: '#FF0000' }], header: { tags: ['$label1'] } });
  mockFetch({ model: 'jev', answers: answers(0.95, 0.05, 0.1), usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.runKind, 'applied');
  assert.ok(env.calls.tagsCreate.includes('preen_bills'));
  assert.deepEqual(msg.header.tags, ['$label1', 'preen_bills', 'preen_processed'], 'no tag for "not a real person"');
  assert.deepEqual(entry.applied.before.tags, ['$label1']);
  assert.ok(entry.applied.changes.includes('+preen_bills'));
  assert.ok(env.store.processed['acct1|msg-acct1@example']);
});

test('To-do and Review are recorded and acted on without any tag: only Preen\'s four tag kinds are created', async () => {
  const msg = await setupApply({ dryRun: false, actions: { flagToDo: true } });
  const toDoAnswers = { ...answers(0.95), to_do: { type: 'noul', noul: 0.9 } };
  mockFetch({ model: 'jev', answers: toDoAnswers, usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.toDo, true);
  assert.equal(entry.review, false);
  assert.equal(msg.header.flagged, true, 'flagged because it is a to-do');
  assert.deepEqual(msg.header.tags, ['preen_bills', 'preen_processed']);
  assert.ok(!entry.tags.some((t) => /to-?do|review|sensitive/i.test(t)));
  assert.ok(env.calls.tagsCreate.every((k) => !/to_do|review|sensitive/.test(k)), env.calls.tagsCreate.join());
  // Unsure of the category: Review is recorded, still no tag.
  mockFetch({ model: 'jev', answers: answers(0.5), usage: { input_tokens: 700 } });
  const [unsure] = await classifyMessages([1], { apply: true, force: true });
  assert.equal(unsure.review, true);
  assert.ok(!unsure.tags.some((t) => /review/i.test(t)));
});

test('Preview never changes messages, even with dry run off', async () => {
  await setupApply({ dryRun: false });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1]);
  assert.deepEqual(env.calls.update, []);
  assert.equal(entry.runKind, 'preview');
  assert.equal(env.store.processed, undefined);
});

test('category action "mark as unread" is applied', async () => {
  const msg = await setupApply({
    dryRun: false,
    categories: [{ name: 'Bills', description: 'r', actions: { markUnread: true } }],
  }, { header: { read: true } });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1], { apply: true });
  assert.equal(msg.header.read, false);
});

test('address-book sender: Real person is asked, with the contact fact in state', async () => {
  await setupApply({}, { contacts: ['sam@example.org'] });
  const requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  assert.ok('person' in requests[0].questions);
  assert.equal(requests[0].state.sender_is_contact, true);
});

test('obvious bulk headers: Real person is asked, with the header signs in state', async () => {
  const msg = await setupApply({});
  msg.full.headers['list-unsubscribe'] = ['<https://x.example/unsub>'];
  msg.full.headers['x-sg-eid'] = ['abc'];
  const requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  assert.ok('person' in requests[0].questions);
  assert.ok(requests[0].state.header_hints.automated_signs.length > 0);
});

test('a failed update is logged, not thrown', async () => {
  const msg = await setupApply({ dryRun: false });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  env.messenger.messages.update = async () => { throw new Error('folder is read-only'); };
  const [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.applyError, 'folder is read-only');
  assert.equal(env.store.processed, undefined, 'not marked processed when the update failed');
  assert.deepEqual(msg.header.tags, []);
});

test('logged cost: null without a price; provider cost when reported; user price otherwise', async () => {
  await setup({ default: 'deep', accounts: {} });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 1000 } });
  let [entry] = await classifyMessages([1]);
  assert.equal(entry.inputTokens, 1000);
  assert.equal(entry.costUsd, null);

  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 1000, cost: 0.00007 } });
  [entry] = await classifyMessages([1]);
  assert.equal(entry.costUsd, 0.00007);
  assert.equal(entry.costSource, 'provider');

  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, depth: { default: 'deep', accounts: {} }, pricePerMillionInputTokens: 0.5 }),
  });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 1000 } });
  [entry] = await classifyMessages([1]);
  assert.equal(entry.costUsd, 0.0005);
  assert.equal(entry.costSource, 'user price');
});

test('Junk on, dry run off: spam gets Thunderbird\'s Junk mark, recorded for undo', async () => {
  const msg = await setupApply({ dryRun: false, questions: { junk: true } });
  const requests = mockFetch({ model: 'jev', answers: { ...answers(0.95), junk: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1], { apply: true });
  assert.ok('junk' in requests[0].questions);
  assert.equal(entry.junk, true);
  assert.equal(msg.header.junk, true);
  assert.ok(entry.applied.changes.includes('marked junk'));
  assert.equal(entry.applied.before.junk, false);
});

test('Junk on, dry run: nothing is marked, the verdict is only logged', async () => {
  const msg = await setupApply({ dryRun: true, questions: { junk: true } });
  mockFetch({ model: 'jev', answers: { ...answers(0.95), junk: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.junk, true);
  assert.deepEqual(env.calls.update, []);
  assert.notEqual(msg.header.junk, true);
});

test('Junk on: an address-book sender is asked like any other, with the contact fact, at the normal threshold', async () => {
  const msg = await setupApply({ dryRun: false, questions: { junk: true } }, { contacts: ['sam@example.org'] });
  let requests = mockFetch({ model: 'jev', answers: { ...answers(0.95), junk: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: 700 } });
  let [entry] = await classifyMessages([1], { apply: true });
  assert.ok('junk' in requests[0].questions);
  assert.equal(requests[0].state.sender_is_contact, true);
  assert.equal(entry.junk, false);
  assert.notEqual(msg.header.junk, true);
  await setupApply({ dryRun: false, questions: { junk: true } }, { contacts: ['sam@example.org'] });
  requests = mockFetch({ model: 'jev', answers: { ...answers(0.95), junk: { type: 'noul', noul: 0.99 } }, usage: { input_tokens: 700 } });
  [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.junk, true);
});

test('Junk on: a sender with a "real person" rule is still asked about junk', async () => {
  await setupApply({ questions: { junk: true } });
  await env.messenger.storage.local.set({ senderOverrides: { 'sam@example.org': 'person' } });
  const requests = mockFetch({ model: 'jev', answers: { ...answers(0.95), junk: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 700 } });
  const [entry] = await classifyMessages([1]);
  assert.ok('junk' in requests[0].questions);
  assert.equal('person' in requests[0].questions, false, 'the rule still answers Real person');
  assert.ok(entry.tags.includes('Preen/Real person'));
});

test('Stop: messages not yet started are skipped, summed in one notice, and nothing is applied after it', async () => {
  const { stopRuns, STOPPED_BY_USER } = await import('../../apps/thunderbird/background/pipeline.js');
  await useMessenger(createMessenger({ messages: { 1: makeMessage('acct1'), 2: makeMessage('acct2'), 3: makeMessage('acct3') } }));
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, depth: { default: 'deep', accounts: {} } }) });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) stopRuns(); // Stop clicked while the first message is being classified
    return new Response(JSON.stringify({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } }), { status: 200 });
  };
  const results = await classifyMessages([1, 2, 3]);
  const stopped = results.filter((r) => r.skipped === STOPPED_BY_USER);
  assert.ok(stopped.length >= 1, 'later messages were skipped');
  assert.ok(calls < 3, 'no request for stopped messages');
  const rows = (await readAll());
  assert.equal(rows.filter((e) => e.skipped === STOPPED_BY_USER).length, 0, 'no row per stopped message');
  assert.ok(rows.some((e) => /^Stopped: \d+ messages? (was|were) not classified/.test(e.notice ?? '')));
  // A run requested after the Stop runs normally.
  const after = await classifyMessages([1]);
  assert.equal(after[0].skipped, undefined);
});

test('results reach the history while a run is still going, not only at the end', async () => {
  const ids = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, makeMessage(`acct${i}`)]));
  await useMessenger(createMessenger({ messages: ids }));
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, depth: { default: 'deep', accounts: {} } }) });
  let seenMidRun = 0;
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    if (n === 7) seenMidRun = (await readAll()).length; // before the last message finishes
    return new Response(JSON.stringify({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } }), { status: 200 });
  };
  await classifyMessages([1, 2, 3, 4, 5, 6, 7]);
  assert.ok(seenMidRun >= 5, `at least one batch of 5 was saved mid-run (saw ${seenMidRun})`);
  assert.equal((await readAll()).filter((e) => e.scores).length, 7);
});

test('progress is published while a run goes and cleared when it ends', async () => {
  const ids = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, makeMessage(`acct${i}`)]));
  await useMessenger(createMessenger({ messages: ids }));
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, depth: { default: 'deep', accounts: {} } }) });
  const seen = [];
  globalThis.fetch = async () => {
    seen.push(env.store[RUN_PROGRESS_KEY]);
    return new Response(JSON.stringify({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } }), { status: 200 });
  };
  await classifyMessages([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(seen[0].total, 8);
  assert.equal(seen[0].kind, 'preview');
  // Progress is published with each saved batch of 5, so later requests see it.
  assert.ok(seen.some((p) => p?.done >= 5), 'progress moved during the run');
  assert.equal(env.store[RUN_PROGRESS_KEY], null, 'cleared at the end');
});

test('progress is cleared even when saving results fails, and stale progress is cleared at the start', async () => {
  const ids = Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [i, makeMessage(`acct${i}`)]));
  await useMessenger(createMessenger({ messages: ids }));
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, depth: { default: 'deep', accounts: {} } }),
    [RUN_PROGRESS_KEY]: { runId: 'old', kind: 'preview', done: 3, total: 9 },
  });
  idb.failWrites = 'disk full'; // the environment's disk is full
  mockFetch(...[1, 2, 3, 4, 5, 6].map(() => ({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } })));
  await classifyMessages([1, 2, 3, 4, 5, 6]).catch(() => {});
  idb.failWrites = null;
  assert.equal(env.store[RUN_PROGRESS_KEY], null);
});

test('a DMARC failure is sent to Jev as dmarc_failed', async () => {
  const msg = await setupApply({ questions: { junk: true } }, { contacts: ['sam@example.org'] });
  msg.full.headers['authentication-results'] = ['mx.example.com; spf=fail; dmarc=fail (p=reject) header.from=example.org'];
  const requests = mockFetch({ model: 'jev', answers: { ...answers(0.95), junk: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  assert.ok('junk' in requests[0].questions);
  assert.equal(requests[0].state.dmarc_failed, true);
  assert.equal(requests[0].state.sender_is_contact, true);
});

test('the request tells Jev whether the sender is a contact: true, false, or unknown when the lookup fails', async () => {
  await setupApply({}, { contacts: ['sam@example.org'] });
  let requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  assert.equal(requests[0].state.sender_is_contact, true);
  await setupApply({});
  requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  assert.equal(requests[0].state.sender_is_contact, false);
  await setupApply({});
  env.messenger.addressBooks.contacts.query = async () => { throw new Error('address book down'); };
  requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await classifyMessages([1]);
  } finally {
    console.warn = warn;
  }
  assert.equal(requests[0].state.sender_is_contact, 'unknown');
});

const INBOX = { id: 'f-inbox', accountId: 'acct1', path: '/INBOX', name: 'Inbox', specialUse: ['inbox'] };
const JUNK = { id: 'f-junk', accountId: 'acct1', path: '/Junk', name: 'Junk', specialUse: ['junk'] };
const spam = () => mockFetch({ model: 'jev', answers: { ...answers(0.95), junk: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 700 } });

test('move junk (opt-in, D127): off by default, so junk is marked but stays put', async () => {
  const msg = await setupApply({ dryRun: false, questions: { junk: true } }, { header: { folder: INBOX }, folders: [INBOX, JUNK] });
  spam();
  await classifyMessages([1], { apply: true });
  assert.equal(msg.header.junk, true);
  assert.equal(env.calls.move, undefined);
});

test('move junk on: junk goes to the account\'s Junk folder, recorded so Undo can move it back', async () => {
  const { undoEntries } = await import('../../apps/thunderbird/mail/undo.js');
  const msg = await setupApply({ dryRun: false, questions: { junk: true }, actions: { moveJunk: true } },
    { header: { folder: INBOX }, folders: [INBOX, JUNK], optionalGranted: ['messagesMove'] });
  spam();
  const [entry] = await classifyMessages([1], { apply: true });
  assert.deepEqual(env.calls.move, [{ ids: [1], folderId: 'f-junk' }]);
  assert.equal(msg.header.folder.path, '/Junk');
  assert.deepEqual(entry.applied.moved, { accountId: 'acct1', fromPath: '/INBOX', toPath: '/Junk' });
  const [logged] = (await readAll()).filter((e) => e.applied);
  await undoEntries([logged]);
  assert.equal(msg.header.folder.path, '/INBOX', 'Undo moved it back');
  const notice = (await readAll()).find((e) => e.undo);
  assert.deepEqual(notice.undo, { runs: 1, messages: 1 }, 'counted for the statistics: runs undone, messages restored');
  assert.equal(msg.header.junk, false, 'and cleared the junk mark Preen set');
});

test('Undo after the move permission was taken back: the message stays in Junk, untouched, counted as failed', async () => {
  const { undoEntries } = await import('../../apps/thunderbird/mail/undo.js');
  const msg = await setupApply({ dryRun: false, questions: { junk: true }, actions: { moveJunk: true } },
    { header: { folder: INBOX }, folders: [INBOX, JUNK], optionalGranted: ['messagesMove'] });
  spam();
  await classifyMessages([1], { apply: true });
  assert.equal(msg.header.folder.path, '/Junk');
  env.messenger.permissions.contains = async () => false; // the user revoked it in Thunderbird
  const [logged] = (await readAll()).filter((e) => e.applied);
  const result = await undoEntries([logged]);
  assert.equal(result.failed, 1);
  assert.equal(msg.header.folder.path, '/Junk');
  assert.equal(msg.header.junk, true, 'not un-marked while it stays in Junk');
});

test('Undo when the original folder is gone: the message stays in Junk and keeps its junk mark', async () => {
  const { undoEntries } = await import('../../apps/thunderbird/mail/undo.js');
  const msg = await setupApply({ dryRun: false, questions: { junk: true }, actions: { moveJunk: true } },
    { header: { folder: INBOX }, folders: [INBOX, JUNK], optionalGranted: ['messagesMove'] });
  spam();
  await classifyMessages([1], { apply: true });
  env.messenger.folders.query = async () => []; // the folder it came from was deleted
  const [logged] = (await readAll()).filter((e) => e.applied);
  const result = await undoEntries([logged]);
  assert.equal(result.failed, 1);
  assert.equal(msg.header.folder.path, '/Junk');
  assert.equal(msg.header.junk, true, 'not un-marked while it stays in Junk');
});

test('move junk on: never in dry run, and a missing Junk folder is noted, not an error', async () => {
  const dry = await setupApply({ questions: { junk: true }, actions: { moveJunk: true } }, { header: { folder: INBOX }, folders: [INBOX, JUNK] });
  spam();
  await classifyMessages([1], { apply: true });
  assert.equal(env.calls.move, undefined);
  assert.equal(dry.header.folder.path, '/INBOX');
  const noJunk = await setupApply({ dryRun: false, questions: { junk: true }, actions: { moveJunk: true } },
    { header: { folder: INBOX }, folders: [INBOX], optionalGranted: ['messagesMove'] });
  spam();
  const [entry] = await classifyMessages([1], { apply: true });
  assert.equal(noJunk.header.junk, true);
  assert.ok(entry.applied.changes.includes('not moved: no Junk folder in this account'));
});

test('move junk on but Thunderbird\'s move permission not allowed (lab item 25): marked, not moved, and said why', async () => {
  const msg = await setupApply({ dryRun: false, questions: { junk: true }, actions: { moveJunk: true } },
    { header: { folder: INBOX }, folders: [INBOX, JUNK] });
  spam();
  const [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.applyError, null);
  assert.equal(msg.header.junk, true);
  assert.equal(msg.header.folder.path, '/INBOX');
  assert.equal(env.calls.move, undefined);
  assert.ok(entry.applied.changes.some((c) => c.startsWith('not moved: Preen isn\'t allowed to move mail')));
});

test('a failing Junk-folder lookup is reported, not hidden', async () => {
  await setupApply({ dryRun: false, questions: { junk: true }, actions: { moveJunk: true } },
    { header: { folder: INBOX }, folders: [INBOX, JUNK], optionalGranted: ['messagesMove'] });
  env.messenger.folders.query = async () => { throw new Error('folders API unavailable'); };
  spam();
  const [entry] = await classifyMessages([1], { apply: true });
  assert.ok(entry.applied.changes.includes('not moved: couldn\'t find the Junk folder (folders API unavailable)'));
});

test('the first model seen is remembered quietly; a later different model adds one notice', async () => {
  await setup({ default: 'deep', accounts: {} });
  mockFetch({ model: 'typesafe/jev-1.13', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  assert.equal(env.store.lastModel, 'typesafe/jev-1.13');
  assert.equal((await readAll()).filter((e) => e.notice).length, 0);
  mockFetch({ model: 'typesafe/jev-1.14', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  const notices = (await readAll()).filter((e) => /now answers with/.test(e.notice ?? ''));
  assert.equal(notices.length, 1);
  assert.equal(env.store.lastModel, 'typesafe/jev-1.14');
});

test('D136 sensitive flag: off by default; on, a card number in the subject is recorded as Sensitive (no tag) with a value-free reason', async () => {
  const msg = await setupApply({});
  msg.header.subject = 'Your card 4111 1111 1111 1111 was charged';
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  let [entry] = await classifyMessages([1], { apply: true });
  assert.ok(!entry.tags.includes('Preen/Sensitive'), 'off by default');
  assert.equal(entry.sensitive, false);

  await setupApply({ localChecks: { sensitive: true } });
  env.messenger.messages.get = async () => ({ ...msg.header, id: 1 });
  mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  [entry] = await classifyMessages([1], { apply: true });
  assert.equal(entry.sensitive, true);
  assert.ok(!entry.tags.includes('Preen/Sensitive'), 'noted, never tagged');
  assert.ok(!msg.header.tags.includes('preen_sensitive'), 'no tag on the message');
  assert.ok(entry.reasons.some((r) => /payment card number/.test(r)));
  assert.ok(!JSON.stringify(entry.reasons).includes('4111'), 'never the value');
});

test('by default, PII the local patterns find is replaced with <PII_Block> in the body and subject sent', async () => {
  const msg = await setupApply({});
  msg.textParts[0].content = 'Your card 4111 1111 1111 1111 was charged. SSN 078-05-1120.';
  msg.header.subject = 'Card 4111 1111 1111 1111 receipt';
  const requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  const { email } = requests[0].state;
  assert.equal(email.body, 'Your card <PII_Block> was charged. SSN <PII_Block>.');
  assert.equal(email.subject, 'Card <PII_Block> receipt');

  const settings = (await env.messenger.storage.local.get('settings')).settings;
  settings.localChecks.replacePii = false;
  await env.messenger.storage.local.set({ settings });
  const off = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1], { force: true });
  assert.ok(off[0].state.email.body.includes('4111 1111 1111 1111'));
});

test('a card number split by the length cut is still replaced: replace first, then cut', async () => {
  const msg = await setupApply({});
  msg.textParts[0].content = `${'word '.repeat(397)}4111 1111 1111 1111 end`;
  const requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
  await classifyMessages([1]);
  const { email } = requests[0].state;
  assert.ok(!email.body.includes('4111'), 'no part of the number is sent');
  assert.ok(email.body.includes('<PII_Block>'));
});

test('Sensitive check looks at the full message text, even at Surface depth and past the sent length', async () => {
  for (const depth of ['surface', 'deep']) {
    const msg = await setupApply({ localChecks: { sensitive: true }, depth: { default: depth, accounts: {} } });
    msg.textParts[0].content = `${'word '.repeat(500)}card 4111 1111 1111 1111`;
    const requests = mockFetch({ model: 'jev', answers: answers(0.95), usage: { input_tokens: 700 } });
    const [entry] = await classifyMessages([1], { apply: true });
    assert.equal(entry.sensitive, true, depth);
    assert.ok(!entry.tags.includes('Preen/Sensitive'), depth);
    assert.equal('body' in requests[0].state.email, depth === 'deep', `${depth}: nothing extra is sent`);
    assert.ok(!JSON.stringify(requests[0]).includes('4111'), `${depth}: the number is never sent`);
  }
});

const DEBUG_KEY = 'sk-or-v1-debug-SECRET-0042';

// Records each request body exactly as sent, and answers with fixed text.
function rawFetch(responseText) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(init.body);
    return new Response(responseText, { status: 200 });
  };
  return sent;
}

async function setupDebug(enabled) {
  await useMessenger(createMessenger({ messages: { 1: makeMessage('acct1') } }));
  await clearDebug();
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ apiKey: DEBUG_KEY, consent: AGREED, depth: { default: 'surface', accounts: {} }, debug: { enabled } }),
  });
}

test('debug on: the exact request and response, the decision and a settings snapshot are stored, never the key', async () => {
  await setupDebug(true);
  const responseText = JSON.stringify({ model: 'jev', answers: answers(0.9, 0.9, 0.9), usage: { input_tokens: 10 } }, null, 1);
  const sent = rawFetch(responseText);
  const [entry] = await classifyMessages([1]);
  const records = await readDebugAll();
  assert.equal(records.length, 1);
  const [r] = records;
  assert.equal(r.request, sent[0], 'request byte-equal');
  assert.equal(r.response, responseText, 'response byte-equal');
  assert.equal(r.status, 200);
  assert.equal(r.model, 'jev');
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.key, 'msg-acct1@example');
  assert.deepEqual(r.decision.tags, entry.tags);
  assert.ok(Array.isArray(r.decision.actions));
  assert.equal(r.settings.thresholds.category, 0.75);
  assert.equal(r.settings.depth.default, 'surface');
  assert.equal(r.settings.categories.length, 4);
  assert.equal('apiKey' in r.settings, false);
  assert.ok(!JSON.stringify(records).includes(DEBUG_KEY), 'the API key never appears in a record');
  assert.equal(entry.debugId, r.entryId);
  assert.equal((await readDebug(entry.debugId)).length, 1);
  assert.equal((await readAll()).find((e) => e.messageId === 1).debugId, entry.debugId);
});

test('debug off (the default): nothing is stored', async () => {
  await setupDebug(false);
  rawFetch(JSON.stringify({ model: 'jev', answers: answers(0.9), usage: {} }));
  const [entry] = await classifyMessages([1]);
  assert.equal((await readDebugAll()).length, 0);
  assert.equal('debugId' in entry, false);
});

test('debug on: a failed request is stored with its error kind', async () => {
  await setupDebug(true);
  globalThis.fetch = async () => new Response('unknown model', { status: 400 });
  const [entry] = await classifyMessages([1]);
  assert.equal(entry.error.kind, 'bad_request');
  const records = await readDebugAll();
  assert.equal(records.length, 1);
  assert.deepEqual([records[0].status, records[0].error, records[0].response, records[0].decision], [400, 'bad_request', 'unknown model', null]);
});
