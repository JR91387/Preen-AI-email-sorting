// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Preen's real IndexedDB history code (src/storage/history-db.js) on an in-memory
// IndexedDB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { createIdbHistory } from '../../apps/thunderbird/storage/history-db.js';

test('fresh install: entries, monthly and corrections stores; add, recent, all, prune, clear', async () => {
  const idb = installIndexedDB();
  const h = createIdbHistory(idb);
  await h.add([{ at: '2026-10-01T00:00:00Z', a: 1 }, { at: '2026-10-02T00:00:00Z', a: 2 }, { at: '2026-10-03T00:00:00Z', a: 3 }]);
  assert.deepEqual((await h.recent(2)).map((e) => e.a), [3, 2], 'newest first');
  await h.prune({ beforeIso: '2026-10-02T00:00:00Z' });
  assert.deepEqual((await h.all()).map((e) => e.a), [2, 3]);
  await h.prune({ beforeIso: '2026-10-03T00:00:00Z' });
  assert.deepEqual((await h.all()).map((e) => e.a), [3]);
  await h.clear();
  assert.equal(await h.count(), 0);
  assert.deepEqual(Object.keys(idb.databases['preen-history'].stores).sort(), ['corrections', 'debug', 'entries', 'monthly']);
});

test('an open page holding the database closes when a newer version opens', async () => {
  const idb = installIndexedDB();
  const page = createIdbHistory(idb);
  await page.count();
  const [db] = idb.connections;
  let closed = false;
  const realClose = db.close.bind(db);
  db.close = () => { closed = true; realClose(); };
  await new Promise((resolve) => { const r = idb.open('preen-history', 4); r.onsuccess = resolve; });
  assert.ok(closed, 'onversionchange closed the old connection');
});

test('upgrade from version 2 keeps entries and corrections and adds the debug store', async () => {
  const idb = installIndexedDB();
  await new Promise((resolve) => {
    const r = idb.open('preen-history', 2);
    r.onupgradeneeded = () => {
      const entries = r.result.createObjectStore('entries', { keyPath: 'seq', autoIncrement: true });
      entries.createIndex('at', 'at');
      entries.add({ at: '2026-10-01T00:00:00Z', a: 1 });
      r.result.createObjectStore('monthly', { keyPath: 'month' });
      r.result.createObjectStore('corrections', { keyPath: 'id', autoIncrement: true }).createIndex('at', 'at');
    };
    r.onsuccess = () => { r.result.close(); resolve(); };
  });
  const h = createIdbHistory(idb);
  assert.deepEqual((await h.all()).map((e) => e.a), [1]);
  assert.equal(await h.debugCount(), 0);
  await h.addDebug([{ at: '2026-10-01T00:00:00Z', entryId: 'r1:5', request: '{}' }]);
  assert.equal(await h.debugCount(), 1);
});

test('debug records: by entry, all, retention pruning with the history, clear', async () => {
  const h = createIdbHistory(installIndexedDB());
  await h.addDebug([
    { at: '2026-09-01T00:00:00Z', entryId: 'old', request: 'a' },
    { at: '2026-10-05T00:00:00Z', entryId: 'new', request: 'b' },
    { at: '2026-10-05T00:00:01Z', entryId: 'new', request: 'c' },
  ]);
  assert.deepEqual((await h.debugFor('new')).map((r) => r.request), ['b', 'c']);
  await h.prune({ beforeIso: '2026-10-01T00:00:00Z' });
  assert.deepEqual((await h.debugAll()).map((r) => r.request), ['b', 'c'], 'the history retention removes old debug records');
  await h.clearDebug();
  assert.equal(await h.debugCount(), 0);
});
