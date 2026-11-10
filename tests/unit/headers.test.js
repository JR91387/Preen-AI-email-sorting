// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerSignals, extractAddress } from '../../packages/shared/core/headers.js';
import * as samples from '../fixtures/emails/samples.js';

test('extractAddress handles name + angle brackets and bare addresses', () => {
  assert.equal(extractAddress('Sam Rivera <Sam@Example.org>'), 'sam@example.org');
  assert.equal(extractAddress('sam@example.org'), 'sam@example.org');
  assert.equal(extractAddress(''), '');
});

test('extractAddress ignores addresses inside the display name', () => {
  assert.equal(extractAddress('"Bob <bob@contact.com>" <evil@attacker.net>'), 'evil@attacker.net');
  assert.equal(extractAddress('bob@contact.com <evil@attacker.net>'), 'evil@attacker.net');
  assert.equal(extractAddress('"bob@contact.com" evil@attacker.net'), 'evil@attacker.net');
});

test('newsletter has several service signals', () => {
  const s = headerSignals(samples.newsletter);
  assert.ok(s.service.includes('List-Unsubscribe header'));
  assert.ok(s.service.includes('Feedback-ID header'));
  assert.ok(s.service.includes('Sent through SendGrid'));
  assert.ok(s.service.some((x) => x.startsWith('Precedence')));
  assert.deepEqual(s.person, []);
});

test('receipt from no-reply via SES is a service', () => {
  const s = headerSignals(samples.receipt);
  assert.ok(s.service.includes('Sent through Amazon SES'));
  assert.ok(s.service.some((x) => x.includes('no-reply@shop.example')));
});

test('reply in a conversation without bulk signs suggests a person', () => {
  const s = headerSignals(samples.personalReply);
  assert.deepEqual(s.service, []);
  assert.deepEqual(s.person, ['Reply in a conversation']);
});

test('mailing-list post is flagged as a list and not as a person', () => {
  const s = headerSignals(samples.mailingListPost);
  assert.equal(s.mailingList, true);
  assert.deepEqual(s.person, []);
});

test('auto-reply is a service; Auto-Submitted: no is not', () => {
  assert.ok(headerSignals(samples.outOfOffice).service.some((x) => x.startsWith('Auto-Submitted')));
  assert.deepEqual(headerSignals({ ...samples.plainPerson, 'auto-submitted': ['no'] }).service, []);
});

test('an ordinary sender produces no signals', () => {
  assert.deepEqual(headerSignals(samples.plainPerson), { service: [], person: [], mailingList: false, strongService: false });
});

test('sender names that merely contain "noreply" elsewhere are not flagged', () => {
  const s = headerSignals({ from: ['Noreply Fan <casey@example.com>'] });
  assert.deepEqual(s.service, []);
});

test('strongService: bulk, automated and no-reply senders are strong', () => {
  assert.equal(headerSignals(samples.newsletter).strongService, true);
  assert.equal(headerSignals(samples.receipt).strongService, true);
  assert.equal(headerSignals(samples.outOfOffice).strongService, true);
});

test('strongService: a discussion-list post by a person is not strong', () => {
  // Precedence: list and List-Unsubscribe are added by list software to human posts.
  assert.equal(headerSignals(samples.mailingListPost).strongService, false);
});

test('strongService: plain and conversational mail is not strong', () => {
  assert.equal(headerSignals(samples.plainPerson).strongService, false);
  assert.equal(headerSignals(samples.personalReply).strongService, false);
});

test('lab 0.0.14: a discussion-list post with Precedence: bulk is not "strong service", so Real person is asked', () => {
  const apacheList = {
    'list-id': ['<users.tomcat.apache.org>'], 'list-unsubscribe': ['<mailto:users-unsubscribe@tomcat.apache.org>'],
    precedence: ['bulk'], from: ['Some Person <person@example.org>'],
  };
  assert.equal(headerSignals(apacheList).strongService, false);
  assert.equal(headerSignals({ ...apacheList, 'list-id': undefined, 'list-post': ['<mailto:users@tomcat.apache.org>'] }).strongService, false);
  // Without list headers, bulk still means a bulk sender; on a list, sending-service headers still count.
  assert.equal(headerSignals({ precedence: ['bulk'], from: ['Shop <deals@example.com>'] }).strongService, true);
  assert.equal(headerSignals({ ...apacheList, 'feedback-id': ['1:2:3'] }).strongService, true);
  assert.equal(headerSignals({ ...apacheList, precedence: ['junk'] }).strongService, true);
});

test('dmarcFailed: any Authentication-Results header saying dmarc=fail, in any order', async () => {
  const { dmarcFailed } = await import('../../packages/shared/core/headers.js');
  assert.equal(dmarcFailed({ 'authentication-results': ['mx.example; spf=pass; dkim=none; dmarc=fail (p=reject)'] }), true);
  assert.equal(dmarcFailed({ 'authentication-results': ['forged; dmarc=pass', 'mx.example; dmarc=fail'] }), true);
  assert.equal(dmarcFailed({ 'authentication-results': ['mx.example; dmarc=fail', 'forged; dmarc=pass'] }), true);
  assert.equal(dmarcFailed({ 'authentication-results': ['mx.example; dmarc=pass'] }), false);
  assert.equal(dmarcFailed({ 'authentication-results': ['mx.example; dmarc=failure-not-a-result'] }), false);
  assert.equal(dmarcFailed({}), false);
});
