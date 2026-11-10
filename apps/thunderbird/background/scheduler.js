// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Automatic processing: collects new mail into a queue and works through it
// in runs, within the user's limits. Starts paused (automation off).

import { loadSettings } from '../storage/settings.js';
import {
  readQueue, enqueue, updateQueue, queueKey, readUsage, updateStatus, readScanCursor, saveScanCursor,
} from '../storage/state.js';
import {
  isProcessedSet, isCorrectedSet, readProcessedSet, recordProcessed, processedKey,
} from '../storage/processed.js';
import { folderInScope, eligibility, cutoffDate } from '../core/scope.js';
import { budgetStatus, schedulerLimits } from '../core/budget.js';
import { foldersInScope, recentMessages, findMessage, queueItem } from '../mail/folders.js';
import { classifyMessages, SetupError, STOPPED_BY_USER } from './pipeline.js';
import { collectPages } from '../mail/paging.js';
import { SCHEDULE_ALARM, RUN_SOON_ALARM } from '../core/protocol.js';
import { automationState } from '../core/automation.js';
import { paceFor } from '../core/pace.js';
import { LIMIT_REACHED, AWAITING_CONSENT, STOPPED_AFTER_ERROR } from '../core/run-summary.js';

const REALTIME_DELAY_MINUTES = 0.5; // gather a burst of new mail into one run
const MAX_ATTEMPTS = 3; // runs a message may fail temporarily before it's dropped

/**
 * Sets up (or removes) the schedule to match the settings. An existing
 * schedule with the same interval is left alone, so saving other settings
 * doesn't push the next run back.
 */
export async function configureAlarms(settings) {
  const a = settings.automation;
  // On means a mailbox is ticked and it isn't paused; nothing to schedule otherwise.
  const on = automationState(settings) === 'on';
  const wanted = on && a.trigger === 'scheduled';
  const existing = await messenger.alarms.get(SCHEDULE_ALARM);
  if (!wanted) {
    if (existing) await messenger.alarms.clear(SCHEDULE_ALARM);
  } else if (existing?.periodInMinutes !== a.intervalMinutes) {
    await messenger.alarms.clear(SCHEDULE_ALARM);
    await messenger.alarms.create(SCHEDULE_ALARM, { delayInMinutes: a.intervalMinutes, periodInMinutes: a.intervalMinutes });
  }
  if (!on || a.trigger !== 'realtime') await messenger.alarms.clear(RUN_SOON_ALARM);
}

async function collectHeaders(messageList, limit) {
  const headers = [];
  await collectPages(messageList, (m) => { headers.push(m); return headers.length >= limit; });
  return headers;
}

function eligibleItems(headers, settings, processed) {
  const now = Date.now();
  return headers
    .filter((h) => eligibility(h, settings, { now, processed: isProcessedSet(processed, h), corrected: isCorrectedSet(processed, h) }).ok)
    .map((h) => queueItem(h, now));
}

/** New mail event: queue eligible messages; in real-time mode, run shortly. */
export async function onNewMail(folder, messageList) {
  const settings = await loadSettings();
  if (automationState(settings) !== 'on' || !folderInScope(folder, settings)) return;
  const limits = schedulerLimits(settings);
  const headers = await collectHeaders(messageList, limits.perNewMail);
  const added = await enqueue(eligibleItems(headers, settings, await readProcessedSet(settings)), limits.queue);
  if (added && settings.automation.trigger === 'realtime') {
    await messenger.alarms.create(RUN_SOON_ALARM, { delayInMinutes: REALTIME_DELAY_MINUTES });
  }
}

/**
 * Looks through in-scope folders for recent unprocessed mail (catch-up).
 * The scan size (schedulerLimits) is shared fairly: each folder gets an equal share of what's
 * left, and each scan starts at the next folder, so a busy folder can't keep
 * the others from ever being looked at.
 */
export async function scan(settings) {
  const processed = await readProcessedSet(settings);
  const fromDate = cutoffDate(settings);
  const folders = await foldersInScope(settings);
  if (!folders.length) return 0;
  const start = (await readScanCursor()) % folders.length;
  const ordered = [...folders.slice(start), ...folders.slice(0, start)];
  const limits = schedulerLimits(settings);
  let seen = 0;
  let added = 0;
  for (let i = 0; i < ordered.length && seen < limits.perScan; i++) {
    const share = Math.max(1, Math.floor((limits.perScan - seen) / (ordered.length - i)));
    const headers = await recentMessages(ordered[i].id, fromDate, share);
    seen += headers.length;
    added += await enqueue(eligibleItems(headers, settings, processed), limits.queue);
  }
  await saveScanCursor((start + 1) % folders.length);
  return added;
}

let running = null;

/**
 * Works through the queue: one run of up to the Speed's run size (pace.js) messages, newest first.
 * @param {{manual?: boolean}} [options] manual: "Run now", works even while paused.
 */
export function runQueue(options = {}) {
  running ??= runOnce(options).finally(() => {
    running = null;
  });
  return running;
}

async function runOnce({ manual = false } = {}) {
  const settings = await loadSettings();
  if (!manual && automationState(settings) !== 'on') return null;
  const startedAt = new Date().toISOString();

  const budget = budgetStatus(await readUsage(), settings);
  if (!budget.canRun) {
    await updateStatus({ blockedReason: budget.reason, lastRun: { at: startedAt, manual, classified: 0, note: budget.reason } });
    return null;
  }

  const queue = await readQueue();
  const take = Math.min(paceFor(settings).runSize, budget.remainingMessages);
  const processed = await readProcessedSet(settings);
  const updates = new Map();
  const ids = [];
  const itemsById = new Map();
  const folderCache = new Map();
  let dropped = 0;

  // Find each queued message again and check it still qualifies.
  for (const item of queue) {
    if (ids.length >= take) break;
    let header;
    try {
      header = await findMessage(item, folderCache);
    } catch (e) {
      // Only a real not-found drops an item; any other error keeps it queued for a later run.
      console.warn(`Preen: could not look up queued message ${item.headerMessageId}; keeping it queued`, e);
      continue;
    }
    const ok = header && folderInScope(header.folder, settings)
      && eligibility(header, settings, { processed: isProcessedSet(processed, header), corrected: isCorrectedSet(processed, header) }).ok;
    if (!ok) {
      updates.set(queueKey(item), null); // moved, deleted, already done or no longer eligible
      dropped++;
      continue;
    }
    ids.push(header.id);
    itemsById.set(header.id, item);
  }

  let results = [];
  let lastError = null;
  if (ids.length) {
    try {
      results = await classifyMessages(ids, { apply: true, source: 'automatic' });
    } catch (e) {
      if (!(e instanceof SetupError)) throw e;
      lastError = e.message; // e.g. missing API key: keep the queue for later
    }
  }

  // What happens to each queued message after the run:
  //  - limit reached, waiting for consent, or stopped because of another message's error → stays queued
  //  - API key/permission problem (auth) → stays queued; shown as the last error
  //  - other errors, including a failed update of the message → retried in
  //    later runs; after MAX_ATTEMPTS it's dropped and recorded as processed,
  //    so later scans don't pick it up (and spend tokens) again
  //  - classified, or skipped for good (e.g. encrypted) → removed
  let classified = 0;
  let failed = 0;
  let limitReason = null;
  const givenUp = [];
  for (const result of results) {
    const item = itemsById.get(result.messageId);
    if (!item) continue;
    const key = queueKey(item);
    if (result.skipped === LIMIT_REACHED) {
      limitReason = result.limitReason;
    } else if (result.skipped === STOPPED_AFTER_ERROR || result.skipped === STOPPED_BY_USER || result.skipped === AWAITING_CONSENT) {
      // stays queued
    } else if (result.error?.kind === 'auth') {
      lastError = `The provider rejected the API key or permission (${result.error.message})`;
    } else if (result.error || result.applyError) {
      failed++;
      const attempts = (item.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        updates.set(key, null);
        givenUp.push(processedKey(item.accountId, item.headerMessageId));
      } else {
        updates.set(key, { ...item, attempts });
      }
    } else {
      if (!result.skipped) classified++;
      updates.set(key, null);
    }
  }

  await updateQueue(updates);
  if (givenUp.length) await recordProcessed(givenUp);
  const remaining = (await readQueue()).length;
  await updateStatus({
    blockedReason: limitReason,
    lastError,
    lastRun: { at: startedAt, manual, classified, failed, dropped, remaining },
  });
  return { classified, failed, dropped, remaining };
}

/** "Run now": look for new mail, then process. Works even while paused. */
export async function runNow(options = {}) {
  const settings = await loadSettings();
  await scan(settings);
  return runQueue({ ...options, manual: true });
}

/** At startup or on schedule: catch up on mail that arrived meanwhile, then run. */
export async function catchUpAndRun(options = {}) {
  const settings = await loadSettings();
  if (automationState(settings) !== 'on' || settings.automation.trigger === 'manual') return null;
  await scan(settings);
  return runQueue(options);
}
