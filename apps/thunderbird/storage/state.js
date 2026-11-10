// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Automatic-processing state in the add-on's local storage: the queue, usage
// counters and the latest status. Queue items identify messages by their
// Message-ID header, account and folder path, because Thunderbird's internal
// message and folder IDs change after a restart.

import { rollUsage } from '../core/budget.js';
import { createSerializer } from '../core/serialize.js';

export const QUEUE_KEY = 'queue';
export const USAGE_KEY = 'usage';
export const STATUS_KEY = 'status';
export const SCAN_CURSOR_KEY = 'scanCursor';

const serialized = createSerializer();

async function get(key, fallback) {
  const stored = await messenger.storage.local.get(key);
  return stored[key] ?? fallback;
}

// --- Queue ------------------------------------------------------------------

export const queueKey = (item) => `${item.accountId}\n${item.folderPath}\n${item.headerMessageId}`;

export function readQueue() {
  return get(QUEUE_KEY, []);
}

/**
 * Adds items that aren't queued yet. Newest messages are kept if the queue is full.
 * @param {number} maxQueue from schedulerLimits(settings) in core/budget.js
 * @param {{headerMessageId: string, accountId: string, folderPath: string, date?: string}[]} items
 * @returns {Promise<number>} how many were added
 */
export function enqueue(items, maxQueue) {
  let added = 0;
  return serialized(async () => {
    const queue = await readQueue();
    const seen = new Set(queue.map(queueKey));
    const fresh = new Set();
    for (const item of items) {
      if (!item.headerMessageId || !item.accountId || !item.folderPath || seen.has(queueKey(item))) continue;
      seen.add(queueKey(item));
      fresh.add(queueKey(item));
      queue.push({ ...item, queuedAt: new Date().toISOString(), attempts: 0 });
    }
    queue.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    const kept = queue.slice(0, maxQueue);
    added = kept.filter((item) => fresh.has(queueKey(item))).length; // trimmed items aren't "added"
    await messenger.storage.local.set({ [QUEUE_KEY]: kept });
  }).then(() => added);
}

/**
 * Applies the outcome of a run: removes finished items, updates the others.
 * @param {Map<string, object|null>} updates queueKey → updated item, or null to remove
 */
export function updateQueue(updates) {
  return serialized(async () => {
    const queue = await readQueue();
    const next = [];
    for (const item of queue) {
      const key = queueKey(item);
      if (!updates.has(key)) next.push(item);
      else if (updates.get(key)) next.push(updates.get(key));
    }
    await messenger.storage.local.set({ [QUEUE_KEY]: next });
  });
}

// --- Usage ------------------------------------------------------------------

export async function readUsage(now = new Date()) {
  return rollUsage(await get(USAGE_KEY, null), now);
}

export function saveUsage(usage) {
  return serialized(() => messenger.storage.local.set({ [USAGE_KEY]: usage }));
}

// --- Status -----------------------------------------------------------------

export function readStatus() {
  return get(STATUS_KEY, {});
}

export function updateStatus(patch) {
  return serialized(async () => {
    const status = await readStatus();
    await messenger.storage.local.set({ [STATUS_KEY]: { ...status, ...patch } });
  });
}

// --- Scan rotation ----------------------------------------------------------

/** Which folder the next scan starts at (an index into the in-scope folders). */
export async function readScanCursor() {
  const n = await get(SCAN_CURSOR_KEY, 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function saveScanCursor(n) {
  return serialized(() => messenger.storage.local.set({ [SCAN_CURSOR_KEY]: n }));
}
