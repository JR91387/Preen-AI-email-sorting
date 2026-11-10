// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Usage counters and limits. Days and months follow the user's local time.
// A limit of 0 (or null for cost) means "no limit".

import { costOfTokens, formatUsd } from './cost.js';
import { paceFor } from './pace.js';
import { dateStamp } from './time.js';

// Selections larger than this are confirmed before running (a prompt, not a cap).
export const CONFIRM_ABOVE = 100;
// The scheduler looks at, and queues, this many times the Speed's run size.
const LOOKAHEAD_RUNS = 10;

export function dayKey(date = new Date()) {
  return dateStamp(new Date(date));
}

export function monthKey(date = new Date()) {
  return dayKey(date).slice(0, 7);
}

export function emptyUsage(now = new Date()) {
  return {
    day: dayKey(now),
    dayMessages: 0,
    dayTokens: 0,
    month: monthKey(now),
    monthMessages: 0,
    monthTokens: 0,
    monthCostUsd: 0,
    monthCostKnownMessages: 0,
  };
}

/** Starts new day/month counters when the date has moved on. */
export function rollUsage(usage, now = new Date()) {
  const current = { ...emptyUsage(now), ...(usage ?? {}) };
  if (current.day !== dayKey(now)) {
    Object.assign(current, { day: dayKey(now), dayMessages: 0, dayTokens: 0 });
  }
  if (current.month !== monthKey(now)) {
    Object.assign(current, {
      month: monthKey(now), monthMessages: 0, monthTokens: 0, monthCostUsd: 0, monthCostKnownMessages: 0,
    });
  }
  return current;
}

/** Adds one activity entry's API use to the counters (entries without API use are ignored). */
export function addUsage(usage, entry) {
  const tokens = Math.max(0, Number(entry?.inputTokens));
  if (!entry?.passes?.length || !Number.isFinite(tokens)) return usage;
  usage.dayMessages += 1;
  usage.dayTokens += tokens;
  usage.monthMessages += 1;
  usage.monthTokens += tokens;
  if (typeof entry.costUsd === 'number') {
    usage.monthCostUsd += Math.max(0, entry.costUsd);
    usage.monthCostKnownMessages += 1;
  }
  return usage;
}

/**
 * This month's cost estimated from counted tokens and the user's price, or null without a price.
 * Tokens are always counted, so the estimate covers every message, not only ones with a reported cost.
 */
export function estimatedMonthCostUsd(usage, settings) {
  const tokens = Number(usage?.monthTokens);
  const usd = Number.isFinite(tokens) ? costOfTokens(tokens, settings.pricePerMillionInputTokens) : null;
  return Number.isFinite(usd) ? usd : null;
}

/**
 * The scheduler's working sizes, derived from the user's settings rather than fixed:
 * per scan and per new-mail event, 10 × the run size of the Speed; the queue holds the larger of
 * the daily allowance and 10 × the run size (with no daily allowance, 10 × the run size).
 */
export function schedulerLimits(settings) {
  const look = LOOKAHEAD_RUNS * paceFor(settings).runSize;
  return { perScan: look, perNewMail: look, queue: Math.max(settings.limits.dailyMessages, look) };
}

/** Whether a right-click, folder or popup run of `selected` messages is confirmed first. */
export function needsConfirm(selected) {
  return selected > CONFIRM_ABOVE;
}

/**
 * @returns {{canRun: boolean, reason: string|null, remainingMessages: number}}
 *   remainingMessages is Infinity without a daily message limit
 */
export function budgetStatus(usage, settings) {
  const l = settings.limits;
  let reason = null;
  if (l.dailyMessages > 0 && usage.dayMessages >= l.dailyMessages) {
    reason = `Daily limit of ${l.dailyMessages} message${l.dailyMessages === 1 ? '' : 's'} reached`;
  } else if (typeof l.monthlyCostUsd === 'number' && (estimatedMonthCostUsd(usage, settings) ?? -Infinity) >= l.monthlyCostUsd) {
    reason = `Estimated monthly cost limit of ${formatUsd(l.monthlyCostUsd)} reached`;
  }
  if (reason) reason += ' (change it in Settings → Limits & allowance)';
  const remainingMessages = l.dailyMessages > 0 ? Math.max(0, l.dailyMessages - usage.dayMessages) : Infinity;
  return { canRun: reason === null, reason, remainingMessages };
}
