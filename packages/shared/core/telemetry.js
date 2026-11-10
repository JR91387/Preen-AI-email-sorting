// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Not used in this version: usage reports are off and hidden. Kept for when they return.
// Anonymous usage statistics: a weekly report of counts and setting choices.
// The report is built from an explicit allow-list (REPORT_SHAPE), never from
// "the settings minus secrets": no install ID, account IDs, folder paths,
// model name, personal context, languages, notes, sender rules, API key, sender
// or subject, and no time finer than the report's date. Numbers are sent as ranges.
// Category names, descriptions and options are sent only under the separate opt-in
// telemetry.shareCategories (off by default), as the `categorySetup` block: the
// setup only, never message content.

import { PROVIDERS } from '../providers/index.js';
import { DEPTH_MODES } from './depth.js';
import { FOLDER_SCOPES, ACCOUNT_TYPES } from './scope.js';
import { SPEEDS } from './pace.js';
import { DAY_MS, dateStamp } from './time.js';
import { monthKey } from './budget.js';
import { emptyDetail } from './history.js';
import { DEFAULT_SETTINGS, MAX_CATEGORIES, MAX_NAME_LENGTH, DESCRIPTION_LIMIT } from './settings-schema.js';

// No server yet: while empty, nothing is sent (the report is still built and shown).
// Activating: set the URL, add it to host_permissions, update PRIVACY.md.
export const TELEMETRY_URL = '';
export const REPORT_SCHEMA = 2;
export const FIRST_REPORT_AFTER_MS = DAY_MS;
export const REPORT_EVERY_MS = 7 * DAY_MS;
export const NO_SERVER = 'no server';
// A report that couldn't be sent is tried again a day later; its period stays open meanwhile.
export const RETRY_AFTER_MS = DAY_MS;
// A send that takes longer than this is given up (the server may be down or unreachable).
export const SEND_TIMEOUT_MS = 10_000;

const APPEARANCES = ['auto', 'light', 'dark'];
const TRIGGERS = ['realtime', 'scheduled', 'manual'];

// --- Ranges --------------------------------------------------------------------

/** "lo-hi" for the range n falls in; edges are each range's lower bound, the last is open ("lo+"). */
export function range(n, edges, unit = '') {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  let i = edges.length - 1;
  while (i > 0 && v < edges[i]) i--;
  if (v < edges[0]) return `<${edges[0]}${unit}`;
  return i === edges.length - 1 ? `${edges[i]}+${unit}` : `${edges[i]}-${edges[i + 1]}${unit}`;
}

const COUNT_EDGES = [1, 10, 50, 100, 500, 1000, 5000, 10_000, 50_000, 100_000];
const TOKEN_EDGES = [1, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];
const COST_EDGES = [0.01, 0.1, 1, 5, 10, 50, 100];
const SMALL_EDGES = [1, 2, 3, 6, 11, 21];

export const countRange = (n) => range(n, COUNT_EDGES);
export const tokenRange = (n) => range(n, TOKEN_EDGES);
export const costRange = (usd) => range(usd, COST_EDGES);
export const smallRange = (n) => range(n, SMALL_EDGES);
/** Certainty levels in tenths: 0.75 → "0.7-0.8". */
export function levelRange(p) {
  const v = Number(p);
  if (!Number.isFinite(v)) return 'other';
  const lo = Math.min(9, Math.max(0, Math.floor(v * 10 + 1e-9)));
  return `${(lo / 10).toFixed(1)}-${((lo + 1) / 10).toFixed(1)}`;
}

const pick = (value, allowed) => (allowed.includes(value) ? value : 'other');
const bool = (v) => v === true;

// --- Totals --------------------------------------------------------------------

export const TOTAL_FIELDS = ['messages', 'tokens', 'costUsd', 'applied', 'person', 'needsReply', 'toDo', 'junk', 'corrections'];
// Detail counter groups (history.js emptyDetail): errors by kind, skips by reason, run types,
// corrections by tag kind, Review tags, depth, undo and response times. Counts only.
export const DETAIL_GROUPS = Object.keys(emptyDetail());
// Sent as exact numbers; every other detail counter is sent as a range.
const EXACT_GROUPS = new Set(['errors', 'stoppedAfterError']);

/** Adds `src`'s counters into `target`, following emptyDetail()'s keys (others are ignored). */
function addCounts(target, src, shape) {
  for (const [k, v] of Object.entries(shape)) {
    if (typeof v === 'object') addCounts(target[k], src?.[k], v);
    else target[k] += Number(src?.[k]) || 0;
  }
}

/** Maps every counter of a detail shape: fn(now, previous, groupName). */
function mapCounts(shape, now, before, fn, group) {
  return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, typeof v === 'object'
    ? mapCounts(v, now?.[k], before?.[k], fn, group ?? k)
    : fn(Number(now?.[k]) || 0, Number(before?.[k]) || 0, group ?? k)]));
}

/**
 * The user's own running totals, from the monthly summaries (history.js) and the corrections table.
 * @returns {{allTime: object, thisMonth: object, categories: Record<string, number>, since: string|null}}
 */
export function collectTotals({ summaries = [], corrections = [], now = new Date() }) {
  const empty = () => ({ ...Object.fromEntries(TOTAL_FIELDS.map((f) => [f, 0])), ...emptyDetail() });
  const shape = emptyDetail();
  const allTime = empty();
  const thisMonth = empty();
  const categories = {};
  const month = monthKey(now);
  for (const s of summaries) {
    for (const f of TOTAL_FIELDS) {
      if (f === 'corrections') continue;
      allTime[f] += Number(s[f]) || 0;
      if (s.month === month) thisMonth[f] += Number(s[f]) || 0;
    }
    addCounts(allTime, s, shape);
    if (s.month === month) addCounts(thisMonth, s, shape);
    for (const [name, n] of Object.entries(s.byCategory ?? {})) categories[name] = (categories[name] ?? 0) + (Number(n) || 0);
  }
  allTime.corrections = corrections.length;
  thisMonth.corrections = corrections.filter((c) => monthKey(new Date(c.at)) === month).length;
  const months = summaries.filter((s) => s.messages > 0).map((s) => s.month).sort();
  return { allTime, thisMonth, categories, since: months[0] ?? null };
}

// --- Schedule ------------------------------------------------------------------

/** When the next report is due (ms): 24 h after first use, then 7 days after the last report. */
export function nextReportAt(state) {
  if (state?.retryAt) return state.retryAt;
  if (state?.lastReport?.at) return state.lastReport.at + REPORT_EVERY_MS;
  if (state?.firstSeen) return state.firstSeen + FIRST_REPORT_AFTER_MS;
  return null;
}

export function isDue(state, now = Date.now()) {
  const next = nextReportAt(state);
  return next !== null && now >= next;
}

// --- The report ------------------------------------------------------------------

// Every key a report may hold. A leaf is the type its value must have.
// Two markers extend the leaves for the category setup, the only free text a report can hold:
// text(max) is a string of at most `max` characters, list(item, max) an array of at most
// `max` entries that each fit `item` (a leaf or a nested shape).
const TEXT = Symbol('text');
const LIST = Symbol('list');
const text = (max) => ({ [TEXT]: max });
const list = (item, max) => ({ [LIST]: item, max });

export const REPORT_SHAPE = {
  schema: 'number',
  preen: 'string',
  thunderbirdMajor: 'number',
  reportDate: 'string',
  periodDays: 'number',
  period: {
    ...Object.fromEntries(TOTAL_FIELDS.map((f) => [f, 'string'])),
    ...mapCounts(emptyDetail(), null, null, () => 'string'),
  },
  settings: {
    provider: 'string',
    model: 'string',
    appearance: 'string',
    dryRun: 'boolean',
    categoriesOn: 'boolean',
    speed: 'string',
    depthDefault: 'string',
    depthOverrides: 'string',
    questions: { person: 'boolean', needsReply: 'boolean', toDo: 'boolean', junk: 'boolean' },
    localChecks: { sensitive: 'boolean', replacePii: 'boolean' },
    actions: { flagNeedsReply: 'boolean', flagToDo: 'boolean', moveJunk: 'boolean' },
    automation: {
      enabled: 'boolean', unreadOnly: 'boolean', trigger: 'string', intervalMinutes: 'string', maxAgeDays: 'string',
    },
    markProcessedTag: 'boolean',
    debug: 'boolean',
    price: 'string',
    limits: { dailyMessages: 'string', monthlyCost: 'string' },
    historyRetentionDays: 'string',
    thresholds: { category: 'string', realPerson: 'string', needsReply: 'string', toDo: 'string', junk: 'string' },
    categories: {
      count: 'string', withFlag: 'string', withMarkUnread: 'string', noToDo: 'string', ownThreshold: 'string', withExcludes: 'string',
    },
    accounts: {
      automated: 'string',
      withNote: 'string',
      types: Object.fromEntries([...Object.keys(ACCOUNT_TYPES), 'none'].map((k) => [k, 'string'])),
      folders: Object.fromEntries(FOLDER_SCOPES.map((k) => [k, 'string'])),
    },
  },
  // Present only under the separate opt-in telemetry.shareCategories.
  categorySetup: {
    sortOn: 'boolean',
    categories: list({
      name: text(MAX_NAME_LENGTH),
      description: text(DESCRIPTION_LIMIT),
      excludes: text(DESCRIPTION_LIMIT),
      actions: { flag: 'boolean', markUnread: 'boolean' },
      noToDo: 'boolean',
      threshold: 'number',
    }, MAX_CATEGORIES),
    defaultsRemoved: list(text(MAX_NAME_LENGTH), MAX_CATEGORIES),
    defaultsEdited: list(text(MAX_NAME_LENGTH), MAX_CATEGORIES),
  },
};

/** Throws if `report` holds a key outside REPORT_SHAPE, or a value of another type. */
export function assertAllowed(report, shape = REPORT_SHAPE, path = 'report') {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error(`${path} must be an object`);
  for (const [key, value] of Object.entries(report)) {
    const where = `${path}.${key}`;
    if (!Object.hasOwn(shape, key)) throw new Error(`${where} is not in the allow-list`);
    assertValue(value, shape[key], where);
  }
  return report;
}

function assertValue(value, want, where) {
  if (want[TEXT]) {
    if (typeof value !== 'string') throw new Error(`${where} must be a string`);
    if (value.length > want[TEXT]) throw new Error(`${where} is longer than ${want[TEXT]} characters`);
  } else if (want[LIST]) {
    if (!Array.isArray(value)) throw new Error(`${where} must be a list`);
    if (value.length > want.max) throw new Error(`${where} has more than ${want.max} entries`);
    value.forEach((item, i) => assertValue(item, want[LIST], `${where}[${i}]`));
  } else if (typeof want === 'object') {
    assertAllowed(value, want, where);
  } else if (typeof value !== want) {
    throw new Error(`${where} must be a ${want}`);
  } else if (want === 'string' && !/^[a-z0-9.+<-]{1,24}$/i.test(value)) {
    throw new Error(`${where} has a value outside the allowed form`);
  }
}

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The category setup, sent only under telemetry.shareCategories. Configuration only. */
function categorySetup(s) {
  const cats = (Array.isArray(s.categories) ? s.categories : []).filter((c) => c && typeof c === 'object');
  const byName = new Map(cats.map((c) => [norm(c.name), c]));
  const defaults = DEFAULT_SETTINGS.categories;
  const edited = (d, c) => norm(d.description) !== norm(c.description) || norm(d.excludes) !== norm(c.excludes);
  return {
    sortOn: bool(s.categorySort?.enabled !== false),
    categories: cats.slice(0, MAX_CATEGORIES).map((c) => ({
      name: clip(c.name, MAX_NAME_LENGTH),
      description: clip(c.description, DESCRIPTION_LIMIT),
      excludes: clip(c.excludes, DESCRIPTION_LIMIT),
      actions: { flag: c.actions?.flag === true, markUnread: c.actions?.markUnread === true },
      noToDo: c.noToDo === true,
      ...(typeof c.threshold === 'number' && Number.isFinite(c.threshold) ? { threshold: c.threshold } : {}),
    })),
    defaultsRemoved: defaults.filter((d) => !byName.has(norm(d.name))).map((d) => d.name),
    defaultsEdited: defaults.filter((d) => byName.has(norm(d.name)) && edited(d, byName.get(norm(d.name)))).map((d) => d.name),
  };
}

function settingsSnapshot(s) {
  const cats = Array.isArray(s.categories) ? s.categories : [];
  const accounts = Object.values(s.scope?.accounts ?? {});
  const automated = accounts.filter((a) => a?.enabled);
  const types = Object.fromEntries([...Object.keys(ACCOUNT_TYPES), 'none'].map((k) => [k, 0]));
  for (const a of automated) types[a.type in ACCOUNT_TYPES ? a.type : 'none'] += 1;
  const folders = Object.fromEntries(FOLDER_SCOPES.map((k) => [k, 0]));
  for (const a of automated) if (a.folders in folders) folders[a.folders] += 1;
  const count = (f) => smallRange(cats.filter(f).length);
  const t = s.thresholds ?? {};
  return {
    provider: pick(s.provider, Object.keys(PROVIDERS)),
    model: s.model ? 'custom' : 'default',
    appearance: pick(s.appearance, APPEARANCES),
    dryRun: bool(s.dryRun),
    categoriesOn: bool(s.categorySort?.enabled !== false),
    speed: pick(s.speed, SPEEDS),
    depthDefault: pick(s.depth?.default, DEPTH_MODES),
    depthOverrides: smallRange(Object.keys(s.depth?.accounts ?? {}).length),
    questions: {
      person: bool(s.questions?.person), needsReply: bool(s.questions?.needsReply), toDo: bool(s.questions?.toDo), junk: bool(s.questions?.junk),
    },
    localChecks: { sensitive: bool(s.localChecks?.sensitive), replacePii: bool(s.localChecks?.replacePii) },
    actions: { flagNeedsReply: bool(s.actions?.flagNeedsReply), flagToDo: bool(s.actions?.flagToDo), moveJunk: bool(s.actions?.moveJunk) },
    automation: {
      enabled: bool(s.automation?.enabled),
      unreadOnly: bool(s.automation?.unreadOnly),
      trigger: pick(s.automation?.trigger, TRIGGERS),
      intervalMinutes: range(s.automation?.intervalMinutes, [5, 15, 30, 60, 240, 1440]),
      maxAgeDays: range(s.automation?.maxAgeDays, [1, 2, 3, 8, 31, 91]),
    },
    markProcessedTag: bool(s.markProcessed?.tag),
    debug: bool(s.debug?.enabled),
    price: typeof s.pricePerMillionInputTokens === 'number' ? 'set' : 'unset',
    limits: {
      dailyMessages: s.limits?.dailyMessages === 0 ? 'none' : countRange(s.limits?.dailyMessages),
      monthlyCost: typeof s.limits?.monthlyCostUsd === 'number' ? 'set' : 'unset',
    },
    historyRetentionDays: range(s.history?.retentionDays, [1, 7, 30, 90, 91, 366]),
    thresholds: Object.fromEntries(['category', 'realPerson', 'needsReply', 'toDo', 'junk'].map((k) => [k, levelRange(t[k])])),
    categories: {
      count: range(cats.length, [1, 4, 11]),
      withFlag: count((c) => c?.actions?.flag === true),
      withMarkUnread: count((c) => c?.actions?.markUnread === true),
      noToDo: count((c) => c?.noToDo === true),
      ownThreshold: count((c) => typeof c?.threshold === 'number'),
      withExcludes: count((c) => typeof c?.excludes === 'string' && c.excludes.trim() !== ''),
    },
    accounts: {
      automated: smallRange(automated.length),
      withNote: smallRange(accounts.filter((a) => typeof a?.note === 'string' && a.note.trim() !== '').length),
      types: Object.fromEntries(Object.entries(types).map(([k, n]) => [k, smallRange(n)])),
      folders: Object.fromEntries(Object.entries(folders).map(([k, n]) => [k, smallRange(n)])),
    },
  };
}

/**
 * The report for the period since the last one.
 * @param {object} input
 * @param {object} input.settings the saved settings
 * @param {object} input.totals collectTotals(...).allTime now
 * @param {{at: number, totals: object}|null} input.previous the last report's time and totals
 * @param {number} input.firstSeen when Preen first ran (ms), for the first period
 * @param {string} input.version Preen's version
 * @param {number|null} input.thunderbirdMajor
 * @param {number} input.now ms
 */
export function buildReport({ settings, totals, previous = null, firstSeen = null, version, thunderbirdMajor = null, now = Date.now() }) {
  const from = previous?.at ?? firstSeen ?? now;
  const delta = (f) => Math.max(0, (Number(totals?.[f]) || 0) - (Number(previous?.totals?.[f]) || 0));
  const period = Object.fromEntries(TOTAL_FIELDS.map((f) => {
    const n = delta(f);
    return [f, f === 'tokens' ? tokenRange(n) : f === 'costUsd' ? costRange(n) : countRange(n)];
  }));
  Object.assign(period, mapCounts(emptyDetail(), totals, previous?.totals, (now, before, group) => {
    const n = Math.max(0, now - before);
    return EXACT_GROUPS.has(group) ? String(n) : countRange(n);
  }));
  const report = {
    schema: REPORT_SCHEMA,
    preen: String(version ?? 'unknown'),
    thunderbirdMajor: Number.isInteger(thunderbirdMajor) ? thunderbirdMajor : 0,
    reportDate: dateStamp(new Date(now)),
    periodDays: Math.max(0, Math.round((now - from) / DAY_MS)),
    period,
    settings: settingsSnapshot(settings ?? {}),
  };
  // A separate opt-in on top of the statistics switch; both must be on.
  if (settings?.telemetry?.enabled === true && settings?.telemetry?.shareCategories === true) {
    report.categorySetup = categorySetup(settings);
  }
  return assertAllowed(report);
}

/** The totals kept with a sent report, for the next report's deltas. */
export function totalsToKeep(totals) {
  return {
    ...Object.fromEntries(TOTAL_FIELDS.map((f) => [f, Number(totals?.[f]) || 0])),
    ...mapCounts(emptyDetail(), totals, null, (n) => n),
  };
}

/**
 * The totals kept with the last report, lowered to the current totals where those are smaller
 * (after the user resets the statistics), so later growth is counted in full instead of
 * hiding behind the old, larger numbers.
 */
export function rebaseTotals(kept, current) {
  const lower = (before, now) => Math.min(Number(before) || 0, Number(now) || 0);
  return {
    ...Object.fromEntries(TOTAL_FIELDS.map((f) => [f, lower(kept?.[f], current?.[f])])),
    ...mapCounts(emptyDetail(), current, kept, (now, before) => Math.min(now, before)),
  };
}

/**
 * Sends a report. While `url` is empty nothing is fetched. Only HTTPS; no cookies or credentials.
 * Never throws: a failure (no connection, timeout, server error) only comes back as `{sent: false}`.
 * @returns {Promise<{sent: boolean, reason: string|null}>}
 */
export async function sendReport(report, { url = TELEMETRY_URL, fetchImpl = globalThis.fetch, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  if (!url) return { sent: false, reason: NO_SERVER };
  if (!/^https:\/\//.test(url)) return { sent: false, reason: 'not https' };
  if (typeof fetchImpl !== 'function') return { sent: false, reason: 'no network' };
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      signal: abort?.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assertAllowed(report)),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    return res.ok ? { sent: true, reason: null } : { sent: false, reason: `server answered ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e?.name === 'AbortError' ? 'no answer in time' : 'could not connect' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
