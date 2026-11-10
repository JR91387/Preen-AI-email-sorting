// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// "Review this run": applying a preview's decisions without asking the provider again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { readAll, readSummaries, clearLog, clearCorrections, clearSummaries } from '../../apps/thunderbird/storage/activity-log.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { applyReviewed, reviewSummary, reviewable } from '../../apps/thunderbird/mail/apply-reviewed.js';
import { recordCorrected } from '../../apps/thunderbird/storage/processed.js';
import { lastUndoableRun } from '../../packages/shared/core/undo.js';

installIndexedDB();

const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };
const inbox = { id: 'a1-inbox', accountId: 'a1', specialUse: ['inbox'], name: 'Inbox', path: '/INBOX' };
const message = (n) => ({
  header: {
    headerMessageId: `m${n}@example`, author: 'Shop <orders@shop.example>', subject: `Order ${n}`,
    date: new Date(), recipients: ['me@example.com'], ccList: [], folder: inbox, tags: [], flagged: false, read: false,
  },
  full: { contentType: 'text/plain', headers: {}, parts: [] },
  textParts: [{ contentType: 'text/plain', content: `Order ${n} confirmed.` }],
});
const answers = {
  category: { type: 'choice', choice: 'Bills', probabilities: { Bills: 0.95 }, confidence: 0.9 },
  person: { type: 'noul', noul: 0.03 },
  needs_reply: { type: 'noul', noul: 0.02 },
};

let env;
let calls;
async function previewTwo(patch = {}) {
  env = createMessenger({ messages: { 1: message(1), 2: message(2) }, folders: [inbox] });
  globalThis.messenger = env.messenger;
  await clearLog();
  await clearCorrections();
  await clearSummaries();
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({ apiKey: 'k', consent: AGREED, dryRun: false, depth: { default: 'surface', accounts: {} }, ...patch }),
  });
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(init.body);
    return new Response(JSON.stringify({ model: 'jev', answers, usage: { input_tokens: 600 } }), { status: 200 });
  };
  await classifyMessages([1, 2]);
  return (await readAll()).filter(reviewable);
}

test('applying from the review changes the messages with no new request, as a normal undoable run', async () => {
  const entries = await previewTwo();
  assert.equal(entries.length, 2);
  const before = (await readSummaries())[0];
  const result = await applyReviewed(entries);
  assert.deepEqual(result, { applied: 2, corrected: 0, missing: 0, failed: 0 });
  assert.equal(calls.length, 2, 'only the preview asked the provider');
  assert.equal(env.calls.update.length, 2);
  const applied = (await readAll()).filter((e) => e.reviewOf);
  assert.equal(applied.length, 2);
  assert.ok(applied.every((e) => e.runKind === 'applied' && e.applied && e.source === 'manual'));
  const after = (await readSummaries())[0];
  assert.equal(after.messages, before.messages, 'messages are not counted twice');
  assert.equal(after.tokens, before.tokens);
  assert.equal(after.applied, before.applied + 2);
  assert.equal(lastUndoableRun(await readAll()).entries.length, 2, 'Undo last run finds them');
  assert.equal(reviewSummary(result), "Applied Preen's decisions to 2 messages.");
});

test('a to-do decided in the preview is flagged when applied from the review, with no To-do tag', async () => {
  answers.to_do = { type: 'noul', noul: 0.9 };
  try {
    const entries = await previewTwo({ actions: { flagToDo: true } });
    assert.ok(entries.every((e) => e.toDo === true && !e.tags.includes('Preen/To-do')));
    await applyReviewed(entries);
    for (const n of [1, 2]) {
      const header = env.messenger.messages.get ? await env.messenger.messages.get(n) : null;
      assert.equal(header.flagged, true, `message ${n} is flagged`);
      assert.ok(!header.tags.includes('preen_to_do'));
    }
  } finally {
    delete answers.to_do;
  }
});

test('the review leaves corrected messages alone', async () => {
  const entries = await previewTwo();
  await recordCorrected(['a1|m1@example']);
  const result = await applyReviewed(entries);
  assert.equal(result.applied, 1);
  assert.equal(result.corrected, 1);
  assert.match(reviewSummary(result), /1 message left alone because you corrected it/);
});

test('with dry run on, the review changes nothing and says why', async () => {
  const entries = await previewTwo({ dryRun: true });
  const result = await applyReviewed(entries);
  assert.equal(result.dryRun, true);
  assert.equal(env.calls.update?.length ?? 0, 0);
  assert.match(reviewSummary(result), /Dry run is on/);
});

test('a row\'s Apply and Apply all at the same time apply each message once', async () => {
  const entries = await previewTwo();
  const [one, all] = await Promise.all([applyReviewed([entries[0]]), applyReviewed(entries)]);
  assert.equal(one.applied, 1);
  assert.equal(all.applied, 1, 'the second call skips the message the first applied');
  assert.equal((await readAll()).filter((e) => e.reviewOf).length, 2);
  assert.equal(env.calls.update.length, 2);
});
