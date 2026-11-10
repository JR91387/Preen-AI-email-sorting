// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// An in-memory stand-in for the browser's IndexedDB, for running Preen's real
// storage code (src/storage/history-db.js) under Node, which has no IndexedDB.
// It implements the part of the standard that code uses: open with versions and
// upgrades, object stores with key paths, auto-increment and indexes, transactions
// that complete when their requests are done, get/put/add/delete/clear/count/getAll,
// and cursors with key ranges in both directions. Preen itself has no test hooks:
// tests install this as `globalThis.indexedDB`, like a browser provides one.
// `failWrites` makes every write fail, as a full disk would.

// The real timer, kept from when this file loads: tests that mock timers (to step a
// 10 s link revoke or a check mark) must not freeze the database as well.
const realSetTimeout = globalThis.setTimeout;
const later = (fn) => realSetTimeout(fn, 0);

class KeyRange {
  constructor(lower, upper, lowerOpen, upperOpen) {
    Object.assign(this, { lower, upper, lowerOpen, upperOpen });
  }
  static upperBound(upper, open = false) { return new KeyRange(undefined, upper, false, open); }
  static lowerBound(lower, open = false) { return new KeyRange(lower, undefined, open, false); }
  static bound(lower, upper, lowerOpen = false, upperOpen = false) { return new KeyRange(lower, upper, lowerOpen, upperOpen); }
  includes(key) {
    if (this.lower !== undefined && (this.lowerOpen ? key <= this.lower : key < this.lower)) return false;
    if (this.upper !== undefined && (this.upperOpen ? key >= this.upper : key > this.upper)) return false;
    return true;
  }
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clone = (v) => structuredClone(v);

class Request {
  constructor(tx) {
    this.transaction = tx;
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}

class Transaction {
  constructor(db, names, mode) {
    this.db = db;
    this.names = names;
    this.mode = mode;
    this.pending = 0;
    this.done = false;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.snapshot = mode === 'readonly' ? null : clone(db.data);
    later(() => this.maybeFinish());
  }
  objectStore(name) {
    if (!this.names.includes(name)) throw new Error(`NotFoundError: store ${name} not in transaction`);
    return new ObjectStore(this, name);
  }
  // Runs `fn` as a request: its result arrives on a later tick, like the browser.
  request(fn, { write = false } = {}) {
    if (this.done) throw new Error('TransactionInactiveError');
    const req = new Request(this);
    this.pending++;
    later(() => {
      try {
        if (write && this.db.factory.failWrites) throw new Error(this.db.factory.failWrites);
        req.result = fn();
        req.onsuccess?.({ target: req });
      } catch (e) {
        req.error = e;
        this.error = e;
        req.onerror?.({ target: req });
        this.abort();
      }
      this.pending--;
      this.maybeFinish();
    });
    return req;
  }
  maybeFinish() {
    if (this.done || this.pending > 0) return;
    // One more tick: a success handler may have queued a new request.
    later(() => {
      if (this.done || this.pending > 0) return;
      this.done = true;
      this.oncomplete?.({ target: this });
    });
  }
  abort() {
    if (this.done) return;
    this.done = true;
    if (this.snapshot) this.db.data = this.snapshot;
    this.error ??= new Error('AbortError');
    this.onerror?.({ target: this });
    this.onabort?.({ target: this });
  }
}

class ObjectStore {
  constructor(tx, name) {
    this.tx = tx;
    this.name = name;
  }
  get meta() { return this.tx.db.data.stores[this.name]; }
  keyOf(value) {
    const m = this.meta;
    if (m.keyPath in value) return value[m.keyPath];
    if (!m.autoIncrement) throw new Error('DataError: no key');
    return ++m.nextKey;
  }
  sorted() {
    return Object.values(this.meta.records).sort((a, b) => compare(a.key, b.key));
  }
  add(value) {
    return this.tx.request(() => {
      const v = clone(value);
      const key = this.keyOf(v);
      if (this.meta.records[key]) throw new Error('ConstraintError: key exists');
      if (this.meta.autoIncrement) v[this.meta.keyPath] = key;
      this.meta.records[key] = { key, value: v };
      return key;
    }, { write: true });
  }
  put(value) {
    return this.tx.request(() => {
      const v = clone(value);
      const key = this.keyOf(v);
      if (this.meta.autoIncrement) v[this.meta.keyPath] = key;
      this.meta.records[key] = { key, value: v };
      return key;
    }, { write: true });
  }
  get(key) { return this.tx.request(() => clone(this.meta.records[key]?.value)); }
  delete(key) { return this.tx.request(() => { delete this.meta.records[key]; }, { write: true }); }
  clear() { return this.tx.request(() => { this.meta.records = {}; }, { write: true }); }
  count() { return this.tx.request(() => Object.keys(this.meta.records).length); }
  getAll(range = null, count = Infinity) {
    return this.tx.request(() => this.sorted().filter((r) => !range || range.includes(r.key)).slice(0, count).map((r) => clone(r.value)));
  }
  createIndex(name, keyPath) { this.meta.indexes[name] = keyPath; return this.index(name); }
  index(name) {
    const keyPath = this.meta.indexes[name];
    if (!keyPath) throw new Error(`NotFoundError: index ${name}`);
    return new Index(this, keyPath);
  }
  openCursor(range = null, direction = 'next') {
    return openCursor(this, () => this.sorted().map((r) => ({ key: r.key, primaryKey: r.key })), range, direction);
  }
}

class Index {
  constructor(store, keyPath) {
    this.store = store;
    this.keyPath = keyPath;
  }
  entries() {
    return Object.values(this.store.meta.records)
      .map((r) => ({ key: r.value[this.keyPath], primaryKey: r.key }))
      .filter((e) => e.key !== undefined)
      .sort((a, b) => compare(a.key, b.key) || compare(a.primaryKey, b.primaryKey));
  }
  getAll(range = null, count = Infinity) {
    return this.store.tx.request(() => this.entries().filter((e) => !range || range.includes(e.key)).slice(0, count)
      .map((e) => clone(this.store.meta.records[e.primaryKey].value)));
  }
  openCursor(range = null, direction = 'next') {
    return openCursor(this.store, () => this.entries(), range, direction);
  }
}

// A cursor over a snapshot of keys; each continue() is a new request on the transaction.
function openCursor(store, list, range, direction) {
  const tx = store.tx;
  let keys = list().filter((e) => !range || range.includes(e.key));
  if (direction === 'prev') keys = keys.reverse();
  let i = 0;
  const req = new Request(tx);
  const step = () => {
    tx.pending++;
    later(() => {
      while (i < keys.length && !store.meta.records[keys[i].primaryKey]) i++;
      if (i >= keys.length) {
        req.result = null;
      } else {
        const e = keys[i];
        req.result = {
          key: e.key,
          primaryKey: e.primaryKey,
          value: clone(store.meta.records[e.primaryKey].value),
          continue: () => { i++; step(); },
          delete: () => store.delete(e.primaryKey),
        };
      }
      try {
        req.onsuccess?.({ target: req });
      } catch (err) {
        req.error = err;
        req.onerror?.({ target: req });
        tx.abort();
      }
      tx.pending--;
      tx.maybeFinish();
    });
  };
  step();
  return req;
}

class Database {
  constructor(factory, name, data) {
    Object.assign(this, { factory, name, data });
    this.onversionchange = null;
    this.closed = false;
  }
  get version() { return this.data.version; }
  get objectStoreNames() {
    const names = Object.keys(this.data.stores);
    return Object.assign(names, { contains: (n) => names.includes(n) });
  }
  createObjectStore(name, { keyPath = 'id', autoIncrement = false } = {}) {
    this.data.stores[name] = { keyPath, autoIncrement, nextKey: 0, records: {}, indexes: {} };
    return new ObjectStore(this.upgradeTx, name);
  }
  transaction(names, mode = 'readonly') {
    if (this.closed) throw new Error('InvalidStateError: database closed');
    return new Transaction(this, [names].flat(), mode);
  }
  close() { this.closed = true; this.factory.connections.delete(this); }
}

/** A fresh, empty IndexedDB stand-in. */
export function createIndexedDB() {
  const factory = {
    databases: {},
    connections: new Set(),
    failWrites: null, // e.g. 'disk full': every write fails, as on a full disk
  };
  return Object.assign(factory, {
    open(name, version = 1) {
      const req = new Request(null);
      req.onupgradeneeded = null;
      req.onblocked = null;
      later(() => {
        const existing = factory.databases[name];
        const oldVersion = existing?.version ?? 0;
        if (version < oldVersion) {
          req.error = new Error('VersionError');
          req.onerror?.({ target: req });
          return;
        }
        const finish = () => {
          const data = factory.databases[name] ?? { version: 0, stores: {} };
          const db = new Database(factory, name, data);
          if (version > oldVersion) {
            for (const other of factory.connections) if (other.name === name) other.onversionchange?.({ oldVersion, newVersion: version });
            const tx = new Transaction(db, [], 'versionchange');
            tx.objectStore = (n) => new ObjectStore(tx, n);
            db.upgradeTx = tx;
            req.transaction = tx;
            req.result = db;
            data.version = version;
            factory.databases[name] = data;
            try {
              req.onupgradeneeded?.({ oldVersion, newVersion: version, target: req });
            } catch (e) {
              tx.abort();
            }
            tx.oncomplete = () => {
              req.transaction = null;
              factory.connections.add(db);
              req.onsuccess?.({ target: req });
            };
            tx.onabort = () => {
              // A failed upgrade leaves the database exactly as it was before.
              factory.databases[name] = existing ? tx.snapshot : undefined;
              req.error = tx.error;
              req.onerror?.({ target: req });
            };
          } else {
            req.result = db;
            factory.connections.add(db);
            req.onsuccess?.({ target: req });
          }
        };
        finish();
      });
      return req;
    },
  });
}

/** Installs a fresh stand-in as the global IndexedDB (what a browser provides). */
export function installIndexedDB() {
  const idb = createIndexedDB();
  globalThis.indexedDB = idb;
  globalThis.IDBKeyRange = KeyRange;
  return idb;
}
