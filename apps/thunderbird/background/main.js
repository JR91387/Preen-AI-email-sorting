// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// ============================================================================
// Name:     Jerry Reinitz
// Role:     Software Engineer (Midwest, USA)
// Focus:    Healthcare Intelligence, Clinical Operations & AI Agent Workflows
// Skills:   Rust, PostgreSQL, React, LLM Orchestration
// Website:  https://jerryreinitz.com
// GitHub:   https://github.com/JR91387
// Bio:      Building systems that reduce friction and let computers handle the
//           data, so people can focus on the work that matters.
// Credit:   Conceived, written and managed by Jerry Reinitz, in partnership
//           with large language models from Anthropic (Claude).
// ============================================================================
// Background entry point: registers menu items, events and alarms. All
// listeners are added at the top level so Thunderbird can wake this script.

import { classifyMessages, stopRuns } from './pipeline.js';
import { appendEntries } from '../storage/activity-log.js';
import { loadSettings } from '../storage/settings.js';
import { clearDryRunSeen } from '../storage/processed.js';
import { readQueue, readStatus, readUsage, updateStatus } from '../storage/state.js';
import { skipSummary, CORRECTED } from '../core/run-summary.js';
import { setOverride } from '../storage/overrides.js';
import { folderMessageIds } from '../mail/folders.js';
import { collectPages } from '../mail/paging.js';
import { extractAddress } from '../core/headers.js';
import { badgeState } from '../core/badge.js';
import { budgetStatus, needsConfirm } from '../core/budget.js';
import { selfCheckProblems } from '../core/selfcheck.js';
import { validateSettings } from '../core/settings-schema.js';
import {
  configureAlarms, onNewMail, runQueue, runNow, catchUpAndRun,
} from './scheduler.js';
import { RUN_NOW, CLASSIFY_IDS, CONFIRM_RESULT, STOP_RUNS, SCHEDULE_ALARM, RUN_SOON_ALARM } from '../core/protocol.js';
import { recordTagChange } from './corrections.js';
import { showPage, ACTIVITY_PAGE } from '../ui/shared/pages.js';
import { configureTelemetryAlarm, runTelemetry, TELEMETRY_ALARM } from '../storage/telemetry.js';

const MENU_CLASSIFY = 'preen-classify';
const MENU_CLASSIFY_PREVIEW = 'preen-classify-preview';
const MENU_SENDER = 'preen-sender';
const MENU_FOLDER = 'preen-folder';
// Folder-pane entries: [apply, include subfolders].
const FOLDER_MENUS = {
  'preen-folder-classify': [true, false],
  'preen-folder-classify-sub': [true, true],
  'preen-folder-preview': [false, false],
  'preen-folder-preview-sub': [false, true],
};
const SENDER_RULE_MENUS = {
  'preen-sender-person': 'person',
  'preen-sender-service': 'service',
  'preen-sender-clear': null,
};

function logFailure(what) {
  return (e) => console.error(`Preen: ${what} failed`, e);
}

// --- Toolbar badge -----------------------------------------------------------

async function updateBadge() {
  const [settings, queue, status] = await Promise.all([loadSettings(), readQueue(), readStatus()]);
  const badge = badgeState({ settings, queueLength: queue.length, status });
  await messenger.action.setBadgeText({ text: badge.text });
  await messenger.action.setBadgeBackgroundColor({ color: badge.color });
  await messenger.action.setTitle({ title: badge.title });
}

// --- Menus -------------------------------------------------------------------

// Install and startup can both fire on one launch: building the menus one at a
// time stops the second build from adding entries the first already made.
let menuChain = Promise.resolve();

/**
 * (Re)creates Preen's right-click entries. Called on install or update AND on every
 * startup: whether Thunderbird keeps menu entries between sessions isn't guaranteed,
 * and without them right-click has no Preen at all. A failure is written to the
 * activity log, so it shows up for the user rather than only in the console.
 */
function createMenus() {
  menuChain = menuChain.then(buildMenus);
  return menuChain;
}

// menus.create reports failures through its callback (runtime.lastError), not by throwing.
function addMenu(item) {
  return new Promise((resolve, reject) => {
    messenger.menus.create(item, () => {
      const error = messenger.runtime.lastError;
      if (error) reject(new Error(`${item.id}: ${error.message}`));
      else resolve();
    });
  });
}

async function buildMenus() {
  try {
    await messenger.menus.removeAll();
    await addMenu({ id: MENU_CLASSIFY, title: 'Classify with Preen', contexts: ['message_list'] });
    await addMenu({ id: MENU_CLASSIFY_PREVIEW, title: 'Preview with Preen (no changes)', contexts: ['message_list'] });
    await addMenu({ id: MENU_SENDER, title: 'Preen: this sender is…', contexts: ['message_list'] });
    await addMenu({ id: 'preen-sender-person', parentId: MENU_SENDER, title: 'Always a real person', contexts: ['message_list'] });
    await addMenu({ id: 'preen-sender-service', parentId: MENU_SENDER, title: 'Never a real person', contexts: ['message_list'] });
    await addMenu({ id: 'preen-sender-clear', parentId: MENU_SENDER, title: 'No rule (let Preen decide)', contexts: ['message_list'] });
    await addMenu({ id: MENU_FOLDER, title: 'Preen', contexts: ['folder_pane'] });
    await addMenu({ id: 'preen-folder-classify', parentId: MENU_FOLDER, title: 'Classify this folder', contexts: ['folder_pane'] });
    await addMenu({ id: 'preen-folder-classify-sub', parentId: MENU_FOLDER, title: 'Classify this folder and its subfolders', contexts: ['folder_pane'] });
    await addMenu({ id: 'preen-folder-preview', parentId: MENU_FOLDER, title: 'Preview this folder (no changes)', contexts: ['folder_pane'] });
    await addMenu({ id: 'preen-folder-preview-sub', parentId: MENU_FOLDER, title: 'Preview this folder and its subfolders (no changes)', contexts: ['folder_pane'] });
    return true;
  } catch (e) {
    console.error('Preen: could not create the right-click menus', e);
    await appendEntries([{ at: new Date().toISOString(), error: { kind: 'setup', message: `Couldn't add Preen's right-click menus: ${e.message}` } }])
      .catch(() => {}); // the failure is already logged above; a failing history write must not hide it
    return false;
  }
}

async function recomputeSelfCheck(menusOk) {
  const settings = await loadSettings();
  const { errors } = validateSettings(settings);
  return { settings, problems: selfCheckProblems({ menusOk, settingsErrors: errors }) };
}

let lastMenusOk = true;

/**
 * Startup self-check: menus built and settings valid. A problem shows
 * as "!" on the toolbar button and one line in the activity log; a clean check clears it.
 */
async function selfCheck() {
  const menusOk = await createMenus();
  lastMenusOk = menusOk;
  const { settings, problems } = await recomputeSelfCheck(menusOk);
  await refreshLimitNotice(settings).catch(logFailure('checking limits'));
  await updateStatus({ selfCheck: problems }).catch(logFailure('saving the self-check'));
  if (problems.length) {
    // The badge already shows the problem; a history write failing must not stop startup.
    await appendEntries(problems.map((p) => ({ at: new Date().toISOString(), error: { kind: 'setup', message: `Self-check: ${p}` } })))
      .catch(logFailure('logging the self-check'));
  }
}

async function refreshSettingsCheck() {
  const { settings, problems } = await recomputeSelfCheck(lastMenusOk);
  await updateStatus({ selfCheck: problems });
  await refreshLimitNotice(settings);
}

// The "limit reached" notice would otherwise change only when a run happens, so a raised
// limit (or a new day) still showed "!" until then. Recheck it at startup and
// whenever settings change.
async function refreshLimitNotice(settings) {
  const { reason } = budgetStatus(await readUsage(), settings);
  const { blockedReason = null } = await readStatus();
  if (blockedReason !== reason) await updateStatus({ blockedReason: reason });
}

messenger.runtime.onInstalled.addListener(async ({ reason } = {}) => {
  await selfCheck();
  await configureAlarms(await loadSettings()).catch(logFailure('setting up the schedule'));
  await scheduleTelemetry();
  updateBadge().catch(logFailure('updating the toolbar button'));
  // First install only: open Settings so Getting started and the usage-statistics switch are seen at once.
  if (reason === 'install') await messenger.runtime.openOptionsPage().catch(logFailure('opening Settings'));
});

/** One field of every message in a (possibly paged) message list; ids only, so large selections stay small. */
async function collectField(messageList, field) {
  const values = [];
  await collectPages(messageList, (m) => { values.push(m[field]); });
  return values;
}

function showActivityPage() {
  return showPage(ACTIVITY_PAGE);
}

// --- Asking before large runs ------------------------------------------------
// The run waits in storage, not in memory: Thunderbird may suspend this script
// while the confirm window is open, and the answer (a runtime message) wakes it.

const PENDING_RUN_KEY = 'pendingManualRun';

async function openConfirm(ids, apply, anyway) {
  const usage = await readUsage();
  const perMessage = usage.monthMessages ? usage.monthTokens / usage.monthMessages : 0;
  const tokens = Number.isFinite(perMessage) ? Math.round(perMessage * ids.length) : 0;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Only one large run waits at a time; a newer one replaces an unanswered one.
  // Message ids are small integers (100,000 of them is well under 1 MB), and
  // Thunderbird's storage.local has no small fixed quota; a failed write is still reported.
  try {
    await messenger.storage.local.set({ [PENDING_RUN_KEY]: { id, ids, apply, anyway } });
  } catch (e) {
    await appendEntries([{ at: new Date().toISOString(), error: { kind: 'setup', message: `Couldn't hold ${ids.length} messages for confirmation: ${e.message}` } }]);
    return;
  }
  const url = messenger.runtime.getURL(
    `ui/confirm/confirm.html?id=${encodeURIComponent(id)}&count=${ids.length}&tokens=${tokens}&apply=${apply ? 1 : 0}`,
  );
  try {
    // Generous first size; the page then fits the window to its content.
    await messenger.windows.create({ url, type: 'popup', width: 520, height: 420 });
  } catch (e) {
    await messenger.storage.local.remove(PENDING_RUN_KEY);
    await appendEntries([{ at: new Date().toISOString(), error: { kind: 'setup', message: `Couldn't ask before a large run: ${e.message}` } }]);
  }
}

/** The confirm window's answer: run the stored selection, or note that it was cancelled. */
async function answerConfirm(id, ok) {
  const { [PENDING_RUN_KEY]: run } = await messenger.storage.local.get(PENDING_RUN_KEY);
  if (!run || run.id !== id) return; // already answered, or replaced by a newer run
  await messenger.storage.local.remove(PENDING_RUN_KEY);
  // Started, not awaited: the confirm window waits for this reply before closing,
  // and a large run takes minutes.
  if (ok) runSelection(run.ids, run.apply, run.anyway).catch(logFailure('running the confirmed messages'));
  else await appendEntries([{ at: new Date().toISOString(), notice: `Cancelled: ${run.ids.length} selected messages were not classified.` }]);
}

async function runSelection(ids, apply, anyway = false, review = false) {
  await showActivityPage();
  let results;
  try {
    results = await classifyMessages(ids, { apply, anyway: anyway ? ids : [] });
  } catch (e) {
    await appendEntries([{ at: new Date().toISOString(), error: { kind: 'setup', message: e.message } }]);
    return;
  }
  await noteSkipped(results).catch(logFailure('noting the messages a run left undone'));
  await noteCorrected(results, apply).catch(logFailure('noting the corrected messages a run left alone'));
  // The 7-day trial: the Activity page opens this run's review.
  const runId = results.find((r) => r.runId)?.runId;
  if (review && runId) await updateStatus({ reviewRun: { runId, at: new Date().toISOString() } }).catch(logFailure('opening the review'));
}

/** Messages left alone because the user corrected them: kept so the popup and Activity can offer "Classify anyway". */
async function noteCorrected(results, apply) {
  const ids = results.filter((r) => r.skipped === CORRECTED).map((r) => r.messageId);
  await updateStatus({ lastCorrected: ids.length ? { at: new Date().toISOString(), ids, apply } : null });
}

/** Says plainly when a run left messages unprocessed; a run that left none clears it. */
async function noteSkipped(results) {
  const skip = skipSummary(results);
  if (skip) {
    const at = new Date().toISOString();
    // A limit's own reason usually says where to change it already.
    const hint = skip.kind === 'consent' ? '. Agree in Settings → Provider & cost.'
      : skip.kind === 'limit' && !/Limits & allowance/.test(skip.reason) ? ' Change it in Settings → Limits & allowance.' : '';
    await appendEntries([{ at, notice: `${skip.text}${hint}` }]);
    await updateStatus({ lastSkipped: { at, count: skip.count, total: skip.total, reason: skip.reason, kind: skip.kind } });
  } else {
    await updateStatus({ lastSkipped: null });
  }
}

/**
 * Classifies (or previews) chosen messages and shows the activity page.
 * Every chosen message is taken; large runs are confirmed first (needsConfirm).
 */
async function classifySelection(allIds, { apply, selected = allIds.length, anyway = false }) {
  if (allIds.length === 0) return;
  if (needsConfirm(Math.max(selected, allIds.length))) await openConfirm(allIds, apply, anyway);
  else await runSelection(allIds, apply, anyway);
}

async function saveSenderRule(authors, rule) {
  const addresses = [...new Set(authors.map(extractAddress).filter(Boolean))];
  if (!addresses.length) return;
  await setOverride(addresses, rule);
  const what = rule === 'person' ? 'always a real person' : rule === 'service' ? 'never a real person' : 'decided by Preen (rule removed)';
  await appendEntries([{ at: new Date().toISOString(), notice: `Sender rule: ${addresses.join(', ')} → ${what}.` }]);
}

/** Right-clicked folder(s): every message in them, through the same limits and confirm as a selection. */
async function classifyFolders(folders, apply, subfolders) {
  const ids = new Set();
  const skipped = [];
  for (const folder of folders) {
    try {
      const found = await folderMessageIds(folder, { subfolders });
      found.ids.forEach((id) => ids.add(id));
      skipped.push(...found.skipped);
    } catch (e) {
      await appendEntries([{ at: new Date().toISOString(), error: { kind: 'setup', message: `Couldn't read folder “${folder.name ?? folder.path}”: ${e.message}` } }]);
    }
  }
  if (skipped.length) {
    const shown = skipped.slice(0, 10).join(', ') + (skipped.length > 10 ? ` and ${skipped.length - 10} more` : '');
    await appendEntries([{ at: new Date().toISOString(), notice: `Special subfolders skipped: ${shown}.` }]);
  }
  if (!ids.size) {
    await appendEntries([{ at: new Date().toISOString(), notice: 'That folder has no messages to classify.' }]);
    return;
  }
  await classifySelection([...ids], { apply });
}

messenger.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId in FOLDER_MENUS) {
    const folders = Array.isArray(info.selectedFolders) ? info.selectedFolders : [];
    const [apply, subfolders] = FOLDER_MENUS[info.menuItemId];
    await classifyFolders(folders, apply, subfolders).catch(logFailure('classifying a folder'));
    return;
  }
  if (!info.selectedMessages) return;
  if (info.menuItemId in SENDER_RULE_MENUS) {
    await saveSenderRule(await collectField(info.selectedMessages, 'author'), SENDER_RULE_MENUS[info.menuItemId]);
    return;
  }
  const apply = info.menuItemId === MENU_CLASSIFY;
  if (!apply && info.menuItemId !== MENU_CLASSIFY_PREVIEW) return;
  await classifySelection(await collectField(info.selectedMessages, 'id'), { apply });
});

// --- Automatic processing --------------------------------------------------

// Tag corrections: the user adding or removing a Preen tag is recorded locally.
messenger.messages.onUpdated?.addListener((message, changed) => {
  if (!Array.isArray(changed?.tags)) return;
  const getNames = async () => Object.fromEntries((await messenger.messages.tags.list()).map((t) => [t.key, t.tag]));
  recordTagChange(message, changed.tags, { getNames }).catch(logFailure('recording a tag change'));
});

messenger.messages.onNewMailReceived.addListener((folder, messages) => {
  onNewMail(folder, messages).catch(logFailure('queuing new mail'));
}, false);

// Anonymous usage statistics: due 24 h after first run, then every 7 days. A report missed
// while Thunderbird was closed is sent once at the next startup.
async function scheduleTelemetry() {
  try {
    await runTelemetry();
    await configureTelemetryAlarm(await loadSettings());
  } catch (e) {
    // Statistics must never bother the user: a quiet note for developers, nothing else.
    console.debug('Preen: usage statistics skipped', e);
  }
}

messenger.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TELEMETRY_ALARM) scheduleTelemetry();
  if (alarm.name === SCHEDULE_ALARM) catchUpAndRun().catch(logFailure('scheduled run'));
  if (alarm.name === RUN_SOON_ALARM) runQueue().catch(logFailure('run'));
});

// Catch up on mail that arrived while Thunderbird was closed.
messenger.runtime.onStartup.addListener(async () => {
  // A failed step must not stop the badge and the catch-up below.
  await selfCheck().catch(logFailure('self-check'));
  try {
    await configureAlarms(await loadSettings());
  } catch (e) {
    logFailure('setting up the schedule')(e);
  }
  await scheduleTelemetry();
  updateBadge().catch(logFailure('updating the toolbar button'));
  catchUpAndRun().catch(logFailure('catch-up'));
});

messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings || changes.queue || changes.status) {
    updateBadge().catch(logFailure('updating the toolbar button'));
  }
  if (!changes.settings) return;
  // A fixed setting clears the self-check's settings problem without a restart.
  refreshSettingsCheck().catch(logFailure('checking settings'));
  const before = changes.settings.oldValue;
  const after = changes.settings.newValue;
  // Turning dry run off: mail seen only in dry run gets processed for real.
  if (before?.dryRun && after && !after.dryRun) clearDryRunSeen().catch(logFailure('clearing the dry-run list'));
  loadSettings().then(configureAlarms).catch(logFailure('updating the schedule'));
  if (before?.telemetry?.enabled !== after?.telemetry?.enabled) {
    loadSettings().then((s) => configureTelemetryAlarm(s)).catch(logFailure('updating the usage statistics schedule'));
  }
});

// --- Requests from Preen's pages -------------------------------------------

messenger.runtime.onMessage.addListener((message) => {
  if (message?.type === STOP_RUNS) {
    stopRuns();
    // A large run still waiting for its confirm is dropped too.
    return messenger.storage.local.remove(PENDING_RUN_KEY)
      .then(() => appendEntries([{ at: new Date().toISOString(), notice: 'Stop: Preen finishes the messages already being sent, then stops. Automatic processing stays on; use Pause to stop future runs.' }]))
      .then(() => ({ stopped: true }));
  }
  if (message?.type === RUN_NOW) {
    return runNow().catch((e) => ({ error: e.message }));
  }
  if (message?.type === CONFIRM_RESULT && typeof message.id === 'string') {
    return answerConfirm(message.id, Boolean(message.ok)).catch(logFailure('answering a confirm'));
  }
  if (message?.type === CLASSIFY_IDS && Array.isArray(message.ids)) {
    // Runs in the background so it continues after the popup closes.
    // trial: "Try it on the last 7 days", already confirmed on the page; a preview whose review opens after.
    if (message.trial) {
      runSelection(message.ids, false, false, true).catch(logFailure('previewing the last days'));
      return Promise.resolve({ started: message.ids.length });
    }
    // anyway: "Classify anyway" for messages the user corrected (only the ids sent).
    classifySelection(message.ids, { apply: Boolean(message.apply), selected: message.selected, anyway: Boolean(message.anyway) })
      .catch(logFailure('classifying selected messages'));
    return Promise.resolve({ started: message.ids.length });
  }
  return undefined;
});
