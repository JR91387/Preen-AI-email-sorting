// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Loads the settings page as Thunderbird would. Regression test for F13 (the
// page script stopped while building the Low/Medium/High controls, leaving
// the Provider list empty), and checks of the 0.0.13 layout's behaviour.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage } from './page-env.js';
import { PACE } from '../../packages/shared/core/pace.js';

// Timers are mocked so the Save button's check mark can be stepped through.
mock.timers.enable({ apis: ['setTimeout'] });
const { document, env } = setUpPage('options/options');
// The test DOM has no layout: give the top bar the height a browser would measure.
document.querySelector('header.topbar').offsetHeight = 140;
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type, event = {}) => {
  for (const fn of node.listeners[type] ?? []) fn({ target: node, preventDefault() {}, ...event });
};
const settle = () => tick();
// Note: the test DOM keeps an element's own text apart from its child
// elements, so text mixing the two comes out in a different order than in a
// browser. Assertions on such text check the pieces, not their order.
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
// Loads `settings` into the page through Import, as a person would, and waits for it.
const reimport = async (settings) => {
  const { exportSettings } = await import('../../packages/shared/core/settings-io.js');
  const file = JSON.stringify(exportSettings(settings, { includeApiKey: false }));
  $('importFile').files = [{ name: 'settings.json', text: async () => file }];
  fire($('importFile'), 'change');
  for (let i = 0; i < 4; i++) await settle();
};
// Ticks or unticks the test account under "Process new mail automatically in:".
const tickMailbox = (on) => {
  const input = $('accountsIncluded').querySelector('input[data-account-id="a1"]');
  input.checked = on;
  fire($('accountsIncluded'), 'change', { target: input });
};

test('settings page loads: providers, categories, accounts and level pickers are all there', () => {
  assert.deepEqual($('provider').options.map((o) => o.value), ['openrouter', 'typesafe']);
  assert.equal($('categories').querySelectorAll('.cat-card').length, 4);
  assert.equal($('accounts').querySelectorAll('.acct-card').length, 1);
  // 6 page-level pickers + one "Certainty required" per category.
  assert.equal(document.querySelectorAll('.level-picker').length, 6 + 4);
  assert.equal(document.querySelectorAll('.level-buttons button.active').length, 6 + 4, 'every picker shows a level');
});

test('the detail fields are back on the page after the pickers are built', () => {
  for (const id of ['intervalValue', 'dailyMessages', 'tRealPerson', 'tNeedsReply', 'tToDo', 'retentionDays']) {
    assert.ok($(id), `${id} is attached to the page`);
  }
  assert.equal($('dailyMessages').value, '500', 'Medium allowance shown');
  const allowance = text(document.querySelector('.level-picker'));
  for (const piece of ['Up to about', 'emails a day', '500']) assert.ok(allowance.includes(piece), piece);
});

test('nothing is flagged as unsaved straight after loading', () => {
  assert.equal($('dirty').hidden, true);
});

test('first visit: Languages I read is suggested from the browser, counted, and not yet stored', async () => {
  assert.match($('recipientLanguages').value, /English/);
  assert.match(text($('languagesHelp')), /Suggested from your language settings/);
  assert.match(text($('recipientLanguagesCounter')), /^\d+ \/ 200$/);
  assert.equal((await env.messenger.storage.local.get('settings')).settings?.recipientLanguagesSet ?? false, false);
  assert.equal($('dirty').hidden, true);
});

test('first visit: every section is an always-open card (no <details>); Provider & cost leads and Getting started is one line (D1)', () => {
  assert.equal(document.querySelectorAll('main details.card').length, 0, 'no collapsible section cards');
  const cards = [...document.querySelectorAll('main section.card')];
  assert.equal(cards.length, 15);
  assert.deepEqual(cards.filter((c) => !c.hidden).map((c) => c.id), ['s-view', 's-provider', 's-setup', 's-automatic', 's-limits', 's-categories'], 'Standard sections show, View first');
  assert.equal($('s-setup').hidden, false, 'setup not finished');
  assert.equal($('setupBody').hidden, true, 'steps wait behind Show steps');
  assert.equal($('setupDone').hidden, false, 'the one-line strip is shown');
  assert.match(text($('setupDoneTitle')), /^Next: /);
  assert.equal(text($('setupDoneSub')), '0 of 4 steps done');
  assert.equal(text($('setupCount')), '0 of 4 done');
  assert.ok($('setupSteps').querySelector('li.next'), 'the next step is marked');
});

test('top bar chips: not tested yet, automatic processing off until a mailbox is ticked', () => {
  assert.match(text($('connChip')), /Not tested/);
  assert.match(text($('autoChip')), /Automatic off/);
  tickMailbox(true);
  assert.match(text($('autoChip')), /Automatic on/, 'ticking a mailbox is what turns it on (#17)');
  tickMailbox(false);
  assert.match(text($('autoChip')), /Automatic off/);
});

test('turning dry run off asks first; "Keep dry run on" keeps it', () => {
  assert.equal($('dryRun').checked, false, 'off by default');
  $('dryRun').checked = true;
  fire($('dryRun'), 'change');
  assert.equal($('dryConfirm').hidden, true, 'turning it on needs no question');
  assert.equal($('dirty').hidden, false, 'turning it on is an unsaved change');
  $('dryRun').checked = false;
  fire($('dryRun'), 'change');
  assert.equal($('dryRun').checked, true, 'still on until confirmed');
  assert.equal($('dryConfirm').hidden, false);
  fire($('dryKeep'), 'click');
  assert.equal($('dryConfirm').hidden, true);
  assert.equal($('dryRun').checked, true);

  $('dryRun').checked = false;
  fire($('dryRun'), 'change');
  fire($('dryOff'), 'click');
  assert.equal($('dryRun').checked, false);
  assert.equal($('dirty').hidden, true, 'back to the saved value, so nothing is unsaved');
});

test('the check interval shows minutes or hours and saves as minutes', async () => {
  assert.equal($('intervalValue').value, '15');
  assert.equal($('intervalUnit').value, 'minutes');
  $('intervalUnit').value = 'hours';
  fire($('intervalUnit'), 'change');
  assert.equal($('intervalValue').value, '1', '15 minutes rounds up to 1 hour');
  $('intervalValue').value = '2';
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(saved.automation.intervalMinutes, 120);
  assert.equal(saved.dryRun, false, 'dry run is off after the confirmed change');
  assert.match(text($('status')), /Saved/);
});

test('account rows: type pill, depth wording and folder count; the process switch is under Automatic processing', () => {
  const row = $('accounts').querySelector('.acct-card');
  assert.equal(row.tagName, 'DETAILS');
  assert.equal(row.querySelector('.switch'), null, 'no switch in the account row (#2)');
  const included = [...$('accountsIncluded').querySelectorAll('input[type="checkbox"]')];
  assert.equal(included.length, 1, 'one tick box per mailbox under Automatic processing');
  assert.equal(included[0].dataset.accountId, 'a1');
  assert.match(text($('accountsIncluded')), /Test account/);
  assert.equal(text(row.querySelector('.pill')), 'IMAP');
  const depth = row.querySelector('select[data-field="depth"]');
  assert.match(depth.options[0].textContent, /^Use default — currently Deep$/);
  assert.match(text(row.querySelector('.folder-picker .tree-head')), /0 selected/);
});

test('category rows show name, description and certainty in the header', () => {
  const row = $('categories').querySelector('.cat-card');
  assert.equal(row.tagName, 'DETAILS');
  assert.equal(text(row.querySelector('.name')), 'Personal');
  assert.ok(text(row.querySelector('.desc')).length > 10);
  assert.match(text(row.querySelector('.cat-level')), /^Certainty: Medium \(default\)$/);
  const jev = text(row.querySelector('.jev'));
  assert.ok(jev.includes('Jev sees:') && jev.includes('Does NOT include'), jev);
  assert.equal(text($('categories').querySelector('.count-txt')), '4 of 20');
  assert.equal($('categories').querySelector('.suggest').hidden, true, 'no suggestions to offer: the row is hidden');
});

test('"Never a To-do" loads from the settings, shows its tip, and saves back', async () => {
  const rows = [...$('categories').querySelectorAll('.cat-card')];
  const box = (row) => row.querySelector('input[data-field="noToDo"]');
  const on = rows.filter((row) => box(row).checked).map((row) => text(row.querySelector('.name')));
  assert.deepEqual(on, ['Codes']);
  assert.match(text(rows[0]), /Never a To-do/);
  assert.ok(rows[0].querySelector('.tip-btn'), 'info tip beside the switch');
  box(rows[3]).checked = false;
  box(rows[0]).checked = true;
  fire(box(rows[0]), 'change');
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings.categories;
  assert.equal(saved[3].name, 'Codes');
  assert.equal(saved[3].noToDo, undefined, 'off is not stored');
  assert.equal(saved[0].noToDo, true);
});

test('folder tree: subfolders nest under their parent; orphans and odd paths go to the top', () => {
  const tree = $('accounts').querySelector('.tree');
  const top = tree.firstElementChild.children.map((li) => text(li.querySelector('label')));
  assert.deepEqual(top, ['Inbox', 'Child', 'Odd', 'Trash']);
  const inbox = tree.firstElementChild.children[0];
  assert.equal(text(inbox.querySelector('ul').querySelector('label')), 'Receipts');
  const trash = tree.querySelector('input[data-path="/Trash"]');
  assert.equal(trash.disabled, true, 'special folders are locked');
});

test('Limits & allowance: the cost limit is locked until a price is entered; Speed sets the run size, so no run-size boxes remain', () => {
  assert.ok($('s-limits'), 'the section exists');
  for (const id of ['maxPerRun', 'manualMax', 'dailyTokens', 'monthlyTokens']) assert.equal($(id), null, `${id} is gone`);
  $('price').value = '';
  fire($('price'), 'input');
  assert.equal($('monthlyCost').disabled, true);
  assert.equal($('monthlyCostLock').hidden, false);
  $('price').value = '0.05';
  fire($('price'), 'input');
  assert.equal($('monthlyCost').disabled, false);
  assert.equal($('monthlyCostLock').hidden, true);
});

test('clearing the price and typing it again keeps the typed cost limit', () => {
  $('price').value = '0.05';
  fire($('price'), 'input');
  $('monthlyCost').value = '12';
  $('price').value = '';
  fire($('price'), 'input');
  $('price').value = '0.05';
  fire($('price'), 'input');
  assert.equal($('monthlyCost').value, '12');
  $('monthlyCost').value = '';
});

test('Save button: plain, then accented with a dot beside the unsaved badge, then a check mark after saving', async () => {
  mock.timers.tick(2000);
  const save = $('save');
  assert.equal(save.classList.contains('is-dirty'), false);
  assert.equal($('draftDot').hidden, true);
  assert.equal($('saveLabel').textContent, 'Save');

  $('personalContext').value = 'I run a bakery.';
  fire($('settings'), 'input', { target: $('personalContext') });
  assert.equal(save.classList.contains('is-dirty'), true);
  assert.equal($('draftDot').hidden, false);
  assert.equal($('dirty').hidden, false);
  assert.equal($('dirty').nextElementSibling, save, 'the badge sits directly beside Save');

  fire($('settings'), 'submit');
  await settle();
  assert.equal(save.classList.contains('is-dirty'), false);
  assert.equal(save.classList.contains('is-saved'), true);
  assert.equal($('saveLabel').textContent, 'Saved');
  assert.equal(save.querySelector('use').getAttribute('href'), '#i-check');
  assert.equal($('draftDot').hidden, true);

  mock.timers.tick(2000);
  assert.equal(save.classList.contains('is-saved'), false, 'back to normal after about 2 s');
  assert.equal($('saveLabel').textContent, 'Save');
  assert.equal(save.querySelector('use').getAttribute('href'), '#i-save');
});

test('a new edit during the check mark brings the dirty look straight back', async () => {
  fire($('settings'), 'submit');
  await settle();
  assert.equal($('save').classList.contains('is-saved'), true);
  $('personalContext').value += ' edited';
  fire($('settings'), 'input', { target: $('personalContext') });
  assert.equal($('save').classList.contains('is-saved'), false);
  assert.equal($('save').classList.contains('is-dirty'), true);
  mock.timers.tick(2000);
  assert.equal($('save').classList.contains('is-dirty'), true, 'the old timer must not clear it');
  fire($('settings'), 'submit');
  await settle();
  mock.timers.tick(2000);
});

test('Appearance: shown as Match Thunderbird by default, saved when changed, and applied to the page', async () => {
  const { applyAppearance } = await import('../../apps/thunderbird/ui/shared/appearance.js');
  const scheme = () => document.documentElement.style['color-scheme'];
  assert.deepEqual($('appearance').options.map((o) => [o.value, o.textContent]),
    [['auto', 'Match Thunderbird'], ['light', 'Light'], ['dark', 'Dark']]);
  assert.equal($('appearance').value, 'auto');
  assert.equal(scheme(), '', 'auto leaves the browser colors alone');

  $('appearance').value = 'dark';
  fire($('settings'), 'input', { target: $('appearance') });
  fire($('settings'), 'submit');
  await settle();
  assert.equal((await env.messenger.storage.local.get('settings')).settings.appearance, 'dark');
  applyAppearance('dark');
  assert.equal(scheme(), 'dark');
  applyAppearance('light');
  assert.equal(scheme(), 'light');
  applyAppearance('auto');
  assert.equal(scheme(), '');

  $('appearance').value = 'auto';
  fire($('settings'), 'submit');
  await settle();
  mock.timers.tick(2000);
});

const tipButton = (subject) => [...document.querySelectorAll('.tip-btn')].find((b) => b.getAttribute('aria-label') === `More about ${subject}`);

test('info tips sit beside the labels they explain', () => {
  const subjects = ['history kept', 'depth', 'certainty required for junk', 'daily allowance', 'speed',
    'estimated monthly cost limit', 'personal context', 'languages I read', 'junk', 'sender rules'];
  for (const subject of subjects) assert.ok(tipButton(subject), `a tip for ${subject}`);
  // One in the consent panel, one for the default depth and one per account row.
  assert.equal([...document.querySelectorAll('.tip-btn')].filter((b) => b.getAttribute('aria-label') === 'More about depth').length, 3);
  const popText = tipButton('history kept').parentNode.querySelector('.tip-pop').textContent;
  assert.ok(popText.startsWith('How long Preen keeps its activity log'));
});

test('a tip opens on click and closes on Esc, on a second click and on a click outside', () => {
  const button = tipButton('speed');
  const pop = button.parentNode.querySelector('.tip-pop');
  assert.equal(pop.getAttribute('role'), 'tooltip');
  assert.equal(button.getAttribute('aria-controls'), pop.id);
  assert.equal(button.getAttribute('aria-describedby'), null, 'not described while hidden');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(pop.hidden, true);

  fire(button, 'click');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-describedby'), pop.id, 'described while open');
  assert.equal(pop.hidden, false);
  document.dispatch('click', { target: button }); // the same click bubbling up: stays open
  assert.equal(pop.hidden, false);
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(pop.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');

  fire(button, 'click');
  fire(button, 'click');
  assert.equal(pop.hidden, true, 'a second click closes it');

  fire(button, 'click');
  document.dispatch('click', { target: $('status') });
  assert.equal(pop.hidden, true, 'a click outside closes it');
});

test('a tip also opens on keyboard focus or hover, and closes when they leave', () => {
  const button = tipButton('junk');
  const pop = button.parentNode.querySelector('.tip-pop');
  fire(button, 'focus');
  assert.equal(pop.hidden, false);
  fire(button, 'blur');
  assert.equal(pop.hidden, true);
  fire(button.parentNode, 'mouseenter');
  assert.equal(pop.hidden, false);
  fire(button.parentNode, 'mouseleave');
  assert.equal(pop.hidden, true);
  // A click keeps it open past hover and blur; Esc on the button closes it.
  fire(button, 'click');
  fire(button.parentNode, 'mouseleave');
  fire(button, 'blur');
  assert.equal(pop.hidden, false);
  fire(button, 'keydown', { key: 'Escape' });
  assert.equal(pop.hidden, true);
});

test('Automatic processing: no master switch; the fields are locked until a mailbox is ticked (#17)', () => {
  assert.equal($('autoEnabled'), null, 'the master switch is gone');
  const fields = ['trigger', 'intervalValue', 'intervalUnit', 'maxAgeDays', 'unreadOnly'];
  tickMailbox(false);
  assert.equal($('autoLock').hidden, false);
  assert.match(text($('autoLock')), /Tick a mailbox above to change these/);
  assert.ok($('autoLock').querySelector('svg'), 'with a lock icon');
  assert.equal($('autoFields').classList.contains('is-locked'), true);
  for (const id of fields) assert.equal($(id).disabled, true, `${id} disabled`);

  tickMailbox(true);
  assert.equal($('autoLock').hidden, true);
  assert.equal($('autoFields').classList.contains('is-locked'), false);
  for (const id of fields) assert.equal($(id).disabled, false, `${id} enabled`);
  tickMailbox(false);
});

const rowsOf = () => {
  const kids = [...$('autoUses').children];
  return kids.filter((_, i) => i % 2 === 0).map((dt, i) => ({ label: text(dt), value: text(kids[2 * i + 1]), dim: dt.classList.contains('dim') }));
};

test('the summary shows the state pill, the ticked mailboxes and the settings in a fixed order; unused ones are dimmed (#9)', () => {
  tickMailbox(false);
  assert.equal(text($('autoPill')), 'Off');
  assert.ok($('autoPill').classList.contains('off'));
  assert.equal(text($('autoMailboxes')), 'No mailbox ticked.');
  assert.deepEqual(rowsOf().map((r) => r.label), ['When', 'Every', 'Only unread mail', 'Only mail from the last', 'Dry run']);
  assert.deepEqual(rowsOf().map((r) => r.dim), [true, true, true, true, false], 'dimmed while off, dry run never');
  assert.equal($('autoUses').children.length, 10, 'dimmed rows are still shown');
  assert.match(text($('autoDimNote')), /not used while automatic processing is off/);
  assert.ok($('autoFields').classList.contains('is-dimmed'));

  tickMailbox(true);
  $('trigger').value = 'scheduled';
  fire($('trigger'), 'change');
  assert.equal(text($('autoPill')), 'On');
  assert.ok($('autoPill').classList.contains('on'));
  assert.equal(text($('autoMailboxes')), 'Mailboxes: Test account');
  assert.deepEqual(rowsOf().map((r) => r.dim), [false, false, false, false, false]);
  assert.equal(text($('autoDimNote')), '');
  assert.equal($('autoFields').classList.contains('is-dimmed'), false);

  $('trigger').value = 'manual';
  fire($('trigger'), 'change');
  assert.deepEqual(rowsOf().slice(0, 2).map((r) => r.dim), [false, true], 'the interval is dimmed when nothing is scheduled');
  tickMailbox(false);
});

test('the sentence under the list says what will happen: off, on (with when), dry run (#17)', () => {
  tickMailbox(false);
  assert.match(text($('autoSentence')), /^Off: Preen only runs when you right-click/);
  assert.equal($('autoResume').hidden, true);
  tickMailbox(true);
  $('trigger').value = 'realtime';
  fire($('trigger'), 'change');
  assert.match(text($('autoSentence')), /Preen tags new mail in Test account as it arrives\./);
  assert.ok($('autoNow').classList.contains('on'));
  tickMailbox(false);
});

test('the cost limit shows the same kind of lock line', () => {
  $('price').value = '';
  fire($('price'), 'input');
  assert.ok($('monthlyCostLock').classList.contains('lock-reason'));
  assert.equal($('monthlyCostField').classList.contains('is-locked'), true);
  $('price').value = '0.05';
  fire($('price'), 'input');
  assert.equal($('monthlyCostField').classList.contains('is-locked'), false);
});

test('Languages I read: saving marks it as set', async () => {
  assert.equal((await env.messenger.storage.local.get('settings')).settings.recipientLanguagesSet, true, 'saved by the earlier saves');
  $('recipientLanguages').value = 'Dutch, English';
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(saved.recipientLanguages, 'Dutch, English');
  assert.equal(saved.recipientLanguagesSet, true);
});

test('Languages I read: over 200 characters is refused', async () => {
  $('recipientLanguages').value = 'x'.repeat(201);
  fire($('recipientLanguages'), 'input');
  assert.equal($('recipientLanguagesCounter').classList.contains('over'), true);
  fire($('settings'), 'submit');
  await settle();
  assert.match(text($('status')), /Languages I read is longer than 200/);
  $('recipientLanguages').value = '';
});

test('an empty Languages box can be saved and stays empty', async () => {
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(saved.recipientLanguages, '');
  assert.equal(saved.recipientLanguagesSet, true, 'a decision, so it is not pre-filled again');
});

test('Esc on the dry-run question keeps dry run on', () => {
  $('dryRun').checked = true;
  $('dryConfirm').hidden = false;
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal($('dryConfirm').hidden, true);
  assert.equal($('dryRun').checked, true);
});

test('ticking "Also move it to the Junk folder" asks Thunderbird for the move permission; a refusal unticks it', async () => {
  const asked = [];
  env.messenger.permissions.request = async (p) => { asked.push(p); return false; };
  $('moveJunk').checked = true;
  fire($('moveJunk'), 'change');
  await settle();
  assert.deepEqual(asked, [{ permissions: ['messagesMove'] }]);
  assert.equal($('moveJunk').checked, false);
  assert.match(text($('status')), /permission to move mail/);

  env.messenger.permissions.request = async (p) => { asked.push(p); return true; };
  $('moveJunk').checked = true;
  fire($('moveJunk'), 'change');
  await settle();
  assert.equal($('moveJunk').checked, true, 'allowed: stays ticked');
  $('moveJunk').checked = false;
  fire($('moveJunk'), 'change');
  await settle();
  assert.equal(asked.length, 2, 'unticking asks nothing');
});

test('Move junk on without Thunderbird\'s permission: a note with "Allow moving mail" appears, and goes once allowed', async () => {
  let allowed = false;
  env.messenger.permissions.contains = async () => allowed;
  env.messenger.permissions.request = async () => { allowed = true; return true; };
  $('moveJunk').checked = true;
  fire($('moveJunk'), 'change'); // as if loaded ticked: the change re-checks
  allowed = false;
  fire($('allowMove'), 'click');
  await settle();
  await settle();
  assert.equal(allowed, true, 'the button asked Thunderbird');
  assert.equal($('moveJunkNeedsPermission').hidden, true, 'note gone once allowed');

  env.messenger.permissions.request = async () => false;
  allowed = false;
  fire($('allowMove'), 'click');
  await settle();
  await settle();
  assert.equal($('moveJunkNeedsPermission').hidden, false, 'still not allowed: the note stays');
  assert.match(text($('status')), /didn.t allow moving mail/);
});

test('loading settings with Move junk on but no permission shows the note at once, without asking', async () => {
  let asked = 0;
  $('moveJunkNeedsPermission').hidden = true; // the previous test left it showing
  env.messenger.permissions.contains = async () => false;
  env.messenger.permissions.request = async () => { asked++; return false; };
  const file = { format: 'preen-settings', version: 1, settings: { actions: { moveJunk: true } } };
  $('importFile').files = [{ name: 'lab.json', text: async () => JSON.stringify(file) }];
  fire($('importFile'), 'change');
  for (let i = 0; i < 5; i++) await settle();
  assert.equal($('moveJunk').checked, true);
  assert.equal($('moveJunkNeedsPermission').hidden, false, 'the note shows beside the ticked box');
  assert.equal(asked, 0, 'loading never asks: only a click may');
});

// --- 0.0.18 layout (settings rework) ---------------------------------------

test('sections and rail follow the approved order, View first, Activity last (D2)', () => {
  const order = ['s-view', 's-provider', 's-setup', 's-automatic', 's-limits', 's-accounts', 's-people', 's-junk',
    's-categories', 's-privacy', 's-corrections', 's-stats', 's-backup', 's-debug', 's-advanced'];
  assert.deepEqual([...document.querySelectorAll('main section.card')].map((c) => c.id), order);
  assert.equal(document.getElementById('s-dryrun'), null, 'Dry run has no section of its own');
  const links = [...document.querySelectorAll('nav.rail a')];
  assert.deepEqual(links.slice(0, -1).map((a) => a.getAttribute('href')), order.map((id) => `#${id}`));
  assert.equal(links.at(-1).id, 'navActivity');
  assert.match(text(links.at(-1)), /Activity/);
});

test('every element id on the page is used once', () => {
  const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('Junk and Sensitive info have their own section; People keeps replies, to-dos and sender rules', () => {
  for (const id of ['qJunk', 'tJunk', 'moveJunk', 'allowMove', 'sensitive']) assert.ok($(id).closest('#s-junk'), `${id} in Junk & sensitive info`);
  for (const id of ['qPerson', 'qNeedsReply', 'qToDo', 'tToDo', 'flagToDo', 'senderRules']) assert.ok($(id).closest('#s-people'), `${id} in People`);
  for (const id of ['exportCorrectionsCsv', 'clearCorrections', 'suggestions']) assert.ok($(id).closest('#s-corrections'), `${id} in Tag corrections`);
  for (const id of ['exportSettings', 'importSettings', 'includeKey']) assert.ok($(id).closest('#s-backup'), `${id} in Backup`);
});

test('the Mode switch is the View card and dry run is a row in Advanced, neither in the top bar', () => {
  assert.ok($('modeSeg').closest('#s-view'), 'Simple / Standard / Everything is in View');
  assert.equal(document.querySelector('header.mast #modeSeg'), null, 'not in the top bar');
  assert.ok($('dryRun').closest('#s-advanced'), 'dry run is in Advanced');
  assert.ok($('dryRun').closest('form#settings'), 'part of the settings form');
  assert.ok($('dryConfirm').closest('#s-advanced'), 'its question sits beside the row');
  assert.equal(document.querySelector('header.mast #dryRun'), null);
});

test('the Activity link in the sidebar opens the Activity page in its own tab', async () => {
  const opened = [];
  env.messenger.tabs.create = async (props) => { opened.push(props.url); };
  let prevented = false;
  fire($('navActivity'), 'click', { preventDefault() { prevented = true; } });
  await settle();
  assert.equal(prevented, true, 'the link itself does not navigate');
  assert.deepEqual(opened, ['ui/activity/activity.html']);
});

test('Accounts included saves the account\'s process switch (#2)', async () => {
  const input = $('accountsIncluded').querySelector('input[data-account-id="a1"]');
  input.checked = true;
  fire(input, 'change');
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(saved.scope.accounts.a1.enabled, true);
  assert.equal(saved.scope.accounts.a1.folders, 'inbox', 'the Accounts card still supplies folders');
});

test('the sidebar and scroll offsets follow the top bar\'s height (#5)', () => {
  assert.equal(document.documentElement.style['--head-h'], '140px');
});

test('the dry-run switch reaching the form does not count as an unsaved change before it is confirmed', async () => {
  fire($('settings'), 'submit');
  await settle();
  assert.equal($('dirty').hidden, true, 'clean after saving');
  // In a browser the switch's change event also reaches the form.
  fire($('settings'), 'change', { target: $('dryRun') });
  assert.equal($('dirty').hidden, true, 'the form skips the dry-run switch');
  $('qToDo').checked = !$('qToDo').checked;
  fire($('settings'), 'change', { target: $('qToDo') });
  assert.equal($('dirty').hidden, false, 'any other control still counts');
});

test('if Thunderbird cannot list the accounts, saving keeps the per-account settings', async () => {
  const { exportSettings } = await import('../../packages/shared/core/settings-io.js');
  const before = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(before.scope.accounts.a1.enabled, true, 'set by an earlier test');
  const list = env.messenger.accounts.list;
  env.messenger.accounts.list = async () => { throw new Error('not now'); };
  const file = JSON.stringify(exportSettings(before, { includeApiKey: false }));
  $('importFile').files = [{ name: 'backup.json', text: async () => file }];
  fire($('importFile'), 'change');
  await settle(); await settle(); await settle();
  assert.match(text($('accounts')), /No mail accounts found/);
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.deepEqual(saved.scope.accounts, before.scope.accounts);
  env.messenger.accounts.list = list;
  await reimport(saved); // accounts listed again for the tests that follow
});

test('if Thunderbird cannot list an account\'s folders, saving keeps its chosen folders', async () => {
  const before = (await env.messenger.storage.local.get('settings')).settings;
  const chosen = ['/INBOX/Receipts'];
  const mine = { ...before, scope: { accounts: { a1: { ...before.scope.accounts.a1, folders: 'selected', folderPaths: chosen } } } };
  const query = env.messenger.folders.query;
  env.messenger.folders.query = async () => { throw new Error('not now'); };
  await reimport(mine);
  assert.match(text($('accounts')), /couldn't list the folders/);
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.deepEqual(saved.scope.accounts.a1.folderPaths, chosen);
  env.messenger.folders.query = query;
  await reimport(before);
});

test('a failing permission check shows the move-mail note and is logged', async () => {
  const { contains, request } = env.messenger.permissions;
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a);
  env.messenger.permissions.contains = async () => { throw new Error('no permissions API'); };
  env.messenger.permissions.request = async () => true;
  try {
    $('moveJunk').checked = true;
    fire($('moveJunk'), 'change');
    for (let i = 0; i < 4; i++) await settle();
    assert.equal($('moveJunkNeedsPermission').hidden, false);
  } finally {
    env.messenger.permissions.contains = contains;
    env.messenger.permissions.request = request;
    console.warn = warn;
  }
  assert.ok(warns.some((a) => String(a[0]).includes('permission')), 'logged');
  $('moveJunk').checked = false;
  fire($('moveJunk'), 'change');
  for (let i = 0; i < 4; i++) await settle();
});

test('Limits & allowance: a level hides the detail fields; Custom shows the one box with "% of High" (#8, #9)', () => {
  const pickerEl = $('s-limits').querySelector('.level-picker');
  const button = (label) => [...pickerEl.querySelectorAll('.level-buttons button')].find((b) => text(b) === label);
  fire(button('Medium'), 'click');
  assert.equal($('allowanceDetails').hidden, true, 'a level shows only its one line');
  fire(button('Custom'), 'click');
  assert.equal($('allowanceDetails').hidden, false);
  for (const id of ['dailyMessages']) assert.ok($(id).closest('#allowanceDetails'), `${id} under Custom`);
  $('dailyMessages').value = '3000';
  fire($('allowanceDetails'), 'input');
  const pct = (id) => text(document.querySelector(`[data-pct-for="${id}"]`));
  assert.equal(pct('dailyMessages'), '150% of High');
  $('dailyMessages').value = '0';
  fire($('allowanceDetails'), 'input');
  assert.equal(pct('dailyMessages'), 'No limit');
  $('dailyMessages').value = '1';
  fire($('allowanceDetails'), 'input');
  assert.equal(pct('dailyMessages'), 'Less than 1% of High');
  assert.equal($('dailyMessages').getAttribute('aria-describedby'), 'pct-dailyMessages');
  fire(button('Medium'), 'click');
  assert.equal($('dailyMessages').value, '500', 'back to Medium');
});

test('the cost limit sits under the price in Provider & cost; Speed sits in Limits & allowance (P9)', () => {
  assert.ok($('monthlyCost').closest('#s-provider'));
  assert.ok($('speedButtons').closest('#s-limits'));
  assert.equal($('speedButtons').closest('#s-categories'), null);
});

test('Categories: the description limit is fixed at 128 and over-long text is flagged; no length or message-text boxes remain', () => {
  for (const id of ['descriptionLimit', 'maxBodyChars', 'tUnsureMargin']) assert.equal($(id), null, `${id} is gone`);
  const row = [...$('categories').querySelectorAll('.cat-card')].find((c) => c.querySelector('[data-field="name"]').value === 'Bills');
  const input = row.querySelector('[data-field="description"]');
  input.value = 'x'.repeat(129);
  fire(input, 'input');
  assert.ok(row.querySelector('.count.over'), 'flagged as over the limit');
  input.value = 'x'.repeat(128);
  fire(input, 'input');
  assert.equal(row.querySelector('.count.over'), null);
});

test('Categories: the counter ignores surrounding spaces, as validation does', () => {
  const row = [...$('categories').querySelectorAll('.cat-card')].find((c) => c.querySelector('[data-field="name"]').value === 'Bills');
  const input = row.querySelector('[data-field="description"]');
  input.value = `  ${'x'.repeat(128)}  `;
  fire(input, 'input');
  assert.equal(row.querySelector('.count.over'), null, '128 characters plus spaces is within the limit');
  assert.match(text([...row.querySelectorAll('.count')][1]), /^128 \/ 128$/);
});

test('a failed save opens only the category rows that are really over the limit', async () => {
  const cards = [...$('categories').querySelectorAll('.cat-card')];
  const [over, spaced] = cards;
  for (const c of cards) c.open = false;
  over.querySelector('[data-field="description"]').value = 'x'.repeat(129);
  spaced.querySelector('[data-field="description"]').value = `  ${'y'.repeat(128)}  `;
  fire($('settings'), 'submit');
  await settle();
  assert.equal(over.open, true);
  assert.equal(spaced.open, false, 'surrounding spaces do not count, as in validation');
});

test('Move to Junk help does not claim contacts are exempt (they get the Junk question like any mail)', () => {
  const help = text($('moveJunk').parentNode);
  assert.match(help, /never in dry run/);
  assert.doesNotMatch(help, /contacts/);
});

test('ticking a mailbox and saving turns automatic processing on; a paused install stays paused until Resume (#17)', async () => {
  const saved = async () => (await env.messenger.storage.local.get('settings')).settings;
  // Start from saved: mailbox ticked, paused (as after Pause on the Activity page).
  tickMailbox(true);
  fire($('settings'), 'submit');
  await settle();
  assert.equal((await saved()).automation.enabled, true, 'newly ticked + Save = on');
  const paused = structuredClone(await saved());
  paused.automation.enabled = false;
  await env.messenger.storage.local.set({ settings: paused });
  // Load what's stored, the way Import shows a file: the page now reflects "paused".
  await reimport(paused);
  assert.match(text($('autoSentence')), /^Paused: nothing runs automatically in Test account/);
  assert.equal($('autoResume').hidden, false);
  assert.match(text($('autoChip')), /Automatic paused/);
  assert.equal(text($('autoPill')), 'Paused');
  assert.match(text($('autoDimNote')), /wait until you resume/);
  fire($('settings'), 'submit');
  await settle();
  assert.equal((await saved()).automation.enabled, false, 'saving other settings keeps it paused');
  fire($('autoResume'), 'click');
  assert.match(text($('autoSentence')), /Preen tags new mail in Test account/);
  fire($('settings'), 'submit');
  await settle();
  assert.equal((await saved()).automation.enabled, true, 'Resume + Save = on');
  tickMailbox(false);
  fire($('settings'), 'submit');
  await settle();
});

test('Resume, then untick everything: saved as off, not as a pending resume (#17)', async () => {
  tickMailbox(true);
  fire($('settings'), 'submit');
  await settle();
  tickMailbox(false);
  assert.match(text($('autoSentence')), /^Off:/);
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(saved.automation.enabled, false, 'nothing ticked is never saved as running');
  assert.equal(saved.scope.accounts.a1.enabled, false);
});

test('"Replace these numbers before sending" is on by default and saves', async () => {
  assert.equal($('replacePii').checked, true);
  assert.equal($('replacePii').disabled, false);
  $('replacePii').checked = false;
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(saved.localChecks.replacePii, false);
  $('replacePii').checked = true;
  fire($('settings'), 'submit');
  await settle();
});

test('Speed buttons read Low / Medium / High / No limit, and the help numbers come from PACE', () => {
  const buttons = [...$('speedButtons').querySelectorAll('button')];
  assert.deepEqual(buttons.map((b) => b.textContent), ['Low', 'Medium', 'High', 'No limit']);
  assert.equal(buttons[3].dataset.speed, 'off');
  const pop = tipButton('speed').parentNode.querySelector('.tip-pop').textContent;
  assert.ok(pop.includes(`${PACE.low.runSize}, ${PACE.medium.runSize}, ${PACE.high.runSize} or ${PACE.off.runSize} for Low, Medium, High and No limit.`));
});

test('Daily allowance shows one to three feathers and a pen; Speed shows the four birds; certainty pickers stay plain', () => {
  const icons = (scope) => [...document.querySelectorAll(`${scope} .lv-ico`)].map((n) => {
    const hrefs = [...n.querySelectorAll('use')].map((u) => u.getAttribute('href'));
    return hrefs.includes('#i-pen') ? 'pen' : hrefs.filter((h) => h === '#i-feather').length;
  });
  assert.deepEqual(icons('#s-limits'), [1, 2, 3, 'pen']);
  assert.deepEqual(icons('#s-people'), [], 'no feathers on certainty');
  const birds = [...$('speedButtons').querySelectorAll('use')].map((u) => u.getAttribute('href'));
  assert.deepEqual(birds, ['#b-perch', '#b-glide', '#b-fast', '#b-rocket']);
});

test('the Categories switch turns categories off: the list hides, the rail crosses it out, and Save stores it', () => {
  assert.equal($('categoriesOn').checked, true);
  $('categoriesOn').checked = false;
  fire($('categoriesOn'), 'change');
  assert.equal($('categoriesBody').hidden, true);
  assert.equal($('categoriesOffNote').hidden, false);
  assert.equal($('categoriesOnLabel').textContent, 'Off');
  assert.ok(document.querySelector('nav.rail a[href="#s-categories"]').classList.contains('off'));
  assert.equal($('descriptionCost').hidden, true, 'no category tokens while off');
  $('categoriesOn').checked = true;
  fire($('categoriesOn'), 'change');
  assert.equal($('categoriesBody').hidden, false);
  assert.equal($('categoriesOffNote').hidden, true);
});

test('Categories off is saved, with junk left as the only question it still asks', async () => {
  $('qJunk').checked = true;
  $('categoriesOn').checked = false;
  fire($('categoriesOn'), 'change');
  fire($('settings'), 'submit');
  await settle();
  const saved = (await env.messenger.storage.local.get('settings')).settings;
  assert.equal(saved.categorySort.enabled, false);
  assert.ok(saved.categories.length > 0, 'the categories are kept');
  $('categoriesOn').checked = true;
  fire($('categoriesOn'), 'change');
  fire($('settings'), 'submit');
  await settle();
  assert.equal((await env.messenger.storage.local.get('settings')).settings.categorySort.enabled, true);
});
