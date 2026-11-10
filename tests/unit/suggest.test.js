// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// D135: suggested certainty levels from the user's own corrections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestLevels, MIN_CORRECTIONS, LEVEL_FIELD } from '../../packages/shared/core/suggest.js';

const T = { realPerson: 0.7, needsReply: 0.7, toDo: 0.65 };
// A lower Real person level, so removals just above it are not shortcut removals.
const LOW = { ...T, realPerson: 0.65 };
const rows = (key, change, scores) => scores.map((score) => ({ key, change, score }));
const forField = (list, field) => list.find((s) => s.field === field);

test('no corrections: counts are zero and nothing is suggested', () => {
  for (const s of suggestLevels([], T)) assert.deepEqual([s.added, s.removed, s.suggested], [0, 0, null]);
});

test('fewer than the minimum: no suggestion, however one-sided', () => {
  const s = forField(suggestLevels(rows('preen_person', 'removed', Array(MIN_CORRECTIONS - 1).fill(0.7)), LOW), 'realPerson');
  assert.equal(s.removed, MIN_CORRECTIONS - 1);
  assert.equal(s.suggested, null);
});

test('tags removed at scores just above the level: suggests a higher level', () => {
  const s = forField(suggestLevels(rows('preen_person', 'removed', [0.66, 0.68, 0.7, 0.7, 0.72, 0.74, 0.66, 0.69, 0.71, 0.73]), LOW), 'realPerson');
  assert.ok(s.suggested > 0.65 && s.suggested <= 0.8, `got ${s.suggested}`);
  assert.equal(s.avoided, 10);
});

test('tags added where Preen scored a little under the level: suggests a lower level', () => {
  const s = forField(suggestLevels(rows('preen_needs_reply', 'added', [0.6, 0.62, 0.65, 0.66, 0.68, 0.61, 0.63, 0.64, 0.67, 0.69]), T), 'needsReply');
  assert.ok(s.suggested < 0.7 && s.suggested <= 0.6, `got ${s.suggested}`);
});

test('untouched messages count: kept tags near the level stop a change that only the corrections would favour', () => {
  const mixed = [...rows('preen_person', 'removed', [0.71, 0.72, 0.73, 0.74, 0.75]), ...rows('preen_person', 'added', [0.69, 0.68, 0.67, 0.66, 0.65])];
  // Corrections alone: raising past 0.75 avoids the 5 removals, so a change is suggested.
  assert.notEqual(forField(suggestLevels(mixed, T), 'realPerson').suggested, null);
  // With 20 kept tags at 0.71-0.79 and 20 untouched, untagged messages at 0.6-0.69,
  // any move costs more than it saves: no suggestion.
  const kept = Array.from({ length: 20 }, (_, i) => 0.71 + (i % 9) / 100);
  const untagged = Array.from({ length: 20 }, (_, i) => 0.6 + (i % 10) / 100);
  assert.equal(forField(suggestLevels(mixed, T, { realPerson: [...kept, ...untagged] }), 'realPerson').suggested, null);
});

test('rows without a score, and tags without a level (categories), are ignored', () => {
  const list = suggestLevels([...rows('preen_person', 'removed', Array(12).fill(null)), ...rows('preen_bills', 'removed', Array(12).fill(0.9))], T);
  assert.equal(forField(list, 'realPerson').removed, 0);
  assert.equal(list.length, 2);
});

test('only really applied, not undone, uncorrected messages count as "Preen was right"', async () => {
  const { untouchedEntries } = await import('../../packages/shared/core/suggest.js');
  const base = { scores: { toDo: 0.7 }, applied: { changes: [] } };
  const entries = [
    { ...base, headerMessageId: 'a' },
    { ...base, headerMessageId: 'b', dryRun: true },
    { ...base, headerMessageId: 'c', applied: null },
    { ...base, headerMessageId: 'd', undoneAt: '2026-10-02' },
    { ...base, headerMessageId: 'e' },
  ];
  assert.deepEqual(untouchedEntries(entries, new Set(['e'])).map((e) => e.headerMessageId), ['a']);
});

test('removed tags scored below the level (shortcut tags) are ignored; bad numbers too', () => {
  const shortcut = rows('preen_person', 'removed', Array(12).fill(0.2));
  const s = forField(suggestLevels([...shortcut, { key: 'preen_person', change: 'added', score: NaN }], T), 'realPerson');
  assert.deepEqual([s.removed, s.added, s.suggested], [0, 0, null]);
  assert.equal(forField(suggestLevels(rows('preen_person', 'removed', Array(12).fill(0.9)), { ...T, realPerson: undefined }), 'realPerson').suggested, null);
});

test('the tag keys that have a level are the keys of the two Preen tags that come from a question with a level (To-do has no tag)', () => {
  assert.deepEqual(LEVEL_FIELD, { preen_person: 'realPerson', preen_needs_reply: 'needsReply' });
});
