// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The Junk verdict: Thunderbird's own Junk mark for spam, scams and phishing.
// Off by default, never for known senders, never cleared, undoable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWithDefaults, validateSettings } from '../../packages/shared/core/settings-schema.js';
import { buildQuestions } from '../../packages/shared/core/questions.js';
import { decide } from '../../packages/shared/core/rules.js';
import { planUpdate } from '../../packages/shared/core/actions.js';
import { planUndo } from '../../packages/shared/core/undo.js';
import { emptySummary, addToSummary, toCsv } from '../../packages/shared/core/history.js';
import { levelOf } from '../../packages/shared/core/levels.js';

const off = mergeWithDefaults({});
const on = mergeWithDefaults({ questions: { junk: true } });
const choice = (name, p = 0.9) => ({ type: 'choice', choice: name, probabilities: { [name]: p }, confidence: 0.9 });
const answers = (junk, extra = {}) => ({
  category: choice('Bills'), person: { noul: 0.05 }, needs_reply: { noul: 0.05 }, to_do: { noul: 0.05 }, junk: { noul: junk }, ...extra,
});
const clean = { tags: [], flagged: false, read: false, junk: false };

test('Junk is off by default and its default certainty is high', () => {
  assert.equal(off.questions.junk, false);
  assert.equal(buildQuestions(off).junk, undefined);
  assert.equal(off.thresholds.junk, 0.9);
  assert.equal(levelOf('junk', off), 'high', 'the help text says the default is high (#13)');
  // An install that saved its own level keeps it.
  assert.equal(mergeWithDefaults({ thresholds: { junk: 0.8 } }).thresholds.junk, 0.8);
  assert.ok(validateSettings(on).ok);
});

test('when on, Junk is asked, also for a sender with a "real person" rule', () => {
  assert.equal(buildQuestions(on).junk.type, 'noul');
  assert.match(buildQuestions(on).junk.instructions, /spam, a scam, phishing/);
  assert.equal(buildQuestions(on, { person: 'person' }).junk.type, 'noul');
});

test('junk mail also gets a visible Preen/Junk tag; other mail never does (#22)', () => {
  assert.ok(decide(answers(0.95), on).tags.includes('Preen/Junk'));
  assert.ok(!decide(answers(0.5), on).tags.includes('Preen/Junk'), 'below the level');
  assert.ok(!decide(answers(0.95), off).tags.includes('Preen/Junk'), 'Junk switched off');
});

test('junk only at or above the threshold', () => {
  assert.equal(decide(answers(0.95), on).junk, true);
  assert.equal(decide(answers(0.9), on).junk, true, 'threshold is inclusive');
  assert.equal(decide(answers(0.85), on).junk, false, 'below the High default');
  assert.equal(decide(answers(0.5), on).junk, false);
  assert.equal(decide(answers(0.95), off).junk, false, 'not asked when off');
  assert.equal(decide(answers(0.99), on, { person: 'person' }).junk, true, 'a sender rule doesn\'t skip Junk');
  assert.equal(decide(answers(0.95), on).scores.junk, 0.95);
});

test('junk mail gets no Needs reply tag and no to-do, so no flag either', () => {
  const s = mergeWithDefaults({ questions: { junk: true }, actions: { flagNeedsReply: true, flagToDo: true } });
  const d = decide(answers(0.95, { needs_reply: { noul: 0.9 }, to_do: { noul: 0.9 } }), s);
  assert.ok(!d.tags.includes('Preen/Needs reply'));
  assert.equal(d.toDo, false);
  assert.equal(planUpdate(clean, d, s).after.flagged, false);
});

test('an unclear or missing junk answer is explained in the log', () => {
  assert.ok(decide(answers(0.8), on).reasons.some((r) => r.startsWith("Unsure if it's junk")));
  assert.ok(decide({ ...answers(0), junk: undefined }, on).reasons.includes('Answer for Junk not understood'));
});

test('applying sets Thunderbird\'s Junk mark, and never clears one', () => {
  const plan = planUpdate(clean, decide(answers(0.95), on), on);
  assert.equal(plan.update.junk, true);
  assert.ok(plan.changes.includes('marked junk'));
  assert.equal(plan.update.read, undefined, 'never marks read');
  const already = planUpdate({ ...clean, junk: true }, decide(answers(0.1), on), on);
  assert.equal(already.update.junk, undefined, 'a junk mark Preen did not set is left alone');
  assert.equal(already.after.junk, true);
});

test('undo clears only a junk mark Preen set, if it is still there', () => {
  const plan = planUpdate(clean, decide(answers(0.95), on), on);
  const undo = planUndo({ ...plan.after }, plan);
  assert.equal(undo.update.junk, false);
  assert.ok(undo.changes.includes('marked not junk'));
  assert.equal(planUndo({ ...plan.after, junk: false }, plan).update.junk, undefined, 'user already cleared it');
  const old = { before: { tags: [], flagged: false, read: false }, after: { tags: ['preen_promotions'], flagged: false, read: false } };
  assert.equal(planUndo({ tags: ['preen_promotions'], junk: true }, old).update.junk, undefined, 'pre-0.0.14 entries never touch junk');
});

test('history counts junk and exports the score and the verdict', () => {
  const entry = { scores: { junk: 0.95 }, junk: true, at: '2026-10-01T00:00:00Z' };
  assert.equal(addToSummary(emptySummary('2026-10'), entry).junk, 1);
  const [header, row] = toCsv([entry]).trim().split('\r\n');
  const cols = header.split(',');
  assert.equal(row.split(',')[cols.indexOf('junk')], '0.95');
  assert.equal(row.split(',')[cols.indexOf('is_junk')], 'true');
});

test('a category flag or mark-unread action is not applied to junk mail', () => {
  const s = mergeWithDefaults({
    questions: { junk: true },
    categories: [{ name: 'Promotions', description: 'p', actions: { flag: true, markUnread: true } }],
  });
  const plan = planUpdate({ ...clean, read: true }, decide(answers(0.95), s), s);
  assert.equal(plan.after.flagged, false);
  assert.equal(plan.after.read, true);
  assert.equal(plan.update.junk, true);
});

test('junk mail with an uncertain category is marked for review too, like any other mail (no Review tag)', () => {
  const unsureCategory = { ...answers(0.95), category: choice('Bills', 0.5) };
  const d = decide(unsureCategory, on);
  assert.equal(d.junk, true);
  assert.equal(d.review, true);
  assert.ok(!d.tags.includes('Preen/Review'));
  assert.ok(d.tags.includes('Preen/Junk'));
  const notJunk = decide({ ...answers(0.1), category: choice('Bills', 0.5) }, on);
  assert.equal(notJunk.review, true, 'not junk: review as before');
  assert.deepEqual(notJunk.tags, []);
});

test('Preen/Junk stays while the message keeps its junk mark; a "Junk" category is refused (#22)', () => {
  const later = decide(answers(0.3), on); // a later run no longer calls it junk
  const plan = planUpdate({ ...clean, junk: true, tags: ['preen_junk'] }, later, on);
  assert.ok(plan.after.tags.includes('preen_junk'), 'kept with the junk mark');
  assert.equal(plan.after.junk, true);
  const thunderbirdOnly = planUpdate({ ...clean, junk: true, tags: [] }, later, on);
  assert.ok(!thunderbirdOnly.after.tags.includes('preen_junk'), 'not added for a mark Preen did not make');
  const withJunkCategory = mergeWithDefaults({ categories: [...on.categories, { name: 'Junk', description: 'Spam' }] });
  const { ok, errors } = validateSettings(withJunkCategory);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /Junk/i.test(e)), errors.join('; '));
});
