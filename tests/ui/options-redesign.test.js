// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The redesigned settings page: unsaved-changes tray (Blotter), Find, the
// "setup complete" line, per-section help dialogs, and the numbering rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, waitFor } from './page-env.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { appendEntries } from '../../apps/thunderbird/storage/activity-log.js';
import { SECTION_HELP } from '../../apps/thunderbird/ui/options/section-help.js';

const { document, env } = setUpPage('options/options');
// A finished setup: consent, key, successful test, history, dry run off, a mailbox ticked.
const done = mergeWithDefaults({
  apiKey: 'sk-test-1234',
  dryRun: false,
  consent: { sendToProvider: new Date().toISOString(), provider: 'openrouter' },
  scope: { accounts: { a1: { enabled: true, folders: 'inbox' } } },
  automation: { enabled: true },
});
await env.messenger.storage.local.set({
  settings: done,
  connectionTest: { ok: true, provider: done.provider },
});
await appendEntries([{ at: new Date().toISOString(), runKind: 'applied', tags: [], reasons: [], scores: {}, signals: {}, subject: 's', from: 'f', inputTokens: 0 }]);
document.querySelector('header.topbar').offsetHeight = 140;
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type, event = {}) => {
  for (const fn of node.listeners[type] ?? []) fn({ target: node, preventDefault() {}, ...event });
};
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
await waitFor(() => $('setupCount').textContent !== '' && $('categories').querySelectorAll('.cat-card').length > 0);
for (let i = 0; i < 4; i++) await tick();

const SECTIONS = ['s-view', 's-provider', 's-setup', 's-automatic', 's-limits', 's-accounts', 's-people', 's-junk',
  's-categories', 's-privacy', 's-corrections', 's-stats', 's-backup', 's-debug', 's-advanced'];

test('Setup complete: one summary line replaces the steps; Show steps reveals them, Hide steps hides them again', () => {
  assert.equal(text($('setupCount')), '4 of 4 done');
  assert.equal($('setupDone').hidden, false, 'summary line shown');
  assert.match(text($('setupDone')), /Setup complete/);
  assert.match(text($('setupDoneSub')), /^4 of 4 steps done$/);
  assert.equal($('setupBody').hidden, true, 'steps hidden');
  assert.equal($('setupDone').getAttribute('aria-expanded'), 'false');
  assert.equal(text($('setupDoneMore')), 'Show steps');
  fire($('setupDone'), 'click');
  assert.equal($('setupBody').hidden, false, 'steps shown');
  assert.equal($('setupDone').getAttribute('aria-expanded'), 'true');
  assert.equal(text($('setupDoneMore')), 'Hide steps');
  assert.equal($('setupSteps').querySelectorAll('li.done').length, 4);
  fire($('setupDone'), 'click');
  assert.equal($('setupBody').hidden, true);
});

test('Blotter: two edits list two old → new rows; Discard restores both values and empties the tray', async () => {
  const [days, retention] = [$('dailyMessages'), $('retentionDays')];
  const [days0, retention0] = [days.value, retention.value];
  assert.equal($('blotter').hidden, true, 'no tray before any edit');
  days.value = '123';
  fire($('settings'), 'input', { target: days });
  retention.value = '45';
  fire($('settings'), 'input', { target: retention });
  assert.equal($('blotter').hidden, false);
  assert.equal(text($('blCount')), '2 unsaved changes');
  const rows = [...$('blList').querySelectorAll('li')];
  assert.equal(rows.length, 2);
  const [a, b] = rows.map(text);
  assert.ok(a.includes('Messages per day') && a.includes(days0) && a.includes('123'), a);
  assert.ok(b.includes('Days') && b.includes(retention0) && b.includes('45'), b);
  assert.ok(rows.every((r) => r.textContent.includes('→')), 'old → new');

  fire($('discard'), 'click');
  for (let i = 0; i < 4; i++) await tick();
  assert.equal($('dailyMessages').value, days0);
  assert.equal($('retentionDays').value, retention0);
  assert.equal($('blotter').hidden, true, 'tray gone');
  assert.equal($('blList').querySelectorAll('li').length, 0, 'tray empty');
  assert.equal($('dirty').hidden, true);
});

test('Find: a label typed and Enter sends the focus to that control', () => {
  const focused = [];
  for (const id of ['retentionDays', 'appearance']) $(id).focus = () => focused.push(id);
  $('find').value = 'appearance';
  fire($('find'), 'input');
  assert.match(text($('findNote')), /^Enter: Appearance/);
  assert.equal($('findNote').hidden, false);
  fire($('find'), 'keydown', { key: 'Enter' });
  assert.deepEqual(focused, ['appearance']);
  assert.equal($('findNote').hidden, true, 'find closes after the jump');

  $('find').value = 'days';
  fire($('find'), 'keydown', { key: 'Enter' });
  assert.deepEqual(focused, ['appearance', 'retentionDays']);

  // A section title goes to that section's heading.
  const h = $('h-backup');
  h.focus = () => focused.push('h-backup');
  $('find').value = 'Backup';
  fire($('find'), 'keydown', { key: 'Enter' });
  assert.equal(focused.at(-1), 'h-backup');

  $('find').value = 'zzz no such setting';
  fire($('find'), 'input');
  assert.equal(text($('findNote')), 'No setting matches.');
  const before = focused.length;
  fire($('find'), 'keydown', { key: 'Enter' });
  assert.equal(focused.length, before, 'no match: nothing focused');
});

test('Section help: each of the 15 header icons opens the dialog with its title and text; Close and Esc close it', () => {
  const buttons = [...document.querySelectorAll('.sec-help')];
  assert.deepEqual(buttons.map((b) => b.dataset.help), SECTIONS);
  const dialog = $('helpDialog');
  for (const button of buttons) {
    const id = button.dataset.help;
    const title = text(document.getElementById(id).querySelector('h2'));
    assert.ok(SECTION_HELP[id], `${id} has help text`);
    fire(button, 'click');
    assert.equal(dialog.getAttribute('open'), '', `${id}: dialog open`);
    assert.equal(text($('helpTitle')), title, `${id}: title`);
    assert.equal($('helpText').textContent, SECTION_HELP[id], `${id}: text`);
    fire($('helpClose'), 'click');
    assert.equal(dialog.getAttribute('open'), null, `${id}: Close closes`);
  }
  // Esc: the browser closes a modal dialog itself and fires 'close'; the page then returns focus to the icon.
  let refocused = false;
  buttons[3].focus = () => { refocused = true; };
  fire(buttons[3], 'click');
  fire(dialog, 'close');
  assert.equal(refocused, true, 'focus returns to the icon after Esc');
});

test('Card headers carry no section numbers; the rail items are numbered 1–15, Activity unnumbered', () => {
  for (const card of document.querySelectorAll('main section.card')) {
    const head = text(card.querySelector('.card-head h2'));
    assert.doesNotMatch(head, /^\d+[.\s)]|\d+$/, `${card.id}: "${head}"`);
    assert.equal(card.querySelector('.card-head .num'), null, `${card.id}: no number badge`);
  }
  const nums = [...document.querySelectorAll('nav.rail a .num')].map(text);
  assert.deepEqual(nums, [...Array(15)].map((_, i) => String(i + 1)).concat(''));
});

test('Appearance setting lives in Advanced', () => {
  assert.ok($('appearance').closest('#s-advanced'));
});

test('Pause from elsewhere while the page is open survives an edit and Discard', async () => {
  env.storageChanged({ settings: { oldValue: { automation: { enabled: true } }, newValue: { automation: { enabled: false } } } });
  const days = $('dailyMessages');
  days.value = '321';
  fire($('settings'), 'input', { target: days });
  assert.equal(text($('blCount')), '1 unsaved change', 'the external pause is not listed as an unsaved change');
  fire($('discard'), 'click');
  for (let i = 0; i < 4; i++) await tick();
  assert.match(text($('autoChip')), /Automatic paused|off/, 'Discard did not resume it');
  assert.doesNotMatch(text($('autoChip')), /on$/);
});

test('Undoing an edit by hand clears "Unsaved changes": badge, Save dot and Blotter all go back', () => {
  const days = $('dailyMessages');
  const days0 = days.value;
  days.value = '77';
  fire($('settings'), 'input', { target: days });
  assert.equal($('dirty').hidden, false);
  assert.equal($('draftDot').hidden, false);
  days.value = days0;
  fire($('settings'), 'input', { target: days });
  assert.equal($('dirty').hidden, true, 'badge gone once the value is back');
  assert.equal($('draftDot').hidden, true, 'Save button dot gone');
  assert.equal($('blotter').hidden, true, 'tray closed');
});
