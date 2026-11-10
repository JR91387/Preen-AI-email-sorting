// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Messages the user corrected: automatic runs and Classify leave them alone; Preview and
// Classify anyway still run them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { clearLog, clearCorrections } from '../../apps/thunderbird/storage/activity-log.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { scan } from '../../apps/thunderbird/background/scheduler.js';
import { recordCorrected, CORRECTED_KEY } from '../../apps/thunderbird/storage/processed.js';
import { eligibility } from '../../packages/shared/core/scope.js';
import { CORRECTED, correctedText, skipSummary } from '../../packages/shared/core/run-summary.js';

installIndexedDB();

const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };
const inbox = { id: 'a1-inbox', accountId: 'a1', specialUse: ['inbox'], name: 'Inbox', path: '/INBOX' };

function message(n) {
  return {
    header: {
      headerMessageId: `m${n}@example`, author: 'Shop <orders@shop.example>', subject: `Order ${n}`,
      date: new Date(Date.now() - 3600_000), recipients: ['me@example.com'], ccList: [], folder: inbox, tags: [], flagged: false, read: false,
    },
    full: { contentType: 'text/plain', headers: {}, parts: [] },
    textParts: [{ contentType: 'text/plain', content: `Order ${n} confirmed.` }],
  };
}

const answers = {
  category: { type: 'choice', choice: 'Receipts', probabilities: { Receipts: 0.95 }, confidence: 0.9 },
  person: { type: 'noul', noul: 0.03 },
  needs_reply: { type: 'noul', noul: 0.02 },
};

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'jev', answers, usage: { input_tokens: 600 } }), { status: 200 });
  };
  return calls;
}

let env;
async function setup() {
  env = createMessenger({ messages: { 1: message(1), 2: message(2) }, folders: [inbox] });
  globalThis.messenger = env.messenger;
  await clearLog();
  await clearCorrections();
  await env.messenger.storage.local.set({
    settings: mergeWithDefaults({
      apiKey: 'k', consent: AGREED, dryRun: false, depth: { default: 'surface', accounts: {} },
      automation: { enabled: true, trigger: 'scheduled', intervalMinutes: 15, maxAgeDays: 2, unreadOnly: false },
      scope: { accounts: { a1: { enabled: true, folders: 'inbox' } } },
    }),
  });
  await recordCorrected(['a1|m1@example']);
}

test('the corrected set is stored like the processed record', async () => {
  await setup();
  assert.ok(env.store[CORRECTED_KEY]['a1|m1@example']);
});

test('eligibility: a corrected message is not eligible, with the plain reason', () => {
  const settings = mergeWithDefaults({});
  const r = eligibility({ headerMessageId: 'x', date: new Date() }, settings, { corrected: true });
  assert.deepEqual(r, { ok: false, reason: 'You corrected this message' });
});

test('Classify skips corrected messages; no request is sent for them', async () => {
  await setup();
  const calls = mockFetch();
  const results = await classifyMessages([1, 2], { apply: true });
  assert.equal(calls.length, 1);
  assert.equal(results.find((r) => r.messageId === 1).skipped, CORRECTED);
  assert.ok(results.find((r) => r.messageId === 2).scores);
  assert.equal(skipSummary(results), null, 'not counted as a run left undone');
});

test('Preview still runs on corrected messages', async () => {
  await setup();
  const calls = mockFetch();
  const results = await classifyMessages([1, 2]);
  assert.equal(calls.length, 2);
  assert.ok(results.every((r) => !r.skipped));
});

test('Classify anyway runs only the ids given', async () => {
  await setup();
  env.store[CORRECTED_KEY]['a1|m2@example'] = Date.now();
  const calls = mockFetch();
  const results = await classifyMessages([1, 2], { apply: true, anyway: [1] });
  assert.equal(calls.length, 1);
  assert.ok(results.find((r) => r.messageId === 1).scores);
  assert.equal(results.find((r) => r.messageId === 2).skipped, CORRECTED);
});

test('automatic scans do not queue corrected messages', async () => {
  await setup();
  await scan((await env.messenger.storage.local.get('settings')).settings);
  assert.deepEqual((env.store.queue ?? []).map((q) => q.headerMessageId), ['m2@example']);
});

test('the note after Classify', () => {
  assert.equal(correctedText(1), '1 skipped because you corrected it.');
  assert.equal(correctedText(3), '3 skipped because you corrected them.');
});
