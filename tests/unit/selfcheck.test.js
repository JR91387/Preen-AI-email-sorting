// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Startup self-check and model-change notice (lab item 13, design review §3–4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfCheckProblems, modelChangeNotice } from '../../packages/shared/core/selfcheck.js';
import { badgeState } from '../../packages/shared/core/badge.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

test('self-check: nothing to report when menus are built and settings are valid', () => {
  assert.deepEqual(selfCheckProblems({ menusOk: true, settingsErrors: [] }), []);
});

test('self-check: missing menus and invalid settings each become one plain sentence', () => {
  const p = selfCheckProblems({ menusOk: false, settingsErrors: ['Bad A.', 'Bad B.'] });
  assert.equal(p.length, 2);
  assert.match(p[0], /right-click menus/);
  assert.match(p[1], /Bad A\. \(\+1 more\) Open Preen settings/);
});

test('a self-check problem shows "!" on the toolbar button, ahead of other states', () => {
  const b = badgeState({ settings: mergeWithDefaults({}), queueLength: 3, status: { selfCheck: ['X broke.'] } });
  assert.equal(b.text, '!');
  assert.match(b.title, /X broke/);
  assert.notEqual(badgeState({ settings: mergeWithDefaults({}), queueLength: 0, status: { selfCheck: [] } }).text, '!');
});

test('model change: a notice only when a known model is replaced by another', () => {
  assert.equal(modelChangeNotice(null, 'typesafe/jev-1.13'), null, 'first model seen: nothing to compare');
  assert.equal(modelChangeNotice('typesafe/jev-1.13', 'typesafe/jev-1.13'), null);
  assert.match(modelChangeNotice('typesafe/jev-1.13', 'typesafe/jev-1.14'), /now answers with typesafe\/jev-1\.14 \(was typesafe\/jev-1\.13\)/);
});
