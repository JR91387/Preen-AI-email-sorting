// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Activity history. Entries hold IDs, decisions, scores, token counts, and the
// sender and subject, never the message text. Stored in IndexedDB (history-db.js).
// Debug records, kept only while debug mode is on, hold the full request and
// response (so the message text too), on this computer only.

import { createIdbHistory, correctionRow } from './history-db.js';
import { retentionCutoff } from '../core/history.js';
import { ACTIVITY_UPDATED } from '../core/protocol.js';
import { createSerializer } from '../core/serialize.js';

let backend = null;

function history() {
  backend ??= createIdbHistory();
  return backend;
}

// Serialize writes; a failed write doesn't block later ones.
const serialized = createSerializer();

function notify() {
  // Tells open Preen pages to refresh; fails harmlessly when none are open.
  messenger.runtime.sendMessage({ type: ACTIVITY_UPDATED }).catch(() => {});
}

/**
 * @param {object[]} entries
 * @param {{retentionDays: number}} [retention]
 */
export function appendEntries(entries, retention) {
  return serialized(async () => {
    const h = await history();
    await h.add(entries);
    if (retention) {
      await h.prune({ beforeIso: retentionCutoff(retention.retentionDays) });
    }
    notify();
  });
}

export async function readRecent(limit = 200, beforeSeq = null) {
  return (await history()).recent(limit, beforeSeq);
}

export async function readAll() {
  return (await history()).all();
}

export async function readSummaries() {
  return (await history()).summaries();
}

/** Clears the monthly summaries (the statistics) only; the activity log and corrections stay. */
export function clearSummaries() {
  return serialized(async () => {
    await (await history()).clearSummaries();
    notify();
  });
}

// Corrections are kept 2 years, at most 20,000 rows, apart from the history.
export const CORRECTIONS_KEEP_DAYS = 730;
export const CORRECTIONS_MAX_ROWS = 20_000;

/** Adds the long-term copy of correction entries, then trims the oldest. */
export function appendCorrections(entries) {
  return serialized(async () => {
    const h = await history();
    await h.addCorrections(entries.map(correctionRow));
    await h.pruneCorrections({ beforeIso: retentionCutoff(CORRECTIONS_KEEP_DAYS), maxRows: CORRECTIONS_MAX_ROWS });
  });
}

export async function readCorrections() {
  return (await history()).corrections();
}

export function clearCorrections() {
  return serialized(async () => (await history()).clearCorrections());
}

/** Records that entries' changes were undone (entries are identified by `seq`). */
export function markUndone(seqs, at = new Date().toISOString()) {
  return serialized(async () => {
    const h = await history();
    for (const seq of seqs) await h.update(seq, { undoneAt: at });
    notify();
  });
}

export function appendDebug(records) {
  return serialized(async () => (await history()).addDebug(records));
}

export async function readDebug(entryId) {
  return (await history()).debugFor(entryId);
}

export async function readDebugAll() {
  return (await history()).debugAll();
}

export async function countDebug() {
  return (await history()).debugCount();
}

export function clearDebug() {
  return serialized(async () => (await history()).clearDebug());
}

export function clearLog() {
  return serialized(async () => {
    await (await history()).clear();
    notify();
  });
}
