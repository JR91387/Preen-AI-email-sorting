// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// D136: the sensitive-info flag, local patterns only. Values never leave the
// function: only the kinds are returned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSensitive, sensitiveReason, replaceSensitive } from '../../packages/shared/core/sensitive.js';

test('documented test numbers are found, each kind once', () => {
  assert.deepEqual(detectSensitive('Visa 4111 1111 1111 1111, Amex 3782-822463-10005'), ['card']);
  assert.deepEqual(detectSensitive('IBAN GB82 WEST 1234 5698 7654 32 / DE89370400440532013000'), ['iban']);
  assert.deepEqual(detectSensitive('SSN 078-05-1120'), ['ssn']);
  assert.deepEqual(detectSensitive('DOB: 1980-04-12'), ['dob']);
  assert.deepEqual(detectSensitive('born on March 3, 1975'), ['dob']);
  assert.deepEqual(detectSensitive('Passport no. X1234567'), ['passport']);
  assert.deepEqual(detectSensitive("Driver's licence # D1234-5678"), ['licence']);
  assert.deepEqual(detectSensitive('DOB 1/2/1990, card 5555555555554444'), ['card', 'dob']);
});

test('near-misses are not flagged', () => {
  for (const text of [
    'Order 1234567890123456 has shipped', 'Card 4111 1111 1111 1112', 'Gift code 7000 1234 5678 9012',
    'Tracking 1Z999AA10123456784', 'Call 555-123-4567 or +1 (415) 555-0199', 'SSN-shaped 666-12-3456 and 900-12-3456',
    'IBAN GB82 WEST 1234 5698 7654 33', 'Meeting on 04/12/1980', 'Passport photo booth opens at 9', 'Version 4.1.1.1-1111',
    'Invoice INV-2026-000123 total $1,234.56',
  ]) assert.deepEqual(detectSensitive(text), [], text);
});

test('the reason names the kinds, never the value', () => {
  const reason = sensitiveReason(detectSensitive('Card 4111 1111 1111 1111, SSN 078-05-1120'));
  assert.match(reason, /payment card number, a US Social Security number/);
  assert.doesNotMatch(reason, /4111|078/);
});

test('no-break spaces, tabs and Unicode dashes are separators; line breaks are not; a bare "DL" is not a label', () => {
  assert.deepEqual(detectSensitive('Card 4111 1111 1111 1111'), ['card']);
  assert.deepEqual(detectSensitive('Card 4111\t1111‑1111‑1111'), ['card']);
  assert.deepEqual(detectSensitive('IBAN GB82 WEST 1234 5698 7654 32'), ['iban']);
  assert.deepEqual(detectSensitive('Ref 4111 1111\n1111 1111'), []);
  assert.deepEqual(detectSensitive('DL: release-2026-final is ready'), []);
  assert.deepEqual(detectSensitive('DL no. D1234-5678'), ['licence']);
});

test('replaceSensitive replaces exactly what detectSensitive reports', () => {
  assert.equal(replaceSensitive('Card 4111 1111 1111 1111, SSN 078-05-1120, DOB: 1980-04-12'), 'Card <PII_Block>, SSN <PII_Block>, <PII_Block>');
  assert.equal(replaceSensitive('Order 1234 5678 9012 3456, call 555-123-4567'), 'Order 1234 5678 9012 3456, call 555-123-4567');
});
