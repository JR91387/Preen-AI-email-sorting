// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// End-to-end tests of automatic processing against a fake Thunderbird.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { appendEntries, readAll, clearLog, clearCorrections } from '../../apps/thunderbird/storage/activity-log.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import {
  scan, runQueue, runNow, onNewMail, configureAlarms, catchUpAndRun,
} from '../../apps/thunderbird/background/scheduler.js';
import { SCHEDULE_ALARM, RUN_SOON_ALARM } from '../../packages/shared/core/protocol.js';
import { clearDryRunSeen } from '../../apps/thunderbird/storage/processed.js';

// The user has agreed to send mail to the provider.
const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };

installIndexedDB();

const HOUR = 60 * 60 * 1000;
const inbox = { id: 'a1-inbox', accountId: 'a1', specialUse: ['inbox'], name: 'Inbox', path: '/INBOX' };
const other = { id: 'a1-projects', accountId: 'a1', specialUse: [], name: 'Projects', path: '/Projects' };
const trash = { id: 'a1-trash', accountId: 'a1', specialUse: ['trash'], name: 'Trash', path: '/Trash' };

function message(n, folder, { hoursAgo = n, tags = [] } = {}) {
  return {
    header: {
      headerMessageId: `m${n}@example`,
      author: 'Shop <orders@shop.example>',
      subject: `Order ${n}`,
      date: new Date(Date.now() - hoursAgo * HOUR),
      recipients: ['me@example.com'],
      ccList: [],
      folder,
      tags: [...tags],
      flagged: false,
      read: false,
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

// Answers every request; `fail` can make chosen calls fail with an HTTP status.
function mockFetch({ fail = () => null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const status = fail(calls.length);
    if (status) return new Response('{}', { status });
    return new Response(JSON.stringify({ model: 'jev', answers, usage: { input_tokens: 600 } }), { status: 200 });
  };
  return calls;
}

let env;
async function setup(messages, patch = {}) {
  env = createMessenger({ messages, folders: [inbox, other, trash] });
  globalThis.messenger = env.messenger;
  await clearLog();
  await clearCorrections();
  const base = {
    apiKey: 'k', consent: AGREED,
    dryRun: false,
    depth: { default: 'surface', accounts: {} },
    automation: { enabled: true, trigger: 'scheduled', intervalMinutes: 15, maxAgeDays: 2, unreadOnly: false },
    scope: { accounts: { a1: { enabled: true, folders: 'inbox' } } },
  };
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ ...base, ...patch }) });
}

const queue = () => env.store.queue ?? [];
const settingsNow = async () => (await env.messenger.storage.local.get('settings')).settings;

test('scan queues recent, unprocessed mail from in-scope folders only', async () => {
  await setup({
    1: message(1, inbox),
    2: message(2, inbox, { hoursAgo: 72 }), // too old
    3: message(3, inbox, { tags: ['preen_processed'] }),
    4: message(4, other), // inbox-only account
    5: message(5, trash),
  });
  const added = await scan(await settingsNow());
  assert.equal(added, 1);
  assert.deepEqual(queue().map((q) => q.headerMessageId), ['m1@example']);
  assert.equal(queue()[0].folderPath, '/INBOX');
  assert.equal(queue()[0].accountId, 'a1');
});

test('"all folders" covers normal folders but never special ones', async () => {
  await setup({ 1: message(1, inbox), 4: message(4, other), 5: message(5, trash) },
    { scope: { accounts: { a1: { enabled: true, folders: 'all' } } } });
  await scan(await settingsNow());
  assert.deepEqual(queue().map((q) => q.headerMessageId).sort(), ['m1@example', 'm4@example']);
});

test('a run classifies and tags queued mail, then empties the queue', async () => {
  await setup({ 1: message(1, inbox), 2: message(2, inbox) });
  const calls = mockFetch();
  const result = await catchUpAndRun();
  assert.deepEqual(result, { classified: 2, failed: 0, dropped: 0, remaining: 0 });
  assert.equal(calls.length, 2);
  assert.ok(env.calls.update.length === 2);
  assert.ok((await readAll()).every((e) => e.source === 'automatic' && e.runKind === 'applied'));
  assert.equal(env.store.status.lastRun.classified, 2);
  assert.equal(env.store.usage.dayMessages, 2);
  assert.equal(env.store.usage.dayTokens, 1200);
  // Already processed now: a second catch-up finds nothing to do.
  await catchUpAndRun();
  assert.equal(calls.length, 2);
});

test('paused: scheduled runs do nothing, but Run now still works', async () => {
  await setup({ 1: message(1, inbox) }, { automation: { enabled: false } });
  const calls = mockFetch();
  assert.equal(await catchUpAndRun(), null);
  assert.equal(await runQueue(), null);
  assert.equal(calls.length, 0);
  const result = await runNow();
  assert.equal(result.classified, 1);
});

test('a run takes the Speed\'s run size of messages (High: 50), newest first', async () => {
  const messages = {};
  for (let n = 1; n <= 52; n += 1) messages[n] = message(n, inbox, { hoursAgo: n / 4 });
  await setup(messages, { speed: 'high' });
  mockFetch();
  const result = await catchUpAndRun();
  assert.equal(result.classified, 50);
  assert.equal(result.remaining, 2);
  assert.deepEqual(queue().map((q) => q.headerMessageId).sort(), ['m51@example', 'm52@example'], 'the oldest wait for the next run');
});

test('the daily message limit stops a run and is reported', async () => {
  await setup({ 1: message(1, inbox), 2: message(2, inbox), 3: message(3, inbox) }, {
    limits: { dailyMessages: 2, monthlyCostUsd: null },
  });
  const calls = mockFetch();
  await catchUpAndRun();
  assert.equal(calls.length, 2);
  assert.equal(queue().length, 1);
  await catchUpAndRun();
  assert.equal(calls.length, 2, 'no more API calls today');
  assert.match(env.store.status.blockedReason, /Daily limit of 2 messages/);
});

test('the cost limit also applies to manual right-click classification (Speed Medium: one at a time)', async () => {
  await setup({ 1: message(1, inbox), 2: message(2, inbox), 3: message(3, inbox), 4: message(4, inbox) }, {
    pricePerMillionInputTokens: 1,
    limits: { dailyMessages: 0, monthlyCostUsd: 0.0005 },
  });
  const calls = mockFetch();
  const results = await classifyMessages([1, 2, 3, 4], { apply: true });
  // One request at a time: the first one's 600 tokens ($0.0006) reach the limit, nothing more starts.
  assert.equal(calls.length, 1);
  assert.equal(results.filter((r) => r.skipped === 'limit reached').length, 3);
  const skipped = results.find((r) => r.skipped === 'limit reached');
  assert.match(skipped.limitReason, /Estimated monthly cost limit/);
  assert.ok((await readAll()).some((e) => e.skipped === 'limit reached'), 'manual runs log it');
});

test('Speed High runs two at a time: both requests already in progress finish at the cost limit', async () => {
  await setup({ 1: message(1, inbox), 2: message(2, inbox), 3: message(3, inbox), 4: message(4, inbox) }, {
    speed: 'high',
    pricePerMillionInputTokens: 1,
    limits: { dailyMessages: 0, monthlyCostUsd: 0.0005 },
  });
  const calls = mockFetch();
  const results = await classifyMessages([1, 2, 3, 4], { apply: true });
  // Tokens are only known when a request finishes, so both requests in progress complete.
  assert.equal(calls.length, 2);
  assert.equal(results.filter((r) => r.skipped === 'limit reached').length, 2);
});

test('messages moved or deleted since queuing are dropped', async () => {
  const messages = { 1: message(1, inbox), 2: message(2, inbox) };
  await setup(messages);
  await scan(await settingsNow());
  delete messages[2];
  mockFetch();
  const result = await runQueue();
  assert.equal(result.classified, 1);
  assert.equal(result.dropped, 1);
  assert.equal(queue().length, 0);
});

test('A-2: a failed lookup keeps the queued message instead of dropping it', async () => {
  await setup({ 1: message(1, inbox) });
  await scan(await settingsNow());
  const realQuery = env.messenger.folders.query;
  env.messenger.folders.query = async () => { throw new Error('folder query failed'); };
  mockFetch();
  const warn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await runQueue();
  } finally {
    console.warn = warn;
  }
  assert.equal(result.dropped, 0);
  assert.equal(queue().length, 1, 'still queued');
  env.messenger.folders.query = realQuery;
  assert.equal((await runQueue()).classified, 1, 'processed once lookups work again');
});

test('temporary errors are retried, then the message waits for later runs and is dropped after 3', async () => {
  await setup({ 1: message(1, inbox) });
  const calls = mockFetch({ fail: () => 503 });
  await scan(await settingsNow());
  await runQueue();
  assert.equal(calls.length, 3, 'three tries within a run');
  assert.equal(queue()[0].attempts, 1);
  await runQueue();
  await runQueue();
  assert.equal(queue().length, 0, 'dropped after three failed runs');
});

test('an API key problem keeps the queue and is shown as the last error', async () => {
  await setup({ 1: message(1, inbox), 2: message(2, inbox) });
  mockFetch({ fail: () => 401 });
  await scan(await settingsNow());
  await runQueue();
  assert.equal(queue().length, 2);
  assert.match(env.store.status.lastError, /rejected the API key/);
});

test('with dry run on, automatic runs classify each message once and change nothing', async () => {
  await setup({ 1: message(1, inbox) }, { dryRun: true });
  const calls = mockFetch();
  await catchUpAndRun();
  await catchUpAndRun();
  assert.equal(calls.length, 1, 'not re-classified on every run');
  assert.equal(env.calls.update.length, 0);
  // Turning dry run off clears the dry-run record, so the mail is processed for real.
  await env.messenger.storage.local.set({ settings: { ...(await settingsNow()), dryRun: false } });
  await clearDryRunSeen();
  await catchUpAndRun();
  assert.equal(calls.length, 2);
  assert.equal(env.calls.update.length, 1);
});

test('new mail: queued for in-scope folders; real-time mode schedules a run soon', async () => {
  await setup({ 1: message(1, inbox), 4: message(4, other) }, {
    automation: { enabled: true, trigger: 'realtime', intervalMinutes: 15, maxAgeDays: 2, unreadOnly: false },
  });
  await onNewMail(inbox, { id: null, messages: [{ id: 1, ...env.messenger && (await env.messenger.messages.get(1)) }] });
  assert.equal(queue().length, 1);
  assert.ok(env.alarms.has(RUN_SOON_ALARM));
  await onNewMail(other, { id: null, messages: [{ id: 4, ...(await env.messenger.messages.get(4)) }] });
  assert.equal(queue().length, 1, 'Projects is out of scope for an inbox-only account');
});

test('a failing alarm in real-time mode rejects onNewMail so the caller can log it', async () => {
  await setup({ 1: message(1, inbox) }, {
    automation: { enabled: true, trigger: 'realtime', intervalMinutes: 15, maxAgeDays: 2, unreadOnly: false },
  });
  env.messenger.alarms.create = async () => { throw new Error('alarms unavailable'); };
  await assert.rejects(onNewMail(inbox, { id: null, messages: [{ id: 1, ...(await env.messenger.messages.get(1)) }] }), /alarms unavailable/);
});

test('new mail is ignored while paused', async () => {
  await setup({ 1: message(1, inbox) }, { automation: { enabled: false } });
  await onNewMail(inbox, { id: null, messages: [{ id: 1, ...(await env.messenger.messages.get(1)) }] });
  assert.equal(queue().length, 0);
});

test('the schedule follows the settings', async () => {
  await setup({});
  await configureAlarms(mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } }, automation: { enabled: true, trigger: 'scheduled', intervalMinutes: 30 } }));
  assert.deepEqual(env.alarms.get(SCHEDULE_ALARM), { delayInMinutes: 30, periodInMinutes: 30 });
  await configureAlarms(mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } }, automation: { enabled: true, trigger: 'manual' } }));
  assert.equal(env.alarms.has(SCHEDULE_ALARM), false);
  await configureAlarms(mergeWithDefaults({ automation: { enabled: false, trigger: 'scheduled' } }));
  assert.equal(env.alarms.has(SCHEDULE_ALARM), false);  // Not paused but no mailbox ticked is off (#17): nothing to schedule.
  await configureAlarms(mergeWithDefaults({ automation: { enabled: true, trigger: 'scheduled', intervalMinutes: 30 } }));
  assert.equal(env.alarms.has(SCHEDULE_ALARM), false);
});

test('manual trigger: catch-up does nothing; only Run now processes', async () => {
  await setup({ 1: message(1, inbox) }, {
    automation: { enabled: true, trigger: 'manual', intervalMinutes: 15, maxAgeDays: 2, unreadOnly: false },
  });
  const calls = mockFetch();
  assert.equal(await catchUpAndRun(), null);
  assert.equal(calls.length, 0);
  await runNow();
  assert.equal(calls.length, 1);
});

test('history retention is by days only: older entries go, any number of newer ones stay', async () => {
  await setup({ 1: message(1, inbox) }, { history: { retentionDays: 90 } });
  mockFetch();
  const old = new Date(Date.now() - 91 * 86400000).toISOString();
  await appendEntries([{ at: old, notice: 'too old' }]);
  await appendEntries(Array.from({ length: 150 }, (_, i) => ({ at: new Date().toISOString(), notice: `new ${i}` })));
  await catchUpAndRun();
  const all = await readAll();
  assert.ok(!all.some((e) => e.notice === 'too old'), 'older than 90 days: removed');
  assert.ok(all.length > 150, 'no entry-count cap');
});

test('the queue survives a restart: folders are found again by path when their IDs change', async () => {
  await setup({ 1: message(1, inbox) });
  await scan(await settingsNow());
  // After a restart Thunderbird hands out new folder IDs.
  const renamedInbox = { ...inbox, id: 'new-session-inbox-id' };
  const messages = { 1: message(1, renamedInbox) };
  const fresh = createMessenger({ messages, folders: [renamedInbox, other, trash] });
  Object.assign(fresh.store, env.store);
  env = fresh;
  globalThis.messenger = env.messenger;
  const calls = mockFetch();
  const result = await runQueue();
  assert.equal(result.classified, 1);
  assert.equal(calls.length, 1);
});

test('"only these folders" scans just the chosen folders', async () => {
  await setup({ 1: message(1, inbox), 4: message(4, other) },
    { scope: { accounts: { a1: { enabled: true, folders: 'selected', folderPaths: ['/Projects'] } } } });
  await scan(await settingsNow());
  assert.deepEqual(queue().map((q) => q.headerMessageId), ['m4@example']);
});

// --- Fixes from the code review ----------------------------------------------

test('review fix 1: a message whose update fails is retried, then recorded so it is not classified forever', async () => {
  await setup({ 1: message(1, inbox) });
  const calls = mockFetch();
  env.messenger.messages.update = async () => { throw new Error('folder is read-only'); };
  await scan(await settingsNow());
  await runQueue();
  assert.equal(queue()[0].attempts, 1, 'kept for another try');
  await runQueue();
  await runQueue();
  assert.equal(queue().length, 0, 'given up after three runs');
  assert.ok(env.store.processed['a1|m1@example'], 'recorded as processed');
  const before = calls.length;
  await catchUpAndRun();
  assert.equal(calls.length, before, 'no more API calls for it');
});

test('review fix 2: encrypted messages are recorded, so scans stop picking them up', async () => {
  const encrypted = message(1, inbox);
  encrypted.full = { contentType: 'multipart/encrypted', headers: {}, parts: [] };
  await setup({ 1: encrypted });
  const calls = mockFetch();
  await catchUpAndRun();
  assert.equal(calls.length, 0);
  assert.ok(env.store.processed['a1|m1@example']);
  assert.equal(await scan(await settingsNow()), 0, 'not queued again');
});

test('review fix 2: previews still record nothing, even for encrypted mail', async () => {
  const encrypted = message(1, inbox);
  encrypted.full = { contentType: 'multipart/encrypted', headers: {}, parts: [] };
  await setup({ 1: encrypted });
  mockFetch();
  const [entry] = await classifyMessages([1]);
  assert.equal(entry.skipped, 'encrypted');
  assert.equal(env.store.processed, undefined);
});

test('review fix 3: usage and processed records are saved after each message, not at the end', async () => {
  await setup({ 1: message(1, inbox), 2: message(2, inbox) });
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    if (n === 2) await hold; // the second request hangs, as if the run were interrupted
    return new Response(JSON.stringify({ model: 'jev', answers, usage: { input_tokens: 600 } }), { status: 200 });
  };
  const run = classifyMessages([1, 2], { apply: true });
  for (let i = 0; i < 50 && !env.store.usage; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(env.store.usage.dayMessages, 1, 'first message counted while the batch is still running');
  assert.equal(env.store.usage.dayTokens, 600);
  assert.equal(Object.keys(env.store.processed ?? {}).length, 1, 'first message already recorded');
  release();
  await run;
  assert.equal(env.store.usage.dayMessages, 2);
});

test('a manual run stops at exactly the daily message limit (lab item 21: "2001 / 2000")', async () => {
  await setup({ 1: message(1, inbox), 2: message(2, inbox), 3: message(3, inbox), 4: message(4, inbox), 5: message(5, inbox) }, {
    limits: { dailyMessages: 3, monthlyCostUsd: null },
  });
  const calls = mockFetch();
  const results = await classifyMessages([1, 2, 3, 4, 5], { apply: true });
  assert.equal(calls.length, 3, 'three requests, not four');
  assert.equal(results.filter((r) => r.skipped === 'limit reached').length, 2);
});

test('Speed: Medium (default) rests after each message sent; High does not (real timing)', async () => {
  const ids = { 1: message(1, inbox), 2: message(2, inbox), 3: message(3, inbox) };
  await setup(ids, {});
  mockFetch();
  let t = Date.now();
  await classifyMessages([1, 2, 3], { apply: true });
  const medium = Date.now() - t;
  await setup(ids, { speed: 'high' });
  mockFetch();
  t = Date.now();
  await classifyMessages([1, 2, 3], { apply: true });
  const high = Date.now() - t;
  assert.ok(medium >= 950 && medium < 1500, `Medium: two 0.5 s rests (none after the last), took ${medium} ms`);
  assert.ok(high < 400, `High: no rests, took ${high} ms`);
});

test('Speed Low: pressing Stop ends the 2-second rest at once, and the rest of the run stops', async () => {
  const { stopRuns } = await import('../../apps/thunderbird/background/pipeline.js');
  await setup({ 1: message(1, inbox), 2: message(2, inbox), 3: message(3, inbox) }, { speed: 'low' });
  const calls = mockFetch();
  const t = Date.now();
  const run = classifyMessages([1, 2, 3], { apply: true });
  setTimeout(stopRuns, 300); // during the rest after message 1
  const results = await run;
  const took = Date.now() - t;
  assert.equal(calls.length, 1, 'only the first message was sent');
  assert.ok(took < 900, `stopped within the rest, took ${took} ms (a full rest would be 2,000)`);
  assert.equal(results.filter((r) => r.skipped === 'stopped by you').length, 2);
});

