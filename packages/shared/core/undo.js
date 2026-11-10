// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Plans undoing a change Preen made. Only what Preen changed is reversed:
// Preen's tags are removed (and tags it replaced restored), while the user's
// own tags stay. A flag or read state is reverted only if it's still the way
// Preen set it; if the user already changed it back, there's nothing to do.

const describe = {
  flagged: (value) => (value ? 'flagged' : 'unflagged'),
  read: (value) => (value ? 'marked read' : 'marked unread'),
  junk: (value) => (value ? 'marked junk' : 'marked not junk'),
};

/**
 * @param {{tags?: string[], flagged?: boolean, read?: boolean, junk?: boolean}} current the message now
 * @param {{before: object, after: object}} applied what the activity log recorded
 * @returns {{update: object, changes: string[]}} update: properties to set
 *   (empty when there's nothing to undo)
 */
export function planUndo(current, applied) {
  const now = {
    tags: [...(current.tags ?? [])], flagged: Boolean(current.flagged), read: Boolean(current.read), junk: Boolean(current.junk),
  };
  const { before, after } = applied;
  const added = after.tags.filter((t) => !before.tags.includes(t));
  const removed = before.tags.filter((t) => !after.tags.includes(t));

  const changes = [];
  const tags = now.tags.filter((t) => !added.includes(t));
  for (const t of added) if (now.tags.includes(t)) changes.push(`-${t}`);
  for (const t of removed) {
    if (!tags.includes(t)) {
      tags.push(t);
      changes.push(`+${t}`);
    }
  }

  const update = {};
  if (changes.length) update.tags = tags;
  // Older entries have no junk state: both sides read as false, so it's skipped.
  for (const key of ['flagged', 'read', 'junk']) {
    if (Boolean(after[key]) === Boolean(before[key])) continue;
    if (now[key] === Boolean(after[key])) {
      update[key] = Boolean(before[key]);
      changes.push(describe[key](Boolean(before[key])));
    }
  }
  return { update, changes };
}

/** Entries of the most recent run that still has changes to undo. */
export function lastUndoableRun(entries) {
  const undoable = entries.filter((e) => e.applied?.changes?.length && !e.undoneAt && e.runId);
  if (!undoable.length) return { runId: null, entries: [] };
  const latest = undoable.reduce((a, b) => (a.at >= b.at ? a : b));
  return { runId: latest.runId, entries: undoable.filter((e) => e.runId === latest.runId) };
}
