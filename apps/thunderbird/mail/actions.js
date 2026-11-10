// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Applies a decision to a message: tags, flag, read and junk state, and (only when
// the user opted in) a move to the Junk folder. Reads the message's current
// state right before changing it, and returns what changed so it can be logged
// (and undone later).

import { planUpdate } from '../core/actions.js';
import { junkFolderFor, canMoveMail, NO_MOVE_PERMISSION } from './folders.js';
import { noteOwnUpdate } from './own-updates.js';

/**
 * @param {Set<string>} [managed] tag keys Preen may replace (mail/tags.js managedTagKeys)
 * @returns {Promise<{changes: string[], before: object, after: object}>}
 */
export async function applyDecision(messageId, decision, settings, managed) {
  const header = await messenger.messages.get(messageId);
  const plan = planUpdate(header, decision, settings, managed);
  if (Object.keys(plan.update).length > 0) {
    await noteOwnUpdate(messageId);
    await messenger.messages.update(messageId, plan.update);
  }
  const applied = { changes: plan.changes, before: plan.before, after: plan.after };
  if (decision.junk === true && settings.actions.moveJunk) {
    let junkFolder = null;
    let lookupError = null;
    try {
      junkFolder = await junkFolderFor(header.folder);
    } catch (e) {
      lookupError = e.message;
    }
    if (!(await canMoveMail())) {
      applied.changes.push(NO_MOVE_PERMISSION);
    } else if (lookupError) {
      applied.changes.push(`not moved: couldn't find the Junk folder (${lookupError})`);
    } else if (!junkFolder) {
      applied.changes.push('not moved: no Junk folder in this account');
    } else if (junkFolder.id !== header.folder?.id) {
      // Where it came from (read before moving), so Undo can move it back.
      const moved = { accountId: header.folder.accountId, fromPath: header.folder.path, toPath: junkFolder.path };
      await noteOwnUpdate(messageId);
      await messenger.messages.move([messageId], junkFolder.id);
      applied.moved = moved;
      applied.changes.push(`moved to ${junkFolder.name ?? 'Junk'}`);
    }
  }
  return applied;
}
