// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Activity history in the add-on's own IndexedDB database. Entries are
// indexed by time so old ones can be removed quickly; monthly summaries are
// kept separately and survive when old entries are removed. Tag corrections
// have their own store, untouched by history trimming and Clear history.
// Debug records (full requests and responses, only while debug mode is on)
// have their own store, trimmed with the history.

import { emptySummary, addToSummary, summaryMonth, countsInSummary } from '../core/history.js';

const DB_NAME = 'preen-history';
const DB_VERSION = 3;

/** The long-term copy of a correction: no sender, subject or message id. */
export function correctionRow(entry) {
  const c = entry.correction ?? {};
  return { at: entry.at, key: c.key, tag: c.tag, change: c.change, score: c.score ?? null, category: c.from?.category ?? null };
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

/** Removes rows older than `beforeIso` from a store, then the oldest beyond `maxRows`. */
async function pruneStore(database, storeName, beforeIso, maxRows = Infinity) {
  const tx = database.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await new Promise((resolve, reject) => {
    const cursor = store.index('at').openCursor(IDBKeyRange.upperBound(beforeIso, true));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve();
      c.delete();
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
  let excess = (await request(store.count())) - maxRows;
  if (excess > 0) {
    await new Promise((resolve, reject) => {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || excess <= 0) return resolve();
        c.delete();
        excess--;
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }
  await done(tx);
}

/** History backend on IndexedDB (same interface as the in-memory test backend). */
export function createIdbHistory(idb = globalThis.indexedDB) {
  let dbPromise = null;
  const db = () => {
    dbPromise ??= new Promise((resolve, reject) => {
      const open = idb.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = (event) => {
        const database = open.result;
        if (event.oldVersion < 1) {
          const entries = database.createObjectStore('entries', { keyPath: 'seq', autoIncrement: true });
          entries.createIndex('at', 'at');
          database.createObjectStore('monthly', { keyPath: 'month' });
        }
        if (event.oldVersion < 2) {
          const corrections = database.createObjectStore('corrections', { keyPath: 'id', autoIncrement: true });
          corrections.createIndex('at', 'at');
        }
        if (event.oldVersion < 3) {
          const debug = database.createObjectStore('debug', { keyPath: 'id', autoIncrement: true });
          debug.createIndex('at', 'at');
          debug.createIndex('entryId', 'entryId');
        }
      };
      // A page still holding the old version blocks the upgrade until it closes;
      // every connection closes itself when a newer version asks (below).
      open.onblocked = () => console.warn('Preen: history upgrade waiting for another Preen page to close');
      open.onsuccess = () => {
        const database = open.result;
        database.onversionchange = () => {
          database.close();
          dbPromise = null; // reopened (at the new version) on next use
        };
        resolve(database);
      };
      open.onerror = () => reject(open.error);
    });
    return dbPromise;
  };

  return {
    /**
     * Adds entries and updates their months' summaries. The summaries are read
     * in a separate transaction first, so the write transaction never waits
     * part-way through (which could let it close early). Only the background
     * script adds classified entries, one batch at a time, so the read and the
     * write can't interleave with another update of the same summaries.
     */
    async add(entries) {
      if (!entries.length) return;
      const database = await db();
      const months = [...new Set(entries.filter(countsInSummary).map(summaryMonth))];
      const summaries = new Map();
      if (months.length) {
        const read = database.transaction('monthly').objectStore('monthly');
        const found = await Promise.all(months.map((m) => request(read.get(m))));
        months.forEach((m, i) => summaries.set(m, found[i] ?? emptySummary(m)));
      }
      for (const entry of entries) {
        if (countsInSummary(entry)) addToSummary(summaries.get(summaryMonth(entry)), entry);
      }
      const tx = database.transaction(['entries', 'monthly'], 'readwrite');
      const store = tx.objectStore('entries');
      const monthly = tx.objectStore('monthly');
      for (const entry of entries) store.add(entry);
      for (const summary of summaries.values()) monthly.put(summary);
      await done(tx);
    },

    /** Newest entries first; `beforeSeq` continues from an earlier page. */
    async recent(limit, beforeSeq = null) {
      const tx = (await db()).transaction('entries');
      const range = beforeSeq === null ? null : IDBKeyRange.upperBound(beforeSeq, true);
      const out = [];
      await new Promise((resolve, reject) => {
        const cursor = tx.objectStore('entries').openCursor(range, 'prev');
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c || out.length >= limit) return resolve();
          out.push(c.value);
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
      return out;
    },

    /** Merges `patch` into the entry with sequence number `seq`. */
    async update(seq, patch) {
      const tx = (await db()).transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      const entry = await request(store.get(seq));
      if (entry) store.put({ ...entry, ...patch });
      await done(tx);
    },

    /** All entries, oldest first (for export). */
    async all() {
      const tx = (await db()).transaction('entries');
      return request(tx.objectStore('entries').getAll());
    },

    async summaries() {
      const tx = (await db()).transaction('monthly');
      return request(tx.objectStore('monthly').getAll());
    },

    async count() {
      const tx = (await db()).transaction('entries');
      return request(tx.objectStore('entries').count());
    },

    /** Removes entries and debug records older than `beforeIso`. */
    async prune({ beforeIso }) {
      const database = await db();
      await pruneStore(database, 'entries', beforeIso);
      await pruneStore(database, 'debug', beforeIso);
    },

    async addDebug(rows) {
      if (!rows.length) return;
      const tx = (await db()).transaction('debug', 'readwrite');
      const store = tx.objectStore('debug');
      for (const row of rows) store.add(row);
      await done(tx);
    },

    /** The debug records of one activity entry, oldest first. */
    async debugFor(entryId) {
      const tx = (await db()).transaction('debug');
      return request(tx.objectStore('debug').index('entryId').getAll(IDBKeyRange.bound(entryId, entryId)));
    },

    /** All debug records, oldest first. */
    async debugAll() {
      const tx = (await db()).transaction('debug');
      return request(tx.objectStore('debug').getAll());
    },

    async debugCount() {
      const tx = (await db()).transaction('debug');
      return request(tx.objectStore('debug').count());
    },

    async clearDebug() {
      const tx = (await db()).transaction('debug', 'readwrite');
      tx.objectStore('debug').clear();
      await done(tx);
    },

    async addCorrections(rows) {
      if (!rows.length) return;
      const tx = (await db()).transaction('corrections', 'readwrite');
      const store = tx.objectStore('corrections');
      for (const row of rows) store.add(row);
      await done(tx);
    },

    /** All corrections, oldest first. */
    async corrections() {
      const tx = (await db()).transaction('corrections');
      return request(tx.objectStore('corrections').getAll());
    },

    /** Removes corrections older than `beforeIso`, then the oldest beyond `maxRows`. */
    async pruneCorrections({ beforeIso, maxRows }) {
      await pruneStore(await db(), 'corrections', beforeIso, maxRows);
    },

    async clearCorrections() {
      const tx = (await db()).transaction('corrections', 'readwrite');
      tx.objectStore('corrections').clear();
      await done(tx);
    },

    /** Removes the monthly summaries only (entries and corrections are kept). */
    async clearSummaries() {
      const tx = (await db()).transaction('monthly', 'readwrite');
      tx.objectStore('monthly').clear();
      await done(tx);
    },

    /** Removes all entries (monthly summaries are kept). */
    async clear() {
      const tx = (await db()).transaction('entries', 'readwrite');
      tx.objectStore('entries').clear();
      await done(tx);
    },
  };
}
