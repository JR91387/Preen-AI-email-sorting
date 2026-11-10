// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage, waitFor, waitForTick } from './page-env.js';
import { appendEntries, readAll, clearLog } from '../../apps/thunderbird/storage/activity-log.js';
import { RUN_NOW, STOP_RUNS } from '../../packages/shared/core/protocol.js';

const { document, env } = setUpPage('activity/activity');
document.querySelector('header.topbar').offsetHeight = 96;
await import('../../apps/thunderbird/ui/activity/activity.js');
await waitFor(() => document.getElementById('summary').children.length > 0 && document.getElementById('status').children.length > 0);
// The export download revokes its link after 10 s; timers are mocked so nothing waits for that.
mock.timers.enable({ apis: ['setTimeout'] });

const $ = (id) => document.getElementById(id);
const click = (id) => Promise.all(($(id).listeners.click ?? []).map((fn) => fn({ target: $(id), preventDefault() {} })));
const settle = () => tick();
/** Waits for Preen's dialog, returns its text, and answers it (the "yes" button or the other one). */
async function answerDialog(yes) {
  await waitForTick(() => document.getElementById('preenDialog'));
  const shown = text(document.getElementById('preenDialog'));
  const button = document.getElementById(yes || !document.getElementById('dialogNo') ? 'dialogYes' : 'dialogNo');
  button.listeners.click.forEach((fn) => fn({ target: button }));
  await settle();
  assert.equal(document.getElementById('preenDialog'), null, 'dialog closes');
  return shown;
}
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

test('activity page loads and shows its summary and status', () => {
  assert.ok($('summary').children.length > 0);
  assert.ok($('status').children.length > 0);
  assert.equal($('empty').hidden, false, 'empty history message shown');  // No mailbox ticked: automatic processing is off, with nothing to pause (#17).
  assert.match($('status').textContent, /Off: no mailbox is ticked in Settings → Automatic processing/);
  assert.equal($('toggle').hidden, true);
  assert.match($('autoChip').textContent, /Automatic processing off/);
});

test('every action button is in the sticky top bar, with its own handler', () => {
  const ids = ['runNow', 'stop', 'toggle', 'undoLast', 'exportCsv', 'exportJson', 'clear', 'settings'];
  for (const id of ids) {
    assert.ok($(id), `#${id} exists`);
    assert.ok($(id).closest('.topbar'), `#${id} is in the top bar`);
    assert.equal($(id).tagName, 'BUTTON');
    assert.ok($(id).listeners.click?.length, `#${id} has a click handler`);
  }
  // Nothing is left behind in the page body.
  assert.equal([...document.querySelectorAll('main button')].filter((b) => ids.includes(b.id)).length, 0);
});

test('status chips: dry run and automatic processing', () => {
  assert.ok($('dryChip').hidden, 'dry run chip shows only while dry run is on');
  assert.match(text($('autoChip')), /Automatic processing off/);
  assert.ok($('autoChip').classList.contains('warn'));
});

test('Pause / Resume turns automatic processing on and off', async () => {
  assert.equal($('toggle').textContent, 'Resume');
  await click('toggle');
  assert.equal((await env.messenger.storage.local.get('settings')).settings.automation.enabled, true);
  await click('toggle');
  const { settings } = await env.messenger.storage.local.get('settings');
  assert.equal(settings.automation.enabled, false);
  assert.equal('categories' in settings, false, 'only automation.enabled is written, not the merged defaults');
});

test('Run now asks the background to run, then restores its label', async () => {
  await click('runNow');
  assert.ok(env.calls.sent.some((m) => m.type === RUN_NOW));
  assert.equal($('runNow').textContent, 'Run now');
  assert.equal($('runNow').disabled, false);
});

test('Settings opens the settings page', async () => {
  let opened = 0;
  env.messenger.runtime.openOptionsPage = () => { opened++; };
  await click('settings');
  assert.equal(opened, 1);
});

test('Undo last run says so when nothing was applied', async () => {
  const pending = click('undoLast');
  assert.match(await answerDialog(true), /no applied changes to undo/);
  await pending;
});

test('Undo last run asks in a Preen dialog naming the count; declining changes nothing', async () => {
  await appendEntries([{ at: new Date().toISOString(), runId: 'run-undo', tags: [], reasons: [], applied: { changes: [{ add: ['x'] }] } }]);
  const pending = click('undoLast');
  assert.match(await answerDialog(false), /Undo the last run\?.*Undo Preen's changes to 1 message from the run at/);
  await pending;
  assert.equal((await readAll()).some((e) => e.undoneAt), false, 'declined: nothing undone');
  await clearLog();
});

test('Export CSV and Export JSON each start a download of the history', async () => {
  const blobs = [];
  const create = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
  try {
    await click('exportCsv');
    await click('exportJson');
  } finally {
    URL.createObjectURL = create;
  }
  assert.deepEqual(blobs.map((b) => b.type), ['text/csv', 'application/json']);
  // The download has no dialog, so the page says where the file went (#21).
  assert.equal($('exportNote').hidden, false);
  assert.match(text($('exportNote')), /^Export started: preen-history-.*\.json goes where Thunderbird saves downloads/);
  mock.timers.tick(20000);
  assert.equal($('exportNote').hidden, true, 'the note goes away after a while');
});

test('a run that left messages unprocessed at a limit shows a banner; a full run clears it (#20)', async () => {
  assert.equal($('skipBanner').hidden, true, 'nothing skipped yet');
  const lastSkipped = { at: new Date().toISOString(), count: 102, total: 102, reason: 'Daily limit of 500 messages reached (change it in Settings → Limits & allowance)' };
  await env.messenger.storage.local.set({ status: { lastSkipped } });
  env.storageChanged({ status: { newValue: { lastSkipped } } });
  for (let i = 0; i < 4; i++) await settle();
  assert.equal($('skipBanner').hidden, false);
  assert.match(text($('skipText')), /^Run at .+: 102 of 102 messages were not processed\. Daily limit of 500 messages reached/);
  await env.messenger.storage.local.set({ status: { lastSkipped: null } });
  env.storageChanged({ status: { newValue: { lastSkipped: null } } });
  for (let i = 0; i < 4; i++) await settle();
  assert.equal($('skipBanner').hidden, true);
  // Dismiss clears it for good.
  await env.messenger.storage.local.set({ status: { lastSkipped } });
  env.storageChanged({ status: { newValue: { lastSkipped } } });
  for (let i = 0; i < 4; i++) await settle();
  await click('skipDismiss');
  assert.equal($('skipBanner').hidden, true);
  assert.equal((await env.messenger.storage.local.get('status')).status.lastSkipped, null);
});

test('a message kept from the AI shows in the log, even one saved with empty header hints (0.0.19 lab crash)', async () => {
  await appendEntries([{
    at: new Date().toISOString(), runId: 'r19', runKind: 'applied', mode: 'deep', decidedBy: 'local', passes: [],
    tags: [], sensitive: true, reasons: ['Not sent to the AI: contains a payment card number (found on this computer)'],
    scores: {}, signals: {}, subject: 'x', from: 'y', inputTokens: 0,
  }]);
  await click('more');
  await settle();
  assert.match(text($('rows')), /Not sent to the AI/);
  assert.match(text($('rows')), /not sent to the AI \(checked on this computer\)/);  await clearLog();
});

test('A-6: a failed message lookup says "could not load", not "no longer available"', async () => {
  const realQuery = env.messenger.messages.query;
  env.messenger.messages.query = async () => { throw new Error('search failed'); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await appendEntries([{
      at: new Date().toISOString(), runId: 'r6', runKind: 'applied', mode: 'surface', passes: [],
      messageId: 99, headerMessageId: 'gone@example', tags: [], reasons: ['r'], scores: {}, signals: {}, inputTokens: 0,
    }]);
    await click('runNow'); // re-renders the log
    for (let i = 0; i < 200 && !/could not load|no longer available/.test(text($('rows'))); i++) await settle();
    assert.match(text($('rows')), /could not load the message/);
    assert.doesNotMatch(text($('rows')), /no longer available/);
  } finally {
    console.warn = warn;
    env.messenger.messages.query = realQuery;
    await clearLog();
  }
});

test('Clear history asks first, then empties the log', async () => {
  await appendEntries([{ at: new Date().toISOString(), tags: [], reasons: [] }]);
  assert.equal((await readAll()).length, 1);
  let pending = click('clear');
  assert.match(await answerDialog(false), /Delete the activity history\?\s*Monthly token summaries are kept/);
  await pending;
  assert.equal((await readAll()).length, 1, 'declined: kept');
  pending = click('clear');
  await answerDialog(true);
  await pending;
  await settle();
  assert.equal((await readAll()).length, 0);
});

test('Stop asks the background to stop, and is ready again afterwards', async () => {
  await click('stop');
  assert.ok(env.calls.sent.some((m) => m.type === STOP_RUNS));
  assert.equal($('stop').disabled, false);
});

test('a run in progress shows "Previewing N of M (P%)", and the line hides when it ends', () => {
  assert.equal($('runProgress').hidden, true);
  env.storageChanged({ runProgress: { newValue: { runId: 'r', kind: 'preview', done: 340, total: 1080 } } });
  assert.equal($('runProgress').hidden, false);
  assert.match($('runProgressText').textContent, /^Previewing 340 of 1,?080 \(31%\)$/);
  assert.ok(Math.abs($('runProgressBar').value - 340 / 1080) < 1e-9);
  env.storageChanged({ runProgress: { newValue: null } });
  assert.equal($('runProgress').hidden, true);
});

test('I1: tags show their score as a percentage, with the category confidence and the first reason on one line', async () => {
  await clearLog();
  await appendEntries([{
    at: new Date().toISOString(), runId: 'i1', runKind: 'applied', mode: 'surface', passes: [], subject: 's', from: 'f',
    category: 'Bills', tags: ['Preen/Bills'], toDo: true, review: true, sensitive: true, inputTokens: 0, signals: {},
    reasons: ['Unsure if it\'s a to-do (0.62)', 'second reason'],
    scores: { categoryChoice: 'Bills', categoryProbability: 0.93, categoryConfidence: 0.8, toDo: 0.62, person: 0.1 },
  }]);
  await click('runNow');
  await waitForTick(() => /Bills 93%/.test(text($('rows'))));
  const shown = text($('rows'));
  assert.match(shown, /Preen\/Bills 93%/);
  assert.match(shown, /To-do 62%/, 'a decision chip from the data, not a tag');
  assert.doesNotMatch(shown, /Preen\/To-do/);
  assert.match(shown, /Review/);
  assert.match(shown, /Sensitive/);
  assert.match(shown, /Category: Bills \(93%\)/);
  const why = [...$('rows').querySelectorAll('.why')];
  assert.equal(why.length, 1);
  assert.equal(why[0].textContent, 'Unsure if it\'s a to-do (0.62)');
  assert.match(text([...$('rows').querySelectorAll('.more-reasons')][0]), /1 more\s*second reason/);
  await clearLog();
});

test('I2: a preview run offers "Review this run" with Apply and Skip per row and Apply all', async () => {
  await clearLog();
  const base = { runId: 'pv1', runKind: 'preview', mode: 'surface', passes: [], inputTokens: 0, signals: {}, reasons: [], category: null, tags: [], scores: { person: 0.1 } };
  await appendEntries([
    { ...base, at: new Date().toISOString(), messageId: 1, headerMessageId: 'a@x', subject: 'one', from: 'f' },
    { ...base, at: new Date().toISOString(), messageId: 2, headerMessageId: 'b@x', subject: 'two', from: 'f' },
  ]);
  await click('runNow');
  // Polled until true: how many turns render() takes depends on status redraws queued alongside it.
  await waitForTick(() => [...$('rows').querySelectorAll('button')].some((b) => b.textContent === 'Review this run'));
  const link = [...$('rows').querySelectorAll('button')].find((b) => b.textContent === 'Review this run');
  assert.ok(link);
  link.listeners.click.forEach((fn) => fn({ target: link }));
  await waitForTick(() => /2 messages/.test(text($('reviewTitle'))));
  assert.equal($('review').hidden, false);
  assert.match(text($('reviewTitle')), /2 messages/);
  const buttons = [...$('reviewRows').querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(buttons, ['Apply', 'Skip', 'Apply', 'Skip']);
  assert.match(text($('reviewRows')), /Would do/);
  const skip = [...$('reviewRows').querySelectorAll('button')].find((b) => b.textContent === 'Skip');
  skip.listeners.click.forEach((fn) => fn({ target: skip }));
  await waitForTick(() => /Skipped/.test(text($('reviewRows'))));
  assert.match(text($('reviewRows')), /Skipped/);
  assert.ok($('reviewApplyAll').listeners.click?.length);
  await click('reviewClose');
  assert.equal($('review').hidden, true);
  await clearLog();
});

test('"Review this run" scrolls in below the sticky top bar, whatever its height', () => {
  assert.equal(document.documentElement.style['--head-h'], '96px');
});

test('I3: preview rows say "Would do"; a finished 7-day trial opens its review once', async () => {
  await clearLog();
  await appendEntries([{
    at: new Date().toISOString(), runId: 'trial1', runKind: 'preview', mode: 'surface', passes: [], inputTokens: 0, signals: {},
    reasons: [], category: null, tags: [], scores: { person: 0.1 }, messageId: 5, headerMessageId: 't@x', subject: 'trial', from: 'f',
  }]);
  await env.messenger.storage.local.set({ status: { reviewRun: { runId: 'trial1', at: new Date().toISOString() } } });
  await click('runNow');
  await waitForTick(() => /: 1 message$/.test(text($('reviewTitle'))));
  assert.equal($('review').hidden, false);
  assert.match(text($('reviewTitle')), /1 message/);
  assert.match(text($('rows')), /Would do:/);
  assert.equal((await env.messenger.storage.local.get('status')).status.reviewRun, null, 'opened once');
  await click('reviewClose');
  await clearLog();
});
