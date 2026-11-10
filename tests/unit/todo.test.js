// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// F14: the To-do decision (a task other than replying), its flag option, and
// everywhere it shows up (history, CSV, reserved names). It never gets a tag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWithDefaults, validateSettings } from '../../packages/shared/core/settings-schema.js';
import { buildQuestions } from '../../packages/shared/core/questions.js';
import { decide } from '../../packages/shared/core/rules.js';
import { planUpdate } from '../../packages/shared/core/actions.js';
import { emptySummary, addToSummary, toCsv } from '../../packages/shared/core/history.js';
import { levelOf } from '../../packages/shared/core/levels.js';

const settings = mergeWithDefaults({});
const choice = (name, p = 0.9) => ({ type: 'choice', choice: name, probabilities: { [name]: p }, confidence: 0.9 });
const answers = (toDo) => ({ category: choice('Bills'), person: { noul: 0.05 }, needs_reply: { noul: 0.05 }, to_do: { noul: toDo } });

test('To-do is asked by default, as a separate question from Needs reply', () => {
  const q = buildQuestions(settings);
  assert.equal(q.to_do.type, 'noul');
  assert.match(q.to_do.instructions, /other than replying/);
  assert.match(q.to_do.instructions, /codes or sign-in links they asked for/, 'lab 0.0.14: nothing left to do is not a to-do');
  assert.match(q.to_do.instructions, /tasks meant for other people/);
  assert.ok(q.needs_reply, 'Needs reply is still asked');
  assert.equal(levelOf('toDo', settings), 'medium');
});

test('To-do is decided only at or above its threshold, and never becomes a tag', () => {
  assert.equal(decide(answers(0.9), settings).toDo, true);
  assert.equal(decide(answers(0.65), settings).toDo, true, 'threshold is inclusive');
  assert.equal(decide(answers(0.6), settings).toDo, false, 'default level is 0.65 since 0.0.15');
  for (const p of [0.9, 0.65, 0.6]) assert.ok(!decide(answers(p), settings).tags.some((t) => /to-?do/i.test(t)), 'no To-do tag');
  const no = decide(answers(0.1), settings);
  assert.equal(no.toDo, false);
  assert.ok(!no.tags.some((t) => /to-?do/i.test(t)));
  assert.deepEqual(no.reasons, []);
  assert.equal(no.scores.toDo, 0.1);
});

test('a To-do answer near the threshold is explained in the log', () => {
  assert.ok(decide(answers(0.55), settings).reasons.some((r) => /Unsure if it's a to-do/.test(r)));
  assert.ok(!decide(answers(0.95), settings).reasons.some((r) => /Unsure if it's a to-do/.test(r)));
});

test('turned off: not asked, not decided, no reason', () => {
  const off = mergeWithDefaults({ questions: { toDo: false } });
  assert.ok(!('to_do' in buildQuestions(off)));
  const d = decide(answers(0.9), off);
  assert.equal(d.toDo, false);
  assert.ok(!d.reasons.some((r) => /to-do/i.test(r)));
  assert.equal(d.scores.toDo, null);
});

test('an unreadable To-do answer is reported', () => {
  const a = answers(0.9);
  delete a.to_do;
  assert.ok(decide(a, settings).reasons.includes('Answer for To-do not understood'));
});

test('"Also flag them" flags To-do messages; off by default', () => {
  const d = decide(answers(0.9), settings);
  const current = { tags: [], flagged: false, read: false };
  assert.equal(planUpdate(current, d, settings).after.flagged, false);
  const on = mergeWithDefaults({ actions: { flagToDo: true } });
  const plan = planUpdate(current, d, on);
  assert.equal(plan.after.flagged, true);
  assert.ok(!plan.after.tags.includes('preen_to_do'), 'flagged, but not tagged');
  assert.equal(plan.after.read, false, 'never marks read');
});

test('history counts To-do and the CSV has a to_do column', () => {
  const s = emptySummary('2026-10');
  addToSummary(s, { scores: { toDo: 0.9 }, toDo: true, tags: ['Preen/Needs reply'] });
  assert.deepEqual([s.toDo, s.needsReply], [1, 1]);
  const old = emptySummary('2026-09');
  delete old.toDo; // saved before 0.0.12
  addToSummary(old, { scores: {}, toDo: true, tags: [] });
  assert.equal(old.toDo, 1);
  const csv = toCsv([{ at: '2026-10-01T10:00:00Z', scores: { toDo: 0.82 }, toDo: true, tags: [] }]);
  const [head, row] = csv.trim().split(/\r?\n/);
  assert.equal(row.split(',')[head.split(',').indexOf('to_do')], '0.82');
});

test('To-do is a reserved category name; the threshold is validated', () => {
  for (const name of ['To-do', 'to do', 'TODO']) {
    const s = mergeWithDefaults({ categories: [{ name, description: 'Things to do' }] });
    assert.equal(validateSettings(s).ok, false, name);
  }
  assert.equal(validateSettings(mergeWithDefaults({ thresholds: { toDo: 1.5 } })).ok, false);
  assert.equal(validateSettings(settings).ok, true);
});

// D130: per-category "Never a To-do".
const withNoToDo = (flag, threshold) => mergeWithDefaults({
  categories: [{ name: 'Bills', description: 'x', ...(flag === undefined ? {} : { noToDo: flag }), ...(threshold === undefined ? {} : { threshold }) }],
});

test('Never a To-do on: it is not a to-do, the reason says why, and the score is kept', () => {
  const r = decide(answers(0.9), withNoToDo(true));
  assert.equal(r.category, 'Bills');
  assert.equal(r.toDo, false);
  assert.ok(r.reasons.includes('No To-do for Bills (your category setting)'));
  assert.equal(r.scores.toDo, 0.9);
});

test('Never a To-do on: below the To-do threshold nothing is added or said, and no "unsure" note', () => {
  assert.deepEqual(decide(answers(0.1), withNoToDo(true)).reasons, []);
  assert.ok(!decide(answers(0.55), withNoToDo(true)).reasons.some((r) => /Unsure if it's a to-do/.test(r)));
});

test('Never a To-do off or unset: the to-do stays', () => {
  for (const flag of [false, undefined]) {
    const r = decide(answers(0.9), withNoToDo(flag));
    assert.equal(r.toDo, true);
    assert.ok(!r.reasons.some((x) => /No To-do/.test(x)));
  }
});

test('Never a To-do does not apply when the category was not applied (below its threshold)', () => {
  const r = decide(answers(0.9), withNoToDo(true, 0.95)); // Bills at 0.9 < 0.95
  assert.equal(r.category, null);
  assert.equal(r.toDo, true);
  assert.ok(!r.reasons.some((x) => /No To-do/.test(x)));
});
