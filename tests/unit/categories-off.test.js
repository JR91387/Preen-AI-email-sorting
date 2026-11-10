// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Category sorting off: no category question, no Review for a missing answer, yes/no tags still apply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions } from '../../packages/shared/core/questions.js';
import { decide } from '../../packages/shared/core/rules.js';
import { mergeWithDefaults, validateSettings } from '../../packages/shared/core/settings-schema.js';
import { exportSettings, parseSettingsFile } from '../../packages/shared/core/settings-io.js';
import { buildReport, assertAllowed } from '../../packages/shared/core/telemetry.js';

const off = mergeWithDefaults({ categorySort: { enabled: false }, questions: { junk: true } });
const on = mergeWithDefaults({});

test('categories on by default; the request holds a category question', () => {
  assert.equal(on.categorySort.enabled, true);
  assert.ok(buildQuestions(on).category);
});

test('with categories off the request asks no category question, only the yes/no ones', () => {
  const q = buildQuestions(off);
  assert.equal('category' in q, false);
  assert.deepEqual(Object.keys(q).sort(), ['junk', 'needs_reply', 'person', 'to_do']);
});

test('with categories off a missing category answer is not a Review', () => {
  const d = decide({}, off);
  assert.equal(d.review, false);
  assert.equal(d.category, null);
  assert.ok(!d.tags.includes('Preen/Review'));
  assert.deepEqual(d.reasons.filter((r) => /categor/i.test(r)), ['Categories off']);
  assert.ok(!d.reasons.includes('No category answer'));
});

test('with categories on a missing category answer is still a Review', () => {
  const d = decide({}, on);
  assert.equal(d.review, true);
  assert.ok(d.reasons.includes('No category answer'));
});

test('with categories off a stray category answer is ignored', () => {
  const d = decide({ category: { type: 'choice', choice: 'Receipts', probabilities: { Receipts: 0.99 } } }, off);
  assert.equal(d.category, null);
  assert.equal(d.review, false);
  assert.ok(!d.tags.some((t) => t === 'Preen/Receipts'));
});

test('with categories off the yes/no tags still apply (to-do is a decision, not a tag)', () => {
  const d = decide({
    person: { type: 'noul', noul: 0.99 },
    needs_reply: { type: 'noul', noul: 0.99 },
    to_do: { type: 'noul', noul: 0.99 },
    junk: { type: 'noul', noul: 0.01 },
  }, off);
  assert.deepEqual(d.tags.sort(), ['Preen/Needs reply', 'Preen/Real person'].sort());
  assert.equal(d.toDo, true);
  assert.equal(d.review, false);
  const j = decide({ junk: { type: 'noul', noul: 0.99 } }, off);
  assert.ok(j.tags.includes('Preen/Junk'));
  assert.equal(j.junk, true);
});

test('validation: empty category list is fine when off, an error when on', () => {
  assert.equal(validateSettings({ ...off, categories: [] }).ok, true);
  const bad = validateSettings({ ...on, categories: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('Add at least one category.'));
  assert.equal(validateSettings({ ...off }).ok, true);
});

test('validation: categorySort.enabled must be a boolean', () => {
  const r = validateSettings({ ...on, categorySort: { enabled: 'no' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /categorySort\.enabled/.test(e)));
});

test('categorySort.enabled=false survives export then import', () => {
  const file = JSON.stringify(exportSettings(off));
  const r = parseSettingsFile(file, on, []);
  assert.deepEqual(r.errors, []);
  assert.equal(r.settings.categorySort.enabled, false);
});

test('telemetry reports categoriesOn and passes the allow-list', () => {
  for (const [s, want] of [[off, false], [on, true]]) {
    const r = buildReport({ settings: s, totals: { messages: 1, tokens: 1, costUsd: 0, corrections: 0 }, version: '0.0.27', now: Date.UTC(2026, 10, 6) });
    assert.equal(r.settings.categoriesOn, want);
    assert.doesNotThrow(() => assertAllowed(r));
  }
});

test('with categories off, invalid category rows are not checked, but some question must stay on', () => {
  const base = mergeWithDefaults({ categorySort: { enabled: false } });
  base.categories = [{ name: '', description: '' }];
  base.questions = { person: false, needsReply: false, toDo: false, junk: true };
  assert.deepEqual(validateSettings(base).errors.filter((e) => /Category|categor/.test(e)), []);
  base.questions.junk = false;
  assert.ok(validateSettings(base).errors.some((e) => /turn on at least one yes\/no question/.test(e)));
});
