// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Plans the change to a message from a decision. Pure: the caller reads the
// message's current state and applies the returned update.

import { keyForTagName, tagSpecs, PROCESSED_TAG_KEY, JUNK_TAG, NEEDS_REPLY_TAG } from './tags.js';

/**
 * The tag keys Preen manages with these settings. The processed marker is
 * included only while "Tag processed messages" is on: turning it off stops
 * adding the tag, without stripping it from messages that already have it.
 */
export function ownTagKeys(settings) {
  return new Set(tagSpecs(settings).map((t) => t.key));
}

/**
 * @param {{tags: string[], flagged: boolean, read: boolean, junk?: boolean}} current
 * @param {{category: string|null, tags: string[], junk?: boolean, scores: object}} decision
 * @param {object} settings
 * @param {Set<string>} [managed] tag keys Preen may replace: its current tags plus
 *   leftovers from renamed or deleted categories (see mail/tags.js). Any other
 *   tag, even one whose key happens to start with "preen_", is the user's.
 * @returns {{update: object, before: object, after: object, changes: string[]}}
 *   `update` holds only the properties that change (empty when nothing does).
 */
export function planUpdate(current, decision, settings, managed = ownTagKeys(settings)) {
  const before = {
    tags: [...(current.tags ?? [])], flagged: Boolean(current.flagged), read: Boolean(current.read), junk: Boolean(current.junk),
  };

  // Keep the user's own tags; replace Preen's tags from any earlier run.
  const preenTags = decision.tags.map(keyForTagName);
  if (settings.markProcessed.tag) preenTags.push(PROCESSED_TAG_KEY);
  // The junk mark is never cleared, so its tag stays with it while the message is still junk.
  const junkKey = keyForTagName(JUNK_TAG);
  if (before.junk && before.tags.includes(junkKey)) preenTags.push(junkKey);
  const userTags = before.tags.filter((k) => !managed.has(k));
  const tags = [...userTags, ...new Set(preenTags)];

  const category = settings.categories.find((c) => c.name.trim() === decision.category);
  const actions = category?.actions ?? {};
  const needsReply = decision.tags.includes(NEEDS_REPLY_TAG);
  const toDo = decision.toDo === true;

  let flagged = before.flagged;
  if (actions.flag || (needsReply && settings.actions.flagNeedsReply) || (toDo && settings.actions.flagToDo)) flagged = true;

  // Never marks mail as read: "read" means the user read it.
  let read = before.read;
  if (actions.markUnread) read = false;

  // Junk asks for no attention: no new flag or unread mark from category actions.
  if (decision.junk === true) {
    flagged = before.flagged;
    read = before.read;
  }

  // Only ever marks junk, never clears it: "not junk" is the user's (or Thunderbird's) call.
  const junk = before.junk || decision.junk === true;

  const after = { tags, flagged, read, junk };
  const update = {};
  const changes = [];

  const added = tags.filter((k) => !before.tags.includes(k));
  const removed = before.tags.filter((k) => !tags.includes(k));
  if (added.length || removed.length) {
    update.tags = tags;
    for (const k of added) changes.push(`+${k}`);
    for (const k of removed) changes.push(`-${k}`);
  }
  if (flagged !== before.flagged) {
    update.flagged = flagged;
    changes.push(flagged ? 'flagged' : 'unflagged');
  }
  if (read !== before.read) {
    update.read = read;
    changes.push(read ? 'marked read' : 'marked unread');
  }
  if (junk !== before.junk) {
    update.junk = junk;
    changes.push('marked junk');
  }
  return { update, before, after, changes };
}
