// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Tests for the fixes to testing findings F1–F12 (plans/FINDINGS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileStamp, localTime } from '../../packages/shared/core/time.js';
import { priceFromUsage } from '../../packages/shared/core/cost.js';
import { DEPTH_SHORT, DEPTH_MODES } from '../../packages/shared/core/depth.js';
import { LEVEL_GROUPS, LEVELS, levelOf, applyLevel } from '../../packages/shared/core/levels.js';
import { decide, thresholdFor } from '../../packages/shared/core/rules.js';
import { buildState } from '../../packages/shared/core/questions.js';
import { tagKey, keyForTagName, tagSpecs } from '../../packages/shared/core/tags.js';
import { toCsv } from '../../packages/shared/core/history.js';
import {
  mergeWithDefaults, validateSettings, DEFAULT_SETTINGS, SUGGESTED_CATEGORIES, MAX_CATEGORIES,
} from '../../packages/shared/core/settings-schema.js';
import { createMessenger } from '../mocks/messenger.js';

const choice = (label, p, confidence = 0.9) => ({ type: 'choice', choice: label, probabilities: { [label]: p }, confidence });

// --- F11 -------------------------------------------------------------------

test('F11: file names use local date and time, HHMM', () => {
  const d = new Date(2026, 8, 30, 21, 1); // 30 Sep 2026, 21:01 local
  assert.equal(fileStamp(d), '2026-09-30-2101');
  assert.equal(localTime(d), '2026-09-30 21:01:00');
  assert.equal(localTime('not a date'), '');
});

test('F11: CSV has a local-time column next to UTC', () => {
  const [header, row] = toCsv([{ at: new Date(2026, 8, 30, 21, 1, 5).toISOString(), notice: 'n' }]).trimEnd().split('\r\n');
  assert.ok(header.startsWith('time,time_local,'));
  assert.ok(row.split(',')[1] === '2026-09-30 21:01:05');
});

// --- F1 --------------------------------------------------------------------

test('F1: price per million tokens from a reported cost', () => {
  assert.equal(priceFromUsage({ input_tokens: 705, cost: 2.961e-5 }), 0.042);
  assert.equal(priceFromUsage({ input_tokens: 40 }), null, 'no cost reported');
  assert.equal(priceFromUsage({ input_tokens: 0, cost: 0.01 }), null);
  assert.equal(priceFromUsage({ input_tokens: 100, cost: -1 }), null);
});

// --- F3 --------------------------------------------------------------------

test('F3: every depth has a short description', () => {
  for (const mode of DEPTH_MODES) assert.ok(DEPTH_SHORT[mode]?.length > 10, mode);
});

// --- F6 / F12 ----------------------------------------------------------------

test('MVP defaults: Personal, Work, Bills and Codes, in that order, valid, no suggestions', () => {
  const names = DEFAULT_SETTINGS.categories.map((c) => c.name);
  assert.deepEqual(names, ['Personal', 'Work', 'Bills', 'Codes']);
  assert.deepEqual(SUGGESTED_CATEGORIES, []);
  assert.deepEqual(validateSettings(mergeWithDefaults({})).errors, []);
  assert.equal(MAX_CATEGORIES, 20);
  for (const c of DEFAULT_SETTINGS.categories) {
    assert.ok(c.description.length <= 128 && c.excludes.length <= 128, c.name);
  }
});

test('F6: existing settings keep their own categories', () => {
  const mine = [{ name: 'Work', description: 'w' }];
  assert.deepEqual(mergeWithDefaults({ categories: mine }).categories, mine);
});

// --- F7 --------------------------------------------------------------------

test('F7: "Real person" keeps the old tag key; no Service tag exists', () => {
  assert.equal(tagKey('Real person'), 'preen_person');
  assert.equal(keyForTagName('Preen/Real person'), 'preen_person');
  const names = tagSpecs(mergeWithDefaults({})).map((t) => t.name);
  assert.ok(names.includes('Preen/Real person'));
  assert.ok(!names.some((n) => /Service|Preen\/Person$/.test(n)));
});

// --- F8 --------------------------------------------------------------------

test('F8: each category can require its own certainty', () => {
  const s = mergeWithDefaults({
    categories: [{ name: 'Codes', description: 'c', threshold: 0.6 }, { name: 'Bills', description: 'b', threshold: 0.9 }],
  });
  assert.equal(thresholdFor('Codes', s), 0.6);
  assert.equal(thresholdFor('Bills', s), 0.9);
  assert.equal(decide({ category: choice('Codes', 0.65) }, s).category, 'Codes', 'Low certainty accepts 0.65');
  assert.equal(decide({ category: choice('Bills', 0.85) }, s).category, null, 'High certainty rejects 0.85');
  assert.equal(validateSettings(mergeWithDefaults({ categories: [{ name: 'A', description: 'a', threshold: 1.5 }] })).ok, false);
});

test('F8: categories without their own certainty use the global one', () => {
  const s = mergeWithDefaults({ categories: [{ name: 'A', description: 'a' }] });
  assert.equal(thresholdFor('A', s), 0.75);
});

// --- F5 / F9 -----------------------------------------------------------------

test('F9: Medium is today\'s default everywhere but Junk (High since 0.0.18, #13), and every level round-trips', () => {
  const s = mergeWithDefaults({});
  for (const group of Object.keys(LEVEL_GROUPS)) {
    if (group === 'certainty') continue; // per category
    assert.equal(levelOf(group, s), group === 'junk' ? 'high' : 'medium', group);
    for (const level of LEVELS) assert.equal(levelOf(group, applyLevel(group, level, structuredClone(s))), level, `${group} ${level}`);
  }
  assert.equal(levelOf('certainty', applyLevel('certainty', 'high', {})), 'high');
});

test('F9: High always means more of the named quantity', () => {
  for (const [group, g] of Object.entries(LEVEL_GROUPS)) {
    const [low, , high] = LEVELS.map((l) => g.presets[l][0]);
    assert.ok(high > low, group);
  }
});

test('F5: changing one detail makes it custom', () => {
  const s = mergeWithDefaults({});
  s.limits.dailyMessages = 1234;
  assert.equal(levelOf('allowance', s), 'custom');
  assert.deepEqual(validateSettings(applyLevel('allowance', 'high', mergeWithDefaults({}))).errors, []);
});

// --- F4 --------------------------------------------------------------------

test('F4: the mailbox type and note are sent as context, never the account name or address', () => {
  const s = mergeWithDefaults({ scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [], type: 'founder', note: 'Design studio' } } } });
  const email = { accountId: 'a1', author: 'x@example.com', subject: 's' };
  const signals = { service: [], person: [], mailingList: false };
  const state = buildState(email, s, signals);
  assert.deepEqual(state.mailbox, { context: "This email arrived in the recipient's Founder / business owner mailbox.", note: 'Design studio' });
  assert.ok(!JSON.stringify(state.mailbox).includes('a1'));
  assert.equal('mailbox' in buildState({ ...email, accountId: 'other' }, s, signals), false, 'no type, no context');
});

test('F4: account type and note are validated', () => {
  const ok = (a) => validateSettings(mergeWithDefaults({ scope: { accounts: { a1: { enabled: false, folders: 'inbox', folderPaths: [], ...a } } } })).ok;
  assert.equal(ok({ type: 'work' }), true);
  assert.equal(ok({ type: 'boss' }), false);
  assert.equal(ok({ note: 'x'.repeat(128) }), true);
  assert.equal(ok({ note: 'x'.repeat(129) }), false);
});

// --- Review of 0.0.10 ---------------------------------------------------------

import { managedTagKeys } from '../../apps/thunderbird/mail/tags.js';
import { undoEntries } from '../../apps/thunderbird/mail/undo.js';
import { choiceProbability } from '../../packages/shared/core/rules.js';
import { appendEntries, readAll, clearLog } from '../../apps/thunderbird/storage/activity-log.js';
import { installIndexedDB } from '../mocks/indexeddb.js';

installIndexedDB();

test('review 1: with "Tag processed messages" off, the processed tag is not Preen\'s to remove', async () => {
  const env = createMessenger({ messages: {}, tags: [
    { key: 'preen_processed', tag: 'Preen: processed', color: '#9E9E9E' },
    { key: 'preen_old', tag: 'Preen/Old category', color: '#000000' },
  ] });
  globalThis.messenger = env.messenger;
  const off = await managedTagKeys(mergeWithDefaults({ markProcessed: { tag: false } }));
  assert.ok(!off.has('preen_processed'));
  assert.ok(off.has('preen_old'), 'leftovers from renamed categories are still cleaned up');
  const on = await managedTagKeys(mergeWithDefaults({}));
  assert.ok(on.has('preen_processed'));
});

test('a failing tag list stops the run instead of leaving old and new tags together', async () => {
  const env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  env.messenger.messages.tags.list = async () => { throw new Error('tags unavailable'); };
  await assert.rejects(managedTagKeys(mergeWithDefaults({})), /tags unavailable/);
});

test('review 3: one failing message does not stop an undo', async () => {
  const header = (id) => ({ id, headerMessageId: `m${id}`, tags: ['preen_x'], flagged: false, read: false });
  const env = createMessenger({ messages: { 1: { header: header(1) }, 2: { header: header(2) } }, tags: [{ key: 'preen_x', tag: 'Preen/X' }] });
  globalThis.messenger = env.messenger;
  await clearLog();
  let calls = 0;
  env.messenger.messages.update = async (id) => {
    calls++;
    if (id === 1) throw new Error('read-only folder');
  };
  const applied = { before: { tags: [], flagged: false, read: false }, after: { tags: ['preen_x'], flagged: false, read: false }, changes: ['+preen_x'] };
  await appendEntries([{ at: 'a', messageId: 1, headerMessageId: 'm1', applied }, { at: 'b', messageId: 2, headerMessageId: 'm2', applied }]);
  const result = await undoEntries(await readAll());
  assert.equal(calls, 2, 'both messages were tried');
  assert.equal(result.failed, 1);
  assert.equal(result.undone, 1);
  assert.match((await readAll()).at(-1).notice, /1 could not be changed/);
});

test('review 4: probability found when its key differs only in case', () => {
  assert.equal(choiceProbability({ choice: 'Receipts', probabilities: { receipts: 0.9 } }, 'Receipts'), 0.9);
});

test('review 5: "unsure" is logged on both sides of the threshold, matching Smart', () => {
  const s = mergeWithDefaults({ categories: [{ name: 'A', description: 'a' }] });
  const d = decide({ category: choice('A', 0.9), person: { noul: 0.75 }, needs_reply: { noul: 0.75 } }, s);
  assert.ok(d.tags.includes('Preen/Real person') && d.tags.includes('Preen/Needs reply'));
  assert.ok(d.reasons.some((r) => r.startsWith('Unsure if a real person')));
  assert.ok(d.reasons.some((r) => r.startsWith('Unsure if a reply is needed')));
});

test('review 6: invalid or empty values always count as Custom', () => {
  assert.equal(levelOf('certainty', { threshold: NaN }), 'custom');
  assert.equal(levelOf('certainty', {}), 'custom');
});
