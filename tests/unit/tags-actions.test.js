// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagKey, keyForTagName, tagSpecs, PROCESSED_TAG_KEY } from '../../packages/shared/core/tags.js';
import { planUpdate } from '../../packages/shared/core/actions.js';
import { presetPerson } from '../../packages/shared/core/sender-rules.js';
import { vCardEmails } from '../../apps/thunderbird/mail/contacts.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

const settings = mergeWithDefaults({
  categories: [
    { name: 'Receipts', description: 'r', actions: { markUnread: true } },
    { name: 'Work', description: 'w', actions: { flag: true } },
    { name: 'Newsletters', description: 'n' },
  ],
});

const decision = (category, tags) => ({ category, tags, scores: {} });

// --- tag keys -------------------------------------------------------------

test('tag keys are lowercase, safe and prefixed', () => {
  assert.equal(tagKey('Needs reply'), 'preen_needs_reply');
  assert.equal(tagKey('Café & Co.'), 'preen_cafe_co');
  assert.equal(tagKey('!!!'), '');
  assert.equal(keyForTagName('Preen/Receipts'), 'preen_receipts');
  assert.ok(!/[()<>{/%*" ]/.test(tagKey('A (b) <c> {d} /e %f *g "h')));
});

test('tagSpecs covers categories, fixed tags and the processed tag', () => {
  const keys = tagSpecs(settings).map((s) => s.key);
  assert.deepEqual(keys, [
    'preen_receipts', 'preen_work', 'preen_newsletters',
    'preen_person', 'preen_needs_reply', 'preen_junk', PROCESSED_TAG_KEY,
  ]);
  for (const gone of ['preen_to_do', 'preen_review', 'preen_sensitive']) assert.ok(!keys.includes(gone), `no ${gone} tag`);
  assert.equal(tagSpecs(settings).find((t) => t.key === 'preen_person').name, 'Preen/Real person', 'new name, old key');
  const noMarker = tagSpecs(mergeWithDefaults({ markProcessed: { tag: false } })).map((s) => s.key);
  assert.ok(!noMarker.includes(PROCESSED_TAG_KEY));
  assert.ok(tagSpecs(settings).every((s) => /^#[0-9A-F]{6}$/.test(s.color)));
});

test('default settings create exactly Personal, Work, Bills, Codes, Real person, Needs reply, Junk and processed', () => {
  assert.deepEqual(tagSpecs(mergeWithDefaults({})).map((s) => s.key), [
    'preen_personal', 'preen_work', 'preen_bills', 'preen_codes',
    'preen_person', 'preen_needs_reply', 'preen_junk', PROCESSED_TAG_KEY,
  ]);
});

// --- planUpdate -----------------------------------------------------------

test('adds Preen tags and the processed marker, keeping the user\'s tags', () => {
  const plan = planUpdate({ tags: ['$label1'], flagged: false, read: false },
    decision('Newsletters', ['Preen/Newsletters', 'Preen/Service']), settings);
  assert.deepEqual(plan.update, { tags: ['$label1', 'preen_newsletters', 'preen_service', PROCESSED_TAG_KEY] });
  assert.deepEqual(plan.changes, ['+preen_newsletters', '+preen_service', `+${PROCESSED_TAG_KEY}`]);
  assert.deepEqual(plan.before.tags, ['$label1']);
});

test('replaces Preen tags from an earlier run', () => {
  const plan = planUpdate({ tags: ['$label1', 'preen_work', 'preen_person', PROCESSED_TAG_KEY], flagged: true, read: true },
    decision('Newsletters', ['Preen/Newsletters', 'Preen/Service']), settings);
  assert.deepEqual(plan.after.tags, ['$label1', 'preen_newsletters', 'preen_service', PROCESSED_TAG_KEY]);
  assert.ok(plan.changes.includes('-preen_work'));
  assert.ok(plan.changes.includes('-preen_person'));
  assert.equal('flagged' in plan.update, false, 'never unflags');
});

test('category actions: mark unread and flag; never mark read', () => {
  const unread = planUpdate({ tags: [], flagged: false, read: true }, decision('Receipts', ['Preen/Receipts']), settings);
  assert.equal(unread.update.read, false);
  assert.ok(unread.changes.includes('marked unread'));
  const stayUnread = planUpdate({ tags: [], flagged: false, read: false }, decision('Newsletters', ['Preen/Newsletters']), settings);
  assert.equal('read' in stayUnread.update, false);
  const flag = planUpdate({ tags: [], flagged: false, read: false }, decision('Work', ['Preen/Work']), settings);
  assert.equal(flag.update.flagged, true);
});

test('no actions when there is no confident category', () => {
  const plan = planUpdate({ tags: [], flagged: false, read: false }, decision(null, ['Preen/Review']), settings);
  assert.equal('read' in plan.update, false);
  assert.equal('flagged' in plan.update, false);
});

test('flagNeedsReply setting flags messages tagged Needs reply', () => {
  const s = mergeWithDefaults({ actions: { flagNeedsReply: true } });
  const plan = planUpdate({ tags: [], flagged: false, read: false }, decision(null, ['Preen/Needs reply']), s);
  assert.equal(plan.update.flagged, true);
  const off = planUpdate({ tags: [], flagged: false, read: false }, decision(null, ['Preen/Needs reply']), settings);
  assert.equal('flagged' in off.update, false);
});

test('flagToDo flags a to-do decision (no tag involved); off by default', () => {
  const s = mergeWithDefaults({ actions: { flagToDo: true } });
  const toDo = { category: null, tags: [], toDo: true, scores: {} };
  assert.equal(planUpdate({ tags: [], flagged: false, read: false }, toDo, s).update.flagged, true);
  assert.equal('flagged' in planUpdate({ tags: [], flagged: false, read: false }, toDo, settings).update, false);
  assert.equal('flagged' in planUpdate({ tags: [], flagged: false, read: false }, { ...toDo, toDo: false }, s).update, false);
});

test('an up-to-date message needs no update', () => {
  const plan = planUpdate({ tags: ['preen_newsletters', PROCESSED_TAG_KEY], flagged: false, read: false },
    decision('Newsletters', ['Preen/Newsletters']), settings);
  assert.deepEqual(plan.update, {});
  assert.deepEqual(plan.changes, []);
});

test('without the processed tag setting, no marker is added', () => {
  const s = mergeWithDefaults({ markProcessed: { tag: false } });
  const plan = planUpdate({ tags: [] }, decision(null, []), s);
  assert.deepEqual(plan.update, {});
});

// --- sender rules ---------------------------------------------------------

test('presetPerson: only a sender rule presets Real person; otherwise Jev is asked', () => {
  const s = mergeWithDefaults({});
  assert.equal(presetPerson(s).person, null);
  assert.equal(presetPerson(s, 'person').person, 'person');
  assert.equal(presetPerson(s, 'service').person, 'service');
  assert.equal(presetPerson(mergeWithDefaults({ questions: { person: false } }), 'person').person, null);
});

test('no shortcut settings remain; old stored ones are dropped', () => {
  assert.equal('shortcuts' in mergeWithDefaults({}), false);
  assert.equal('shortcuts' in mergeWithDefaults({ shortcuts: { headerService: true, addressBookPerson: true } }), false);
});

// --- vCard ----------------------------------------------------------------

test('vCardEmails reads EMAIL lines, including grouped and folded ones', () => {
  const vCard = 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Sam\r\nEMAIL;PREF=1:Sam@Example.org\r\nitem1.EMAIL:sam.work@exa\r\n mple.com\r\nEND:VCARD\r\n';
  assert.deepEqual(vCardEmails(vCard), ['sam@example.org', 'sam.work@example.com']);
  assert.deepEqual(vCardEmails(undefined), []);
});
