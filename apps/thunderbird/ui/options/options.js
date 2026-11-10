// SPDX-License-Identifier: PolyForm-Shield-1.0.0

import { loadSettings, saveSettings, setDebugEnabled } from '../../storage/settings.js';
import { readSummaries, readCorrections, clearCorrections, readAll, readDebugAll, countDebug, clearDebug } from '../../storage/activity-log.js';
import { debugExport, submissionRows, debugSubmission, sendSubmission, SUBMIT_URL } from '../../core/debug.js';
import { correctionsToCsv } from '../../core/history.js';
import { ACTIVITY_UPDATED } from '../../core/protocol.js';
import { suggestLevels, untouchedEntries, MIN_CORRECTIONS } from '../../core/suggest.js';
import {
  validateSettings, mergeWithDefaults, DEFAULT_SETTINGS, DESCRIPTION_LIMIT,
} from '../../core/settings-schema.js';
import { PROVIDERS, resolveProvider, testConnection } from '../../providers/index.js';
import {
  formatUsd, formatTokens, costFromUsage, estimateTokens, costOfTokens, priceFromUsage, averageTokens, costOfEmails, suggestMonthlyLimit,
} from '../../core/cost.js';
import { buildQuestions } from '../../core/questions.js';
import { DEPTH_MODES, DEPTH_LABELS, DEPTH_SHORT } from '../../core/depth.js';
import { isExcludedFolder, ACCOUNT_TYPES } from '../../core/scope.js';
import { createLevelPicker } from '../shared/level-picker.js';
import { percentOfHigh, getPath, setPath } from '../../core/levels.js';
import { automationState, automationRows, dimNote, intervalText } from '../../core/automation.js';
import { $, el, download, icon, reveal, infoTip, updateCounter, setSaveMark, clearPendingMarks, askDialog } from '../shared/ui.js';
import { undoLastRun } from '../shared/undo-last.js';
import { startTrial } from '../shared/trial.js';
import { suggestedLanguages, MAX_LANGUAGES_LENGTH } from '../../core/languages.js';
import { exportSettings, parseSettingsFile } from '../../core/settings-io.js';
import { setupSteps } from '../../core/setup.js';
import { consentText, PRIVACY_PAGE } from '../../core/consent.js';
import { fileStamp } from '../../core/time.js';
import { monthKey } from '../../core/budget.js';
import { PACE } from '../../core/pace.js';
import { createCategoryEditor } from './category-editor.js';
import { SECTION_HELP } from './section-help.js';
import { readOverrides, setOverride, OVERRIDES_KEY } from '../../storage/overrides.js';
import { MOVE_PERMISSION } from '../../mail/folders.js';
import { showPage, ACTIVITY_PAGE } from '../shared/pages.js';
import { readTotals, readTelemetryState, resetStatistics } from '../../storage/telemetry.js';

// Result of the last successful "Test connection", for the setup checklist.
const CONNECTION_TEST_KEY = 'connectionTest';

// Thunderbird's account types, as shown on each account row.
const ACCOUNT_KIND_LABELS = { imap: 'IMAP', pop3: 'POP', nntp: 'News', rss: 'Feeds', none: 'Local', ews: 'Exchange', owl: 'Exchange' };

const FOLDER_OPTIONS = [
  ['inbox', 'Inbox only'],
  ['all', 'All folders'],
  ['selected', 'Only these folders…'],
  ['except', 'All except these…'],
];


// --- Info tips ---------------------------------------------------------------
// All tip texts live here. Each says what the code does with the setting.

const TIPS = {
  history: {
    subject: 'history kept',
    text: 'How long Preen keeps its activity log: entries older than the number of days are removed. ' +
      'Monthly token totals are kept either way.',
  },
  depth: {
    subject: 'depth',
    text: 'Surface sends only the sender, subject, date, attachment names and header hints. Deep adds part of the ' +
      'message text in the same single request: in testing it was clearly more accurate, especially for junk and real ' +
      'people, for only a little more cost.',
  },
  certainty: {
    subject: 'certainty required',
    text: 'How sure Jev must be, on a scale from 0 to 1, before Preen adds the tag. Higher means fewer, safer tags; ' +
      'lower means more tags and more mistakes.',
  },
  allowance: {
    subject: 'daily allowance',
    text: 'The most messages Preen sends in a day. Low, Medium and High set it; Custom shows the box. It applies to every ' +
      'request, automatic or right-click, and is checked before each message. 0 means no limit.',
  },
  categoriesOn: {
    subject: 'categories on or off',
    text: 'Off: Preen asks no category question and gives no category label, which also makes each request smaller. ' +
      'The yes/no checks you turned on still run, so Preen can be used only to catch junk. Your categories are kept for when you turn them back on.',
  },
  monthlyCost: {
    subject: 'estimated monthly cost limit',
    text: 'Preen stops running when this month\'s estimate reaches the limit. The estimate is the tokens Preen counted ' +
      'this month times your price per million input tokens, so it needs a price. Your provider\'s own credit limit is the hard stop.',
  },
  personalContext: {
    subject: 'personal context',
    text: 'A few words about you, sent with every request so Jev can judge mail from your point of view. ' +
      'It shares the category character limit. Leave it empty to send nothing.',
  },
  recipientLanguages: {
    subject: 'languages I read',
    text: 'The languages you read, sent with every request as a hint, not a rule. Filled in from your Thunderbird and ' +
      'browser language settings the first time; change it freely. Empty means nothing is sent.',
  },
  noToDo: {
    subject: 'Never a To-do',
    text: 'Preen won\'t count mail in this category as a To-do (so it is never flagged as one), even if the model thinks it is one. ' +
      'On by default for categories that are rarely a real task, such as codes.',
  },
  sensitive: {
    subject: 'sensitive info',
    text: 'Checked on this computer with fixed patterns. Card and bank numbers must pass their check ' +
      'digits, and dates of birth, passport and licence numbers need their label nearby, so order or phone numbers aren\'t flagged.',
  },
  speed: {
    subject: 'speed',
    text: 'How hard Preen works during a run. Slower speeds send one message at a time and rest between them, so ' +
      'Thunderbird and your computer stay responsive with large folders. It also sets how many waiting messages one ' +
      `automatic run takes: ${PACE.low.runSize}, ${PACE.medium.runSize}, ${PACE.high.runSize} or ${PACE.off.runSize} for Low, Medium, High and No limit.`,
  },
  junk: {
    subject: 'junk',
    text: 'Uses Thunderbird\'s own Junk mark. Preen never deletes mail or clears a junk mark, and moves junk only if you turn that on. ' +
      'Jev is told whether the sender is in your address book.',
  },
  senderRules: {
    subject: 'sender rules',
    text: 'Rules you set with right-click, “Preen: this sender is…”, decide Real person for that sender: they win over ' +
      'Jev\'s answer and save that question. Removing a rule takes effect at once.',
  },
};

/** Puts the info tip for `key` next to `target` (a label or caption), or inside it for a heading. */
function addTip(target, key, subject = TIPS[key].subject) {
  const bubble = infoTip(TIPS[key].text, subject);
  if (target.tagName === 'H4') {
    target.append(bubble);
    return;
  }
  // The tip sits beside the label, not in it, so it doesn't become part of the field's name.
  const row = document.createElement('span');
  row.className = 'label-row';
  target.replaceWith(row);
  row.append(target, bubble);
}

// --- Unsaved changes ------------------------------------------------------

let loading = false;
let dirty = false;
let snapshot = null; // readForm() as last loaded or saved, for the Blotter and Discard
let snapshotValues = new Map(); // control id → the value it showed then
let setupOpen = false; // Getting started shown in full instead of the one-line strip

function setDirty(value) {
  dirty = value;
  $('dirty').hidden = !value;
  if (!value) clearPendingMarks();
  showSaveButton();
  renderBlotter();
}

// The Save button is plain when nothing changed, accented with a dot while
// there are unsaved changes, and shows a check mark for a moment after saving.
const SAVED_FOR_MS = 2000;
let savedTimer = null;

function showSaveButton(saved = false) {
  const button = $('save');
  button.classList.toggle('is-dirty', dirty && !saved);
  button.classList.toggle('is-saved', saved);
  $('draftDot').hidden = !dirty || saved;
  $('saveLabel').textContent = saved ? 'Saved' : 'Save';
  button.querySelector('use').setAttribute('href', saved ? '#i-check' : '#i-save');
}

function flashSaved() {
  clearTimeout(savedTimer);
  showSaveButton(true);
  savedTimer = setTimeout(() => showSaveButton(), SAVED_FOR_MS);
}

// An edit that puts every value back the way it was saved leaves nothing to save.
function markDirty() {
  if (loading) return;
  clearTimeout(savedTimer);
  setDirty(!matchesSnapshot());
}

function matchesSnapshot() {
  if (!snapshot) return false;
  try {
    return blotterRows().length === 0 && JSON.stringify(readForm()) === JSON.stringify(snapshot);
  } catch {
    return false;
  }
}

const categoryEditor = createCategoryEditor($('categories'), {
  noToDoTip: TIPS.noToDo.text,
  onChange: () => {
    updateDescriptionCost();
    markDirty();
  },
  defaultThreshold: () => {
    const n = Number($('tCategory').value);
    return Number.isFinite(n) && $('tCategory').value !== '' ? n : 0.75;
  },
});

// --- Token estimates --------------------------------------------------------

function readPrice() {
  const raw = $('price').value.trim();
  return raw === '' ? null : Number(raw);
}

// " (≈ $0.12 …)" when the user has entered a price, otherwise nothing.
function priceNote(tokens, what) {
  const price = readPrice();
  if (price === null || !Number.isFinite(price)) return '';
  return ` (≈ ${formatUsd(costOfTokens(tokens, price))} ${what} at your price)`;
}

/** Tokens the category question adds to every request (0 without described categories). */
function descriptionTokens() {
  if (!$('categoriesOn').checked) return 0;
  const categories = categoryEditor.get().filter((c) => c.name && c.description?.trim());
  if (!categories.length) return 0;
  const question = buildQuestions({ categories, questions: { person: false, needsReply: false, toDo: false } }).category;
  return estimateTokens(JSON.stringify(question));
}

// Shows roughly what the category question adds to every request.
function updateDescriptionCost() {
  const tokens = descriptionTokens();
  if (!tokens) {
    $('descriptionCost').hidden = true;
  } else {
    $('descriptionCost').hidden = false;
    $('descriptionCost').replaceChildren(icon('info'), el('span', {},
      'Your categories add about ', el('b', {}, `${tokens} tokens`), ' to every request — ' +
      `≈ ${formatTokens(tokens * 10000)} tokens per 10,000 emails` +
      `${priceNote(tokens * 10000, 'per 10,000 emails')}.`));
  }
  updateCostExamples();
}

// Dollars for 100 and 1,000 emails: price × the average tokens per email in the history, or,
// before any history, only what the categories add (a floor, and said so).
let historyAvgTokens = null;

async function loadAverageTokens() {
  try {
    historyAvgTokens = averageTokens(await readSummaries());
  } catch (e) {
    console.warn('Preen: could not read history', e);
    historyAvgTokens = null;
  }
  updateCostExamples();
}

function updateCostExamples() {
  const price = readPrice();
  const avg = historyAvgTokens ?? (descriptionTokens() || null);
  const per = (count) => costOfEmails(avg, price, count);
  const known = per(100) !== null;
  $('costExamples').hidden = !known;
  if (known) {
    const basis = historyAvgTokens
      ? `an estimate from your history: about ${formatTokens(Math.round(avg))} tokens per email`
      : 'Preen has not sorted any mail yet, so this counts only what your categories add. The email itself adds more, '
        + 'so the real figure will be higher';
    $('costExamples').replaceChildren(icon('info'), el('span', {},
      `At your price, sorting costs ${historyAvgTokens ? 'about' : 'at least about'} ${formatUsd(per(100))} per 100 emails `
      + `and ${formatUsd(per(1000))} per 1,000 emails (${basis}).`));
  }
  // A starting monthly limit comes from real history only, and only while the box is empty.
  const limit = historyAvgTokens ? suggestMonthlyLimit(historyAvgTokens, price) : null;
  const show = limit !== null && $('monthlyCost').value.trim() === '';
  $('costSuggest').hidden = !show;
  if (show) {
    $('costSuggestText').textContent = 'A starting limit: about what 1,000 emails cost, rounded up.';
    $('costUse').textContent = `Use ${formatUsd(limit)}`;
    $('costUse').dataset.value = String(limit);
  }
}
$('costUse').addEventListener('click', () => {
  $('monthlyCost').value = $('costUse').dataset.value;
  markDirty();
  updateCostExamples();
});

function updateContextCounter() {
  updateCounter($('personalContext'), $('personalContextCounter'), DESCRIPTION_LIMIT);
}

const LANGUAGES_HELP = 'Sent with every request. Empty: nothing is sent.';
const LANGUAGES_SUGGESTED = 'Suggested from your language settings. Edit it, then click Save to use it.';

function updateLanguagesCounter() {
  updateCounter($('recipientLanguages'), $('recipientLanguagesCounter'), MAX_LANGUAGES_LENGTH);
}

// --- Status lines -----------------------------------------------------------

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status-msg ${kind}`;
  $('status').hidden = !text;
}

const NOTE_ICONS = { ok: 'check', warn: 'warn', error: 'warn', info: 'info' };

/** Shows `text` in a note box (ok, warn, error or info) with its icon. */
function showNote(node, kind, text) {
  node.className = `note ${kind}`;
  node.replaceChildren(icon(NOTE_ICONS[kind] ?? 'info'), el('span', {}, text));
  node.hidden = !text;
}

function setTestStatus(text, kind = 'info') {
  showNote($('testStatus'), kind, text);
}

// --- Setup checklist --------------------------------------------------------

async function renderSetup(settings) {
  const stored = await messenger.storage.local.get(CONNECTION_TEST_KEY);
  const test = stored[CONNECTION_TEST_KEY];
  let hasHistory = false;
  try {
    hasHistory = (await readSummaries()).some((s) => s.messages > 0);
  } catch (e) {
    console.warn('Preen: could not read history', e);
  }
  const steps = setupSteps(settings, { connectionOk: Boolean(test?.ok && test.provider === settings.provider), hasHistory });
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  // Getting started is one line (the next step, or "Setup complete") until Show steps opens it.
  const complete = done === steps.length;
  $('s-setup').classList.toggle('is-complete', complete);
  $('setupDoneTitle').textContent = complete ? 'Setup complete' : `Next: ${next.label}`;
  $('setupDoneSub').textContent = `${done} of ${steps.length} steps done`;
  showSetupBody();
  $('setupCount').textContent = `${done} of ${steps.length} done`;
  $('setupSteps').replaceChildren(...steps.map((s, i) => {
    const link = STEP_LINKS[s.id];
    return el('li', { className: s.done ? 'done' : s === next ? 'next' : '' },
      el('span', { className: 'dot' }, s.done ? '✓' : String(i + 1)),
      s.label,
      link && !s.done ? el('a', { href: link[0] }, link[1]) : null);
  }));
  updateConnectionChip(test);
}

function showSetupBody() {
  $('setupBody').hidden = !setupOpen;
  $('s-setup').classList.toggle('is-open', setupOpen);
  $('setupDone').setAttribute('aria-expanded', String(setupOpen));
  $('setupDoneMore').textContent = setupOpen ? 'Hide steps' : 'Show steps';
}
$('setupDone').addEventListener('click', () => {
  setupOpen = !setupOpen;
  showSetupBody();
});

// Where each setup step is done on this page.
const STEP_LINKS = {
  consent: ['#s-provider', 'Provider'],
  connect: ['#s-provider', 'Provider'],
  automation: ['#s-automatic', 'Automatic processing'],
};

/** The connection chip at the top: the last successful Test connection, if it was for this provider. */
function updateConnectionChip(test) {
  const chip = $('connChip');
  const provider = $('provider').value;
  const ok = Boolean(test?.ok && test.provider === provider);
  chip.className = `pchip ${ok ? 'ok' : 'warn'}`;
  const label = PROVIDERS[provider]?.label ?? provider;
  chip.replaceChildren(icon(ok ? 'check' : 'warn'), el('strong', {}, ok ? 'Connected' : 'Not tested'),
    ok ? ` ${label}${test.model ? ` · ${test.model}` : ''}` : '');
}

/** The automatic-processing sentence mentions dry run, so it follows the switch. */
function updateDryRunChip() {
  describeAutomation();
}

/** The automation chip at the top, from the form as it is now (what Save will store). */
function updateAutomationChip() {
  const state = automationState(formAutomation());
  $('autoChip').className = `pchip ${state === 'on' ? 'ok' : 'warn'}`;
  $('autoChip').replaceChildren(icon(state === 'on' ? 'check' : 'pause'), el('strong', {}, `Automatic ${state}`));
  $('autoChip').title = `Automatic processing ${state}`;
}

// --- Automatic processing: one list of mailboxes, no master switch -----
// `automation.enabled` is the Pause / Resume state. Saving turns it on when a mailbox
// is newly ticked (the user asked for automatic processing); otherwise a paused
// install stays paused until Resume.
let resumeFlag = false; // automation.enabled as loaded, or as set by Resume here
let tickedAtSave = new Set();

// While Thunderbird can't list the accounts, the saved mailboxes stand (they are kept on Save).
const tickedNow = () => (loadedAccounts
  ? Object.entries(loadedAccounts.scope).filter(([, a]) => a?.enabled).map(([id]) => id)
  : [...$('accountsIncluded').querySelectorAll('input[data-account-id]')].filter((i) => i.checked).map((i) => i.dataset.accountId));

/** Just the parts of the form that decide automatic processing, shaped like settings. */
function formAutomation() {
  const ticked = tickedNow();
  const newlyTicked = ticked.some((id) => !tickedAtSave.has(id));
  return {
    // Nothing ticked: off, and nothing to resume later by accident.
    automation: { enabled: ticked.length > 0 && (resumeFlag || newlyTicked) },
    scope: { accounts: Object.fromEntries(ticked.map((id) => [id, { enabled: true }])) },
  };
}

const WHEN = {
  realtime: () => 'as it arrives',
  scheduled: () => intervalText(readInterval()),
  manual: () => 'when you click “Run now”',
};
const names = (ids) => ids.map((id) => accountNames.get(id) ?? id).join(', ');

/** The sentence under the list: what will happen, in plain words. */
function describeAutomation() {
  const form = formAutomation();
  const state = automationState(form);
  const ticked = Object.keys(form.scope.accounts);
  const others = [...accountNames.keys()].filter((id) => !ticked.includes(id));
  let text;
  if (state === 'off') {
    text = 'Off: Preen only runs when you right-click “Classify with Preen”.';
  } else if (state === 'paused') {
    text = `Paused: nothing runs automatically in ${names(ticked)} until you resume.`;
  } else {
    text = `Preen tags new mail in ${names(ticked)} ${WHEN[$('trigger').value]?.() ?? ''}.`
      + (others.length ? ` ${names(others)}: only when you right-click.` : '')
      + ($('dryRun').checked ? ' Dry run is on, so it only logs what it would do.' : '');
  }
  $('autoSentence').textContent = text;
  $('autoNow').className = `auto-now ${state}`;
  $('autoResume').hidden = state !== 'paused';
  renderAutomationSummary(state, ticked);
}

const STATE_LABELS = { off: 'Off', paused: 'Paused', on: 'On' };

/** The summary block: state pill, ticked mailboxes, and the settings automation uses in a fixed order. */
function renderAutomationSummary(state, ticked) {
  $('autoPill').className = `pill state-pill ${state}`;
  $('autoPill').textContent = STATE_LABELS[state];
  $('autoMailboxes').textContent = ticked.length ? `Mailboxes: ${names(ticked)}` : 'No mailbox ticked.';
  const rows = automationRows({
    state,
    trigger: $('trigger').value,
    intervalMinutes: readInterval(),
    unreadOnly: $('unreadOnly').checked,
    maxAgeDays: Number($('maxAgeDays').value),
    dryRun: $('dryRun').checked,
  });
  $('autoUses').replaceChildren(...rows.flatMap((r) => [
    el('dt', { className: r.dim ? 'dim' : '' }, r.label),
    el('dd', { className: r.dim ? 'dim' : '' }, r.value),
  ]));
  $('autoDimNote').textContent = dimNote(state);
  $('autoFields').classList.toggle('is-dimmed', state !== 'on');
}

// --- Providers and depth ------------------------------------------------------

function fillProviders() {
  for (const [id, p] of Object.entries(PROVIDERS)) $('provider').append(new Option(p.label, id));
}

function modeOptions(select, includeDefault) {
  if (includeDefault) select.append(new Option('Use default', ''));
  for (const mode of DEPTH_MODES) select.append(new Option(DEPTH_LABELS[mode], mode));
}

/** Surface / Deep, explained once under the default depth. */
function fillDepthDefinitions() {
  $('depthDefs').replaceChildren(...DEPTH_MODES.flatMap((mode) => [el('dt', {}, DEPTH_LABELS[mode]), el('dd', {}, DEPTH_SHORT[mode])]));
}

function updateDepthHelp() {
  // Accounts set to "Use default" name and describe the current default.
  for (const select of document.querySelectorAll('select[data-field="depth"]')) describeDepth(select);
}

/** The "Use default" wording and the one-line description under an account's Depth dropdown. */
function describeDepth(select) {
  const fallback = $('depthDefault').value;
  select.options[0].textContent = `Use default — currently ${DEPTH_LABELS[fallback]}`;
  select.parentElement.querySelector('.help').textContent = DEPTH_SHORT[select.value || fallback] ?? '';
}

function updateModelPlaceholder() {
  const model = PROVIDERS[$('provider').value]?.defaultModel ?? '';
  $('model').placeholder = model;
  $('modelHelp').textContent = model ? `Leave blank to use the default (${model}).` : '';
}

// --- Check interval: shown as minutes or hours, stored as minutes ------------

function renderInterval(minutes) {
  const hours = minutes >= 60 && minutes % 60 === 0;
  $('intervalUnit').value = hours ? 'hours' : 'minutes';
  $('intervalValue').value = hours ? minutes / 60 : minutes;
  updateIntervalLimits();
}

function readInterval() {
  return Number($('intervalValue').value) * ($('intervalUnit').value === 'hours' ? 60 : 1);
}

function updateIntervalLimits() {
  const hours = $('intervalUnit').value === 'hours';
  $('intervalValue').min = hours ? 1 : 5;
  $('intervalValue').max = hours ? 24 : 1440;
  $('intervalValue').step = hours ? 1 : 5;
}

// The cost limit is an estimate from tokens × price, so it needs a price.
function updateCostLimitField() {
  const hasPrice = readPrice() !== null;
  $('monthlyCost').disabled = !hasPrice;
  $('monthlyCostLock').hidden = hasPrice;
  $('monthlyCostField').classList.toggle('is-locked', !hasPrice);
}

function updateAutomationFields() {
  const on = tickedNow().length > 0;
  for (const id of ['trigger', 'intervalValue', 'intervalUnit', 'maxAgeDays', 'unreadOnly']) $(id).disabled = !on;
  $('autoLock').hidden = on;
  $('autoFields').classList.toggle('is-locked', !on);
  // The interval only matters for scheduled runs.
  $('intervalField').hidden = $('trigger').value !== 'scheduled';
  updateAutomationChip();
  describeAutomation();
}

// --- Accounts and folder picker -------------------------------------------

let accountNames = new Map();
// Per-account settings as loaded. If Thunderbird can't list the accounts, the page
// shows none, and saving keeps these instead of erasing them.
let loadedAccounts = null;

function cell(...children) {
  const td = document.createElement('td');
  td.append(...children);
  return td;
}

/** An account's folders as a nested checkbox tree, with a count of those chosen. */
async function folderPicker(accountId, chosenPaths) {
  let folders = [];
  let listed = true;
  try {
    folders = await messenger.folders.query({ accountId, sort: 'path' });
  } catch (e) {
    listed = false;
    console.warn('Preen: could not list folders', e);
  }
  const count = el('span', { className: 'help' });
  const root = el('ul');
  // Folders arrive sorted by path, so each one's parent list is already built.
  const lists = new Map([['', root]]);
  const found = new Set();
  for (const folder of folders) {
    if (folder.isRoot) continue;
    const excluded = isExcludedFolder(folder);
    const input = el('input', { type: 'checkbox', checked: !excluded && chosenPaths.includes(folder.path), disabled: excluded });
    input.dataset.path = folder.path;
    const label = el('label', { className: excluded ? 'locked' : '' }, input, excluded ? icon('lock') : null, folder.name);
    if (excluded) label.title = 'Special folders are never processed automatically';
    const item = el('li', {}, label);
    const cut = folder.path.lastIndexOf('/');
    const parentPath = cut > 0 ? folder.path.slice(0, cut) : '';
    (lists.get(parentPath) ?? root).append(item);
    const children = el('ul');
    item.append(children);
    lists.set(folder.path, children);
    found.add(folder.path);
  }
  const box = el('div', { className: 'field folder-picker' },
    el('div', { className: 'tree-head' }, el('span', { className: 'label' }, 'Folders to process'), count),
    folders.length ? el('div', { className: 'tree' }, root)
      : el('div', { className: 'empty' }, listed ? 'No folders found.' : 'Thunderbird couldn\'t list the folders just now.'));
  // Only a successful listing can show that a chosen folder is gone.
  const missing = listed ? chosenPaths.filter((p) => !found.has(p)) : [];
  if (missing.length) {
    box.append(el('p', { className: 'missing' },
      `No longer found (renamed, moved or deleted): ${missing.join(', ')}. They'll be removed when you save.`));
  }
  if (!listed) box.dataset.keptPaths = JSON.stringify(chosenPaths); // no boxes to read: Save keeps these
  const updateCount = () => {
    count.textContent = `${box.querySelectorAll('input[data-path]:checked').length} selected`;
  };
  box.addEventListener('change', updateCount);
  updateCount();
  return box;
}

const fieldId = (accountId, name) => `acct-${name}-${accountId.replace(/[^a-z0-9]/gi, '_')}`;

function field(text, input, ...rest) {
  return el('div', { className: 'field' }, el('label', { htmlFor: input.id }, ...[text].flat()), input, ...rest);
}

/** A mailbox's tick box in "Process new mail automatically in:" (Automatic processing). */
function includedRow(account, settings) {
  const input = el('input', {
    type: 'checkbox', id: fieldId(account.id, 'enabled'),
    checked: Boolean(settings.scope.accounts[account.id]?.enabled), dataset: { accountId: account.id },
  });
  return el('label', { className: 'check' }, input,
    el('span', {}, el('span', { className: 't' }, account.name), ' ',
      el('span', { className: 'pill' }, ACCOUNT_KIND_LABELS[account.type] ?? account.type)));
}

/** One collapsible row per account: folders, depth (with description) and mailbox type. */
async function accountCard(account, settings) {
  const scope = settings.scope.accounts[account.id] ?? {};
  const id = (name) => fieldId(account.id, name);

  const folders = el('select', { id: id('folders'), dataset: { field: 'folders' } });
  for (const [value, label] of FOLDER_OPTIONS) folders.append(new Option(label, value));
  folders.value = scope.folders ?? 'inbox';
  const picker = await folderPicker(account.id, scope.folderPaths ?? []);
  const updatePicker = () => { picker.hidden = !['selected', 'except'].includes(folders.value); };
  folders.addEventListener('change', updatePicker);
  updatePicker();

  const depth = el('select', { id: id('depth'), dataset: { field: 'depth' } });
  modeOptions(depth, true);
  depth.value = settings.depth.accounts[account.id] ?? '';
  depth.addEventListener('change', () => describeDepth(depth));

  const type = el('select', { id: id('type'), dataset: { field: 'type' } });
  type.append(new Option('Not set', ''));
  for (const [value, label] of Object.entries(ACCOUNT_TYPES)) type.append(new Option(label, value));
  type.value = scope.type ?? '';
  const note = el('input', {
    type: 'text', id: id('note'), value: scope.note ?? '', dataset: { field: 'note' },
    placeholder: 'e.g. Design studio; clients are agencies',
  });
  const noteCounter = el('span', { className: 'count' });
  const updateNote = () => updateCounter(note, noteCounter, DESCRIPTION_LIMIT);
  note.addEventListener('input', updateNote);
  updateNote();

  const depthField = field('Depth', depth, el('p', { className: 'help' }));
  addTip(depthField.querySelector('label'), 'depth');

  const card = el('details', { className: 'acct acct-card', dataset: { accountId: account.id } },
    el('summary', {},
      icon('caret', 'ico caret'),
      el('span', { className: 'acct-name' }, account.name),
      el('span', { className: 'pill' }, ACCOUNT_KIND_LABELS[account.type] ?? account.type)),
    el('div', { className: 'body' },
      el('div', { className: 'grid g3' },
        field('Folders', folders, el('p', { className: 'help' }, 'Start with Inbox only; add folders once the previews look right.')),
        depthField,
        field('Kind of mailbox', type, el('p', { className: 'help' }, 'Sent to Jev as context. Your account name and address are never sent.'))),
      field(['About this mailbox ', el('span', { className: 'opt' }, 'optional')], note, noteCounter),
      picker));
  describeDepth(depth);
  return card;
}

async function renderAccounts(settings) {
  let accounts = [];
  loadedAccounts = null;
  try {
    accounts = await messenger.accounts.list(false);
  } catch (e) {
    console.warn('Preen: could not list accounts', e);
    loadedAccounts = { scope: settings.scope.accounts, depth: settings.depth.accounts };
  }
  accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const cards = [];
  for (const account of accounts) cards.push(await accountCard(account, settings));
  const none = () => el('div', { className: 'empty' }, 'No mail accounts found.');
  $('accounts').replaceChildren(...(cards.length ? cards : [none()]));
  $('accountsIncluded').replaceChildren(...(accounts.length ? accounts.map((a) => includedRow(a, settings)) : [none()]));
}

/** @returns {{scope: object, depth: object}} per-account settings from the cards */
function readAccounts() {
  if (loadedAccounts) return loadedAccounts;
  const scope = {};
  const depth = {};
  for (const card of $('accounts').querySelectorAll('.acct-card')) {
    const id = card.dataset.accountId;
    const field = (name) => card.querySelector(`[data-field="${name}"]`);
    const kept = card.querySelector('.folder-picker')?.dataset.keptPaths;
    const folderPaths = kept ? JSON.parse(kept) : [...card.querySelectorAll('.folder-picker input[data-path]:checked')].map((i) => i.dataset.path);
    const enabled = $('accountsIncluded').querySelector(`input[data-account-id="${CSS.escape(id)}"]`)?.checked ?? false;
    const entry = { enabled, folders: field('folders').value, folderPaths };
    if (field('type').value) entry.type = field('type').value;
    if (field('note').value.trim()) entry.note = field('note').value.trim();
    scope[id] = entry;
    if (field('depth').value) depth[id] = field('depth').value;
  }
  return { scope, depth };
}

// --- Sender rules (stored separately; changes apply immediately) ------------

async function renderSenderRules() {
  const rules = Object.entries(await readOverrides()).sort(([a], [b]) => a.localeCompare(b));
  if (!rules.length) {
    $('senderRules').replaceChildren(el('div', { className: 'empty' }, 'No sender rules yet.'));
    return;
  }
  const table = el('table', { className: 'rules' });
  for (const [address, rule] of rules) {
    const remove = el('button', { type: 'button', className: 'btn small', textContent: 'Remove' });
    remove.addEventListener('click', () => setOverride([address], null));
    const row = document.createElement('tr');
    row.append(cell(address), cell(rule === 'person' ? 'Always a real person' : 'Never a real person'), cell(remove));
    table.append(row);
  }
  $('senderRules').replaceChildren(table);
}

messenger.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[OVERRIDES_KEY]) renderSenderRules();
  // Pause / Resume from the Activity page or toolbar while this page is open: follow
  // it, so a later Save here doesn't undo it.
  const paused = changes.settings?.newValue?.automation?.enabled;
  if (area === 'local' && typeof paused === 'boolean' && paused !== resumeFlag
      && changes.settings.oldValue?.automation?.enabled !== paused) {
    resumeFlag = paused;
    if (snapshot) snapshot.automation.enabled = paused;
    updateAutomationFields();
    renderBlotter();
  }
});

// --- Low / Medium / High / Custom pickers ---------------------------

// Under each Custom allowance field: the value as a share of High, e.g. "150% of High".
function updatePercents() {
  for (const line of document.querySelectorAll('[data-pct-for]')) {
    const id = line.dataset.pctFor;
    const value = Number($(id).value);
    const pct = percentOfHigh('allowance', `limits.${id}`, value);
    if (pct === null) line.textContent = 'No limit';
    else line.textContent = pct < 1 ? 'Less than 1% of High' : `${Math.round(pct).toLocaleString()}% of High`;
  }
}
$('allowanceDetails').addEventListener('input', () => updatePercents());

/**
 * Builds a picker for `group` whose details are the given inputs, mapped to
 * settings paths. The inputs are looked up once, up front: the picker moves
 * them into its own box, and while that box isn't on the page yet a lookup by
 * ID would find nothing.
 */
function picker(group, slotId, detailsId, fields, afterWrite = () => {}, icon = undefined) {
  const inputs = Object.entries(fields).map(([path, id]) => {
    const input = $(id);
    if (!input) throw new Error(`Settings page: no input #${id} for ${path}`);
    return [path, input];
  });
  const read = () => {
    const values = {};
    for (const [path, input] of inputs) {
      setPath(values, path, Number(input.value));
    }
    return values;
  };
  const write = (values) => {
    for (const [path, input] of inputs) input.value = getPath(values, path);
    afterWrite();
  };
  const p = createLevelPicker({ group, details: $(detailsId), read, write, onChange: markDirty, icon });
  $(slotId).replaceWith(p.element);
  return p;
}

// Daily allowance is the one level picker drawn as a rating: one to three feathers, a pen for Custom.
const ALLOWANCE_ICONS = { low: 1, medium: 2, high: 3 };
const allowanceIcon = (level) => (level in ALLOWANCE_ICONS
  ? Array.from({ length: ALLOWANCE_ICONS[level] }, () => icon('feather', 'ico feather'))
  : [icon('pen')]);

const pickers = {
  allowance: picker('allowance', 'allowancePicker', 'allowanceDetails', {
    'limits.dailyMessages': 'dailyMessages',
  }, () => updatePercents(), allowanceIcon),
  realPerson: picker('realPerson', 'realPersonPicker', 'realPersonDetails', { 'thresholds.realPerson': 'tRealPerson' }),
  needsReply: picker('needsReply', 'needsReplyPicker', 'needsReplyDetails', { 'thresholds.needsReply': 'tNeedsReply' }),
  toDo: picker('toDo', 'toDoPicker', 'toDoDetails', { 'thresholds.toDo': 'tToDo' }),
  junk: picker('junk', 'junkPicker', 'junkDetails', { 'thresholds.junk': 'tJunk' }),
  history: picker('history', 'historyPicker', 'historyDetails', {
    'history.retentionDays': 'retentionDays',
  }),
};

// Tips beside the pickers' captions.
for (const [group, key, subject] of [
  ['allowance', 'allowance'], ['history', 'history'],
  ['realPerson', 'certainty', 'certainty required for real person'],
  ['needsReply', 'certainty', 'certainty required for needs reply'],
  ['toDo', 'certainty', 'certainty required for to-do'],
  ['junk', 'certainty', 'certainty required for junk'],
]) addTip(pickers[group].element.querySelector('.level-caption'), key, subject);
// Tips beside labels marked data-tip in the page.
for (const target of document.querySelectorAll('[data-tip]')) addTip(target, target.dataset.tip);

// --- Reading and writing the form -------------------------------------------

// Consent is given or withdrawn with its own buttons, never by Save or Import.
let consent = null;

const numberOrNull = (id) => ($(id).value.trim() === '' ? null : Number($(id).value));

async function render(s) {
  loading = true;
  try {
    consent = s.consent;
    $('dryRun').checked = s.dryRun;
    $('appearance').value = s.appearance;
    updateDryRunChip();
    $('provider').value = s.provider;
    renderConsent();
    $('model').value = s.model;
    $('price').value = s.pricePerMillionInputTokens ?? '';
    $('apiKey').value = s.apiKey;
    $('personalContext').value = s.personalContext;
    updateContextCounter();
    // First time: suggest the user's own languages (not stored until they click Save).
    const suggested = suggestedLanguages(s, {
      uiLanguage: messenger.i18n?.getUILanguage?.(),
      languages: globalThis.navigator?.languages ? [...navigator.languages] : [],
    });
    $('recipientLanguages').value = suggested || s.recipientLanguages;
    $('languagesHelp').textContent = suggested ? LANGUAGES_SUGGESTED : LANGUAGES_HELP;
    updateLanguagesCounter();
    $('tCategory').value = s.thresholds.category;
    categoryEditor.set(s.categories);
    $('categoriesOn').checked = s.categorySort.enabled;
    showCategoriesOn();
    $('qPerson').checked = s.questions.person;
    $('qNeedsReply').checked = s.questions.needsReply;
    $('qToDo').checked = s.questions.toDo;
    $('sensitive').checked = s.localChecks.sensitive;
    $('replacePii').checked = s.localChecks.replacePii;
    $('qJunk').checked = s.questions.junk;
    $('flagNeedsReply').checked = s.actions.flagNeedsReply;
    $('flagToDo').checked = s.actions.flagToDo;
    $('moveJunk').checked = s.actions.moveJunk;
    updateMovePermissionNote();
    $('markProcessedTag').checked = s.markProcessed.tag;
    $('tRealPerson').value = s.thresholds.realPerson;
    $('tNeedsReply').value = s.thresholds.needsReply;
    $('tToDo').value = s.thresholds.toDo;
    $('tJunk').value = s.thresholds.junk;
    showSpeed(s.speed);
    $('depthDefault').value = s.depth.default;
    syncConsentDepth();
    resumeFlag = s.automation.enabled;
    $('trigger').value = s.automation.trigger;
    renderInterval(s.automation.intervalMinutes);
    $('maxAgeDays').value = s.automation.maxAgeDays;
    $('unreadOnly').checked = s.automation.unreadOnly;
    $('dailyMessages').value = s.limits.dailyMessages;
    $('monthlyCost').value = s.limits.monthlyCostUsd ?? '';
    updatePercents();
    $('retentionDays').value = s.history.retentionDays;
    $('debugEnabled').checked = s.debug.enabled;
    $('debugBanner').hidden = !s.debug.enabled;
    $('priceSource').textContent = '';
    setTestStatus('');
    updateModelPlaceholder();
    await renderAccounts(s);
    tickedAtSave = new Set(tickedNow());
    updateDepthHelp();
    updateAutomationFields();
    updateCostLimitField();
    updateCostExamples();
    for (const p of Object.values(pickers)) p.refresh();
  } finally {
    loading = false;
  }
}

function readForm() {
  const categories = categoryEditor.get();
  const accounts = readAccounts();
  return {
    dryRun: $('dryRun').checked,
    appearance: $('appearance').value,
    provider: $('provider').value,
    model: $('model').value.trim(),
    pricePerMillionInputTokens: readPrice(),
    apiKey: $('apiKey').value.trim(),
    personalContext: $('personalContext').value,
    recipientLanguages: $('recipientLanguages').value.trim(),
    // Saving is the user's decision, even when they leave the box empty.
    recipientLanguagesSet: true,
    categories,
    categorySort: { enabled: $('categoriesOn').checked },
    depth: { default: $('depthDefault').value, accounts: accounts.depth },
    scope: { accounts: accounts.scope },
    automation: {
      enabled: formAutomation().automation.enabled,
      trigger: $('trigger').value,
      intervalMinutes: readInterval(),
      maxAgeDays: Number($('maxAgeDays').value),
      unreadOnly: $('unreadOnly').checked,
    },
    limits: {
      dailyMessages: Number($('dailyMessages').value),
      monthlyCostUsd: readPrice() === null ? null : numberOrNull('monthlyCost'), // no price: no limit
    },
    history: {
      retentionDays: Number($('retentionDays').value),
    },
    debug: { enabled: $('debugEnabled').checked },
    telemetry: { ...DEFAULT_SETTINGS.telemetry }, // no control in this version: usage reports stay off
    questions: { person: $('qPerson').checked, needsReply: $('qNeedsReply').checked, toDo: $('qToDo').checked, junk: $('qJunk').checked },
    localChecks: { sensitive: $('sensitive').checked, replacePii: $('replacePii').checked },
    actions: { flagNeedsReply: $('flagNeedsReply').checked, flagToDo: $('flagToDo').checked, moveJunk: $('moveJunk').checked },
    markProcessed: { tag: $('markProcessedTag').checked },
    thresholds: {
      category: Number($('tCategory').value),
      realPerson: Number($('tRealPerson').value),
      needsReply: Number($('tNeedsReply').value),
      toDo: Number($('tToDo').value),
      junk: Number($('tJunk').value),
    },
    speed: currentSpeed,
    consent,
  };
}

// Validation messages name accounts by ID; show their names instead.
function readableErrors(errors) {
  return errors.map((e) => e.replace(/\baccount ([^\s,.]+)/, (m, id) => (accountNames.has(id) ? `account “${accountNames.get(id)}”` : m)));
}

function readValidForm() {
  const settings = readForm();
  const { ok, errors } = validateSettings(settings);
  if (!ok) throw new Error(readableErrors(errors).join('\n'));
  return settings;
}

// --- Consent to send mail ------------------------------------------------------

/** The consent panel, for the provider chosen in the form. */
function renderConsent(note = '') {
  const provider = $('provider').value;
  const { label, summary, fields, privacyPage } = consentText(provider);
  const agreed = Boolean(consent?.sendToProvider) && consent.provider === provider;
  $('consentText').textContent = summary;
  $('consentFields').replaceChildren(...fields.map((f) => el('li', {}, `${f.name}. `, el('span', {}, f.why))));
  $('consentPrivacy').href = messenger.runtime.getURL(privacyPage);
  $('consentAgree').hidden = agreed;
  $('consentNotNow').hidden = agreed;
  $('consentWithdraw').hidden = !agreed;
  $('consentState').textContent = note || (agreed
    ? `You agreed on ${new Date(consent.sendToProvider).toLocaleString()} to send mail to ${label}.`
    : `Nothing is sent to ${label} until you agree. Test connection sends no mail.`);
}

/** Stores consent on its own, leaving the rest of the stored settings and the form as they are. */
async function storeConsent(value) {
  try {
    const stored = await loadSettings();
    await saveSettings({ ...stored, consent: value });
    consent = value;
    renderConsent();
    setSaveMark($('consentMark'), 'saved');
    await renderSetup({ ...stored, consent: value });
  } catch (e) {
    setStatus(`Could not save your choice: ${e.message}`, 'error');
  }
}

// The depth choice here is the Default depth under Accounts, shown where the user agrees.
function syncConsentDepth() {
  $('consentDepth').value = $('depthDefault').value;
  $('consentDepthHelp').textContent = DEPTH_SHORT[$('depthDefault').value] ?? '';
}
$('consentDepth').addEventListener('change', () => {
  $('depthDefault').value = $('consentDepth').value;
  syncConsentDepth();
  updateDepthHelp();
  setSaveMark($('depthMark'), 'pending');
  markDirty(); // consentDepth is left out of the form-wide listener: the change is depthDefault's
});

$('consentPrivacy').addEventListener('click', (event) => {
  event.preventDefault();
  showPage(PRIVACY_PAGE);
});
$('consentAgree').addEventListener('click', () =>
  storeConsent({ sendToProvider: new Date().toISOString(), provider: $('provider').value }));
$('consentWithdraw').addEventListener('click', () => storeConsent({ sendToProvider: null, provider: null }));
$('consentNotNow').addEventListener('click', () =>
  renderConsent(`Nothing is sent to ${consentText($('provider').value).label}. You can agree here at any time.`));

// --- Actions ----------------------------------------------------------------

$('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const settings = readValidForm();
    await saveSettings(settings);
    resumeFlag = settings.automation.enabled;
    tickedAtSave = new Set(tickedNow());
    updateAutomationFields();
    clearTimeout(savedTimer);
    takeSnapshot();
    setDirty(false);
    flashSaved();
    $('languagesHelp').textContent = LANGUAGES_HELP;
    setStatus('Saved.', 'ok');
    await renderSetup(settings);
    await renderStats();
  } catch (e) {
    setStatus(e.message, 'error');
    // Open the category rows that need attention.
    if ($('categoriesOn').checked) for (const row of categoryEditor.invalidRows()) reveal(row);
  }
});

$('test').addEventListener('click', async () => {
  const button = $('test');
  // The permission request must come first, directly from the click.
  const origin = PROVIDERS[$('provider').value]?.origin;
  const granted = origin ? await messenger.permissions.request({ origins: [origin] }) : false;
  if (!granted) {
    setTestStatus('Preen needs permission to contact the provider.', 'error');
    return;
  }
  button.disabled = true;
  setTestStatus('Testing…', 'info');
  try {
    // Only the provider fields matter here, so half-finished edits elsewhere
    // (e.g. a duplicate category name) don't block the test.
    const form = readForm();
    const settings = mergeWithDefaults({
      provider: form.provider, model: form.model, apiKey: form.apiKey, pricePerMillionInputTokens: form.pricePerMillionInputTokens,
    });
    if (!settings.apiKey) throw new Error('Enter an API key first.');
    const result = await testConnection(settings);
    const cost = costFromUsage(result.usage, settings.pricePerMillionInputTokens);
    const costText = cost ? `, ${formatUsd(cost.usd)}${cost.source === 'provider' ? ' as reported' : ' at your price'}` : '';
    // The provider reported a cost, so fill in the price from it.
    const testPrice = priceFromUsage(result.usage);
    if (testPrice !== null) {
      const before = readPrice();
      $('price').value = testPrice;
      updateCostLimitField();
      const when = new Date().toLocaleDateString();
      $('priceSource').textContent = before !== null && before !== testPrice
        ? `From your provider's test on ${when} (was $${before}).`
        : `From your provider's test on ${when}.`;
      if (before !== testPrice) markDirty();
      updateDescriptionCost();
    }
    await messenger.storage.local.set({
      [CONNECTION_TEST_KEY]: { ok: true, provider: settings.provider, model: result.model, at: new Date().toISOString() },
    });
    const understood = result.answersUnderstood
      ? ''
      : ' However, Preen couldn\'t read the model\'s yes/no answers, so Real person, Needs reply and To-do won\'t work. '
        + 'Please report this (with the add-on console output) so it can be fixed.';
    setTestStatus(
      `Connected to ${resolveProvider(settings).label}. Model: ${result.model || '(not reported)'}. ` +
      `Test used ${formatTokens(result.usage.input_tokens)} input tokens${costText}.${understood}` +
      `${dirty ? ' Remember to click Save.' : ''}`,
      result.answersUnderstood ? 'ok' : 'warn',
    );
    await renderSetup(await loadSettings());
  } catch (e) {
    const hint = e.kind === 'auth' ? ' Check the API key.' : '';
    setTestStatus(`Test failed (${e.kind ?? 'error'}): ${e.message}.${hint}`, 'error');
  } finally {
    button.disabled = false;
  }
});

// Speed: Low / Medium / High like the level pickers, plus No limit.
const SPEED_HELP = {
  low: `One message at a time, with a 2-second rest after each; ${PACE.low.runSize} messages a run. Gentlest; large folders take much longer.`,
  medium: `One message at a time, with a short rest after each; ${PACE.medium.runSize} messages a run. Recommended.`,
  high: `Two messages at a time, no rest; ${PACE.high.runSize} messages a run. Fastest with a limit.`,
  off: `Three messages at a time, no rest; ${PACE.off.runSize} messages a run.`,
};
let currentSpeed = 'medium';
function showSpeed(speed) {
  currentSpeed = speed in SPEED_HELP ? speed : 'medium';
  for (const b of $('speedButtons').querySelectorAll('button')) {
    const on = b.dataset.speed === currentSpeed;
    b.setAttribute('aria-pressed', String(on));
  }
  $('speedHelp').textContent = SPEED_HELP[currentSpeed];
  $('speedWarning').hidden = currentSpeed !== 'off';
}
for (const b of $('speedButtons').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    if (b.dataset.speed === currentSpeed) return;
    showSpeed(b.dataset.speed);
    markDirty();
  });
}

// Tag corrections: their own table, exported or cleared from here.
const SUGGEST_INPUT = { realPerson: 'tRealPerson', needsReply: 'tNeedsReply' };
const SUGGEST_NAME = { realPerson: 'Real person', needsReply: 'Needs reply' };

// Scores of messages Preen really tagged (applied, not undone) that the user didn't
// correct (latest entry per message), per field: they count as Preen having been right
// (see core/suggest.js). Previews and dry runs never showed tags, so they don't count.
const SCORE_OF = { realPerson: 'person', needsReply: 'needsReply' };
async function untouchedScores() {
  const entries = await readAll();
  const corrected = new Set(entries.filter((e) => e.correction).map((e) => e.headerMessageId));
  const latest = new Map();
  for (const e of untouchedEntries(entries, corrected)) latest.set(e.headerMessageId, e);
  return Object.fromEntries(Object.entries(SCORE_OF).map(([field, k]) => [field, [...latest.values()].map((e) => e.scores[k])]));
}

// Per tag, what the user corrected and, with enough corrections, a suggested
// level. Apply only fills the field; nothing changes until Save.
function renderSuggestions(rows, untouched) {
  const thresholds = Object.fromEntries(Object.entries(SUGGEST_INPUT).map(([f, id]) => [f, Number($(id).value)]));
  const list = document.createElement('ul');
  list.className = 'plain';
  for (const s of suggestLevels(rows, thresholds, untouched)) {
    const li = document.createElement('li');
    li.dataset.field = s.field;
    const counts = `${SUGGEST_NAME[s.field]}: you removed it ${s.removed}×, added it ${s.added}× (level ${s.current}).`;
    if (s.suggested !== null) {
      li.textContent = `${counts} Suggested level ${s.suggested}: would have avoided ${s.avoided} of your corrections. `;
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'btn';
      apply.textContent = `Apply ${s.suggested}`;
      const mark = el('span', { className: 'save-mark' });
      mark.hidden = true;
      apply.addEventListener('click', () => {
        const input = $(SUGGEST_INPUT[s.field]);
        input.value = String(s.suggested);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setSaveMark(mark, 'pending');
        setStatus(`${SUGGEST_NAME[s.field]} level set to ${s.suggested}. Click Save to use it.`, 'warn');
      });
      li.append(apply, ' ', mark);
    } else {
      const total = s.added + s.removed;
      li.textContent = total < MIN_CORRECTIONS
        ? `${counts} A suggestion appears after ${MIN_CORRECTIONS} corrections.`
        : `${counts} The current level already fits your corrections best.`;
    }
    list.append(li);
  }
  $('suggestions').replaceChildren(list);
}

async function showCorrectionsCount() {
  let rows;
  let untouched;
  try {
    rows = await readCorrections();
    untouched = await untouchedScores();
  } catch (e) {
    // Not "none recorded": the history could not be read, so say so and show no suggestions.
    console.warn('Preen: could not read the recorded corrections', e);
    $('correctionsCount').textContent = 'Could not read the recorded corrections. Try reopening Settings.';
    $('suggestions').replaceChildren();
    return [];
  }
  $('correctionsCount').textContent = rows.length
    ? `${rows.length} correction${rows.length === 1 ? '' : 's'} recorded since ${new Date(rows[0].at).toLocaleDateString()}.`
    : 'No corrections recorded yet.';
  renderSuggestions(rows, untouched);
  return rows;
}
$('exportCorrectionsCsv').addEventListener('click', async () => {
  download(`preen-corrections-${fileStamp()}.csv`, correctionsToCsv(await readCorrections()), 'text/csv');
});
$('exportCorrectionsJson').addEventListener('click', async () => {
  download(`preen-corrections-${fileStamp()}.json`, JSON.stringify(await readCorrections(), null, 2));
});
$('clearCorrections').addEventListener('click', async () => {
  const yes = await askDialog({
    title: 'Delete all recorded tag corrections?',
    message: 'The suggested certainty levels start over. This can\'t be undone.',
    confirmLabel: 'Delete corrections',
    cancelLabel: 'Keep them',
    danger: true,
  });
  if (!yes) return;
  await clearCorrections();
  await showCorrectionsCount();
  setStatus('Corrections deleted.', 'ok');
});

// --- Debug log ----------------------------------------------------------------

async function showDebugCount() {
  let n;
  try {
    n = await countDebug();
  } catch (e) {
    console.warn('Preen: could not read the debug log', e);
    $('debugCount').textContent = `Could not read the debug log: ${e.message}`;
    return null;
  }
  $('debugCount').textContent = n ? `${n} debug record${n === 1 ? '' : 's'} stored on this computer.` : 'No debug records stored.';
  return n;
}
// Saved at once (not with Save), so the banner always tells the truth.
$('debugEnabled').addEventListener('change', async () => {
  const on = $('debugEnabled').checked;
  await setDebugEnabled(on);
  setSaveMark($('debugMark'), 'saved');
  $('debugBanner').hidden = !on;
  $('debugOffChoice').hidden = on || (await showDebugCount()) === 0;
  await renderDebugSubmit();
});
$('debugKeep').addEventListener('click', () => { $('debugOffChoice').hidden = true; });
const deleteDebug = async () => {
  await clearDebug();
  $('debugOffChoice').hidden = true;
  await showDebugCount();
  await renderDebugSubmit();
  setStatus('Debug log deleted.', 'ok');
};
$('debugDelete').addEventListener('click', deleteDebug);
$('clearDebug').addEventListener('click', deleteDebug);
// What to do with a saved debug file. Nothing in the docs says to post it publicly, and it holds message text.
const DEBUG_FILE_NEXT = 'Debug file saved. Keep it to share with the developer. It includes message text.';
$('exportDebug').addEventListener('click', async () => {
  const file = debugExport(await readDebugAll(), messenger.runtime.getManifest().version);
  download(`preen-debug-${fileStamp()}.json`, JSON.stringify(file, null, 2));
  setStatus(DEBUG_FILE_NEXT, 'ok');
});

// --- Debug: send chosen messages to the Preen developer ----------------------------
// Only while debug mode is on, only the messages ticked, only after Preview or a confirm.
let debugRows = [];

async function renderDebugSubmit() {
  const on = $('debugEnabled').checked;
  $('debugSubmit').hidden = !on;
  if (!on) return;
  const ticked = new Set(chosenRows().map((r) => r.id));
  try {
    debugRows = submissionRows(await readAll(), await readDebugAll());
  } catch (e) {
    console.warn('Preen: could not read the debug log', e);
    $('debugList').replaceChildren(el('p', { className: 'help', textContent: `Could not read the debug log: ${e.message}` }));
    return;
  }
  $('debugList').replaceChildren(...(debugRows.length ? debugRows.map((r) => el('label', { className: 'debug-row' },
    el('input', { type: 'checkbox', checked: ticked.has(r.id), dataset: { id: r.id } }),
    el('span', { textContent: new Date(r.at).toLocaleDateString() }),
    el('span', { textContent: r.subject || '(no subject)' }),
    el('span', { className: 'tags', textContent: r.fixes.length
      ? `Tags: ${r.before.join(', ') || 'none'} → your correction: ${r.after.join(', ') || 'none'}`
      : `Tags: ${r.before.join(', ') || 'none'}` })))
    : [el('p', { className: 'help', textContent: 'No messages with debug records yet. Classify some mail while debug mode is on.' })]));
  showChosen();
}

function chosenRows() {
  const ids = new Set([...$('debugList').querySelectorAll('input[type="checkbox"]')].filter((c) => c.checked).map((c) => c.dataset.id));
  return debugRows.filter((r) => ids.has(r.id));
}

function showChosen() {
  const n = chosenRows().length;
  $('debugChosen').textContent = n ? `${n} message${n === 1 ? '' : 's'} chosen.` : '';
}
$('debugList').addEventListener('change', showChosen);

/** The submission for the ticked messages, or null (with a note) when none is ticked. */
async function chosenSubmission() {
  const rows = chosenRows();
  if (!rows.length) {
    setStatus('Tick at least one message first.', 'warn');
    return null;
  }
  const { apiKey } = await loadSettings();
  return { rows, submission: debugSubmission(rows, { version: messenger.runtime.getManifest?.()?.version, apiKey }) };
}

const saveSubmission = (submission) => {
  download(`preen-debug-submission-${fileStamp()}.json`, JSON.stringify(submission, null, 2));
  setStatus(DEBUG_FILE_NEXT, 'ok');
};
const messagesText = (n) => `${n} message${n === 1 ? '' : 's'}`;

$('debugPreview').addEventListener('click', async () => {
  const chosen = await chosenSubmission();
  if (!chosen) return;
  openData($('debugPreview'), {
    title: 'What would be sent to the Preen developer',
    text: `Exactly this, for ${messagesText(chosen.rows.length)}: each request as sent to Jev (it includes the message text with Deep), Jev's answer, Preen's decision and your correction. Nothing is sent from here.`,
    data: chosen.submission,
  });
});

$('debugSend').addEventListener('click', async () => {
  const chosen = await chosenSubmission();
  if (!chosen) return;
  const n = messagesText(chosen.rows.length);
  const send = async () => {
    const result = await sendSubmission(chosen.submission);
    setStatus(result.sent ? `Sent ${n} to the Preen developer.` : `Not sent: ${result.reason}.`, result.sent ? 'ok' : 'error');
  };
  openData($('debugSend'), {
    title: `Send ${n} to the Preen developer?`,
    text: SUBMIT_URL
      ? `This sends the data below (${n}, including message text) to the Preen developer. Nothing else is sent.`
      : `Preen can't send this yet: no server is set up. You can save the ${n} below as a file instead.`,
    data: chosen.submission,
    send: SUBMIT_URL ? send : null,
    save: () => saveSubmission(chosen.submission),
  });
});

$('exportSettings').addEventListener('click', () => {
  try {
    const includeApiKey = $('includeKey').checked;
    const file = exportSettings(readValidForm(), { includeApiKey });
    download(`preen-settings-${fileStamp()}.json`, JSON.stringify(file, null, 2));
    setStatus(includeApiKey
      ? 'Settings exported, including your API key. Keep the file somewhere safe.'
      : 'Settings exported (without your API key).', 'ok');
  } catch (e) {
    setStatus(`Can't export: ${e.message}`, 'error');
  }
});

$('importSettings').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  const result = parseSettingsFile(await file.text(), await loadSettings(), [...accountNames.keys()]);
  if (!result.settings) {
    setStatus(`Couldn't import “${file.name}”:\n${readableErrors(result.errors).join('\n')}`, 'error');
    return;
  }
  const notes = [...result.notes];
  if (result.incomingApiKey) {
    const last4 = (key) => (key ? `…${key.slice(-4)}` : '(none)');
    const useIt = await askDialog({
      title: 'Use the API key from this file?',
      message: `This file contains a different API key (${last4(result.incomingApiKey)}). `
        + `Your current key is ${last4(result.settings.apiKey)}.\n\n`
        + 'Only use a key from a file you made yourself: with someone else\'s key, your mail would be sent to their account.',
      confirmLabel: 'Use the key from the file',
      cancelLabel: 'Keep my current key',
      danger: true,
    });
    if (useIt) {
      result.settings.apiKey = result.incomingApiKey;
      notes.push('The API key from the file will be used once you click Save.');
    } else {
      notes.push('The file\'s API key was ignored; your current key was kept.');
    }
  }
  await render(result.settings);
  setDirty(true);
  setStatus(['Imported. Review the settings, then click Save to use them.', ...notes].join('\n'), 'warn');
});

$('statsReset').addEventListener('click', async () => {
  const yes = await askDialog({
    title: 'Reset your statistics?',
    message: 'This clears the monthly totals shown above. Your activity log and your tag corrections are kept. '
      + 'Until new mail is sorted, the cost per email in Provider & cost is a rough guess from your categories only. '
      + 'This can\'t be undone.',
    confirmLabel: 'Reset statistics',
    cancelLabel: 'Keep them',
    danger: true,
  });
  if (!yes) return;
  try {
    await resetStatistics();
  } catch (e) {
    setStatus(`Could not reset the statistics: ${e.message}`, 'error');
    return;
  }
  await Promise.all([renderStats(), loadAverageTokens()]);
});

$('undoLast').addEventListener('click', async () => {
  const { outcome, text } = await undoLastRun();
  $('undoNote').textContent = outcome === 'cancelled' ? '' : text;
  if (outcome === 'done') renderStats();
});

// Uses the saved settings: the mailboxes ticked and saved, the saved consent and limits.
$('trial').addEventListener('click', async () => {
  $('trial').disabled = true;
  try {
    const { text } = await startTrial();
    $('trialNote').textContent = text ?? '';
  } catch (e) {
    $('trialNote').textContent = `Couldn't start the trial: ${e.message}`;
  } finally {
    $('trial').disabled = false;
  }
});

for (const id of ['openActivity', 'navActivity']) {
  $(id).addEventListener('click', (event) => {
    event.preventDefault(); // the sidebar link's href is only a fallback
    showPage(ACTIVITY_PAGE);
  });
}

$('provider').addEventListener('change', async () => {
  updateModelPlaceholder();
  renderConsent();
  updateConnectionChip((await messenger.storage.local.get(CONNECTION_TEST_KEY))[CONNECTION_TEST_KEY]);
});
$('intervalUnit').addEventListener('change', () => {
  // Keep the same interval when switching units; minutes that aren't whole
  // hours round up, so checks never become more frequent than chosen.
  const value = Number($('intervalValue').value);
  if ($('intervalUnit').value === 'hours') $('intervalValue').value = Math.max(1, Math.ceil(value / 60));
  else $('intervalValue').value = value * 60;
  updateIntervalLimits();
});

// Moving mail needs Thunderbird's optional "messagesMove" permission.
// It must be requested straight from a click, so it's asked for here, not on Save.
async function askToMoveMail() {
  try {
    return await messenger.permissions.request(MOVE_PERMISSION);
  } catch (e) {
    console.warn('Preen: asking to move mail failed', e);
    return false;
  }
}

// "Move junk" can be on without the permission (saved before it was asked for, or
// revoked in Thunderbird): say so beside the box, with a button that asks.
async function updateMovePermissionNote() {
  let allowed = true;
  if ($('moveJunk').checked) {
    allowed = await messenger.permissions.contains(MOVE_PERMISSION).catch((e) => {
      console.warn('Preen: could not check the move-mail permission', e);
      return false;
    });
  }
  $('moveJunkNeedsPermission').hidden = allowed || !$('moveJunk').checked; // re-read: it may have changed meanwhile
}

$('moveJunk').addEventListener('change', async () => {
  if ($('moveJunk').checked && !(await askToMoveMail())) {
    $('moveJunk').checked = false;
    setStatus('Preen needs Thunderbird\'s permission to move mail before it can move junk. Nothing was changed.', 'error');
  }
  await updateMovePermissionNote();
});

$('allowMove').addEventListener('click', async () => {
  if (!(await askToMoveMail())) setStatus('Thunderbird didn\'t allow moving mail, so junk stays where it is.', 'error');
  await updateMovePermissionNote();
});

// Dry run is a switch in Advanced.
// Turning it off asks first, so the form's own "unsaved" listener skips it.

$('dryRun').addEventListener('change', () => {
  if (!$('dryRun').checked) {
    $('dryRun').checked = true;
    $('dryConfirm').hidden = false;
    $('dryKeep').focus();
    return;
  }
  $('dryConfirm').hidden = true;
  updateDryRunChip();
  markDirty();
});
function keepDryRun() {
  $('dryConfirm').hidden = true;
  $('dryRun').focus();
}
$('dryKeep').addEventListener('click', keepDryRun);
// Esc answers "Keep dry run on", the safe choice.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('dryConfirm').hidden) keepDryRun();
});
$('dryOff').addEventListener('click', () => {
  $('dryConfirm').hidden = true;
  $('dryRun').checked = false;
  updateDryRunChip();
  markDirty();
  $('dryRun').focus();
});

// --- Statistics ----------------------------------------------------------------------

const asCount = (n) => Number(n || 0).toLocaleString();
const STAT_ROWS = [
  ['messages', 'Messages sorted', asCount],
  ['tokens', 'Tokens', formatTokens],
  ['costUsd', 'Estimated cost', formatUsd],
  ['applied', 'Messages changed', asCount],
  ['person', 'Real person tags', asCount],
  ['needsReply', 'Needs reply tags', asCount],
  ['toDo', 'To-do messages', asCount],
  ['junk', 'Marked as junk', asCount],
  ['corrections', 'Your tag corrections', asCount],
];
// Detail tables: [title, [[label, read(totals) → number], ...]]. Counts only.
const ERROR_LABELS = {
  auth: 'API key refused', rate_limit: 'Too many requests', server: 'Provider server error', network: 'Network error',
  timeout: 'No answer in time', bad_request: 'Request refused', bad_response: 'Unreadable answer', internal: 'Preen error',
};
const LATENCY_LABELS = { lt1s: 'Under 1 s', '1to2s': '1–2 s', '2to5s': '2–5 s', '5to10s': '5–10 s', '10sPlus': 'Over 10 s' };
const STAT_GROUPS = [
  ['Errors (messages)', [
    ...Object.entries(ERROR_LABELS).map(([k, label]) => [label, (t) => t.errors[k]]),
    ['Not tried after an error', (t) => t.stoppedAfterError],
  ]],
  ['Skipped or text not sent', [
    ['Limit reached', (t) => t.skips.limitReached], ['Waiting for your OK', (t) => t.skips.awaitingConsent],
    ['Encrypted', (t) => t.skips.encrypted], ['Message too large', (t) => t.skips.tooLarge],
    ['No readable text', (t) => t.skips.noText], ['You corrected it', (t) => t.skips.corrected],
    ['Other', (t) => t.skips.other],
  ]],
  ['Runs', [
    ['Changed messages', (t) => t.runs.applied], ['Dry run', (t) => t.runs.dryRun], ['Preview', (t) => t.runs.preview],
    ['Automatic', (t) => t.runs.automatic], ['Started by you', (t) => t.runs.manual],
  ]],
  ['Corrections by tag', [
    ['Real person', (t) => t.corrected.person], ['Needs reply', (t) => t.corrected.needsReply],
    ['Junk', (t) => t.corrected.junk], ['Category tags', (t) => t.corrected.category],
  ]],
  ['Decided without a tag', [
    ['Marked for review (no category)', (t) => t.review],
  ]],
  ['Depth and undo', [
    ['Surface (no text)', (t) => t.depth.surface], ['Deep (with text)', (t) => t.depth.deep],
    ['Runs undone', (t) => t.undo.runs], ['Messages restored', (t) => t.undo.messages],
  ]],
  ['Response time', Object.keys(PROVIDERS).flatMap((p) => Object.entries(LATENCY_LABELS)
    .map(([k, label]) => [`${PROVIDERS[p].label} ${label}`, (t) => t.latency[p]?.[k] ?? 0]))],
];
const dateText = (ms) => new Date(ms).toLocaleDateString();
const monthText = (month) => {
  const [y, m] = String(month).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

/** Column headings: the real month, and where the totals start. */
function statHeaders(totals, state) {
  const since = totals.since ? monthText(totals.since) : state.statsResetAt ?? state.firstSeen;
  return [
    monthText(monthKey(new Date())),
    since ? `Since ${typeof since === 'number' ? dateText(since) : since}` : 'All time',
  ];
}

/** Your totals, counted on this computer. */
async function renderStats() {
  let totals;
  let state;
  try {
    [totals, state] = await Promise.all([readTotals(), readTelemetryState()]);
  } catch (e) {
    console.warn('Preen: could not read the statistics', e);
    $('statsSince').textContent = `Could not read the history: ${e.message}`;
    return;
  }
  const heads = statHeaders(totals, state);
  const head = () => el('thead', {}, el('tr', {}, el('th', {}, ''), ...heads.map((h) => el('th', {}, h))));
  const rows = STAT_ROWS.map(([key, label, format]) => el('tr', {},
    el('th', {}, label), el('td', {}, format(totals.thisMonth[key])), el('td', {}, format(totals.allTime[key]))));
  $('statsTotals').replaceChildren(head(), el('tbody', {}, ...rows));
  // Response times: only providers' rows that have a count, to keep it short.
  const tables = STAT_GROUPS.map(([title, items]) => {
    const shown = title === 'Response time' ? items.filter(([, read]) => read(totals.allTime) > 0) : items;
    const body = shown.length
      ? shown.map(([label, read]) => el('tr', {}, el('th', {}, label), el('td', {}, asCount(read(totals.thisMonth))), el('td', {}, asCount(read(totals.allTime)))))
      : [el('tr', {}, el('th', {}, 'None yet'), el('td', {}, '0'), el('td', {}, '0'))];
    return el('table', { className: 'stats' }, el('caption', {}, title), head(), el('tbody', {}, ...body));
  });
  $('statsDetail').replaceChildren(...tables);
  const categories = Object.entries(totals.categories).sort((a, b) => b[1] - a[1]);
  $('statsSince').textContent = [
    state.firstSeen ? `Using Preen since ${dateText(state.firstSeen)}.` : '',
    state.statsResetAt ? `Statistics reset ${dateText(state.statsResetAt)}.` : '',
    totals.since ? `History from ${totals.since}.` : 'No messages sorted yet.',
    categories.length ? `By category: ${categories.map(([name, n]) => `${name} ${n}`).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

// One dialog shows exact data (a report, a debug submission) before anything leaves.
let dataOpener = null;
let dataActions = {};

function openData(opener, { title, text, data, save = null, send = null }) {
  const dialog = $('dataDialog');
  $('dataTitle').textContent = title;
  $('dataText').textContent = text;
  $('dataJson').textContent = JSON.stringify(data, null, 2);
  dataActions = { save, send };
  $('dataSave').hidden = !save;
  $('dataSend').hidden = !send;
  dataOpener = opener;
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open', '');
  $('dataClose').focus();
}

function closeData() {
  const dialog = $('dataDialog');
  if (dialog.close) dialog.close();
  else dialog.removeAttribute('open');
  dataOpener?.focus();
  dataOpener = null;
  dataActions = {};
}
$('dataClose').addEventListener('click', closeData);
$('dataDialog').addEventListener('click', (event) => {
  if (event.target === $('dataDialog')) closeData();
});
for (const [id, key] of [['dataSave', 'save'], ['dataSend', 'send']]) {
  $(id).addEventListener('click', async () => {
    const action = dataActions[key];
    closeData();
    if (action) await action();
  });
}


// --- Blotter: what Save would change -------------------------------------------------
// Each control is compared with the value it showed at load or at the last Save; the
// parts the page builds while it runs (categories, accounts, speed) are compared whole.
// Consent and debug mode are saved at once and the backup controls aren't settings.
const NOT_IN_BLOTTER = new Set(['includeKey', 'importFile', 'debugEnabled', 'consentDepth']);
const BUILT_PARTS = '#categories, #accounts, #accountsIncluded, #debugSubmit';

const blotterControls = () => [...$('settings').querySelectorAll('input, select, textarea')]
  .filter((c) => c.id && !NOT_IN_BLOTTER.has(c.id) && !c.closest(BUILT_PARTS));

/** A node's text without its info tips and "optional" notes. */
function ownText(node) {
  return [...node.querySelectorAll('.tip, .opt')].reduce((t, n) => t.replace(n.textContent, ''), node.textContent).trim();
}

function shownValue(c) {
  if (c.type === 'checkbox') return c.checked ? 'On' : 'Off';
  if (c.tagName === 'SELECT') return [...c.options].find((o) => o.value === c.value)?.textContent ?? c.value;
  if (c.type === 'password') return c.value ? `••••${c.value.slice(-4)}` : '(empty)';
  return c.value.trim() === '' ? '(empty)' : c.value.trim();
}

const sectionOf = (node) => node.closest('section.card')?.querySelector('h2')?.textContent ?? '';

function controlLabel(c) {
  const label = document.querySelector(`label[for="${c.id}"]`);
  if (!label) return ownText(c.closest('label')?.querySelector('.t') ?? c.closest('label') ?? c) || c.getAttribute('aria-label') || c.id;
  // "Certainty required" appears once per question: name the question too.
  const group = c.closest('.sub')?.querySelector('h4');
  return group ? `${ownText(group)}: ${ownText(label)}` : ownText(label);
}

const speedName = (speed) => $('speedButtons').querySelector(`[data-speed="${speed}"]`)?.textContent ?? speed;
const countCategories = (list) => `${list.length} categor${list.length === 1 ? 'y' : 'ies'}`;

function takeSnapshot() {
  snapshot = structuredClone(readForm());
  snapshotValues = new Map(blotterControls().map((c) => [c.id, shownValue(c)]));
}

function blotterRows() {
  if (!snapshot) return [];
  const rows = [];
  for (const c of blotterControls()) {
    const before = snapshotValues.get(c.id);
    const after = shownValue(c);
    if (before !== undefined && before !== after) rows.push({ section: sectionOf(c), label: controlLabel(c), before, after });
  }
  const form = readForm();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (form.speed !== snapshot.speed) {
    rows.push({ section: sectionOf($('speedButtons')), label: 'Speed', before: speedName(snapshot.speed), after: speedName(form.speed) });
  }
  if (!same(form.categories, snapshot.categories)) {
    const after = countCategories(form.categories);
    rows.push({ section: sectionOf($('categories')), label: 'Categories', before: countCategories(snapshot.categories),
      after: form.categories.length === snapshot.categories.length ? `${after}, edited` : after });
  }
  if (!same([form.scope, form.depth.accounts], [snapshot.scope, snapshot.depth.accounts])) {
    rows.push({ section: sectionOf($('accounts')), label: 'Mailboxes, folders and depth', before: 'as saved', after: 'changed' });
  }
  if (form.automation.enabled !== snapshot.automation.enabled) {
    const state = (on) => (on ? 'On' : 'Paused');
    rows.push({ section: sectionOf($('autoNow')), label: 'Running', before: state(snapshot.automation.enabled), after: state(form.automation.enabled) });
  }
  return rows;
}

function renderBlotter() {
  let rows = [];
  try {
    if (dirty) rows = blotterRows();
  } catch (e) {
    console.warn('Preen: could not list the unsaved changes', e);
  }
  $('blotter').hidden = !dirty;
  document.body.classList.toggle('has-changes', dirty);
  $('dirtyLabel').textContent = rows.length ? `${rows.length} unsaved` : 'Unsaved changes';
  $('blCount').textContent = rows.length
    ? `${rows.length} unsaved change${rows.length === 1 ? '' : 's'}`
    : 'Nothing differs from the saved settings.';
  $('blList').replaceChildren(...rows.map((r) => el('li', {},
    el('div', { className: 'bs' }, r.section),
    el('div', { className: 'bf' }, r.label),
    el('div', { className: 'bv' }, el('s', {}, r.before), ' → ', r.after))));
}

// Discard puts the form back as last loaded or saved; consent and debug mode were saved at once, so they stay.
$('discard').addEventListener('click', async () => {
  if (!snapshot) return;
  $('dryConfirm').hidden = true;
  await render({ ...structuredClone(snapshot), consent, debug: { enabled: $('debugEnabled').checked } });
  clearTimeout(savedTimer);
  setDirty(false);
  setStatus('Changes discarded.', 'ok');
});

// --- Modes: Simple / Standard / Everything ---------------------------------------------
// Sections, rail items and fields carry data-min (1 Simple, 2 Standard, 3 Everything) and are
// hidden above the chosen mode. The choice is remembered per viewer; the page works without
// storage. Hidden cards stay in the form, so their changes are still saved and listed in the Blotter.
const MODE_KEY = 'preen.settings.mode';
const MODES = ['simple', 'standard', 'everything'];
const MODE_NAMES = { simple: 'Simple', standard: 'Standard', everything: 'Everything' };
const feathers = (count) => Array.from({ length: count }, () => icon('feather'));
let mode = 'standard';

function setMode(next, { remember = true } = {}) {
  mode = next;
  const level = MODES.indexOf(next) + 1;
  for (const node of document.querySelectorAll('[data-min]')) node.hidden = Number(node.dataset.min) > level;
  for (const seg of document.querySelectorAll('#modeSeg [data-mode]')) {
    seg.setAttribute('aria-checked', String(seg.dataset.mode === next));
    seg.tabIndex = seg.dataset.mode === next ? 0 : -1;
    seg.querySelector('.fs').replaceChildren(...feathers(MODES.indexOf(seg.dataset.mode) + 1));
  }
  for (const tile of document.querySelectorAll('[data-pick]')) {
    tile.setAttribute('aria-pressed', String(tile.dataset.pick === next));
    tile.querySelector('.fs').replaceChildren(...feathers(MODES.indexOf(tile.dataset.pick) + 1));
  }
  if (remember) {
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // no storage: the choice lasts until the page closes
    }
  }
  markRail();
}

/** The lowest mode that shows this node: the highest data-min among it and its parents. */
function modeShowing(node) {
  let need = 1;
  for (let n = node.closest('[data-min]'); n; n = n.parentElement?.closest('[data-min]')) {
    need = Math.max(need, Number(n.dataset.min));
  }
  return MODES[need - 1];
}

for (const tile of document.querySelectorAll('[data-pick]')) {
  tile.addEventListener('click', () => {
    setMode(tile.dataset.pick);
    $('modeChooser').hidden = true;
  });
}
$('chooseLater').addEventListener('click', () => {
  setMode(mode);
  $('modeChooser').hidden = true;
});
// The Mode switch in the top bar: shows the mode and changes it. Arrow keys move between the three.
for (const seg of document.querySelectorAll('#modeSeg [data-mode]')) {
  seg.addEventListener('click', () => {
    setMode(seg.dataset.mode);
    $('modeChooser').hidden = true;
  });
}
$('modeSeg').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const next = MODES[(MODES.indexOf(mode) + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
  setMode(next);
  $('modeChooser').hidden = true;
  $('modeSeg').querySelector(`[data-mode="${next}"]`).focus();
});

// --- Find a setting (box in the rail, Ctrl+K) -------------------------------------------

function findSetting(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return [...$('main').querySelectorAll('h2, h4, label, .label, .t')].find((n) => ownText(n).toLowerCase().includes(q)) ?? null;
}

/** The control a matching label or heading belongs to (a heading of a card: the card). */
function controlFor(node) {
  if (node.tagName === 'LABEL' && node.getAttribute('for')) return $(node.getAttribute('for')) ?? node;
  const inLabel = node.closest('label')?.querySelector('input, select, textarea');
  if (inLabel) return inLabel;
  if (node.tagName === 'H2') return node.closest('section.card');
  return node.closest('.field, .sub')?.querySelector('input, select, textarea, button') ?? node.closest('section.card') ?? node;
}

function openFind() {
  $('findWrap').classList.add('open');
  $('find').focus();
  $('find').select?.();
}

function closeFind() {
  $('findWrap').classList.remove('open');
  $('findNote').hidden = true;
}

$('findBtn').addEventListener('click', openFind);
$('find').addEventListener('input', () => {
  const hit = findSetting($('find').value);
  $('findNote').textContent = hit ? `Enter: ${ownText(hit)}` : 'No setting matches.';
  $('findNote').hidden = !$('find').value.trim();
});
$('find').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFind();
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const hit = findSetting($('find').value);
  if (!hit) return;
  closeFind();
  jumpTo(controlFor(hit));
});

// Ctrl+K finds a setting; Ctrl+S saves when there is something to save.
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key?.toLowerCase();
  if (key === 'k') {
    event.preventDefault();
    openFind();
  } else if (key === 's') {
    event.preventDefault();
    if (dirty) $('settings').requestSubmit?.();
  }
});

// --- "About this section" ---------------------------------------------------------------
// Each card's header icon opens one shared dialog with that section's text; Esc, Close or
// a click outside closes it, and the focus goes back to the icon.
let helpOpener = null;

function openHelp(button) {
  const dialog = $('helpDialog');
  $('helpTitle').textContent = sectionOf(button);
  $('helpText').textContent = SECTION_HELP[button.dataset.help] ?? '';
  helpOpener = button;
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open', '');
  $('helpClose').focus();
}

function helpClosed() {
  helpOpener?.focus();
  helpOpener = null;
}

function closeHelp() {
  const dialog = $('helpDialog');
  if (dialog.close) dialog.close(); // fires 'close'
  else {
    dialog.removeAttribute('open');
    helpClosed();
  }
}

for (const button of document.querySelectorAll('.sec-help')) button.addEventListener('click', () => openHelp(button));
$('helpClose').addEventListener('click', closeHelp);
$('helpDialog').addEventListener('close', helpClosed);
// The dialog's box fills it, so a click on the dialog itself is a click on the backdrop.
$('helpDialog').addEventListener('click', (event) => {
  if (event.target === $('helpDialog')) closeHelp();
});

// --- Jumps within the page ------------------------------------------------------
// Links to a section or control (side rail, setup steps, chips, Find) scroll the main
// column so the card's top sits at the top of it. A control far down a long card is
// brought to the top instead, so it stays in view. Then the control (or the card's
// heading) gets the focus.
const JUMP_GAP = 20; // the main column's top padding

function jumpTo(target) {
  const main = $('main');
  const card = target.closest('section.card') ?? target;
  const showing = modeShowing(target);
  if (MODES.indexOf(showing) > MODES.indexOf(mode)) { // a section the mode hides is revealed first
    setMode(showing);
    setStatus(`Switched to ${MODE_NAMES[showing]} to show this setting.`, 'ok');
  }
  if ($('setupBody').hidden && target.closest('#setupBody')) {
    setupOpen = true;
    showSetupBody();
  }
  reveal(target); // a collapsed category or account row around a control
  if (main.getBoundingClientRect && target.getBoundingClientRect) {
    const top = main.getBoundingClientRect().top;
    let y = card.getBoundingClientRect().top - top + main.scrollTop - JUMP_GAP;
    const targetY = target.getBoundingClientRect().top - top + main.scrollTop;
    if (targetY - y > main.clientHeight - 80) y = targetY - JUMP_GAP - 40;
    main.scrollTop = Math.max(0, y);
  }
  const focusable = target === card ? card.querySelector('h2') : target;
  focusable?.focus({ preventScroll: true });
  markRail();
}

document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href^="#"]');
  const href = link?.getAttribute('href') ?? '';
  const target = href.startsWith('#') && href.length > 1 && document.getElementById(href.slice(1));
  if (!target) return;
  event.preventDefault();
  jumpTo(target);
});

// Categories on/off: off hides the list (kept as it is) and crosses Categories out in the rail.
function showCategoriesOn() {
  const on = $('categoriesOn').checked;
  $('categoriesOnLabel').textContent = on ? 'On' : 'Off';
  $('categoriesBody').hidden = !on;
  $('categoriesIntro').hidden = !on;
  $('categoriesOffNote').hidden = on;
  $('s-categories').classList.toggle('is-off', !on);
  document.querySelector('nav.rail a[href="#s-categories"]').classList.toggle('off', !on);
  updateDescriptionCost();
}
$('categoriesOn').addEventListener('change', showCategoriesOn);

// The rail marks the section at the top of the main column.
const railLinks = [...document.querySelectorAll('nav.rail a')].filter((a) => a.getAttribute('href').startsWith('#'));
function markRail() {
  const main = $('main');
  if (!main.getBoundingClientRect) return;
  const top = main.getBoundingClientRect().top + JUMP_GAP + 40;
  let current = railLinks[0];
  for (const a of railLinks) {
    const section = document.getElementById(a.getAttribute('href').slice(1));
    if (section && !section.hidden && section.getBoundingClientRect().top <= top) current = a;
  }
  for (const a of railLinks) {
    a.classList.toggle('active', a === current);
    if (a === current) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}
$('main').addEventListener('scroll', markRail);
$('depthDefault').addEventListener('change', () => {
  syncConsentDepth();
  updateDepthHelp();
});
$('accountsIncluded').addEventListener('change', updateAutomationFields);
$('autoResume').addEventListener('click', () => {
  resumeFlag = true;
  markDirty();
  updateAutomationFields();
  setStatus('Automatic processing resumes when you click Save.', 'warn');
});
for (const id of ['intervalValue', 'intervalUnit', 'unreadOnly']) $(id).addEventListener('change', describeAutomation);
$('maxAgeDays').addEventListener('input', describeAutomation);
$('trigger').addEventListener('change', updateAutomationFields);
$('tCategory').addEventListener('input', () => categoryEditor.set(categoryEditor.get()));
$('personalContext').addEventListener('input', updateContextCounter);
$('recipientLanguages').addEventListener('input', updateLanguagesCounter);
$('price').addEventListener('input', () => {
  updateDescriptionCost();
  updateCostLimitField();
});
$('monthlyCost').addEventListener('input', updateCostExamples);

// Any edit in the form counts as an unsaved change (except the backup controls, and
// dry run, which marks it itself once a change is confirmed).
for (const type of ['input', 'change']) {
  $('settings').addEventListener(type, (event) => {
    // The debug submission list is a choice of messages, not a setting.
    if (event.target.closest?.('#debugSubmit')) return;
    if (!NOT_IN_BLOTTER.has(event.target.id) && event.target.id !== 'dryRun') markDirty();
  });
}
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = ''; // older engines show the prompt only when this is set
});

// The top bar's height changes (status lines, narrow windows), so the sticky
// sidebar and the scroll offsets follow it instead of a fixed number.
function trackHeaderHeight() {
  const header = document.querySelector('header.topbar');
  const set = () => document.documentElement.style.setProperty('--head-h', `${header.offsetHeight}px`);
  set();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(set).observe(header);
}

trackHeaderHeight();
const version = messenger.runtime?.getManifest?.()?.version;
$('version').textContent = version ? `v${version}` : '';
fillProviders();
modeOptions($('depthDefault'), false);
modeOptions($('consentDepth'), false);
fillDepthDefinitions();
const initial = await loadSettings();
await render(initial);
showCorrectionsCount(); // after render: the suggestions read the level fields
loadAverageTokens();
showDebugCount();
renderStats();
renderDebugSubmit();
// Keep the corrections card current while Settings stays open: a correction is
// written to the history too, which announces every write.
messenger.runtime.onMessage.addListener((message) => {
  if (message?.type === ACTIVITY_UPDATED) {
    showCorrectionsCount();
    loadAverageTokens();
    showDebugCount();
    renderDebugSubmit();
    renderStats();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  showCorrectionsCount();
  showDebugCount();
  renderDebugSubmit();
});
takeSnapshot();
setDirty(false);
let remembered = null;
try {
  remembered = window.localStorage.getItem(MODE_KEY);
} catch {
  // no storage: start in Standard and ask
}
if (!MODES.includes(remembered)) remembered = null;
setMode(remembered ?? 'standard', { remember: false });
$('modeChooser').hidden = remembered !== null;
await renderSetup(initial);
await renderSenderRules();
markRail();
