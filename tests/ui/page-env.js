// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Shared set-up for loading a Preen page in the test DOM.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadPage } from '../mocks/dom.js';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';

const src = (p) => fileURLToPath(new URL(`../../apps/thunderbird/${p}`, import.meta.url));
export const manifestVersion = JSON.parse(readFileSync(src('manifest.json'), 'utf8')).version;

/** Loads `ui/<page>.html` and a fake Thunderbird with one account. */
export function setUpPage(page) {
  const { document, errors } = loadPage(src(`ui/${page}.html`));
  const env = createMessenger({
    messages: {},
    folders: [
      { id: 'f1', accountId: 'a1', path: '/INBOX', name: 'Inbox', specialUse: ['inbox'] },
      { id: 'f2', accountId: 'a1', path: '/INBOX/Receipts', name: 'Receipts' },
      { id: 'f3', accountId: 'a1', path: '/Gone/Child', name: 'Child' }, // parent not listed
      { id: 'f4', accountId: 'a1', path: 'Odd', name: 'Odd' }, // no leading slash
      { id: 'f5', accountId: 'a1', path: '/Trash', name: 'Trash', specialUse: ['trash'] },
    ],
  });
  const ev = { addListener() {} };
  // storage.onChanged keeps its listeners so tests can fire a change.
  const storageListeners = [];
  env.storageChanged = (changes) => storageListeners.forEach((f) => f(changes, 'local'));
  Object.assign(env.messenger, {
    accounts: { list: async () => [{ id: 'a1', name: 'Test account', type: 'imap' }] },
    permissions: { request: async () => true, contains: async () => true },
    i18n: { getUILanguage: () => 'en-US' },
    tabs: { create() {}, query: async () => [] },
    mailTabs: { getSelectedMessages: async () => ({ id: null, messages: [] }) },
  });
  env.messenger.storage.onChanged = { addListener: (f) => storageListeners.push(f) };
  Object.assign(env.messenger.runtime, {
    onMessage: ev,
    getURL: (p) => p,
    getManifest: () => ({ version: manifestVersion }),
    openOptionsPage() {},
  });
  globalThis.messenger = env.messenger;
  installIndexedDB();
  return { document, errors, env };
}

/** Polls until `ready()` is true, so a test waits for the page to render rather than for a fixed time. */
export async function waitFor(ready, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`page not rendered within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Like waitFor, for tests that mock setTimeout: polls on setImmediate. */
export async function waitForTick(ready, maxTurns = 2000) {
  const { setImmediate: tick } = await import('node:timers/promises');
  for (let i = 0; i < maxTurns; i++) {
    if (ready()) return;
    await tick();
  }
  throw new Error('page did not reach the expected state');
}
