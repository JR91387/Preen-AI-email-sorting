// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Regression test (0.0.14 lab finding): right-click had no Preen entries after a
// plain Thunderbird restart, because the menus were only made on install.
// The background script must build them on install AND on every startup,
// without duplicates when both happen on one launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
const menus = new Map();
let removeAllCalls = 0;
let lastError;
let keepOnRemoveAll = false;
let optionsOpened = 0;
const event = (name) => ({ addListener: (f) => { (listeners[name] ??= []).push(f); }, removeListener() {} });
const any = () => new Proxy({}, { get: (_, k) => (String(k).startsWith('on') ? event(k) : async () => ({})) });

globalThis.messenger = new Proxy({}, {
  get: (_, ns) => {
    if (ns === 'runtime') {
      return {
        onInstalled: event('onInstalled'), onStartup: event('onStartup'), onMessage: event('onMessage'), getURL: (u) => u,
        async openOptionsPage() { optionsOpened++; },
        get lastError() { return lastError; },
      };
    }
    if (ns === 'menus') {
      return {
        onClicked: event('menusOnClicked'),
        async removeAll() { removeAllCalls++; if (!keepOnRemoveAll) menus.clear(); },
        // Like Thunderbird: errors arrive through runtime.lastError in the callback.
        create(item, done) {
          lastError = menus.has(item.id) ? { message: `duplicate menu id ${item.id}` } : undefined;
          if (!lastError) menus.set(item.id, item);
          done?.();
          lastError = undefined;
        },
      };
    }
    if (ns === 'storage') return { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: event('storageOnChanged') };
    if (ns === 'alarms') return { get: async () => undefined, clear: async () => {}, create: async () => {}, onAlarm: event('onAlarm') };
    return any();
  },
});
globalThis.indexedDB = undefined;

await import('../../apps/thunderbird/background/main.js');

const EXPECTED = [
  'preen-classify', 'preen-classify-preview', 'preen-sender', 'preen-sender-person', 'preen-sender-service',
  'preen-sender-clear', 'preen-folder', 'preen-folder-classify', 'preen-folder-classify-sub',
  'preen-folder-preview', 'preen-folder-preview-sub',
];

test('menus are built on install', async () => {
  menus.clear();
  await Promise.all(listeners.onInstalled.map((f) => f({ reason: 'update' })));
  assert.deepEqual([...menus.keys()], EXPECTED);
});

test('menus are built again on a plain startup (no reinstall)', async () => {
  menus.clear();
  assert.ok(listeners.onStartup?.length, 'an onStartup listener exists');
  await Promise.all(listeners.onStartup.map((f) => f()));
  assert.deepEqual([...menus.keys()], EXPECTED);
});

test('install and startup on the same launch make no duplicates', async () => {
  menus.clear();
  const before = removeAllCalls;
  await Promise.all([...listeners.onInstalled.map((f) => f({ reason: 'update' })), ...listeners.onStartup.map((f) => f())]);
  assert.deepEqual([...menus.keys()], EXPECTED);
  assert.ok(removeAllCalls - before >= 2, 'each build starts from a clean menu');
});

test('folder entries are in the folder pane, message entries in the message list', () => {
  for (const [id, item] of menus) {
    assert.deepEqual(item.contexts, [id.startsWith('preen-folder') ? 'folder_pane' : 'message_list'], id);
  }
});

test('a menu that fails to be created is reported, not silently missing', async () => {
  menus.clear();
  menus.set('preen-folder', { id: 'preen-folder', contexts: ['folder_pane'] }); // forces a duplicate on rebuild
  keepOnRemoveAll = true;
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    await Promise.all(listeners.onStartup.map((f) => f()));
  } finally {
    console.error = realError;
    keepOnRemoveAll = false;
  }
  assert.ok(!menus.has('preen-folder-classify'), 'building stopped at the failing entry');
  assert.ok(errors.some((e) => e.includes('could not create the right-click menus') && e.includes('preen-folder')), errors.join('\n'));
});

test('Settings opens on first install only, not on updates', async () => {
  optionsOpened = 0;
  await Promise.all(listeners.onInstalled.map((f) => f({ reason: 'update' })));
  assert.equal(optionsOpened, 0);
  await Promise.all(listeners.onInstalled.map((f) => f({ reason: 'install' })));
  assert.equal(optionsOpened, 1);
});
