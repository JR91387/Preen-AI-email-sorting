// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// "Try it on the last 7 days": which messages, the confirm text and the existing gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { trialIds, trialMessage, startTrial } from '../../apps/thunderbird/ui/shared/trial.js';
import { dayKey, monthKey } from '../../packages/shared/core/budget.js';

installIndexedDB();

const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };
const DAY = 24 * 60 * 60 * 1000;
const inbox = { id: 'a1-inbox', accountId: 'a1', specialUse: ['inbox'], name: 'Inbox', path: '/INBOX' };
const other = { id: 'a1-other', accountId: 'a1', specialUse: [], name: 'Other', path: '/Other' };
const msg = (n, folder, daysAgo) => ({ header: { headerMessageId: `m${n}@x`, folder, date: new Date(Date.now() - daysAgo * DAY), tags: [] } });

async function setup(patch = {}) {
  const env = createMessenger({
    messages: { 1: msg(1, inbox, 1), 2: msg(2, inbox, 6), 3: msg(3, inbox, 9), 4: msg(4, other, 1) },
    folders: [inbox, other],
  });
  globalThis.messenger = env.messenger;
  const settings = mergeWithDefaults({
    apiKey: 'k', consent: AGREED, scope: { accounts: { a1: { enabled: true, folders: 'inbox' } } }, ...patch,
  });
  await env.messenger.storage.local.set({ settings });
  return { env, settings: mergeWithDefaults(settings) };
}

test('trialIds: the last 7 days in the ticked mailboxes only, up to the limit', async () => {
  const { settings } = await setup();
  assert.deepEqual(await trialIds(settings, Infinity), { ids: [1, 2], capped: false });
  assert.deepEqual(await trialIds(settings, 1), { ids: [1], capped: true });
  assert.deepEqual(await trialIds(settings, 2), { ids: [1, 2], capped: false }, 'exactly the limit is not capped');
});

test('trialMessage says how many, that nothing changes, and the estimate', () => {
  assert.match(trialMessage(2, { tokens: 1200, usd: 0.0123 }, false),
    /^Preen sends 2 messages to your provider and shows what it would do\. Nothing in your mail changes\. About \S+ tokens, about \$\S+ \(an estimate from your past use\)\.$/);
  assert.match(trialMessage(1, null, true), /1 message to your provider.*as many as today's message limit allows.*no past use/);
});

test('startTrial stops at the existing gates: no mailbox ticked, no consent, limit reached', async () => {
  await setup({ scope: { accounts: {} } });
  assert.match((await startTrial()).text, /Tick a mailbox/);
  await setup({ consent: null });
  assert.match((await startTrial()).text, /Agree to send mail/);
  const { env } = await setup({ limits: { ...mergeWithDefaults({}).limits, dailyMessages: 5 } });
  await env.messenger.storage.local.set({ usage: { day: dayKey(), dayMessages: 5, dayTokens: 0, month: monthKey(), monthTokens: 0, monthMessages: 0 } });
  const r = await startTrial();
  assert.equal(r.outcome, 'blocked');
  assert.match(r.text, /limit/i);
  assert.equal(env.sent?.length ?? 0, 0);
});

test('trialIds: a list filled exactly is not capped when the remaining mailboxes are empty', async () => {
  const empty = { id: 'a1-empty', accountId: 'a1', specialUse: [], name: 'Empty', path: '/Empty' };
  const env = createMessenger({ messages: { 1: msg(1, inbox, 1), 2: msg(2, inbox, 6) }, folders: [inbox, empty] });
  globalThis.messenger = env.messenger;
  const settings = mergeWithDefaults({ apiKey: 'k', consent: AGREED, scope: { accounts: { a1: { enabled: true, folders: 'all' } } } });
  assert.deepEqual(await trialIds(settings, 2), { ids: [1, 2], capped: false });
  assert.equal((await trialIds(settings, 1)).capped, true);
});
