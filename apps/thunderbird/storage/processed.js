// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Local record of processed messages, keyed by Message-ID. Always kept, and
// the only record for accounts where tags don't sync (POP, Local Folders, and
// possibly Gmail). Stores Message-IDs and timestamps only.

import { PROCESSED_TAG_KEY } from '../core/tags.js';
import { createSerializer } from '../core/serialize.js';

export const PROCESSED_KEY = 'processed';
// Messages classified automatically while dry run was on. Kept separately so
// they aren't re-classified on every run, and cleared when dry run is turned
// off so they are then processed for real.
export const DRY_RUN_SEEN_KEY = 'dryRunSeen';
// Messages whose Preen tags the user changed by hand. Automatic runs and Classify
// leave them alone (Preview still works; Classify anyway re-runs them).
export const CORRECTED_KEY = 'corrected';
const MAX_ENTRIES = 20000;

const serialized = createSerializer();

/**
 * Key for the processed record: account and Message-ID, so the same message
 * in two accounts (e.g. a mailing list sent to both) is handled in each.
 */
export function processedKey(accountId, headerMessageId) {
  if (!headerMessageId) return '';
  // Without an account, the Message-ID alone.
  return accountId ? `${accountId}|${headerMessageId}` : headerMessageId;
}

/** Adds `keys` to the record kept under `storageKey`, pruning the oldest beyond MAX_ENTRIES. */
function recordKeys(storageKey, keys) {
  return serialized(async () => {
    const stored = await messenger.storage.local.get(storageKey);
    const record = stored[storageKey] ?? {};
    const now = Date.now();
    for (const key of keys) if (key) record[key] = now;
    let kept = record;
    if (Object.keys(record).length > MAX_ENTRIES) {
      kept = Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES));
    }
    await messenger.storage.local.set({ [storageKey]: kept });
  });
}

/**
 * Marks messages as processed in the local record (oldest entries pruned).
 * @param {string[]} keys from processedKey()
 */
export function recordProcessed(keys) {
  return recordKeys(PROCESSED_KEY, keys);
}

/**
 * Records messages classified automatically during dry run.
 * @param {string[]} keys from processedKey()
 */
export function recordDryRunSeen(keys) {
  return recordKeys(DRY_RUN_SEEN_KEY, keys);
}

/**
 * Records messages the user corrected.
 * @param {string[]} keys from processedKey()
 */
export function recordCorrected(keys) {
  return recordKeys(CORRECTED_KEY, keys);
}

export async function readCorrected() {
  const stored = await messenger.storage.local.get(CORRECTED_KEY);
  return stored[CORRECTED_KEY] ?? {};
}

export function clearDryRunSeen() {
  return serialized(() => messenger.storage.local.remove(DRY_RUN_SEEN_KEY));
}

/**
 * Loads what's needed to check many messages at once.
 * @returns {Promise<{record: object, dryRunSeen: object|null, corrected: object}>}
 */
export async function readProcessedSet(settings) {
  const stored = await messenger.storage.local.get([PROCESSED_KEY, DRY_RUN_SEEN_KEY, CORRECTED_KEY]);
  return {
    record: stored[PROCESSED_KEY] ?? {},
    dryRunSeen: settings?.dryRun ? (stored[DRY_RUN_SEEN_KEY] ?? {}) : null,
    corrected: stored[CORRECTED_KEY] ?? {},
  };
}

/** True if the user corrected Preen's tags on this message. */
export function isCorrectedSet(set, header) {
  const id = header.headerMessageId;
  return Boolean(id && set.corrected?.[processedKey(header.folder?.accountId, id)]);
}

/** True if the message has the processed tag, is in the local record, or was seen during dry run. */
export function isProcessedSet(set, header) {
  if (header.tags?.includes(PROCESSED_TAG_KEY)) return true;
  const id = header.headerMessageId;
  if (!id) return false;
  const key = processedKey(header.folder?.accountId, id);
  return Boolean(set.record[key] || set.dryRunSeen?.[key]);
}
