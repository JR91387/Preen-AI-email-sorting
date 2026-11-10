// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageTokens, costOfEmails, estimateRun, roundUpNice, suggestMonthlyLimit } from '../../packages/shared/core/cost.js';

test('averageTokens: tokens over messages across months; null without history', () => {
  assert.equal(averageTokens([{ messages: 2, tokens: 1000 }, { messages: 2, tokens: 3000 }]), 1000);
  assert.equal(averageTokens([]), null);
  assert.equal(averageTokens(undefined), null);
  assert.equal(averageTokens([{ messages: 3, tokens: 0 }]), null);
  assert.equal(averageTokens([{ messages: 0, tokens: 500 }]), null);
});

test('costOfEmails: tokens × price per million; null without a usable price or average', () => {
  assert.equal(costOfEmails(1000, 1, 1000), 1);
  assert.equal(costOfEmails(800, 0.15, 100), 0.012);
  assert.equal(costOfEmails(1000, null, 100), null);
  assert.equal(costOfEmails(1000, NaN, 100), null);
  assert.equal(costOfEmails(1000, -1, 100), null);
  assert.equal(costOfEmails(null, 1, 100), null);
  assert.equal(costOfEmails(1000, 0, 100), 0);
});

test('estimateRun: tokens always, dollars only with a price', () => {
  assert.deepEqual(estimateRun(5, 1000, 1), { tokens: 5000, usd: 0.005 });
  assert.deepEqual(estimateRun(5, 1000), { tokens: 5000, usd: null });
  assert.equal(estimateRun(5, null, 1), null);
  assert.equal(estimateRun(0, 1000, 1), null);
});

test('roundUpNice: up to 1, 2 or 5 times a power of ten', () => {
  assert.equal(roundUpNice(0.12), 0.2);
  assert.equal(roundUpNice(1), 1);
  assert.equal(roundUpNice(1.01), 2);
  assert.equal(roundUpNice(2.5), 5);
  assert.equal(roundUpNice(5.1), 10);
  assert.equal(roundUpNice(0.0031), 0.005);
  assert.equal(roundUpNice(0), null);
  assert.equal(roundUpNice(null), null);
});

test('suggestMonthlyLimit: what 1,000 emails cost, rounded up; null without an average and a price', () => {
  assert.equal(suggestMonthlyLimit(800, 0.15), 0.2);
  assert.equal(suggestMonthlyLimit(1000, 1), 1);
  assert.equal(suggestMonthlyLimit(1000, null), null);
  assert.equal(suggestMonthlyLimit(null, 1), null);
});
