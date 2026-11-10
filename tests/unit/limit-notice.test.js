// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Regression test (lab item 21): the "limit reached" notice was only rewritten by a
// run, so raising the limit in Settings left "!" on the toolbar button until the
// next run. It must follow the settings (and a new day) straight away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollUsage } from '../../packages/shared/core/budget.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

const listeners = {};
const store = {};
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
    if (ns === 'alarms') return { get: async () => undefined, clear: async () => {}, create: async () => {}, onAlarm: event('onAlarm') };
    return any();
  },
});
globalThis.indexedDB = undefined;

await import('../../apps/thunderbird/background/main.js');

const STALE = 'Daily limit of 500 messages reached (change it in Settings → Limits & allowance)';
const usedToday = (n) => ({ ...rollUsage(null), dayMessages: n });
const settingsWith = (dailyMessages) => mergeWithDefaults({ limits: { dailyMessages } });

async function changeSettings(settings) {
  store.settings = settings;
  listeners.storageOnChanged.forEach((f) => f({ settings: { newValue: settings } }, 'local'));
  // The listener's work is not awaited by Thunderbird; let it finish.
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

test('raising the daily limit clears the "limit reached" notice without a run', async () => {
  store.usage = usedToday(2001);
  store.status = { blockedReason: STALE };
  await changeSettings(settingsWith(4000));
  assert.equal(store.status.blockedReason, null);
});

test('lowering the limit below today\'s use shows the notice with the new number', async () => {
  store.usage = usedToday(2001);
  store.status = { blockedReason: null };
  await changeSettings(settingsWith(2000));
  assert.match(store.status.blockedReason, /Daily limit of 2000 messages reached/);
});

test('at startup a notice from an earlier day is cleared (usage rolls over)', async () => {
  store.usage = { ...usedToday(2001), day: '2000-01-01' };
  store.status = { blockedReason: STALE };
  store.settings = settingsWith(500);
  await Promise.all(listeners.onStartup.map((f) => f()));
  assert.equal(store.status.blockedReason, null);
});
