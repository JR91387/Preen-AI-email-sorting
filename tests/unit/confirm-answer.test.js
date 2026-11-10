// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Regression test (lab item 23): the confirm window closes once the background
// replies, and the reply used to wait for the whole run (minutes for a large
// folder). "Preview all" must start the run and reply at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_RESULT } from '../../packages/shared/core/protocol.js';

const listeners = {};
const store = {};
let runStarted = 0;
const never = new Promise(() => {});
const event = (name) => ({ addListener: (f) => { (listeners[name] ??= []).push(f); }, removeListener() {} });
const any = () => new Proxy({}, { get: (_, k) => (String(k).startsWith('on') ? event(k) : async () => ({})) });
const local = {
  async get(keys) {
    if (keys == null) return structuredClone(store);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  },
  async set(obj) { Object.assign(store, structuredClone(obj)); },
  async remove(keys) { for (const k of [keys].flat()) delete store[k]; },
};

globalThis.messenger = new Proxy({}, {
  get: (_, ns) => {
    if (ns === 'runtime') {
      return { onInstalled: event('onInstalled'), onStartup: event('onStartup'), onMessage: event('onMessage'), getURL: (u) => u, lastError: undefined };
    }
    if (ns === 'storage') return { local, onChanged: event('storageOnChanged') };
    if (ns === 'alarms') return { get: async () => undefined, clear: async () => {}, create: async () => {}, onAlarm: event('onAlarm') };
    // A run that never finishes: its first step (showing the Activity tab) hangs.
    if (ns === 'tabs') {
      return new Proxy({}, { get: (_, k) => (String(k).startsWith('on') ? event(k) : () => { runStarted++; return never; }) });
    }
    return any();
  },
});
globalThis.indexedDB = undefined;

await import('../../apps/thunderbird/background/main.js');

const send = (message) => Promise.all(listeners.onMessage.map((f) => f(message, {})));
const within = (promise, ms) => Promise.race([
  promise.then(() => 'replied'),
  new Promise((r) => setTimeout(() => r('still waiting'), ms)),
]);

test('"Preview all" replies at once, while the run is still going', async () => {
  store.pendingManualRun = { id: 'r1', ids: [1, 2, 3], apply: false };
  assert.equal(await within(send({ type: CONFIRM_RESULT, id: 'r1', ok: true }), 200), 'replied');
  assert.equal(store.pendingManualRun, undefined, 'the stored run is used up');
  for (let i = 0; i < 20 && !runStarted; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(runStarted > 0, 'the run did start');
});

test('Cancel replies at once and starts nothing', async () => {
  runStarted = 0;
  store.pendingManualRun = { id: 'r2', ids: [4], apply: true };
  assert.equal(await within(send({ type: CONFIRM_RESULT, id: 'r2', ok: false }), 200), 'replied');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(runStarted, 0);
});
