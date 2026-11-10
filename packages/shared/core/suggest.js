// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Suggested certainty levels from the user's own tag corrections. Pure.
// Every scored message counts: a correction says what was right (removed = no
// tag, added = tag), and a message the user left alone counts as Preen having
// been right at the current level. The suggestion is the level with the fewest
// mistakes over all of them, offered only when it beats the current level and
// the tag has enough corrections to mean something.

import { keyForTagName, REAL_PERSON_TAG, NEEDS_REPLY_TAG } from './tags.js';

export const MIN_CORRECTIONS = 10;

// Tag key → the settings field holding its level.
export const LEVEL_FIELD = {
  [keyForTagName(REAL_PERSON_TAG)]: 'realPerson',
  [keyForTagName(NEEDS_REPLY_TAG)]: 'needsReply',
};

/**
 * History entries that count as "Preen was right": tags really applied (not a preview
 * or dry run, which showed nothing to correct), not undone, and not corrected.
 */
export function untouchedEntries(entries, corrected) {
  return entries.filter((e) => e.scores && e.headerMessageId && e.applied && !e.dryRun && !e.undoneAt
    && !corrected.has(e.headerMessageId));
}

/**
 * @param {{key: string, change: 'added'|'removed', score: number|null}[]} rows corrections
 * @param {object} thresholds settings.thresholds
 * @param {Record<string, number[]>} [untouched] per field, scores of messages the user didn't correct
 * @returns {{key, field, added, removed, current, suggested, avoided}[]} one per tag with a level
 */
export function suggestLevels(rows, thresholds, untouched = {}) {
  const out = [];
  for (const [key, field] of Object.entries(LEVEL_FIELD)) {
    const current = thresholds[field];
    // A tag removed below the level came from a shortcut (e.g. a sender rule), not
    // from the level, so it says nothing about where the level should be.
    const mine = rows.filter((r) => r.key === key && Number.isFinite(r.score)
      && !(r.change === 'removed' && Number.isFinite(current) && r.score < current));
    // What was right for each message: corrections give it; untouched messages
    // keep Preen's decision at the current level.
    const truth = [
      ...mine.map((r) => ({ score: r.score, tag: r.change === 'added' })),
      ...(untouched[field] ?? []).filter(Number.isFinite).map((s) => ({ score: s, tag: s >= current })),
    ];
    const mistakes = (t) => truth.filter((m) => (m.score >= t) !== m.tag).length;
    const result = {
      key,
      field,
      added: mine.filter((r) => r.change === 'added').length,
      removed: mine.filter((r) => r.change === 'removed').length,
      current,
      suggested: null,
      avoided: 0,
    };
    if (mine.length >= MIN_CORRECTIONS && Number.isFinite(current)) {
      let best = current;
      let fewest = mistakes(current);
      for (let step = 30; step <= 95; step += 5) {
        const level = step / 100;
        const n = mistakes(level);
        // Ties keep the level closest to the current one: change only when it helps.
        if (n < fewest || (n === fewest && Math.abs(level - current) < Math.abs(best - current))) {
          best = level;
          fewest = n;
        }
      }
      if (best !== current && fewest < mistakes(current)) {
        result.suggested = best;
        result.avoided = mistakes(current) - fewest;
      }
    }
    out.push(result);
  }
  return out;
}
