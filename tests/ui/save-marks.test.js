// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// One look for "saved" and "not saved yet": controls that save at once flash a check,
// controls that need Save show the Save button's dot until Save or Discard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage } from './page-env.js';

const { document } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type, event = {}) => {
  for (const fn of node.listeners[type] ?? []) fn({ target: node, preventDefault() {}, ...event });
};
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

test('consent saves at once: it flashes "Saved", not "Not saved yet"', async () => {
  assert.equal($('consentMark').hidden, true);
  fire($('consentAgree'), 'click');
  await settle();
  assert.equal($('consentMark').hidden, false);
  assert.ok($('consentMark').classList.contains('saved'));
  assert.equal(text($('consentMark')), 'Saved');
});

const changeDepth = () => {
  $('consentDepth').value = $('consentDepth').value === 'deep' ? 'surface' : 'deep';
  fire($('consentDepth'), 'change');
};

test('debug mode saves at once and flashes "Saved"', async () => {
  $('debugEnabled').checked = true;
  fire($('debugEnabled'), 'change');
  await settle();
  assert.ok($('debugMark').classList.contains('saved'));
  assert.equal($('debugMark').hidden, false);
});

test('Changing the depth in the consent panel needs Save: it shows the same dot as the Save button until Save', async () => {
  assert.equal($('depthMark').hidden, true);
  changeDepth();
  await settle();
  assert.equal($('depthMark').hidden, false);
  assert.ok($('depthMark').classList.contains('pending'));
  assert.equal(text($('depthMark')), 'Not saved yet');
  assert.equal($('draftDot').hidden, false, 'the Save button shows its dot too');
  fire($('settings'), 'submit');
  await settle();
  assert.equal($('depthMark').hidden, true);
  assert.equal($('draftDot').hidden, true);
});

test('Discard clears a "Not saved yet" mark', async () => {
  changeDepth();
  await settle();
  assert.ok($('depthMark').classList.contains('pending'));
  fire($('discard'), 'click');
  await settle();
  assert.equal($('depthMark').hidden, true);
});
