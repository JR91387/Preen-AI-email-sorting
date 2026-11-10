// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Undoes Preen's changes to messages, using the before/after states in the
// activity log. The user's own tags and changes are left alone (core/undo.js).

import { planUndo } from '../core/undo.js';
import { findMessageHeader } from './messages.js';
import { resolveFolderId, canMoveMail } from './folders.js';
import { noteOwnUpdate } from './own-updates.js';
import { markUndone, appendEntries } from '../storage/activity-log.js';

/**
 * @param {object[]} entries activity entries with `applied` changes
 * @returns {Promise<{undone: number, unchanged: number, missing: number, failed: number}>}
 */
export async function undoEntries(entries) {
  const done = [];
  let undone = 0;
  let unchanged = 0;
  let missing = 0;
  let failed = 0;
  const runs = new Set();
  for (const entry of entries) {
    let header;
    try {
      header = await findMessageHeader(entry.messageId, entry.headerMessageId);
    } catch (e) {
      console.warn('Preen: could not look up a message to undo', e);
      failed++;
      continue;
    }
    if (!header) {
      missing++;
      continue;
    }
    const plan = planUndo(header, entry.applied);
    const moved = entry.applied?.moved;
    // Moved to Junk by Preen and still there: move it back where it was.
    const moveBack = moved && header.folder?.path === moved.toPath && header.folder?.accountId === moved.accountId;
    try {
      // Checked before any change, so a message that can't go back keeps its junk mark too.
      if (moveBack && !(await canMoveMail())) throw new Error('Preen isn\'t allowed to move mail, so this message stays in Junk');
      const back = moveBack ? await resolveFolderId(moved.accountId, moved.fromPath) : null;
      if (moveBack && !back) throw new Error(`The folder ${moved.fromPath} it was moved from no longer exists, so this message stays in Junk`);
      await noteOwnUpdate(header.id);
      if (Object.keys(plan.update).length) await messenger.messages.update(header.id, plan.update);
      if (moveBack) await messenger.messages.move([header.id], back);
      if (Object.keys(plan.update).length || moveBack) {
        undone++;
        runs.add(entry.runId ?? entry.seq);
      } else unchanged++;
      done.push(entry.seq);
    } catch (e) {
      // One message failing (e.g. a read-only folder) mustn't stop the rest.
      console.warn('Preen: could not undo changes on a message', e);
      failed++;
    }
  }
  if (done.length || failed) {
    await markUndone(done);
    await appendEntries([{
      at: new Date().toISOString(),
      notice: `Undo: reversed Preen's changes on ${undone} message${undone === 1 ? '' : 's'}`
        + `${unchanged ? `, ${unchanged} already back to how they were` : ''}`
        + `${missing ? `, ${missing} no longer found` : ''}`
        + `${failed ? `, ${failed} could not be changed` : ''}.`,
      // Counted in the monthly statistics: runs with a message restored, and messages restored.
      undo: { runs: runs.size, messages: undone },
    }]);
  }
  return { undone, unchanged, missing, failed };
}
