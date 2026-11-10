// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The debug log's export file, and debug submissions: messages the user picks and
// sends to the Preen developer. Requests and responses stay the exact strings sent and received.

import { dateStamp } from './time.js';

// No server yet: while empty, nothing is sent; the user can save the submission as a file.
export const SUBMIT_URL = '';
export const SUBMISSION_FORMAT = 'preen-debug-submission';

export function debugExport(records, version, now = new Date()) {
  return { preen: version, exported: now.toISOString(), records };
}

/**
 * One row per message that has debug records: the tags Preen left, the tags after the
 * user's corrections, and its subject (shown in the list only). Corrected messages first, then newest.
 * @param {object[]} entries activity history entries
 * @param {object[]} records debug records
 */
export function submissionRows(entries, records) {
  const byEntry = new Map();
  for (const r of records) {
    if (!r?.entryId) continue;
    if (!byEntry.has(r.entryId)) byEntry.set(r.entryId, []);
    byEntry.get(r.entryId).push(r);
  }
  const fixes = entries.filter((e) => e.correction && e.headerMessageId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const rows = entries.filter((e) => e.debugId && byEntry.has(e.debugId)).map((e) => {
    const own = fixes.filter((c) => c.headerMessageId === e.headerMessageId && String(c.at) >= String(e.at));
    const before = [...(e.tags ?? [])];
    const after = new Set(before);
    for (const c of own) {
      if (c.correction.change === 'added') after.add(c.correction.tag);
      else after.delete(c.correction.tag);
    }
    return {
      id: e.debugId, at: e.at, subject: e.subject ?? '', before, after: [...after], fixes: own, records: byEntry.get(e.debugId),
    };
  });
  return rows.sort((a, b) => (b.fixes.length > 0) - (a.fixes.length > 0) || String(b.at).localeCompare(String(a.at)));
}

/**
 * Exactly what is sent for the chosen rows: per message, each request as sent to Jev and its answer,
 * Preen's decision and the user's correction. No API key, account, message id or settings.
 */
export function debugSubmission(rows, { version, apiKey = '', now = new Date() } = {}) {
  const key = String(apiKey ?? '').trim();
  const scrub = (v) => {
    if (v === null || v === undefined) return null;
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    return key ? text.split(key).join('[removed]') : text;
  };
  return {
    format: SUBMISSION_FORMAT,
    preen: String(version ?? 'unknown'),
    created: dateStamp(now),
    messages: rows.map((r) => ({
      at: r.at,
      exchanges: r.records.map((x) => ({
        at: x.at ?? null, status: x.status ?? null, ms: x.ms ?? null, request: scrub(x.request), response: scrub(x.response), error: scrub(x.error),
      })),
      decision: r.records.find((x) => x.decision)?.decision ?? null,
      correction: r.fixes.length
        ? { before: r.before, after: r.after, changes: r.fixes.map((c) => ({ tag: c.correction.tag, change: c.correction.change, score: c.correction.score ?? null })) }
        : null,
    })),
  };
}

/**
 * Sends a submission the user confirmed. While `url` is empty nothing is fetched. Only HTTPS, no cookies.
 * @returns {Promise<{sent: boolean, reason: string|null}>}
 */
export async function sendSubmission(submission, { url = SUBMIT_URL, fetchImpl = globalThis.fetch } = {}) {
  if (!url) return { sent: false, reason: 'no server' };
  if (!/^https:\/\//.test(url)) return { sent: false, reason: 'not https' };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    return res.ok ? { sent: true, reason: null } : { sent: false, reason: `server answered ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e.message || 'network error' };
  }
}
