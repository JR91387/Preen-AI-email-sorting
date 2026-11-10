// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// "Try it on the last 7 days", shared by Getting started and the toolbar popup: a
// preview (no changes) of recent mail in the mailboxes ticked for automatic
// processing, after saying how many messages and roughly what it costs.

import { loadSettings } from '../../storage/settings.js';
import { readUsage } from '../../storage/state.js';
import { readSummaries } from '../../storage/activity-log.js';
import { foldersInScope, recentMessages } from '../../mail/folders.js';
import { automationState } from '../../core/automation.js';
import { budgetStatus } from '../../core/budget.js';
import { hasConsent } from '../../core/consent.js';
import { estimateRun, averageTokens, formatTokens, formatUsd } from '../../core/cost.js';
import { DAY_MS } from '../../core/time.js';
import { CLASSIFY_IDS } from '../../core/protocol.js';
import { askDialog } from './ui.js';

export const TRIAL_DAYS = 7;

/**
 * Message ids from the last TRIAL_DAYS days in the ticked mailboxes, at most `limit`.
 * @returns {Promise<{ids: number[], capped: boolean}>}
 */
export async function trialIds(settings, limit, now = Date.now()) {
  const fromDate = new Date(now - TRIAL_DAYS * DAY_MS);
  const ids = [];
  for (const folder of await foldersInScope(settings)) {
    // One more than there is room for: a full list is "capped" only if mail was left over.
    const found = await recentMessages(folder.id, fromDate, limit - ids.length + 1);
    for (const m of found) {
      if (ids.length >= limit) return { ids, capped: true };
      ids.push(m.id);
    }
  }
  return { ids, capped: false };
}

/** The confirm text: how many messages, the cost estimate and that nothing changes. */
export function trialMessage(count, estimate, capped) {
  const what = `${count} message${count === 1 ? '' : 's'}`;
  const cost = estimate
    ? `About ${formatTokens(estimate.tokens)} tokens${estimate.usd === null ? '' : `, about ${formatUsd(estimate.usd)}`} (an estimate from your past use).`
    : 'Preen has no past use to estimate the cost from yet.';
  return `Preen sends ${what} to your provider and shows what it would do. Nothing in your mail changes.`
    + `${capped ? ' That is as many as today\'s message limit allows.' : ''} ${cost}`;
}

/**
 * Checks the existing gates, asks, then starts the preview.
 * @returns {Promise<{outcome: 'blocked'|'cancelled'|'started', text?: string}>}
 */
export async function startTrial() {
  const settings = await loadSettings();
  if (automationState(settings) === 'off') {
    return { outcome: 'blocked', text: 'Tick a mailbox in Settings → Automatic processing first: the trial looks at those mailboxes.' };
  }
  if (!hasConsent(settings)) return { outcome: 'blocked', text: 'Agree to send mail to your provider in Settings → Provider & cost first.' };
  const budget = budgetStatus(await readUsage(), settings);
  if (!budget.canRun) return { outcome: 'blocked', text: budget.reason };
  const { ids, capped } = await trialIds(settings, budget.remainingMessages);
  if (!ids.length) return { outcome: 'blocked', text: `No messages from the last ${TRIAL_DAYS} days in the ticked mailboxes.` };
  const estimate = estimateRun(ids.length, averageTokens(await readSummaries()), settings.pricePerMillionInputTokens);
  const yes = await askDialog({
    title: `Preview the last ${TRIAL_DAYS} days?`,
    message: trialMessage(ids.length, estimate, capped),
    confirmLabel: 'Preview',
    cancelLabel: 'Not now',
  });
  if (!yes) return { outcome: 'cancelled' };
  await messenger.runtime.sendMessage({ type: CLASSIFY_IDS, ids, apply: false, selected: ids.length, trial: true });
  return { outcome: 'started', text: `Previewing ${ids.length} message${ids.length === 1 ? '' : 's'}; the review opens on the Activity page when it's done.` };
}
