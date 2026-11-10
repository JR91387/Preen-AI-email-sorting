// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// "Review this run": applies decisions a preview or dry run already made. Nothing is
// sent to the provider again; each applied message gets a normal applied entry, so
// Undo works on it like on any other run.

import { applyDecision } from './actions.js';
import { findMessageHeader } from './messages.js';
import { ensureTags, managedTagKeys } from './tags.js';
import { appendEntries, readRecent } from '../storage/activity-log.js';
import { createSerializer } from '../core/serialize.js';
import { loadSettings } from '../storage/settings.js';
import { recordProcessed, readCorrected, processedKey } from '../storage/processed.js';

/** Entries of a preview or dry run that can still be applied from the review. */
export function reviewable(entry) {
  return Boolean(entry?.scores && !entry.applied && (entry.runKind === 'preview' || entry.runKind === 'dry run'));
}

/** The key that ties an applied entry back to the reviewed one. */
export const reviewKey = (entry) => `${entry.runId}:${entry.headerMessageId ?? entry.messageId}`;

/**
 * Applies the decisions in `entries` (from one reviewed run).
 * @returns {Promise<{applied: number, corrected: number, missing: number, failed: number, dryRun?: boolean}>}
 */
// One apply at a time: a row's Apply and Apply all can overlap; the second then sees the first's entries.
const serialized = createSerializer();
// How far back the "already applied" check looks; the review reads the same window.
const RECENT = 5000;

export function applyReviewed(entries) {
  return serialized(() => applyNow(entries));
}

async function applyNow(entries) {
  const result = { applied: 0, corrected: 0, missing: 0, failed: 0 };
  const settings = await loadSettings();
  // Dry run promises no changes; the review doesn't break that promise.
  if (settings.dryRun) return { ...result, dryRun: true };
  await ensureTags(settings);
  const managed = await managedTagKeys(settings);
  const corrected = await readCorrected();
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const out = [];
  const done = new Set((await readRecent(RECENT)).map((e) => e.reviewOf).filter(Boolean));
  for (const entry of entries.filter((e) => reviewable(e) && !done.has(reviewKey(e)))) {
    let header;
    try {
      header = await findMessageHeader(entry.messageId, entry.headerMessageId);
    } catch (e) {
      console.warn('Preen: could not look up a reviewed message', e);
      result.failed++;
      continue;
    }
    if (!header) {
      result.missing++;
      continue;
    }
    const key = processedKey(header.folder?.accountId, header.headerMessageId);
    if (corrected[key]) {
      result.corrected++;
      continue;
    }
    const decision = { category: entry.category, tags: entry.tags, review: entry.review, toDo: entry.toDo === true, junk: entry.junk };
    try {
      const applied = await applyDecision(header.id, decision, settings, managed);
      await recordProcessed([key]);
      const copy = { ...entry };
      for (const field of ['seq', 'debugId', 'runStart']) delete copy[field];
      out.push({
        ...copy, at: new Date().toISOString(), runId, messageId: header.id, runKind: 'applied', dryRun: false,
        source: 'manual', applied, applyError: null, reviewOf: reviewKey(entry),
      });
      result.applied++;
    } catch (e) {
      console.error('Preen: could not apply a reviewed decision', e);
      result.failed++;
    }
  }
  if (out.length) await appendEntries(out);
  return result;
}

/** What applying from the review did, in plain words. */
export function reviewSummary({ applied, corrected, missing, failed, dryRun }) {
  if (dryRun) return 'Dry run is on, so Preen changes no messages. Turn dry run off in Settings (Advanced) to apply these.';
  const n = (count) => `${count} message${count === 1 ? '' : 's'}`;
  const parts = [`Applied Preen's decisions to ${n(applied)}.`];
  if (corrected) parts.push(`${n(corrected)} left alone because you corrected ${corrected === 1 ? 'it' : 'them'}.`);
  if (missing) parts.push(`${n(missing)} could not be found (moved or deleted).`);
  if (failed) parts.push(`${n(failed)} could not be changed.`);
  return parts.join(' ');
}
