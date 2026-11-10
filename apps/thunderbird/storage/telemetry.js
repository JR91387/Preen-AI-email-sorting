// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Anonymous usage statistics: local state, the weekly alarm, and building and
// sending the report. State in storage.local (this computer only):
// { firstSeen, lastReport: { at, totals }, lastResult: { date, sent, reason }, noticeSeen }.

import { loadSettings } from './settings.js';
import { readSummaries, readCorrections, clearSummaries } from './activity-log.js';
import { createSerializer } from '../core/serialize.js';
import {
  buildReport, collectTotals, isDue, nextReportAt, sendReport, totalsToKeep, rebaseTotals, TELEMETRY_URL, RETRY_AFTER_MS,
} from '../core/telemetry.js';
import { dateStamp } from '../core/time.js';

export const TELEMETRY_KEY = 'telemetry';
export const TELEMETRY_ALARM = 'preen-telemetry';

const serialized = createSerializer();

export async function readTelemetryState() {
  const stored = await messenger.storage.local.get(TELEMETRY_KEY);
  const state = stored[TELEMETRY_KEY];
  return state && typeof state === 'object' ? state : {};
}

export function updateTelemetryState(patch) {
  return serialized(async () => {
    const next = { ...(await readTelemetryState()), ...patch };
    await messenger.storage.local.set({ [TELEMETRY_KEY]: next });
    return next;
  });
}

/** Records when Preen first ran (once). */
export async function ensureFirstSeen(now = Date.now()) {
  const state = await readTelemetryState();
  return state.firstSeen ? state : updateTelemetryState({ firstSeen: now });
}

async function thunderbirdMajor() {
  try {
    const info = await messenger.runtime.getBrowserInfo?.();
    const major = Number.parseInt(String(info?.version ?? ''), 10);
    return Number.isInteger(major) ? major : null;
  } catch {
    return null;
  }
}

/** The user's totals now (all time and this month), from the local history. */
export async function readTotals(now = new Date()) {
  const [summaries, corrections] = await Promise.all([readSummaries(), readCorrections()]);
  return collectTotals({ summaries, corrections, now });
}

/**
 * "Reset my statistics": clears the monthly summaries only (the activity log and the corrections stay),
 * notes when, and lowers the last report's saved totals to match so the next report counts new
 * activity in full.
 */
export async function resetStatistics(now = Date.now()) {
  await clearSummaries();
  const current = (await readTotals(new Date(now))).allTime;
  await updateTelemetryState({ statsResetAt: now });
  const state = await readTelemetryState();
  if (state.lastReport?.totals) {
    await updateTelemetryState({ lastReport: { ...state.lastReport, totals: rebaseTotals(state.lastReport.totals, current) } });
  }
}

/** The report that would be sent now: the exact object, built from the saved settings. */
export async function previewReport({ now = Date.now() } = {}) {
  const [settings, state, totals, tb] = await Promise.all([loadSettings(), readTelemetryState(), readTotals(new Date(now)), thunderbirdMajor()]);
  return buildReport({
    settings,
    totals: totals.allTime,
    previous: state.lastReport ?? null,
    firstSeen: state.firstSeen ?? now,
    version: messenger.runtime.getManifest?.()?.version,
    thunderbirdMajor: tb,
    now,
  });
}

/** Sets the alarm to the next due time, or removes it while statistics are off. */
export async function configureTelemetryAlarm(settings, now = Date.now()) {
  if (!settings.telemetry?.enabled) {
    await messenger.alarms.clear(TELEMETRY_ALARM);
    return null;
  }
  const state = await ensureFirstSeen(now);
  const when = Math.max(now + 60_000, nextReportAt(state));
  const existing = await messenger.alarms.get(TELEMETRY_ALARM);
  if (existing?.scheduledTime !== when) messenger.alarms.create(TELEMETRY_ALARM, { when });
  return when;
}

/**
 * Builds and sends the report if one is due. Off: nothing is built or sent. A report
 * long overdue (Thunderbird was closed) is sent once and the next is 7 days later.
 * @returns {Promise<{report: object, result: object}|null>}
 */
export async function runTelemetry({ now = Date.now(), url = TELEMETRY_URL, fetchImpl = globalThis.fetch } = {}) {
  const settings = await loadSettings();
  if (!settings.telemetry?.enabled) return null;
  const state = await ensureFirstSeen(now);
  if (!isDue(state, now)) return null;
  const totals = (await readTotals(new Date(now))).allTime;
  const report = await previewReport({ now });
  const result = await sendReport(report, { url, fetchImpl });
  const lastResult = { date: dateStamp(new Date(now)), ...result };
  // Not sent: keep the period open (nothing is lost) and quietly try again a day later.
  await updateTelemetryState(result.sent
    ? { lastReport: { at: now, totals: totalsToKeep(totals) }, retryAt: null, lastResult }
    : { retryAt: now + RETRY_AFTER_MS, lastResult });
  return { report, result };
}
