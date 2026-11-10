// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, readNoul } from '../../packages/shared/core/rules.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

// Own categories, so these tests don't depend on the defaults.
const settings = mergeWithDefaults({
  categories: [
    { name: 'Receipts', description: 'r' },
    { name: 'Personal', description: 'p' },
    { name: 'Work', description: 'w' },
  ],
});

function choice(choiceName, p, confidence = 0.8) {
  return { type: 'choice', choice: choiceName, probabilities: { [choiceName]: p }, confidence };
}

test('confident category, not a real person (no tag for that), reply needed', () => {
  const d = decide({
    category: choice('Receipts', 0.9),
    person: { type: 'noul', noul: 0.05 },
    needs_reply: { type: 'noul', noul: 0.7 },
  }, settings);
  assert.equal(d.category, 'Receipts');
  assert.deepEqual(d.tags, ['Preen/Receipts', 'Preen/Needs reply'], 'only the affirmative is tagged');
  assert.equal(d.review, false);
});

test('clear real person', () => {
  const d = decide({ category: choice('Personal', 0.95), person: { noul: 0.92 } }, settings);
  assert.deepEqual(d.tags, ['Preen/Personal', 'Preen/Real person']);
});

test('just below the real-person threshold: no tag, with a reason', () => {
  const reply = { noul: 0.1 };
  const d = decide({ category: choice('Work', 0.9), person: { noul: 0.65 }, needs_reply: reply, to_do: reply }, settings);
  assert.deepEqual(d.tags, ['Preen/Work']);
  assert.match(d.reasons[0], /Unsure if a real person/);
  const clearlyNot = decide({ category: choice('Work', 0.9), person: { noul: 0.1 }, needs_reply: reply, to_do: reply }, settings);
  assert.deepEqual(clearlyNot.reasons, [], 'clearly not a real person: nothing to say');
});

test('low category probability goes to Review (no category, no Review tag)', () => {
  const d = decide({ category: choice('Work', 0.6) }, settings);
  assert.equal(d.category, null);
  assert.equal(d.review, true);
  assert.deepEqual(d.tags, []);
});

test('a category has one threshold: probability at or above it applies, whatever the confidence', () => {
  const d = decide({ category: choice('Work', 0.8, 0.3) }, settings);
  assert.equal(d.category, 'Work');
  assert.equal(d.review, false);
  assert.equal(d.scores.categoryConfidence, 0.3, 'still recorded in the log');
  assert.equal('categoryConfidence' in mergeWithDefaults({ thresholds: { categoryConfidence: 0.9 } }).thresholds, false);
});

test('"other" means no category tag and no Review', () => {
  const d = decide({ category: choice('other', 0.9) }, settings);
  assert.equal(d.category, null);
  assert.equal(d.review, false);
  assert.deepEqual(d.tags, []);
});

test('missing category answer goes to Review', () => {
  assert.equal(decide({}, settings).review, true);
});

test('thresholds are inclusive at the boundary', () => {
  const d = decide({ category: choice('Work', 0.75, 0.5), person: { noul: 0.8 } }, settings);
  assert.deepEqual(d.tags, ['Preen/Work', 'Preen/Real person']);
});

test('readNoul accepts noul, probability or value fields and rejects junk', () => {
  assert.equal(readNoul({ noul: 0.3 }), 0.3);
  assert.equal(readNoul({ probability: 0.4 }), 0.4);
  assert.equal(readNoul({ value: 0.5 }), 0.5);
  assert.equal(readNoul({ noul: 'high' }), null);
  assert.equal(readNoul(undefined), null);
});

test('known answers are used directly: real person tagged, "not a real person" untagged', () => {
  const not = decide({ category: choice('Receipts', 0.9) }, settings, { person: 'service' });
  assert.deepEqual(not.tags, ['Preen/Receipts']);
  const per = decide({ category: choice('Personal', 0.9), person: { noul: 0.01 } }, settings, { person: 'person' });
  assert.deepEqual(per.tags, ['Preen/Personal', 'Preen/Real person'], 'known answer wins over any model answer');
});

test('readNoul clamps provider probabilities to 0–1', () => {
  assert.equal(readNoul({ noul: 1.4 }), 1);
  assert.equal(readNoul({ noul: -0.2 }), 0);
  assert.equal(readNoul({ noul: 0.3 }), 0.3);
});

test('MVP: To-do, Review and Sensitive are decisions with data, never tags', () => {
  const defaults = mergeWithDefaults({});
  const noTag = (d) => assert.ok(!d.tags.some((t) => /to-?do|review|sensitive/i.test(t)), d.tags.join());
  const high = { person: { noul: 0.99 }, needs_reply: { noul: 0.99 }, to_do: { noul: 0.99 }, junk: { noul: 0.99 } };
  const sure = decide({ category: choice('Bills', 0.95), ...high }, mergeWithDefaults({ questions: { junk: false } }));
  noTag(sure);
  assert.equal(sure.toDo, true);
  assert.equal(sure.review, false);
  const unsure = decide({ category: choice('Bills', 0.2), ...high }, defaults);
  noTag(unsure);
  assert.equal(unsure.review, true);
  assert.equal(unsure.toDo, true);
  const asJunk = decide({ category: choice('Bills', 0.95), ...high }, mergeWithDefaults({ questions: { junk: true } }));
  noTag(asJunk);
  assert.equal(asJunk.toDo, false, 'junk asks for nothing');
});
