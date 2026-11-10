// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Tag corrections: when the user adds or removes a Preen tag on a message
// Preen tagged, the change is written to the local history with Preen's score for
// that tag. Kept on this computer only; later used to tune certainty levels.

import { TAG_KEY_PREFIX, PROCESSED_TAG_KEY, tagKey } from '../core/tags.js';
import { readRecent, appendEntries, appendCorrections } from '../storage/activity-log.js';
import { isOwnUpdate } from '../mail/own-updates.js';
import { recordCorrected, processedKey } from '../storage/processed.js';

// How far back to look for the run that tagged the message.
const LOOKBACK_ENTRIES = 1000;
const SCORE_FOR_KEY = {
  preen_person: 'person',
  preen_needs_reply: 'needsReply',
};

const managed = (key) => key.startsWith(TAG_KEY_PREFIX) && key !== PROCESSED_TAG_KEY;

/** Preen tags added and removed between `before` and `now` (tag keys). */
export function tagChanges(before, now) {
  const was = new Set(before.filter(managed));
  const is = new Set(now.filter(managed));
  return [
    ...[...is].filter((k) => !was.has(k)).map((key) => ({ key, change: 'added' })),
    ...[...was].filter((k) => !is.has(k)).map((key) => ({ key, change: 'removed' })),
  ];
}

/** Preen's score behind a tag, from the entry that applied it (null if none fits). */
export function scoreFor(key, entry) {
  const field = SCORE_FOR_KEY[key];
  if (field) return entry.scores?.[field] ?? null;
  if (entry.category && tagKey(entry.category) === key) return entry.scores?.categoryProbability ?? null;
  return null;
}

/**
 * The newest history entry that tells what Preen last left on this message: the run
 * that applied tags, or an earlier correction. Null when Preen never tagged it.
 */
export function baselineFor(message, entries) {
  for (const e of entries) {
    const same = e.messageId === message.id || (e.headerMessageId && e.headerMessageId === message.headerMessageId);
    if (!same) continue;
    if (e.correction?.tagsNow) return { tags: e.correction.tagsNow, from: e.correction.from ?? e };
    if (e.applied?.after?.tags && !e.undoneAt) return { tags: e.applied.after.tags, from: e };
  }
  return null;
}

/**
 * messages.onUpdated handler for tag changes.
 * @param {object} message MessageHeader after the change
 * @param {string[]} newTags tag keys now on the message
 * @param {{getNames?: () => Promise<Record<string, string>>, now?: Date}} [options] tag key → name lookup
 */
export async function recordTagChange(message, newTags, { getNames = async () => ({}), now = new Date() } = {}) {
  if (await isOwnUpdate(message.id)) return [];
  const base = baselineFor(message, await readRecent(LOOKBACK_ENTRIES));
  if (!base) return [];
  const changes = tagChanges(base.tags, newTags);
  if (!changes.length) return [];
  const tagsNow = newTags.filter(managed);
  // Only now, with something to record, are the tag names looked up.
  const names = await getNames();
  const entries = changes.map(({ key, change }) => {
    const name = names[key] ?? key;
    const score = scoreFor(key, base.from);
    return {
      at: now.toISOString(),
      messageId: message.id,
      headerMessageId: message.headerMessageId,
      from: message.author ?? '',
      subject: message.subject ?? '',
      notice: `You ${change} ${name}${score === null ? '' : ` (Preen's score was ${score.toFixed(2)})`}`,
      correction: { key, tag: name, change, score, tagsNow, from: { category: base.from.category, scores: base.from.scores } },
    };
  });
  await appendEntries(entries);
  await appendCorrections(entries); // the long-term copy
  // From now on automatic runs and Classify leave this message alone.
  await recordCorrected([processedKey(message.folder?.accountId, message.headerMessageId)]);
  return entries;
}
