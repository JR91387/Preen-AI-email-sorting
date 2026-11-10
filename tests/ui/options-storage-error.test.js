// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// A-7: when the history can't be read, Settings says so instead of "No corrections recorded yet."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage } from './page-env.js';

const { document } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
// The history database cannot be opened.
globalThis.indexedDB = {
  open() {
    const request = {};
    Promise.resolve().then(() => { request.error = new Error('idb down'); request.onerror?.(); });
    return request;
  },
};
const warn = console.warn;
console.warn = () => {};
await import('../../apps/thunderbird/ui/options/options.js');
for (let i = 0; i < 20; i++) await tick();
console.warn = warn;

test('A-7: an unreadable history shows an error line, not the empty state', () => {
  const line = document.getElementById('correctionsCount').textContent;
  assert.match(line, /Could not read the recorded corrections/);
  assert.doesNotMatch(line, /No corrections recorded yet/);
});

test('an unreadable history: the debug count says so too', () => {
  assert.match(document.getElementById('debugCount').textContent, /Could not read the debug log/);
});
