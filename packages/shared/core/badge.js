// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// What the toolbar button shows: "!" for a problem or a reached limit,
// otherwise how many messages are waiting (only while automatic processing is on).

import { automationState } from './automation.js';

/**
 * @param {{settings: object, queueLength: number, status: object}} state
 * @returns {{text: string, color: string, title: string}}
 */
export function badgeState({ settings, queueLength, status }) {
  if (status?.selfCheck?.length) {
    return { text: '!', color: '#B3261E', title: `Preen: ${status.selfCheck[0]}` };
  }
  if (status?.lastError) {
    return { text: '!', color: '#B3261E', title: `Preen: problem: ${status.lastError}` };
  }
  if (status?.blockedReason) {
    return { text: '!', color: '#9A6400', title: `Preen: ${status.blockedReason}` };
  }
  const state = automationState(settings);
  if (state !== 'on') {
    return { text: '', color: '#1F7FA8', title: `Preen: automatic processing is ${state}` };
  }
  const waiting = queueLength > 0 ? ` · ${queueLength} waiting` : '';
  return {
    text: queueLength > 0 ? (queueLength > 99 ? '99+' : String(queueLength)) : '',
    color: '#1F7FA8',
    title: `Preen: on${settings.dryRun ? ' (dry run)' : ''}${waiting}`,
  };
}
