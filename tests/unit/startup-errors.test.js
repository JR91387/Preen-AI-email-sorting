// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// A-5: a failing startup step must not stop the toolbar badge and the catch-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
const store = {};
const badgeCalls = [];
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
    if (ns === 'menus') return { onClicked: event('menusOnClicked'), removeAll: async () => {}, create: (_, done) => done?.() };
    if (ns === 'storage') return { local, onChanged: event('storageOnChanged') };
    if (ns === 'action') return { setBadgeText: async (a) => { badgeCalls.push(a); }, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} };
    if (ns === 'alarms') {
      return {
        get: async () => { throw new Error('alarms unavailable'); }, clear: async () => {}, create: async () => {}, onAlarm: event('onAlarm'),
      };
    }
    return any();
  },
});
globalThis.indexedDB = undefined;

await import('../../apps/thunderbird/background/main.js');

test('A-5: onStartup survives a failing schedule setup and still updates the badge', async () => {
  badgeCalls.length = 0;
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    await Promise.all(listeners.onStartup.map((f) => f()));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((a) => String(a[0]).includes('setting up the schedule')), 'failure logged');
  assert.ok(badgeCalls.length > 0, 'badge still updated');
});

test('turning dry run off survives a failing clear of the dry-run list, and logs it', async () => {
  const errors = [];
  const original = console.error;
  const remove = local.remove;
  console.error = (...a) => errors.push(a);
  local.remove = async () => { throw new Error('disk full'); };
  try {
    const change = { settings: { oldValue: { dryRun: true }, newValue: { dryRun: false } } };
    for (const f of listeners.storageOnChanged) f(change, 'local');
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = original;
    local.remove = remove;
  }
  assert.ok(errors.some((a) => String(a[0]).includes('clearing the dry-run list')), 'failure logged');
});
