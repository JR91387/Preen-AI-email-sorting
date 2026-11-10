// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBody, truncate } from '../../packages/shared/core/text.js';

test('removes "On … wrote:" quoted history, even when wrapped', () => {
  const body = 'Sounds good, see you then.\n\nOn Tue, Sep 29, 2026 at 10:00 AM Sam Rivera <sam@example.org>\nwrote:\n> Lunch on Friday?';
  assert.equal(cleanBody(body), 'Sounds good, see you then.');
});

test('removes Outlook original-message blocks', () => {
  const body = 'Approved.\r\n\r\n-----Original Message-----\r\nFrom: Someone\r\nPlease approve.';
  assert.equal(cleanBody(body), 'Approved.');
});

test('removes signature after "-- " and stray quoted lines', () => {
  const body = 'Hi,\n> quoted line\nThe file is attached.\n-- \nCasey\nPhone 555-0100';
  assert.equal(cleanBody(body), 'Hi,\nThe file is attached.');
});

test('collapses blank lines and spaces', () => {
  assert.equal(cleanBody('a   b\n\n\n\n\nc  '), 'a b\n\nc');
});

test('handles empty and missing input', () => {
  assert.equal(cleanBody(''), '');
  assert.equal(cleanBody(undefined), '');
});

test('truncate leaves short text alone', () => {
  assert.deepEqual(truncate('hello', 10), { text: 'hello', truncated: false });
});

test('truncate cuts at a word boundary near the limit', () => {
  const text = 'word '.repeat(100); // 500 chars
  const out = truncate(text, 203);
  assert.equal(out.truncated, true);
  assert.ok(out.text.length <= 203);
  assert.ok(out.text.endsWith('word'));
});
