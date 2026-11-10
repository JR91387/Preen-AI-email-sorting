// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, buildQuestions, OTHER_CATEGORY } from '../../packages/shared/core/questions.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

const settings = mergeWithDefaults({ personalContext: '  I run a bakery.  ' });
const signals = { service: ['List-Unsubscribe header'], person: [], mailingList: false };
const email = {
  author: 'Weekly Digest <news@digest.example>',
  toCount: 1,
  ccCount: 0,
  subject: 'This week',
  date: new Date('2026-09-30T12:00:00Z'),
  attachments: ['report.pdf'],
  body: 'Hello subscribers',
  bodyTruncated: true,
};

test('category is a choice over the user categories plus other', () => {
  const q = buildQuestions(settings);
  assert.equal(q.category.type, 'choice');
  assert.deepEqual(Object.keys(q.category.criteria), [...settings.categories.map((c) => c.name), OTHER_CATEGORY]);
});

test('person, needs_reply and to_do are noul questions that can be turned off', () => {
  const q = buildQuestions(settings);
  assert.equal(q.person.type, 'noul');
  assert.equal(q.needs_reply.type, 'noul');
  assert.equal(q.to_do.type, 'noul');
  const off = buildQuestions(mergeWithDefaults({ questions: { person: false, needsReply: false, toDo: false } }));
  assert.deepEqual(Object.keys(off), ['category']);
});

test('state carries the email, header hints and trimmed personal context', () => {
  const { state } = buildRequest(email, settings, signals);
  assert.equal(state.email.subject, 'This week');
  assert.equal(state.email.date, '2026-09-30T12:00:00.000Z');
  assert.deepEqual(state.email.attachments, ['report.pdf']);
  assert.equal(state.email.body_was_shortened, true);
  assert.deepEqual(state.header_hints.automated_signs, ['List-Unsubscribe header']);
  assert.equal(state.about_the_recipient, 'I run a bakery.');
});

test('state carries the sender facts: is_contact (unknown when not looked up) and dmarc_failed', () => {
  assert.equal(buildRequest(email, settings, signals).state.sender_is_contact, 'unknown');
  assert.equal(buildRequest(email, settings, signals).state.dmarc_failed, false);
  const forged = { ...email, senderIsContact: true, headers: { 'authentication-results': ['mx.example; dmarc=fail'] } };
  assert.equal(buildRequest(forged, settings, signals).state.sender_is_contact, true);
  assert.equal(buildRequest(forged, settings, signals).state.dmarc_failed, true);
  assert.equal(buildRequest({ ...email, senderIsContact: false }, settings, signals).state.sender_is_contact, false);
});

test('personal context is omitted when empty', () => {
  const { state } = buildRequest(email, mergeWithDefaults({}), signals);
  assert.equal('about_the_recipient' in state, false);
});

test('request has no model; the provider layer adds it', () => {
  assert.equal('model' in buildRequest(email, settings, signals), false);
});

test('without a body, no message text is included (Surface pass)', () => {
  const { body, bodyTruncated, ...meta } = email;
  const { state } = buildRequest(meta, settings, signals);
  assert.equal(state.email.body_included, false);
  assert.equal('body' in state.email, false);
  assert.equal('body_was_shortened' in state.email, false);
  assert.equal(state.email.subject, 'This week');
});

test('with a body, body_included is true', () => {
  const { state } = buildRequest(email, settings, signals);
  assert.equal(state.email.body_included, true);
  assert.equal(state.email.body, 'Hello subscribers');
});

test('a known person answer removes that question', () => {
  const q = buildQuestions(settings, { person: 'service' });
  assert.equal('person' in q, false);
  assert.ok('needs_reply' in q);
});

test('categoryCriterion combines "is" and "is not"', async () => {
  const { categoryCriterion } = await import('../../packages/shared/core/questions.js');
  assert.equal(categoryCriterion({ description: 'Receipts and invoices.' }), 'Receipts and invoices.');
  assert.equal(
    categoryCriterion({ description: ' Receipts and invoices ', excludes: 'Marketing from shops.  ' }),
    'Receipts and invoices. Does NOT include: Marketing from shops.',
  );
  assert.equal(categoryCriterion({ description: 'Receipts', excludes: '   ' }), 'Receipts.');
});

test('the category question uses the combined text', () => {
  const s = mergeWithDefaults({ categories: [{ name: 'Receipts', description: 'Receipts', excludes: 'Ads' }] });
  assert.equal(buildQuestions(s).category.criteria.Receipts, 'Receipts. Does NOT include: Ads.');
});

test('languages the user reads are sent trimmed, and only when not empty', () => {
  const withLanguages = mergeWithDefaults({ recipientLanguages: '  English (US), Spanish ' });
  assert.equal(buildRequest(email, withLanguages, signals).state.recipient_languages, 'English (US), Spanish');
  for (const empty of ['', '   ']) {
    const { state } = buildRequest(email, mergeWithDefaults({ recipientLanguages: empty }), signals);
    assert.equal('recipient_languages' in state, false);
  }
  assert.equal('recipient_languages' in buildRequest(email, mergeWithDefaults({}), signals).state, false);
});

test('the language hint changes nothing else in the request', () => {
  const plain = buildRequest(email, mergeWithDefaults({}), signals);
  const hinted = buildRequest(email, mergeWithDefaults({ recipientLanguages: 'French' }), signals);
  const { recipient_languages: added, ...rest } = hinted.state;
  assert.equal(added, 'French');
  assert.deepEqual(rest, plain.state);
  assert.deepEqual(hinted.questions, plain.questions);
});

test('an unparseable message date becomes empty instead of throwing', () => {
  assert.equal(buildRequest({ ...email, date: 'garbage' }, settings, signals).state.email.date, '');
});
