// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Toolbar popup: status at a glance and the most common actions.

import { loadSettings, setAutomationEnabled } from '../../storage/settings.js';
import { readQueue, readUsage, readStatus, updateStatus } from '../../storage/state.js';
import { formatTokens, formatUsd, averageTokens, estimateRun } from '../../core/cost.js';
import { readSummaries } from '../../storage/activity-log.js';
import { RUN_NOW, CLASSIFY_IDS } from '../../core/protocol.js';
import { correctedText } from '../../core/run-summary.js';
import { showPage, ACTIVITY_PAGE, OPTIONS_PAGE } from '../shared/pages.js';
import { automationState } from '../../core/automation.js';
import { collectPages } from '../../mail/paging.js';
import { $ } from '../shared/ui.js';
import { undoLastRun } from '../shared/undo-last.js';
import { startTrial } from '../shared/trial.js';


function line(label, value, className = '') {
  const row = document.createElement('p');
  row.className = 'row';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = className;
  v.textContent = value;
  row.append(l, v);
  return row;
}

async function render() {
  const [settings, queue, usage, status] = await Promise.all([loadSettings(), readQueue(), readUsage(), readStatus()]);
  const state = automationState(settings);
  const on = state === 'on';
  $('state').textContent = on ? (settings.dryRun ? 'On · dry run' : 'On') : state === 'off' ? 'Off' : 'Paused';
  $('state').className = `pill state-pill ${state}`;
  $('toggle').textContent = on ? 'Pause' : 'Resume';
  // With no mailbox ticked there is nothing to pause: the mailboxes are chosen in Settings.
  $('toggle').hidden = state === 'off';
  const l = settings.limits;
  $('lines').replaceChildren(...[
    line('Waiting', String(queue.length)),
    line('Today', `${usage.dayMessages}${l.dailyMessages ? ` / ${l.dailyMessages}` : ''} messages · ${formatTokens(usage.dayTokens)} tokens`),
    line('This month', `${formatTokens(usage.monthTokens)} tokens`),
    status.blockedReason ? line('Limit', status.blockedReason, 'warn') : null,
    status.lastError ? line('Problem', status.lastError, 'err') : null,
  ].filter(Boolean));
  const corrected = status.lastCorrected;
  $('corrected').hidden = !corrected;
  if (corrected) $('correctedText').textContent = `${correctedText(corrected.ids.length)} `;
  await showEstimate(settings);
}

async function selectedIds() {
  const ids = [];
  await collectPages(await messenger.mailTabs.getSelectedMessages(), (m) => { ids.push(m.id); });
  return ids;
}

// Classify and Preview both send each message to the provider, so with several messages
// selected the popup says roughly what that costs, from the average of Preen's past use.
const SEVERAL = 2;

async function showEstimate(settings) {
  const note = $('estimate');
  note.hidden = true;
  try {
    const count = (await selectedIds()).length;
    const estimate = count >= SEVERAL ? estimateRun(count, averageTokens(await readSummaries()), settings.pricePerMillionInputTokens) : null;
    if (!estimate) return;
    note.textContent = `Classifying or previewing these ${count} messages: about ${formatTokens(estimate.tokens)} tokens`
      + `${estimate.usd === null ? '' : `, about ${formatUsd(estimate.usd)}`} (an estimate from your past use).`;
    note.hidden = false;
  } catch (e) {
    console.warn('Preen: could not estimate the cost of the selection', e);
  }
}

async function classifySelected(apply) {
  try {
    const ids = await selectedIds();
    if (!ids.length) {
      $('message').textContent = 'Select some messages first.';
      return;
    }
    await messenger.runtime.sendMessage({ type: CLASSIFY_IDS, ids, apply, selected: ids.length });
    window.close();
  } catch (e) {
    $('message').textContent = `Couldn't read the selection: ${e.message}`;
  }
}

$('runNow').addEventListener('click', async () => {
  $('runNow').disabled = true;
  $('message').textContent = 'Running…';
  const result = await messenger.runtime.sendMessage({ type: RUN_NOW }).catch((e) => ({ error: e.message }));
  $('message').textContent = result?.error
    ? `Run failed: ${result.error}`
    : result ? `Done: ${result.classified} classified, ${result.remaining} waiting.` : 'Nothing to do.';
  $('runNow').disabled = false;
  render();
});

$('toggle').addEventListener('click', async () => {
  const settings = await loadSettings();
  await setAutomationEnabled(!settings.automation.enabled);
  render();
});

$('classify').addEventListener('click', () => classifySelected(true));
$('preview').addEventListener('click', () => classifySelected(false));

// Classify anyway: only the corrected messages the last Classify left alone.
$('correctedAnyway').addEventListener('click', async () => {
  const { lastCorrected: corrected } = await readStatus();
  if (!corrected) return;
  await updateStatus({ lastCorrected: null });
  await messenger.runtime.sendMessage({
    type: CLASSIFY_IDS, ids: corrected.ids, apply: corrected.apply, selected: corrected.ids.length, anyway: true,
  });
  window.close();
});

$('trial').addEventListener('click', async () => {
  $('trial').disabled = true;
  try {
    const { outcome, text } = await startTrial();
    if (text) $('message').textContent = text;
    if (outcome === 'started') window.close();
  } catch (e) {
    $('message').textContent = `Couldn't start the trial: ${e.message}`;
  } finally {
    $('trial').disabled = false;
  }
});

$('undoLast').addEventListener('click', async (e) => {
  e.preventDefault();
  const { outcome, text } = await undoLastRun();
  if (outcome !== 'cancelled') $('message').textContent = text;
  if (outcome === 'done') render();
});

$('activity').addEventListener('click', (e) => {
  e.preventDefault();
  showPage(ACTIVITY_PAGE).finally(() => window.close());
});
$('settings').addEventListener('click', (e) => {
  e.preventDefault();
  showPage(OPTIONS_PAGE).finally(() => window.close());
});

render();
