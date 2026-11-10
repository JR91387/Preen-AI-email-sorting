// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Audit A-findings: a failure must not pass for "not found" / "not a contact".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFolderId } from '../../apps/thunderbird/mail/folders.js';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { appendEntries, readAll, clearLog } from '../../apps/thunderbird/storage/activity-log.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { findMessageHeader } from '../../apps/thunderbird/mail/messages.js';
import { undoEntries } from '../../apps/thunderbird/mail/undo.js';

// The user has agreed to send mail to the provider.
const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };

installIndexedDB();

test('A-3: a failed folder query throws and is not cached as "not found"', async () => {
  let fail = true;
  globalThis.messenger = {
    folders: {
      async query() {
        if (fail) throw new Error('boom');
        return [{ id: 'f1', path: '/Junk' }];
      },
    },
  };
  const cache = new Map();
  await assert.rejects(resolveFolderId('a', '/Junk', cache), /boom/);
  assert.equal(cache.size, 0);
  fail = false;
  assert.equal(await resolveFolderId('a', '/Junk', cache), 'f1');
});

test('A-1: undoing a Junk move whose origin folder is gone counts as failed and stays retryable', async () => {
  const junk = { id: 'junk', accountId: 'a1', specialUse: ['junk'], name: 'Junk', path: '/Junk' };
  const header = {
    headerMessageId: 'm1@example', folder: junk, tags: [], flagged: false, read: false,
  };
  const env = createMessenger({
    messages: { 1: { header: { id: 1, ...header }, full: {}, textParts: [] } },
    folders: [junk],
    optionalGranted: ['messagesMove'],
  });
  globalThis.messenger = env.messenger;
  await clearLog();
  const state = { tags: [], flagged: false, read: false };
  await appendEntries([{
    messageId: 1,
    headerMessageId: 'm1@example',
    applied: { before: state, after: state, moved: { accountId: 'a1', fromPath: '/Gone', toPath: '/Junk' } },
  }]);
  const warn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await undoEntries(await readAll());
  } finally {
    console.warn = warn;
  }
  assert.equal(result.failed, 1);
  assert.equal(result.undone, 0);
  assert.equal((await readAll())[0].undoneAt, undefined, 'not marked undone');
});

test('A-4: when the address book lookup fails, Junk is still asked, with sender_is_contact unknown', async () => {
  const inbox = { id: 'f1', accountId: 'a1', specialUse: ['inbox'], path: '/INBOX' };
  const msg = {
    header: {
      headerMessageId: 'm1@example', author: 'Sam <sam@example.org>', subject: 'Hi', date: new Date(),
      recipients: ['me@example.com'], ccList: [], folder: inbox, tags: [], flagged: false, read: false,
    },
    full: { contentType: 'text/plain', headers: {}, parts: [] },
    textParts: [{ contentType: 'text/plain', content: 'Hello' }],
  };
  const env = createMessenger({ messages: { 1: msg }, folders: [inbox] });
  env.messenger.addressBooks.contacts.query = async () => { throw new Error('address book down'); };
  globalThis.messenger = env.messenger;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      model: 'jev',
      answers: {
        category: { type: 'choice', choice: 'Work', probabilities: { Work: 0.95 }, confidence: 0.9 },
        junk: { type: 'noul', noul: 0.99 },
      },
      usage: { input_tokens: 500 },
    }), { status: 200 });
  };
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({
      apiKey: 'k', consent: AGREED, categories: [{ name: 'Work', description: 'w' }], questions: { junk: true }, depth: { default: 'surface', accounts: {} },
    }),
  });
  const warn = console.warn;
  console.warn = () => {};
  let entry;
  try {
    [entry] = await classifyMessages([1]);
  } finally {
    console.warn = warn;
  }
  assert.ok('junk' in requests[0].questions, 'junk asked');
  assert.equal(requests[0].state.sender_is_contact, 'unknown');
  assert.equal(entry.junk, true);
});

test('A-6: findMessageHeader returns null only for not-found; a failing search throws', async () => {
  const env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  assert.equal(await findMessageHeader(1, 'x@example'), null, 'not found');
  env.messenger.messages.query = async () => { throw new Error('search failed'); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(findMessageHeader(1, 'x@example'), /search failed/);
  } finally {
    console.warn = warn;
  }
});
