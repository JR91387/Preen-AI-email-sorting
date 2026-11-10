// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The setup checklist shown at the top of the settings page.

import { automationState } from './automation.js';
import { hasConsent } from './consent.js';

/**
 * @param {object} settings
 * @param {{connectionOk: boolean, hasHistory: boolean}} facts
 *   connectionOk: the last Test connection succeeded for the current provider;
 *   hasHistory: at least one message has been classified
 * @returns {{id: string, label: string, done: boolean}[]}
 */
export function setupSteps(settings, { connectionOk, hasHistory }) {
  return [
    { id: 'consent', label: 'Read what Preen sends and agree to send mail to your provider', done: hasConsent(settings) },
    { id: 'connect', label: 'Add your API key and click “Test connection”', done: Boolean(settings.apiKey && connectionOk) },
    { id: 'preview', label: 'Right-click a few messages → “Preview with Preen” and check the results in the Activity log', done: hasHistory },
    // One step: ticking a mailbox is what switches it on.
    { id: 'automation', label: 'Tick the mailboxes to process automatically', done: automationState(settings) !== 'off' },
  ];
}
