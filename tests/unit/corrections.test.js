// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Tag corrections (D132): the user's own changes to Preen tags are recorded locally,
// with Preen's score; Preen's own changes (classify, Undo) are not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEntries, readAll, readCorrections, clearLog, clearCorrections, markUndone } from '../../apps/thunderbird/storage/activity-log.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { recordTagChange, tagChanges, scoreFor } from '../../apps/thunderbird/background/corrections.js';
import { noteOwnUpdate } from '../../apps/thunderbird/mail/own-updates.js';
import { toCsv } from '../../packages/shared/core/history.js';
import { readCorrected, isCorrectedSet } from '../../apps/thunderbird/storage/processed.js';

installIndexedDB();

// The history notifies open pages through runtime messaging; nothing listens here.
const session = {};
const local = {};
const pick = (store, k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in store).map((x) => [x, store[x]]));
globalThis.messenger = {
  runtime: { sendMessage: async () => {} },
  storage: {
    session: { get: async (k) => pick(session, k), set: async (o) => Object.assign(session, o) },
    local: { get: async (k) => pick(local, k), set: async (o) => Object.assign(local, o) },
  },
};

const names = { preen_needs_reply: 'Preen/Needs reply', preen_person: 'Preen/Real person', preen_bills: 'Preen/Bills' };

async function setup(applied = { after: { tags: ['preen_bills', 'preen_needs_reply', 'preen_processed'] } }) {
  await clearLog();
  await clearCorrections();
  await appendEntries([{
    at: '2026-10-01T10:00:00Z', runId: 'r1', messageId: 7, headerMessageId: 'm7@x', category: 'Bills',
    tags: ['Preen/Bills', 'Preen/Needs reply'], scores: { needsReply: 0.86, person: 0.1, categoryProbability: 0.93 }, applied,
  }]);
}
const msg = { id: 7, headerMessageId: 'm7@x', author: 'Shop <a@shop.example>', subject: 'Your order' };

test('tagChanges: only Preen tags count; the processed mark and the user\'s own tags are ignored', () => {
  assert.deepEqual(
    tagChanges(['preen_needs_reply', 'preen_processed', '$label1'], ['preen_processed', '$label2', 'preen_person']),
    [{ key: 'preen_person', change: 'added' }, { key: 'preen_needs_reply', change: 'removed' }],
  );
});

test('scoreFor maps a tag to the score behind it', () => {
  const e = { category: 'Bills', scores: { needsReply: 0.86, person: 0.1, categoryProbability: 0.93 } };
  assert.equal(scoreFor('preen_needs_reply', e), 0.86);
  assert.equal(scoreFor('preen_bills', e), 0.93);
  assert.equal(scoreFor('preen_review', e), null);
});

test('removing a Preen tag by hand is recorded with Preen\'s score, readable in the log and the CSV', async () => {
  await setup();
  const out = await recordTagChange(msg, ['preen_bills', 'preen_processed'], { getNames: async () => names });
  assert.equal(out.length, 1);
  const [entry] = (await readAll()).slice(-1);
  assert.deepEqual(
    { key: entry.correction.key, change: entry.correction.change, score: entry.correction.score },
    { key: 'preen_needs_reply', change: 'removed', score: 0.86 },
  );
  assert.equal(entry.notice, 'You removed Preen/Needs reply (Preen\'s score was 0.86)');
  assert.equal(entry.scores, undefined, 'not counted in the monthly token summaries');
  const csv = toCsv([entry]);
  assert.match(csv, /Preen\/Needs reply,removed/);
});

test('a second change compares with the first correction, not with the original run', async () => {
  await setup();
  await recordTagChange(msg, ['preen_bills', 'preen_processed'], { getNames: async () => names });
  await recordTagChange(msg, ['preen_processed'], { getNames: async () => names });
  const corrections = (await readAll()).filter((e) => e.correction);
  assert.deepEqual(corrections.map((e) => `${e.correction.change} ${e.correction.key}`), ['removed preen_needs_reply', 'removed preen_bills']);
  assert.equal(corrections[1].correction.score, 0.93, 'still Preen\'s original score');
});

test('Preen\'s own update (classify or Undo) is never a correction', async () => {
  // Its own message id: the 10-second window must not leak into the other tests.
  const own = { ...msg, id: 8, headerMessageId: 'm8@x' };
  await setup();
  await appendEntries([{ at: '2026-10-01T10:00:00Z', messageId: 8, headerMessageId: 'm8@x', applied: { after: { tags: ['preen_needs_reply'] } } }]);
  await noteOwnUpdate(8);
  assert.deepEqual(await recordTagChange(own, ['preen_processed'], { getNames: async () => names }), []);
  assert.equal((await readAll()).filter((e) => e.correction).length, 0);
});

test('messages Preen never tagged, undone runs, and non-Preen tag edits record nothing', async () => {
  await setup();
  assert.deepEqual(await recordTagChange({ ...msg, id: 99, headerMessageId: 'other@x' }, ['preen_needs_reply'], { getNames: async () => names }), []);
  await setup({ after: { tags: ['preen_needs_reply'] } });
  // Only the user's own label changed: the Preen tags are as Preen left them.
  assert.deepEqual(await recordTagChange(msg, ['preen_needs_reply', 'preen_processed', '$label1'], { getNames: async () => names }), []);
  await setup();
  await markUndone([(await readAll())[0].seq], '2026-10-01T11:00:00Z');
  assert.deepEqual(await recordTagChange(msg, [], { getNames: async () => names }), []);
});

test('CSV: a correction\'s text cells stay plain text (formula-safe)', async () => {
  await setup();
  await recordTagChange({ ...msg, subject: '=HYPERLINK("x")' }, ['preen_bills'], { getNames: async () => ({ preen_needs_reply: '=cmd|x' }) });
  const corrections = (await readAll()).filter((e) => e.correction);
  assert.equal(corrections.length, 1, 'the correction was recorded');
  const csv = toCsv(corrections);
  assert.doesNotMatch(csv, /(^|,)=/m);
});

test('Preen\'s own change is still recognised after the background page was suspended (memory lost)', async () => {
  const { noteOwnUpdate: note, isOwnUpdate } = await import('../../apps/thunderbird/mail/own-updates.js?fresh');
  await note(42);
  // A fresh copy of the module has an empty memory, like a woken background page.
  const woken = await import('../../apps/thunderbird/mail/own-updates.js?woken');
  assert.equal(await woken.isOwnUpdate(42), true);
  assert.equal(await isOwnUpdate(43), false);
});

test('a failing storage read is logged and counts as not Preen\'s own change', async () => {
  const { isOwnUpdate } = await import('../../apps/thunderbird/mail/own-updates.js?readfail');
  const area = globalThis.messenger.storage.session ?? globalThis.messenger.storage.local;
  const get = area.get;
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a);
  area.get = async () => { throw new Error('storage gone'); };
  try {
    assert.equal(await isOwnUpdate(77), false);
  } finally {
    area.get = get;
    console.warn = warn;
  }
  assert.equal(warns.length, 1);
});

test('tag names are only looked up when something is recorded', async () => {
  await setup();
  let lookups = 0;
  const getNames = async () => { lookups++; return names; };
  await recordTagChange({ ...msg, id: 99, headerMessageId: 'none@x' }, ['preen_needs_reply'], { getNames });
  assert.equal(lookups, 0);
  await recordTagChange(msg, ['preen_bills', 'preen_processed'], { getNames });
  assert.equal(lookups, 1);
});

test('D134: a correction also goes to the long-term table, minimal (no sender, subject or message id)', async () => {
  await setup();
  await recordTagChange(msg, ['preen_bills', 'preen_processed'], { getNames: async () => names });
  const rows = await readCorrections();
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).filter((k) => k !== 'id').sort(), ['at', 'category', 'change', 'key', 'score', 'tag']);
  assert.deepEqual([rows[0].key, rows[0].change, rows[0].score, rows[0].category], ['preen_needs_reply', 'removed', 0.86, 'Bills']);
});

test('D134: Clear history and history trimming leave corrections alone; their own limits apply', async () => {
  const { appendCorrections, CORRECTIONS_KEEP_DAYS } = await import('../../apps/thunderbird/storage/activity-log.js');
  await setup();
  await recordTagChange(msg, ['preen_bills', 'preen_processed'], { getNames: async () => names });
  await clearLog();
  await appendEntries([], { retentionDays: 1 });
  assert.equal((await readCorrections()).length, 1, 'kept after Clear history and trimming');
  const old = new Date(Date.now() - (CORRECTIONS_KEEP_DAYS + 5) * 86400000).toISOString();
  await appendCorrections([{ at: old, correction: { key: 'preen_person', tag: 'Preen/Real person', change: 'added', score: 0.4 } }]);
  assert.equal((await readCorrections()).length, 1, 'older than 2 years: trimmed on the next write');
  await clearCorrections();
  assert.equal((await readCorrections()).length, 0, 'Clear corrections empties it');
});

test('D134: corrections CSV is formula-safe', async () => {
  const { correctionsToCsv } = await import('../../packages/shared/core/history.js');
  const csv = correctionsToCsv([{ at: '2026-10-02T00:00:00Z', tag: '=cmd|x', change: 'removed', score: 0.9, category: '@sum' }]);
  assert.match(csv, /^at,tag,change,score,category\r\n/);
  assert.doesNotMatch(csv, /(^|,)[=@]/m);
});

test('a correction puts the message in the corrected set, keyed like the processed record', async () => {
  await setup();
  await recordTagChange({ ...msg, folder: { accountId: 'a1' } }, ['preen_bills', 'preen_processed'], { getNames: async () => names });
  const set = await readCorrected();
  assert.ok(set['a1|m7@x']);
  assert.equal(isCorrectedSet({ corrected: set }, { headerMessageId: 'm7@x', folder: { accountId: 'a1' } }), true);
  assert.equal(isCorrectedSet({ corrected: set }, { headerMessageId: 'm7@x', folder: { accountId: 'a2' } }), false);
});
