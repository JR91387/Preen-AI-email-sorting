// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Automatic processing in one word. It runs for the mailboxes the user
// ticks under Settings → Automatic processing; `automation.enabled` is the Pause /
// Resume state (Activity page and toolbar button), not a second on/off switch.

/** Ids of the accounts ticked for automatic processing. */
export function tickedAccounts(settings) {
  return Object.entries(settings.scope?.accounts ?? {}).filter(([, a]) => a?.enabled).map(([id]) => id);
}

/**
 * @returns {'off'|'paused'|'on'} off: no mailbox ticked; paused: ticked but paused;
 *   on: new mail in the ticked mailboxes is processed
 */
export function automationState(settings) {
  if (!tickedAccounts(settings).length) return 'off';
  return settings.automation?.enabled ? 'on' : 'paused';
}

export const TRIGGER_LABELS = {
  realtime: 'As new mail arrives',
  scheduled: 'On a schedule',
  manual: 'Only when you click Run now',
};

/** "every 15 minutes", "every 2 hours": how often a scheduled run happens. */
export function intervalText(minutes) {
  return minutes % 60 === 0 ? `every ${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `every ${minutes} minutes`;
}

/**
 * The settings automatic processing uses, in one fixed order, for the summary on the
 * settings page. `dim` marks those that do nothing while it is off or paused. Dry run
 * is never dimmed: it also decides what right-click Classify does.
 * @param {{state: 'off'|'paused'|'on', trigger: string, intervalMinutes: number, unreadOnly: boolean,
 *   maxAgeDays: number, dryRun: boolean}} a
 * @returns {{key: string, label: string, value: string, dim: boolean}[]}
 */
export function automationRows(a) {
  const dim = a.state !== 'on';
  const scheduled = a.trigger === 'scheduled';
  return [
    { key: 'trigger', label: 'When', value: TRIGGER_LABELS[a.trigger] ?? a.trigger, dim },
    {
      key: 'interval',
      label: 'Every',
      value: scheduled && Number.isFinite(a.intervalMinutes) ? intervalText(a.intervalMinutes).replace(/^every /, '') : 'not used (only for a schedule)',
      dim: dim || !scheduled,
    },
    { key: 'unreadOnly', label: 'Only unread mail', value: a.unreadOnly ? 'Yes' : 'No', dim },
    { key: 'maxAgeDays', label: 'Only mail from the last', value: Number.isFinite(a.maxAgeDays) ? `${a.maxAgeDays} day${a.maxAgeDays === 1 ? '' : 's'}` : '–', dim },
    { key: 'dryRun', label: 'Dry run', value: a.dryRun ? 'On: only logs what it would do' : 'Off: changes messages', dim: false },
  ];
}

/** The note under the summary saying why some settings are dimmed; empty while it is on. */
export function dimNote(state) {
  if (state === 'off') return 'Dimmed settings are not used while automatic processing is off. Tick a mailbox above to turn it on.';
  if (state === 'paused') return 'Dimmed settings wait until you resume.';
  return '';
}
