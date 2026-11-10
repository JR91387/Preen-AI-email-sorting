// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Activity history helpers: monthly summaries and CSV export. Entries hold the
// sender and subject but never the message text; they stay
// on this computer unless the user exports them.

import { monthKey } from './budget.js';
import { localTime, DAY_MS } from './time.js';
import { REAL_PERSON_TAG, NEEDS_REPLY_TAG } from './tags.js';
import { STOPPED_AFTER_ERROR, LIMIT_REACHED, AWAITING_CONSENT, CORRECTED } from './run-summary.js';

// --- Detail counters: counts only, never names or error text ---------------------

export const ERROR_KINDS = ['auth', 'rate_limit', 'server', 'network', 'timeout', 'bad_request', 'bad_response', 'internal'];
// Skip reasons as stored on entries (`skipped`, or `textSkipped` when the text wasn't sent) → counter.
export const SKIP_KEYS = {
  [LIMIT_REACHED]: 'limitReached',
  [AWAITING_CONSENT]: 'awaitingConsent',
  encrypted: 'encrypted',
  'message too large': 'tooLarge',
  'no readable text': 'noText',
  [CORRECTED]: 'corrected',
};
// runKind values ('dry run' → dryRun) and what started the run (source).
const RUN_KEYS = { applied: 'applied', 'dry run': 'dryRun', preview: 'preview' };
// Corrections by tag kind; every category tag counts in one bucket.
const CORRECTION_KEYS = { preen_person: 'person', preen_needs_reply: 'needsReply', preen_junk: 'junk' };
const NOT_CATEGORY = new Set(['preen_processed']);
// Provider response time per message: [counter, upper bound in ms (exclusive)].
export const LATENCY_BUCKETS = [['lt1s', 1000], ['1to2s', 2000], ['2to5s', 5000], ['5to10s', 10_000], ['10sPlus', Infinity]];
export const LATENCY_PROVIDERS = ['openrouter', 'typesafe'];

const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

/** The detail counters of a monthly summary, all 0. Fixed keys only. */
export function emptyDetail() {
  return {
    errors: zeros(ERROR_KINDS),
    stoppedAfterError: 0,
    skips: zeros([...Object.values(SKIP_KEYS), 'other']),
    runs: zeros([...Object.values(RUN_KEYS), 'automatic', 'manual']),
    corrected: zeros([...Object.values(CORRECTION_KEYS), 'category']),
    review: 0,
    depth: zeros(['surface', 'deep']),
    undo: zeros(['runs', 'messages']),
    latency: Object.fromEntries(LATENCY_PROVIDERS.map((p) => [p, zeros(LATENCY_BUCKETS.map(([k]) => k))])),
  };
}

/** Fills missing counters (summaries saved by earlier versions) with 0. */
function withDetail(summary) {
  const fill = (target, empty) => {
    for (const [k, v] of Object.entries(empty)) {
      if (typeof v === 'object') target[k] = fill(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
      else if (typeof target[k] !== 'number') target[k] = 0;
    }
    return target;
  };
  return fill(summary, emptyDetail());
}

export function latencyBucket(ms) {
  return LATENCY_BUCKETS.find(([, below]) => ms < below)[0];
}

/** Entries that change a monthly summary: classified, failed, skipped, corrections and undo notices. */
export function countsInSummary(entry) {
  return Boolean(entry?.scores || entry?.error || entry?.skipped || entry?.correction || entry?.undo);
}

function addDetail(summary, entry) {
  const d = withDetail(summary);
  // One per failed message (retries end in one entry); the kind only, never the message.
  if (entry.error) {
    const kind = ERROR_KINDS.includes(entry.error.kind) ? entry.error.kind : 'internal';
    d.errors[kind] += 1;
  }
  if (entry.skipped === STOPPED_AFTER_ERROR) d.stoppedAfterError += 1;
  else if (entry.skipped) d.skips[SKIP_KEYS[entry.skipped] ?? 'other'] += 1;
  if (entry.textSkipped) d.skips[SKIP_KEYS[entry.textSkipped] ?? 'other'] += 1;
  if (entry.runStart) {
    if (RUN_KEYS[entry.runKind]) d.runs[RUN_KEYS[entry.runKind]] += 1;
    d.runs[entry.source === 'automatic' ? 'automatic' : 'manual'] += 1;
  }
  const key = entry.correction?.key;
  if (key && !NOT_CATEGORY.has(key)) d.corrected[CORRECTION_KEYS[key] ?? 'category'] += 1;
  if (entry.scores) {
    if (entry.review) d.review += 1;
    if (entry.decidedBy === 'surface') d.depth.surface += 1;
    if (entry.decidedBy === 'full') d.depth.deep += 1;
    const times = (entry.passes ?? []).map((p) => p.ms).filter((ms) => typeof ms === 'number' && ms >= 0);
    if (times.length && LATENCY_PROVIDERS.includes(entry.provider)) {
      d.latency[entry.provider][latencyBucket(times.reduce((a, b) => a + b, 0))] += 1;
    }
  }
  if (entry.undo) {
    d.undo.runs += Number(entry.undo.runs) || 0;
    d.undo.messages += Number(entry.undo.messages) || 0;
  }
}

/** ISO time before which entries are removed. */
export function retentionCutoff(retentionDays, now = Date.now()) {
  return new Date(now - retentionDays * DAY_MS).toISOString();
}

export function emptySummary(month) {
  return {
    month, messages: 0, tokens: 0, costUsd: 0, costKnownMessages: 0, byCategory: {}, applied: 0,
    person: 0, needsReply: 0, toDo: 0, junk: 0,
  };
}

/** Adds an entry to its month's summary (entries countsInSummary rejects are ignored). */
export function addToSummary(summary, entry) {
  if (!countsInSummary(entry)) return summary;
  // Applied later from "Review this run": the message was already counted by its preview.
  if (entry.reviewOf) {
    if (entry.applied) summary.applied += 1;
    return summary;
  }
  addDetail(summary, entry);
  if (!entry.scores) return summary;
  summary.messages += 1;
  summary.tokens += Number(entry.inputTokens) || 0;
  // A message kept from the AI had no AI cost to know: not counted as "cost known".
  if (typeof entry.costUsd === 'number' && entry.passes?.length !== 0) {
    summary.costUsd += entry.costUsd;
    summary.costKnownMessages += 1;
  }
  const category = entry.category ?? (entry.review ? 'Review' : 'none');
  summary.byCategory[category] = (summary.byCategory[category] ?? 0) + 1;
  if (entry.runKind === 'applied' && entry.applied) summary.applied += 1;
  const tags = entry.tags ?? [];
  // Summaries saved by earlier versions lack these counters.
  if (tags.includes(REAL_PERSON_TAG)) summary.person = (summary.person ?? 0) + 1;
  if (tags.includes(NEEDS_REPLY_TAG)) summary.needsReply = (summary.needsReply ?? 0) + 1;
  if (entry.toDo) summary.toDo = (summary.toDo ?? 0) + 1;
  if (entry.junk) summary.junk = (summary.junk ?? 0) + 1;
  return summary;
}

export function summaryMonth(entry) {
  return monthKey(new Date(entry.at));
}

export const CSV_COLUMNS = [
  ['time', (e) => e.at],
  ['time_local', (e) => localTime(e.at)],
  ['source', (e) => e.source ?? 'manual'],
  ['run', (e) => e.runKind ?? ''],
  ['depth', (e) => e.mode ?? ''],
  ['decided_by', (e) => e.decidedBy ?? ''],
  ['category', (e) => e.category ?? ''],
  ['tags', (e) => (e.tags ?? []).join(' ')],
  ['review', (e) => (e.scores ? String(Boolean(e.review)) : '')],
  ['category_choice', (e) => e.scores?.categoryChoice ?? ''],
  ['category_probability', (e) => e.scores?.categoryProbability ?? ''],
  ['category_confidence', (e) => e.scores?.categoryConfidence ?? ''],
  ['person', (e) => e.scores?.person ?? ''],
  ['needs_reply', (e) => e.scores?.needsReply ?? ''],
  ['to_do', (e) => e.scores?.toDo ?? ''],
  ['junk', (e) => e.scores?.junk ?? ''],
  ['is_junk', (e) => (e.scores ? String(Boolean(e.junk)) : '')],
  ['reasons', (e) => (e.reasons ?? []).join('; ')],
  ['input_tokens', (e) => e.inputTokens ?? ''],
  ['passes', (e) => (e.passes ?? []).map((p) => `${p.kind}:${p.inputTokens ?? '?'}`).join(' ')],
  ['cost_usd', (e) => e.costUsd ?? ''],
  ['cost_source', (e) => e.costSource ?? ''],
  ['changes', (e) => (e.applied?.changes ?? []).join(' ')],
  ['skipped', (e) => e.skipped ?? ''],
  ['error', (e) => (e.error ? `${e.error.kind}: ${e.error.message}` : e.applyError ?? '')],
  ['notice', (e) => e.notice ?? ''],
  ['correction_tag', (e) => e.correction?.tag ?? ''],
  ['correction_change', (e) => e.correction?.change ?? ''],
  ['message_id', (e) => e.headerMessageId ?? ''],
  ['from', (e) => e.from ?? ''],
  ['subject', (e) => e.subject ?? ''],
  ['model', (e) => e.model ?? ''],
];

// Text starting with = + - or @ (even after spaces, tabs or line breaks,
// which some spreadsheets skip) could run as a formula; a leading apostrophe
// makes spreadsheets show it as plain text.
function csvSafe(value) {
  const text = String(value ?? '');
  return typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = csvSafe(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CORRECTION_COLUMNS = ['at', 'tag', 'change', 'score', 'category'];

/** CSV text (with header row) for the long-term corrections table. */
export function correctionsToCsv(rows) {
  const lines = [CORRECTION_COLUMNS, ...rows.map((r) => CORRECTION_COLUMNS.map((c) => r[c]))];
  return `${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** CSV text (with header row) for activity entries. */
export function toCsv(entries) {
  const rows = [CSV_COLUMNS.map(([name]) => name)];
  for (const entry of entries) rows.push(CSV_COLUMNS.map(([, get]) => get(entry)));
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
