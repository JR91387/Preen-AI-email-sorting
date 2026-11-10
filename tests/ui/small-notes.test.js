// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Small helps on the settings page: live counters in the category editor, what categories
// and questions are, "Test connection sends no mail" and the debug file's next step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage } from './page-env.js';
import { SECTION_HELP } from '../../apps/thunderbird/ui/options/section-help.js';

const { document, env } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
const messageListeners = [];
env.messenger.runtime.onMessage = { addListener: (f) => messageListeners.push(f) };
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type) => Promise.all((node.listeners[type] ?? []).map((fn) => fn({ target: node, preventDefault() {} })));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
await settle();

test('each category shows live counters for its name (of 40) and its Is / Is not text (of 128)', async () => {
  const card = [...$('categories').querySelectorAll('.cat-card')][0];
  const counters = () => [...card.querySelectorAll('.count')].map(text);
  const name = card.querySelector('[data-field="name"]');
  const initial = counters();
  assert.equal(initial.length, 3);
  assert.match(initial[0], new RegExp(`^${name.value.trim().length} / 40$`));
  assert.match(initial[1], / \/ 128$/);
  name.value = 'Receipts';
  await fire(name, 'input');
  assert.equal(counters()[0], '8 / 40');
  const excludes = card.querySelector('[data-field="excludes"]');
  excludes.value = 'abc';
  await fire(excludes, 'input');
  assert.equal(counters()[2], '3 / 128');
});

test('Categories and the questions are explained in the section and in its help', () => {
  assert.match(text($('categoriesHelp')), /Categories pick one label per message; questions add yes\/no tags/);
  assert.match(SECTION_HELP['s-categories'], /Categories pick one label per message; questions add yes\/no tags/);
  assert.match(SECTION_HELP['s-people'], /pick one label per message/);
});

test('the Test connection button has its note, and the key-storage note stays under the key field', () => {
  assert.match(text($('testNote')), /^Test connection sends no mail\./);
  assert.match(text($('apiKey').parentNode.parentNode), /Stored unencrypted in this Thunderbird profile/);
});

test('saving a debug file says what to do with it', async () => {
  globalThis.URL.createObjectURL ??= () => 'blob:x';
  await fire($('exportDebug'), 'click');
  assert.match(text($('status')), /^Debug file saved\. Keep it to share with the developer\. It includes message text\./);
});
