// SPDX-License-Identifier: PolyForm-Shield-1.0.0

import { readRecent, readAll, readSummaries, clearLog, readDebug } from '../../storage/activity-log.js';
import { loadSettings, setAutomationEnabled } from '../../storage/settings.js';
import { readQueue, readUsage, readStatus, updateStatus } from '../../storage/state.js';
import { formatUsd, formatTokens } from '../../core/cost.js';
import { DEPTH_LABELS } from '../../core/depth.js';
import { monthKey, estimatedMonthCostUsd } from '../../core/budget.js';
import { toCsv } from '../../core/history.js';
import { fileStamp } from '../../core/time.js';
import {
  ACTIVITY_UPDATED, RUN_NOW, STOP_RUNS, SCHEDULE_ALARM, RUN_PROGRESS_KEY, CLASSIFY_IDS,
} from '../../core/protocol.js';
import { correctedText } from '../../core/run-summary.js';
import { findMessageHeader } from '../../mail/messages.js';
import { $, el, download, icon, askDialog, notify } from '../shared/ui.js';
import { runUndo, undoLastRun } from '../shared/undo-last.js';
import { showPage, OPTIONS_PAGE } from '../shared/pages.js';
import { automationState } from '../../core/automation.js';
import { applyReviewed, reviewable, reviewKey, reviewSummary } from '../../mail/apply-reviewed.js';
import { TAG_NAME_PREFIX, REAL_PERSON_TAG, NEEDS_REPLY_TAG, JUNK_TAG } from '../../core/tags.js';

const PAGE_SIZE = 200;

const chip = (text) => el('span', { className: 'chip' }, text);

const percent = (value) => `${Math.round(value * 100)}%`;
const SCORE_FOR_TAG = { [REAL_PERSON_TAG]: 'person', [NEEDS_REPLY_TAG]: 'needsReply', [JUNK_TAG]: 'junk' };

/** Preen's score behind a tag (the category's probability, or the question's score), or null. */
function tagScore(tag, entry) {
  const s = entry.scores ?? {};
  const value = entry.category && tag === TAG_NAME_PREFIX + entry.category ? s.categoryProbability : s[SCORE_FOR_TAG[tag]];
  return typeof value === 'number' ? value : null;
}

/** A tag with its score as a percentage, e.g. "Preen/To-do 86%". */
function scoredChip(tag, entry) {
  const score = tagScore(tag, entry);
  return chip(score === null ? tag : `${tag} ${percent(score)}`);
}

/**
 * Chips for what Preen decided without a tag: To-do (with its score), Review and
 * Sensitive. They come from the decision data stored with the entry.
 */
function decisionChips(entry) {
  const s = entry.scores ?? {};
  return [
    entry.toDo ? chip(typeof s.toDo === 'number' ? `To-do ${percent(s.toDo)}` : 'To-do') : null,
    entry.review ? chip('Review') : null,
    entry.sensitive ? chip('Sensitive') : null,
  ].filter(Boolean);
}

/** Tag chips and decision chips, or a "no tags" note when there are none. */
function outcomeChips(entry) {
  const chips = [...entry.tags.map((t) => scoredChip(t, entry)), ...decisionChips(entry)];
  return chips.length ? chips : [el('span', { className: 'muted' }, 'no tags')];
}

/** The category Preen leaned to and how likely the model rated it, also when it wasn't applied. */
function confidenceLine(entry) {
  const s = entry.scores;
  if (!s?.categoryChoice || typeof s.categoryProbability !== 'number') return null;
  return el('div', { className: 'confidence' }, `Category: ${s.categoryChoice} (${percent(s.categoryProbability)})`);
}

/** The first reason as one line; any others behind "more". */
function reasonLines(reasons) {
  if (!reasons?.length) return [];
  const [first, ...rest] = reasons;
  return [
    el('div', { className: 'reason why' }, first),
    rest.length ? el('details', { className: 'more-reasons' }, el('summary', {}, `${rest.length} more`),
      ...rest.map((x) => el('div', { className: 'reason' }, x))) : null,
  ];
}

// Newer entries store sender and subject; older ones are looked up live.
// Rows appear at once with a placeholder; subjects are filled in a few at a
// time. After a restart every lookup is a search, so this keeps the page quick.
const SUBJECT_LOOKUPS_AT_ONCE = 4;
const headerCache = new Map(); // Message-ID (or message ID) → Promise<header|null>
const lookupQueue = [];
let lookupsRunning = 0;

const LOOKUP_FAILED = Symbol('lookup failed');

function lookupHeader(entry) {
  const key = entry.headerMessageId || `id:${entry.messageId}`;
  if (!headerCache.has(key)) {
    headerCache.set(key, new Promise((resolve) => {
      lookupQueue.push(() => findMessageHeader(entry.messageId, entry.headerMessageId).then(resolve, (e) => {
        console.warn('Preen: could not look up a message', e);
        headerCache.delete(key); // a later render may succeed
        resolve(LOOKUP_FAILED);
      }));
      pumpLookups();
    }));
  }
  return headerCache.get(key);
}

function pumpLookups() {
  while (lookupsRunning < SUBJECT_LOOKUPS_AT_ONCE && lookupQueue.length) {
    lookupsRunning++;
    lookupQueue.shift()().finally(() => {
      lookupsRunning--;
      pumpLookups();
    });
  }
}

const subjectCell = (subject, from) =>
  [el('div', { className: 'subject' }, subject || '(no subject)'), el('div', { className: 'from' }, from ?? '')];

function describeMessage(entry) {
  if (entry.messageId === undefined && !entry.headerMessageId) return null;
  // Newer entries carry their own sender and subject; older ones are looked up.
  if (typeof entry.subject === 'string') return el('div', {}, ...subjectCell(entry.subject, entry.from));
  const cell = el('div', { className: 'muted' }, '…');
  lookupHeader(entry).then((m) => {
    if (m === LOOKUP_FAILED) {
      cell.replaceChildren('(could not load the message)');
      return;
    }
    if (!m) {
      cell.replaceChildren('(message no longer available)');
      return;
    }
    cell.className = '';
    cell.replaceChildren(...subjectCell(m.subject, m.author));
  });
  return cell;
}

const PASS_LABELS = { surface: 'metadata', full: 'with text' };

function undoControl(entry) {
  if (!entry.applied?.changes?.length) return null;
  if (entry.undoneAt) return el('div', { className: 'undone' }, `Undone ${new Date(entry.undoneAt).toLocaleString()}`);
  const button = el('button', { type: 'button', className: 'link', textContent: 'Undo' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    await undoAndReport([entry]);
  });
  return button;
}

async function undoAndReport(entries) {
  const { ok, text } = await runUndo(entries);
  if (!ok) await notify('Undo', text);
  render();
}

const RUN_LABELS = { applied: 'Applied', 'dry run': 'Dry run (no changes)', preview: 'Preview (no changes)' };

function runLine(entry) {
  const kind = entry.runKind ?? 'preview';
  const source = entry.source === 'automatic' ? 'Automatic · ' : '';
  let review = null;
  if (entry.runId && reviewable(entry)) {
    review = el('button', { type: 'button', className: 'link', textContent: 'Review this run' });
    review.addEventListener('click', () => openReview(entry.runId));
  }
  return el('div', { className: kind === 'applied' ? 'run applied' : 'run' }, source + (RUN_LABELS[kind] ?? kind), review ? ' · ' : null, review);
}

// --- Review this run (preview / dry run) --------------------------------------

let reviewRunId = null;
const reviewSkipped = new Set(); // rows the user chose to skip, for this page only

async function reviewState() {
  const recent = await readRecent(5000);
  const done = new Set(recent.map((e) => e.reviewOf).filter(Boolean));
  const entries = recent.filter((e) => e.runId === reviewRunId && reviewable(e));
  return { entries, done };
}

function rowStatus(entry, done) {
  if (done.has(reviewKey(entry))) return 'applied';
  return reviewSkipped.has(reviewKey(entry)) ? 'skipped' : 'pending';
}

async function applyAndReport(entries) {
  let summary;
  try {
    summary = reviewSummary(await applyReviewed(entries));
  } catch (e) {
    summary = `Could not apply: ${e.message}`;
  }
  $('reviewNote').textContent = summary;
  await render();
}

async function renderReview() {
  $('review').hidden = !reviewRunId;
  if (!reviewRunId) return;
  const { entries, done } = await reviewState();
  const pending = entries.filter((e) => rowStatus(e, done) === 'pending');
  $('reviewTitle').textContent = `Review this run: ${entries.length} message${entries.length === 1 ? '' : 's'}`;
  $('reviewApplyAll').disabled = pending.length === 0;
  $('reviewRows').replaceChildren(...entries.map((entry) => {
    const status = rowStatus(entry, done);
    let actions;
    if (status === 'pending') {
      const apply = el('button', { type: 'button', className: 'btn', textContent: 'Apply' });
      apply.addEventListener('click', async () => {
        apply.disabled = true;
        await applyAndReport([entry]);
      });
      const skip = el('button', { type: 'button', className: 'btn ghost', textContent: 'Skip' });
      skip.addEventListener('click', () => {
        reviewSkipped.add(reviewKey(entry));
        renderReview();
      });
      actions = el('div', { className: 'review-row-actions' }, apply, skip);
    } else {
      actions = el('span', { className: 'muted' }, status === 'applied' ? 'Applied' : 'Skipped');
    }
    return el('tr', { className: `review-row ${status}` },
      el('td', {}, ...subjectCell(entry.subject, entry.from)),
      el('td', {}, el('div', { className: 'reason' }, 'Would do'),
        ...outcomeChips(entry),
        ...reasonLines(entry.reasons).slice(0, 1)),
      el('td', {}, actions));
  }));
}

function openReview(runId) {
  reviewRunId = runId;
  reviewSkipped.clear();
  $('reviewNote').textContent = '';
  renderReview();
  $('review').scrollIntoView?.({ block: 'start' });
}

function depthLine(entry) {
  if (!entry.mode) return null;
  const how = entry.decidedBy === 'local'
    ? 'not sent to the AI (checked on this computer)'
    : entry.decidedBy === 'full'
      ? (entry.passes?.length > 1 ? 'needed message text' : 'with message text')
      : 'metadata only';
  return el('div', { className: 'reason' }, `${DEPTH_LABELS[entry.mode] ?? entry.mode}: ${how}`);
}

function fmtScore(label, value) {
  return value === null || value === undefined ? null : el('div', {}, `${label} ${value.toFixed(2)}`);
}

/** The stored request and response of a debug-mode row, exactly as sent and received. */
function rawExchange(records) {
  return el('details', { className: 'raw' }, el('summary', {}, 'View raw exchange'),
    ...records.flatMap((r) => [
      el('div', { className: 'reason' }, `${new Date(r.at).toLocaleString()} · HTTP ${r.status ?? '—'} · ${r.ms} ms${r.model ? ` · ${r.model}` : ''}${r.error ? ` · ${r.error}` : ''}`),
      el('div', { className: 'reason' }, 'Request'),
      el('pre', { className: 'raw-request' }, r.request),
      el('div', { className: 'reason' }, 'Response'),
      el('pre', { className: 'raw-response' }, r.response ?? '(no response)'),
    ]));
}

async function renderRow(entry) {
  const time = new Date(entry.at).toLocaleString();
  const message = describeMessage(entry);

  let outcome;
  if (entry.notice) outcome = el('span', { className: 'warn' }, entry.notice);
  else if (entry.error) outcome = el('span', { className: 'err' }, `Error (${entry.error.kind}): ${entry.error.message}`);
  else if (entry.skipped) {
    outcome = el('span', { className: entry.limitReason ? 'warn' : 'muted' },
      `Not processed: ${entry.skipped}${entry.limitReason ? ` — ${entry.limitReason}` : ''}`);
  }
  else {
    outcome = el('div', {},
      runLine(entry),
      entry.runKind === 'applied' ? null : el('span', { className: 'reason would' }, 'Would do: '),
      ...outcomeChips(entry),
      confidenceLine(entry),
      depthLine(entry),
      entry.applied ? el('div', { className: 'reason' }, `Changed: ${entry.applied.changes.join(', ') || 'nothing (already up to date)'}`) : null,
      undoControl(entry),
      entry.applyError ? el('div', { className: 'err' }, `Could not update message: ${entry.applyError}`) : null,
      ...reasonLines(entry.reasons),
    );
  }

  const s = entry.scores;
  const scores = s
    ? el('div', { className: 'scores' },
      s.categoryChoice ? el('div', {}, `${s.categoryChoice} ${s.categoryProbability?.toFixed(2) ?? '?'}`) : null,
      fmtScore('conf', s.categoryConfidence),
      fmtScore('person', s.person),
      fmtScore('reply', s.needsReply),
      fmtScore('to-do', s.toDo),
      fmtScore('junk', s.junk))
    : '';

  const signals = entry.signals
    ? el('div', {},
      ...(entry.signals.service ?? []).map((x) => el('div', { className: 'reason' }, `⚙ ${x}`)),
      ...(entry.signals.person ?? []).map((x) => el('div', { className: 'reason' }, `👤 ${x}`)),
      entry.signals.mailingList ? el('div', { className: 'reason' }, '✉ mailing list') : null)
    : '';

  const hasUsage = entry.inputTokens !== undefined && !entry.error && !entry.skipped;
  const passes = entry.passes ?? [];
  const passLines = passes.length > 1
    ? passes.map((p) => el('div', { className: 'reason' }, `${PASS_LABELS[p.kind] ?? p.kind}: ${formatTokens(p.inputTokens)}`))
    : [];
  const usage = hasUsage
    ? el('div', { className: 'scores' },
      el('div', {}, `${formatTokens(entry.inputTokens)} tokens`),
      ...passLines,
      entry.costUsd !== null && entry.costUsd !== undefined
        ? el('div', { className: 'reason' }, `${formatUsd(entry.costUsd)}${entry.costSource === 'provider' ? '' : ' (your price)'}`)
        : null,
      entry.truncated ? el('div', { className: 'reason' }, 'text shortened') : null)
    : '';

  const debug = entry.debugId ? await readDebug(entry.debugId).catch((e) => { console.warn('Preen: could not read a debug record', e); return []; }) : [];

  return el('tr', {},
    el('td', { className: 'time' }, time),
    el('td', { className: 'message' }, message ?? ''),
    el('td', {}, outcome, debug.length ? rawExchange(debug) : null),
    el('td', {}, scores),
    el('td', {}, signals),
    el('td', {}, usage));
}

const tile = (value, label) =>
  el('div', { className: 'card' }, el('div', { className: 'value' }, value), el('div', { className: 'label' }, label));

// "This month" figures come from the monthly summary, which outlives old entries.
function renderSummary(summary) {
  const n = summary?.messages ?? 0;
  const tokens = summary?.tokens ?? 0;
  const known = summary?.costKnownMessages ?? 0;
  $('summary').replaceChildren(...[
    tile(String(n), 'messages this month'),
    tile(formatTokens(tokens), 'tokens this month'),
    tile(n ? formatTokens(tokens / n) : '–', 'avg tokens / message'),
    tile(n ? formatTokens((tokens / n) * 10000) : '–', 'tokens per 10,000 messages'),
    tile(String(summary?.person ?? 0), 'Real person'),
    tile(String(summary?.needsReply ?? 0), 'Needs reply'),
    tile(String(summary?.toDo ?? 0), 'To-do'),
    summary?.junk ? tile(String(summary.junk), 'Junk') : null,
    // Cost from the messages where it's known; the label says when some are left out.
    known ? tile(formatUsd(summary.costUsd), known === n ? 'cost this month' : `cost of ${known} of ${n} messages (rest unknown)`) : null,
  ].filter(Boolean));
}

// --- Charts (one colour; every value is also shown as text) ------------------

const CATEGORY_LABELS = { none: 'No category', Review: 'Review' };

function renderCategoryChart(summary) {
  const rows = Object.entries(summary?.byCategory ?? {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    $('categoryChart').replaceChildren(el('p', { className: 'chart-empty' }, 'No messages classified this month yet.'));
    return;
  }
  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  const max = rows[0][1];
  $('categoryChart').replaceChildren(...rows.map(([name, n]) => {
    const label = CATEGORY_LABELS[name] ?? name;
    const share = Math.round((n / total) * 100);
    const fill = el('div', { className: 'fill' });
    fill.style.width = `${(n / max) * 100}%`;
    return el('div', { className: 'hbar', title: `${label}: ${n} message${n === 1 ? '' : 's'} (${share}%)` },
      el('span', { className: 'name' }, label),
      el('div', { className: 'track' }, fill),
      el('span', { className: 'value' }, String(n)));
  }));
}

const shortMonth = (key) => new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
const longMonth = (key) => new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function lastMonths(count) {
  const keys = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    keys.unshift(monthKey(d));
    d.setMonth(d.getMonth() - 1);
  }
  return keys;
}

function renderMonthChart(summaries) {
  const byMonth = new Map(summaries.map((s) => [s.month, s]));
  const months = lastMonths(12);
  const data = months.map((m) => ({ month: m, tokens: byMonth.get(m)?.tokens ?? 0, messages: byMonth.get(m)?.messages ?? 0 }));
  const max = Math.max(...data.map((d) => d.tokens));
  if (max === 0) {
    $('monthChart').replaceChildren(el('p', { className: 'chart-empty' }, 'No token use recorded yet.'));
    $('monthTable').replaceChildren();
    // Month labels from an earlier render (e.g. before Clear history) go too.
    for (const labels of $('monthChart').parentElement.querySelectorAll('.column-labels')) labels.remove();
    return;
  }
  const last = data.length - 1;
  $('monthChart').replaceChildren(...data.map((d, i) => {
    const bar = el('div', { className: 'bar' });
    bar.style.height = `${(d.tokens / max) * 100}%`;
    return el('div', {
      className: 'column',
      title: `${longMonth(d.month)}: ${formatTokens(d.tokens)} tokens, ${d.messages} message${d.messages === 1 ? '' : 's'}`,
    },
    // Label only the current month; hover or the table gives the rest.
    i === last ? el('span', { className: 'tip' }, formatTokens(d.tokens)) : null,
    bar);
  }));
  const labels = el('div', { className: 'column-labels' }, ...data.map((d) => el('span', {}, shortMonth(d.month))));
  $('monthChart').after(labels);
  $('monthChart').parentElement.querySelectorAll('.column-labels').forEach((node) => {
    if (node !== labels) node.remove();
  });
  $('monthTable').replaceChildren(
    el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Messages'), el('th', {}, 'Tokens')),
    ...data.filter((d) => d.messages || d.tokens).reverse().map((d) =>
      el('tr', {}, el('td', {}, longMonth(d.month)), el('td', {}, String(d.messages)), el('td', {}, formatTokens(d.tokens)))),
  );
}

function limitText(used, limit, format) {
  return limit > 0 ? `${format(used)} of ${format(limit)}` : `${format(used)} (no limit)`;
}

async function renderStatus() {
  const [settings, status, queue, usage] = await Promise.all([loadSettings(), readStatus(), readQueue(), readUsage()]);
  const a = settings.automation;
  const l = settings.limits;
  const enabledAccounts = Object.values(settings.scope.accounts).filter((x) => x.enabled).length;

  let when = { realtime: 'as new mail arrives', scheduled: `every ${a.intervalMinutes} minutes`, manual: 'only on “Run now”' }[a.trigger];
  if (a.enabled && a.trigger === 'scheduled') {
    const alarm = await messenger.alarms.get(SCHEDULE_ALARM).catch(() => null);
    if (alarm?.scheduledTime) when += ` · next ${new Date(alarm.scheduledTime).toLocaleTimeString()}`;
  }
  const auto = automationState(settings);
  const state = {
    on: `On (${when}) · ${enabledAccounts} account${enabledAccounts === 1 ? '' : 's'}${settings.dryRun ? ' · dry run' : ''}`,
    paused: 'Paused',
    off: 'Off: no mailbox is ticked in Settings → Automatic processing',
  }[auto];

  // A right-click or folder run that left messages unprocessed at a limit.
  const skip = status.lastSkipped;
  $('skipBanner').hidden = !skip;
  if (skip) {
    const when = new Date(skip.at).toLocaleString();
    const textNow = `Run at ${when}: ${skip.count} of ${skip.total} message${skip.total === 1 ? '' : 's'} `
      + `${skip.count === 1 ? 'was' : 'were'} not processed. ${skip.reason}`;
    // Rewritten only when it changes: the status redraws after every message.
    if ($('skipText').textContent !== textNow) $('skipText').textContent = textNow;
  }

  // The 7-day trial finished: show its review once.
  if (status.reviewRun?.runId) {
    const { runId } = status.reviewRun;
    await updateStatus({ reviewRun: null }).catch((e) => console.warn('Preen: could not clear the review request', e));
    openReview(runId);
  }

  // Classify left messages alone because the user corrected them.
  const corrected = status.lastCorrected;
  $('correctedBanner').hidden = !corrected;
  if (corrected) {
    const textNow = `Run at ${new Date(corrected.at).toLocaleString()}: ${correctedText(corrected.ids.length)}`;
    if ($('correctedText').textContent !== textNow) $('correctedText').textContent = textNow;
  }

  const last = status.lastRun;
  const lastText = last
    ? `${new Date(last.at).toLocaleString()}: ${last.note ?? `${last.classified} classified, ${last.failed ?? 0} failed, ${last.dropped ?? 0} dropped`}`
    : 'none yet';

  const line = (label, value, className = '') =>
    el('div', { className: `status-line ${className}` }, el('span', { className: 'label' }, label), el('span', {}, value));
  $('status').replaceChildren(...[
    line('Automatic processing', state, auto === 'on' ? '' : 'warn'),
    line('Waiting in queue', String(queue.length)),
    line('Today', `${limitText(usage.dayMessages, l.dailyMessages, String)} messages · ${formatTokens(usage.dayTokens)} tokens`),
    line('This month', `${formatTokens(usage.monthTokens)} tokens${
      typeof l.monthlyCostUsd === 'number' && estimatedMonthCostUsd(usage, settings) !== null
        ? ` · about ${formatUsd(estimatedMonthCostUsd(usage, settings))} of ${formatUsd(l.monthlyCostUsd)} (estimated)` : ''}`),
    line('Last run', lastText),
    status.blockedReason ? line('Limit', status.blockedReason, 'warn') : null,
    status.lastError ? line('Problem', status.lastError, 'err') : null,
  ].filter(Boolean));
  $('debugBanner').hidden = !settings.debug.enabled;
  $('toggle').textContent = a.enabled ? 'Pause' : 'Resume';
  $('toggle').hidden = auto === 'off'; // nothing to pause until a mailbox is ticked
  // Status chips: automatic processing, plus dry run only while it is on (it is off by default).
  $('dryChip').hidden = !settings.dryRun;
  $('dryChip').replaceChildren(icon('check'), el('strong', {}, 'Dry run on'), ' — never changes messages');
  $('autoChip').className = `pchip ${auto === 'on' ? 'ok' : 'warn'}`;
  $('autoChip').replaceChildren(icon(auto === 'on' ? 'check' : 'pause'), el('strong', {}, `Automatic processing ${auto}`));
}

let shown = [];

async function render() {
  const summaries = await readSummaries();
  const recent = await readRecent(Math.max(PAGE_SIZE, shown.length));
  shown = recent;
  const thisMonth = summaries.find((s) => s.month === monthKey());
  renderSummary(thisMonth);
  renderCategoryChart(thisMonth);
  renderMonthChart(summaries);
  const rows = await Promise.all(recent.map(renderRow));
  $('rows').replaceChildren(...rows);
  $('empty').hidden = recent.length > 0;
  $('more').hidden = recent.length < PAGE_SIZE;
  await renderReview();
  await renderStatus();
}

async function showMore() {
  const older = await readRecent(PAGE_SIZE, shown.at(-1)?.seq ?? null);
  shown = shown.concat(older);
  $('rows').append(...(await Promise.all(older.map(renderRow))));
  $('more').hidden = older.length < PAGE_SIZE;
}

function exportFile(filename, text, type) {
  download(filename, text, type);
  // The download starts without a dialog, so say where it goes. Preen can't see
  // whether it finished, so this says "started".
  $('exportNote').textContent = `Export started: ${filename} goes where Thunderbird saves downloads (usually your Downloads folder).`;
  $('exportNote').hidden = false;
  clearTimeout(exportNoteTimer);
  exportNoteTimer = setTimeout(() => { $('exportNote').hidden = true; }, 20000);
}
let exportNoteTimer = null;


$('settings').addEventListener('click', () => showPage(OPTIONS_PAGE));
$('skipSettings').addEventListener('click', () => showPage(OPTIONS_PAGE));
$('skipDismiss').addEventListener('click', async () => {
  $('skipBanner').hidden = true;
  await updateStatus({ lastSkipped: null }).catch((e) => console.warn('Preen: could not dismiss the note', e));
});
$('correctedDismiss').addEventListener('click', async () => {
  $('correctedBanner').hidden = true;
  await updateStatus({ lastCorrected: null }).catch((e) => console.warn('Preen: could not dismiss the note', e));
});
$('correctedAnyway').addEventListener('click', async () => {
  const { lastCorrected: corrected } = await readStatus();
  if (!corrected) return;
  await updateStatus({ lastCorrected: null });
  await messenger.runtime.sendMessage({
    type: CLASSIFY_IDS, ids: corrected.ids, apply: corrected.apply, selected: corrected.ids.length, anyway: true,
  });
});
$('clear').addEventListener('click', async () => {
  const yes = await askDialog({
    title: 'Delete the activity history?',
    message: 'Monthly token summaries are kept.',
    confirmLabel: 'Delete history',
    cancelLabel: 'Keep it',
    danger: true,
  });
  if (!yes) return;
  await clearLog();
  shown = [];
  render();
});
$('more').addEventListener('click', showMore);
$('reviewClose').addEventListener('click', () => {
  reviewRunId = null;
  renderReview();
});
$('reviewApplyAll').addEventListener('click', async () => {
  const { entries, done } = await reviewState();
  const pending = entries.filter((e) => rowStatus(e, done) === 'pending');
  if (!pending.length) return;
  const yes = await askDialog({
    title: `Apply Preen's decisions to ${pending.length} message${pending.length === 1 ? '' : 's'}?`,
    message: 'Tags, flags and read state change as shown. Skipped rows are left alone. You can undo this afterwards.',
    confirmLabel: 'Apply all',
    cancelLabel: 'Not now',
  });
  if (yes) await applyAndReport(pending);
});
$('undoLast').addEventListener('click', async () => {
  const { outcome, ok, text } = await undoLastRun();
  if (outcome === 'none' || (outcome === 'done' && !ok)) await notify('Undo', text);
  if (outcome === 'done') render();
});
$('exportCsv').addEventListener('click', async () => {
  exportFile(`preen-history-${fileStamp()}.csv`, toCsv(await readAll()), 'text/csv');
});
$('exportJson').addEventListener('click', async () => {
  exportFile(`preen-history-${fileStamp()}.json`, JSON.stringify(await readAll(), null, 2), 'application/json');
});
$('stop').addEventListener('click', async () => {
  const button = $('stop');
  button.disabled = true;
  try {
    await messenger.runtime.sendMessage({ type: STOP_RUNS });
  } finally {
    button.disabled = false;
  }
});

$('runNow').addEventListener('click', async () => {
  const button = $('runNow');
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const result = await messenger.runtime.sendMessage({ type: RUN_NOW });
    if (result?.error) await notify('Run failed', result.error);
  } finally {
    button.disabled = false;
    button.textContent = 'Run now';
    render();
  }
});
$('toggle').addEventListener('click', async () => {
  const settings = await loadSettings();
  await setAutomationEnabled(!settings.automation.enabled);
});

messenger.runtime.onMessage.addListener((message) => {
  if (message?.type === ACTIVITY_UPDATED) render();
});
const RUN_KIND_VERB = { preview: 'Previewing', 'dry run': 'Dry run', applied: 'Classifying' };

/** The run in progress: "Previewing 340 of 1,080 (31%)" with a bar; hidden when nothing runs. */
function renderProgress(progress) {
  const show = Boolean(progress?.total);
  $('runProgress').hidden = !show;
  if (!show) return;
  const share = Math.min(1, progress.done / progress.total);
  $('runProgressText').textContent = `${RUN_KIND_VERB[progress.kind] ?? 'Running'} ${progress.done.toLocaleString()} of `
    + `${progress.total.toLocaleString()} (${Math.round(share * 100)}%)`;
  $('runProgressBar').value = share;
}

messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings || changes.status || changes.queue || changes.usage) renderStatus();
  if (changes[RUN_PROGRESS_KEY]) renderProgress(changes[RUN_PROGRESS_KEY].newValue);
});

// The sticky top bar's height varies (chips, narrow windows); "Review this run" scrolls in below it.
const header = document.querySelector('header.topbar');
const setHeadHeight = () => document.documentElement.style.setProperty('--head-h', `${header.offsetHeight}px`);
setHeadHeight();
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(setHeadHeight).observe(header);

// No stored progress resolves to undefined (bar stays hidden); only a failed read lands in the catch.
messenger.storage.local.get(RUN_PROGRESS_KEY).then((s) => renderProgress(s[RUN_PROGRESS_KEY]))
  .catch((e) => console.warn('Preen: could not read the run progress', e));
render();
