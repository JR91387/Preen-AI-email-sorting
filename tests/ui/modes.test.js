// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Settings has three modes. Simple shows the essentials, Standard the usual sections, Everything
// all of them. The first visit asks which; Find or a jump to a hidden section switches mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, waitFor } from './page-env.js';

const store = new Map();
const local = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const { document } = setUpPage('options/options');
globalThis.window.localStorage = local;
document.querySelector('header.topbar').offsetHeight = 140;
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type, event = {}) => {
  for (const fn of node.listeners[type] ?? []) fn({ target: node, preventDefault() {}, ...event });
};
await waitFor(() => $('setupCount').textContent !== '' && $('categories').querySelectorAll('.cat-card').length > 0);
for (let i = 0; i < 4; i++) await tick();

const STANDARD = ['s-view', 's-setup', 's-provider', 's-automatic', 's-limits', 's-categories'];
const SIMPLE = ['s-view', 's-setup', 's-provider', 's-automatic'];
const cards = () => [...document.querySelectorAll('main section.card')];
const railItem = (id) => document.querySelector(`nav.rail a[href="#${id}"]`).closest('li');
const pick = (name) => fire(document.querySelector(`[data-pick="${name}"]`), 'click');
const NAMES = { simple: 'Simple', standard: 'Standard', everything: 'Everything' };
// The Mode switch in the View card: which of its three buttons is checked.
const chip = () => `Mode: ${NAMES[document.querySelector('#modeSeg [aria-checked="true"]').dataset.mode]}`;

test('First visit: Standard sections show, and the chooser asks which mode', () => {
  for (const card of cards()) assert.equal(card.hidden, !STANDARD.includes(card.id), card.id);
  for (const card of cards()) assert.equal(railItem(card.id).hidden, !STANDARD.includes(card.id), `rail ${card.id}`);
  assert.equal($('modeChooser').hidden, false, 'chooser shown when no mode is stored');
  assert.equal(chip(), 'Mode: Standard');
  assert.equal(store.has('preen.settings.mode'), false, 'nothing stored until a choice is made');
});

test('Everything reveals every section, hides the chooser and is remembered', () => {
  pick('everything');
  for (const card of cards()) assert.equal(card.hidden, false, card.id);
  assert.equal($('modeChooser').hidden, true);
  assert.equal(store.get('preen.settings.mode'), 'everything');
  assert.equal(chip(), 'Mode: Everything');
});

test('Simple shows the setup, provider and automatic sections, and only their basic fields', () => {
  pick('simple');
  for (const card of cards()) assert.equal(card.hidden, !SIMPLE.includes(card.id), card.id);
  assert.equal(store.get('preen.settings.mode'), 'simple');
  assert.equal($('s-limits').hidden, true);
  assert.equal(document.querySelector('#s-automatic .auto-more').hidden, true, 'schedule details wait for Standard');
  assert.equal($('accountsIncluded').closest('.auto-more'), null, 'the mailbox list stays outside them');
  assert.equal($('consentDepth').closest('[data-min]').hidden, true, 'depth choice waits for Standard');
  for (const id of ['provider', 'model', 'apiKey', 'test', 'price', 'monthlyCost', 'modeSeg']) {
    assert.equal($(id).closest('[data-min]')?.hidden ?? false, false, `${id} is shown in Simple`);
  }
});

test('View is shown in every mode; dry run lives in Advanced, so only Everything shows it', () => {
  for (const name of ['simple', 'standard', 'everything']) {
    pick(name);
    assert.equal($('s-view').hidden, false, `View in ${name}`);
    assert.equal(railItem('s-view').hidden, false, `rail View in ${name}`);
    assert.equal(document.querySelector('nav.rail ol li a').getAttribute('href'), '#s-view', 'View leads the rail');
    assert.equal($('modeSeg').closest('#s-view') !== null, true);
    assert.equal($('dryRun').closest('[data-min]').hidden, name !== 'everything', `dry run in ${name}`);
  }
});

test('Standard shows the five usual sections again', () => {
  pick('standard');
  for (const card of cards()) assert.equal(card.hidden, !STANDARD.includes(card.id), card.id);
  assert.equal(document.querySelector('#s-automatic .auto-more').hidden, false);
  assert.equal(chip(), 'Mode: Standard');
});

test('The Mode switch in the View card changes the mode in one click and shows which is on', () => {
  pick('simple');
  fire(document.querySelector('#modeSeg [data-mode="everything"]'), 'click');
  assert.equal(chip(), 'Mode: Everything');
  assert.equal(store.get('preen.settings.mode'), 'everything');
  assert.equal($('s-advanced').hidden, false);
  assert.equal(document.querySelector('#modeSeg [data-mode="simple"]').getAttribute('aria-checked'), 'false');
  assert.equal($('modeChooser').hidden, true, 'choosing in View also answers the first-run question');
});

test('Not now keeps the current mode', () => {
  pick('simple');
  $('modeChooser').hidden = false;
  fire($('chooseLater'), 'click');
  assert.equal($('modeChooser').hidden, true);
  assert.equal(store.get('preen.settings.mode'), 'simple');
});

test('Find reveals a setting in a hidden section by switching mode', () => {
  pick('standard');
  assert.equal($('s-advanced').hidden, true);
  $('find').value = 'appearance';
  fire($('find'), 'keydown', { key: 'Enter' });
  assert.equal($('s-advanced').hidden, false);
  assert.equal(chip(), 'Mode: Everything');
  assert.match($('status').textContent, /Switched to Everything/);
});

test('A link to a hidden section reveals it', () => {
  pick('standard');
  assert.equal($('s-debug').hidden, true);
  fire(document, 'click', { target: { closest: () => ({ getAttribute: () => '#s-debug' }) } });
  assert.equal($('s-debug').hidden, false);
});

test('A change in a hidden section is listed in the Blotter', () => {
  pick('standard');
  assert.equal($('s-advanced').hidden, true);
  $('tCategory').value = '0.9';
  fire($('settings'), 'input', { target: $('tCategory') });
  assert.equal($('blotter').hidden, false);
  assert.match($('blList').textContent, /Advanced/);
});

test('The Deep note states the fixed amount and points to no setting', () => {
  assert.match($('depthPrivacy').textContent, /about 2,000 characters/);
  assert.doesNotMatch($('depthPrivacy').textContent, /Message text sent/);
});

test('Getting started has a right-hand demo that a recorded GIF can replace, and the gradient tokens exist', async () => {
  const side = document.querySelector('#s-setup aside.setup-side');
  assert.ok(side, 'sidecar present');
  assert.equal(side.getAttribute('aria-label'), 'How to preview');
  assert.ok(side.closest('#setupBody'), 'it sits in the steps, so it shows when they are open');
  const { readFile } = await import('node:fs/promises');
  const theme = await readFile(new URL('../../apps/thunderbird/ui/shared/theme.css', import.meta.url), 'utf8');
  for (const token of ['--wash-1', '--wash-2', '--wash-3']) assert.match(theme, new RegExp(`${token}: light-dark\\(`), token);
});

test('The chooser marks the current mode and the Mode switch shows one, two or three feathers', () => {
  pick('everything');
  assert.equal(document.querySelector('[data-pick="everything"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('[data-pick="simple"]').getAttribute('aria-pressed'), 'false');
  const feathers = (mode) => document.querySelector(`#modeSeg [data-mode="${mode}"] .fs`).querySelectorAll('use[href="#i-feather"]').length;
  assert.deepEqual(['simple', 'standard', 'everything'].map(feathers), [1, 2, 3]);
});
