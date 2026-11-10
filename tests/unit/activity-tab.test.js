// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Regression test (lab item 28): every run opened another Activity tab, because the
// open one was looked up with tabs.query({url}), which needs the "tabs" permission.
// It must be found through runtime.getContexts and switched to instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_RESULT } from '../../packages/shared/core/protocol.js';

const listeners = {};
const store = {};
const calls = { created: [], updated: [], query: 0 };
let contexts = [];
const event = (name) => ({ addListener: (f) => { (listeners[name] ??= []).push(f); }, removeListener() {} });
const any = () => new Proxy({}, { get: (_, k) => (String(k).startsWith('on') ? event(k) : async () => ({})) });
const local = {
  async get(keys) {
    const list = keys == null ? Object.keys(store) : [keys].flat();
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  },
  async set(obj) { Object.assign(store, structuredClone(obj)); },
  async remove(keys) { for (const k of [keys].flat()) delete store[k]; },
};

globalThis.messenger = new Proxy({}, {
  get: (_, ns) => {
    if (ns === 'runtime') {
      return {
        onInstalled: event('onInstalled'), onStartup: event('onStartup'), onMessage: event('onMessage'),
        getURL: (u) => `moz-extension://preen/${u}`, lastError: undefined,
        getContexts: async (filter) => contexts.filter((c) => filter.documentUrls.includes(c.documentUrl)),
      };
    }
    if (ns === 'storage') return { local, onChanged: event('storageOnChanged') };
    if (ns === 'alarms') return { get: async () => undefined, clear: async () => {}, create: async () => {}, onAlarm: event('onAlarm') };
    if (ns === 'tabs') {
      return {
        onRemoved: event('tabsOnRemoved'), onUpdated: event('tabsOnUpdated'),
        // Without the "tabs" permission Thunderbird ignores the url filter: never a match.
        query: async () => { calls.query++; return []; },
        create: async (o) => { calls.created.push(o.url); return { id: 99 }; },
        update: async (id) => { calls.updated.push(id); return { id }; },
      };
    }
    return any();
  },
});
globalThis.indexedDB = undefined;

await import('../../apps/thunderbird/background/main.js');

const run = async (id) => {
  store.pendingManualRun = { id, ids: [], apply: false };
  await Promise.all(listeners.onMessage.map((f) => f({ type: CONFIRM_RESULT, id, ok: true }, {})));
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

test('no Activity tab open: one is created', async () => {
  contexts = [];
  await run('a');
  assert.equal(calls.created.length, 1);
  assert.match(calls.created[0], /ui\/activity\/activity\.html$/);
});

test('Activity tab already open: switched to, no second tab (item 28)', async () => {
  contexts = [{ contextType: 'TAB', tabId: 7, documentUrl: 'moz-extension://preen/ui/activity/activity.html' }];
  calls.created.length = 0;
  await run('b');
  assert.deepEqual(calls.updated, [7]);
  assert.equal(calls.created.length, 0);
});

test('the shared helper reuses an open Settings tab too, and otherwise uses openOptionsPage', async () => {
  const { showPage, OPTIONS_PAGE } = await import('../../apps/thunderbird/ui/shared/pages.js');
  let opened = 0;
  const saved = globalThis.messenger;
  const runtime = {
    getURL: (u) => `moz-extension://preen/${u}`,
    openOptionsPage: async () => { opened++; },
    getContexts: async (f) => (f.documentUrls[0].endsWith(OPTIONS_PAGE) && runtime.open ? [{ tabId: 12 }] : []),
  };
  const updated = [];
  globalThis.messenger = { runtime, tabs: { update: async (id) => updated.push(id), create: async () => assert.fail('no new tab') } };
  try {
    runtime.open = true;
    await showPage(OPTIONS_PAGE);
    assert.deepEqual(updated, [12]);
    assert.equal(opened, 0);
    runtime.open = false;
    await showPage(OPTIONS_PAGE);
    assert.equal(opened, 1, 'no Settings tab yet: Thunderbird opens it');
  } finally {
    globalThis.messenger = saved;
  }
});

test('an open tab in another window: that window is brought to the front; getContexts failing opens a tab', async () => {
  const { showPage, ACTIVITY_PAGE } = await import('../../apps/thunderbird/ui/shared/pages.js');
  const saved = globalThis.messenger;
  const focused = [];
  let created = 0;
  const runtime = { getURL: (u) => `moz-extension://preen/${u}`, getContexts: async () => [{ tabId: 5 }] };
  globalThis.messenger = {
    runtime,
    tabs: { update: async (id) => ({ id, windowId: 3 }), create: async () => { created++; } },
    windows: { update: async (id, o) => focused.push([id, o.focused]) },
  };
  try {
    await showPage(ACTIVITY_PAGE);
    assert.deepEqual(focused, [[3, true]]);
    assert.equal(created, 0);
    runtime.getContexts = async () => { throw new Error('not supported'); };
    await showPage(ACTIVITY_PAGE);
    assert.equal(created, 1, 'falls back to a new tab');
  } finally {
    globalThis.messenger = saved;
  }
});
