// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUpPage, waitFor } from './page-env.js';

const { document } = setUpPage('popup/popup');
await import('../../apps/thunderbird/ui/popup/popup.js');
await waitFor(() => document.getElementById('lines').children.length >= 3 && document.getElementById('state').textContent === 'Off');

test('popup loads and shows the status lines', () => {
  assert.ok(document.getElementById('lines').children.length >= 3);
  assert.equal(document.getElementById('state').textContent, 'Off', 'no mailbox ticked (#17)');
  assert.equal(document.getElementById('toggle').hidden, true, 'nothing to pause');
  assert.ok(document.getElementById('state').classList.contains('state-pill'), 'the same pill as Settings');
  assert.ok(document.getElementById('state').classList.contains('off'));
});

test('Undo last run in the popup says so on the message line when nothing was applied', async () => {
  const button = document.getElementById('undoLast');
  await Promise.all(button.listeners.click.map((fn) => fn({ target: button, preventDefault() {} })));
  assert.equal(document.getElementById('preenDialog'), null, 'nothing to ask about');
  assert.match(document.getElementById('message').textContent, /no applied changes to undo/);
});
