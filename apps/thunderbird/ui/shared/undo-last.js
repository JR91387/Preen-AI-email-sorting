// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// "Undo last run", shared by the Activity page, Settings and the toolbar popup.

import { lastUndoableRun } from '../../core/undo.js';
import { undoEntries } from '../../mail/undo.js';
import { readRecent } from '../../storage/activity-log.js';
import { askDialog } from './ui.js';

const plural = (n) => `${n} message${n === 1 ? '' : 's'}`;

/** What an undo did, in plain words. */
export function undoSummary({ undone, unchanged, missing, failed }) {
  const parts = [`Undid Preen's changes on ${plural(undone)}.`];
  if (unchanged) parts.push(`${plural(unchanged)} already back to how they were.`);
  if (missing) parts.push(`${plural(missing)} could not be found (moved or deleted), so left as they are.`);
  if (failed) parts.push(`${plural(failed)} could not be changed.`);
  return parts.join(' ');
}

/** Undoes `entries` and returns the summary; a thrown error becomes the text. */
export async function runUndo(entries) {
  try {
    const result = await undoEntries(entries);
    return { ok: !result.missing && !result.failed, text: undoSummary(result) };
  } catch (e) {
    return { ok: false, text: `Undo failed: ${e.message}` };
  }
}

/**
 * Asks, then undoes Preen's changes from the most recent applied run.
 * @returns {Promise<{outcome: 'none'|'cancelled'|'done', ok?: boolean, text?: string}>}
 */
export async function undoLastRun() {
  const { entries } = lastUndoableRun(await readRecent(5000));
  if (!entries.length) return { outcome: 'none', text: 'There are no applied changes to undo.' };
  const when = new Date(entries[0].at).toLocaleString();
  const yes = await askDialog({
    title: 'Undo the last run?',
    message: `Undo Preen's changes to ${plural(entries.length)} from the run at ${when}? Tags or changes you made yourself are left alone.`,
    confirmLabel: 'Undo changes',
    cancelLabel: 'Keep changes',
    danger: true,
  });
  if (!yes) return { outcome: 'cancelled' };
  return { outcome: 'done', ...(await runUndo(entries)) };
}
