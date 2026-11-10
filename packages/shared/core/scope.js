// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Which accounts, folders and messages automatic processing looks at.

import { PROCESSED_TAG_KEY } from './tags.js';
import { DAY_MS } from './time.js';
import { CORRECTED } from './run-summary.js';

// Never processed automatically, whatever the account setting.
export const EXCLUDED_SPECIAL_USE = ['trash', 'junk', 'sent', 'drafts', 'outbox', 'templates', 'archives'];

// inbox: the Inbox only; all: every folder; selected: only the listed folders;
// except: every folder except the listed ones. Special folders are always excluded.
export const FOLDER_SCOPES = ['inbox', 'all', 'selected', 'except'];

// What kind of mailbox an account is. Sent to Jev as context, because the same
// email means different things in different mailboxes (an invoice in a
// founder's inbox is business; in a personal one, a household bill).
export const ACCOUNT_TYPES = {
  personal: 'Personal',
  work: 'Work',
  founder: 'Founder / business owner',
  shared: 'Shared or team inbox',
  other: 'Other',
};

/**
 * Folders are remembered by path, because Thunderbird's folder IDs only last
 * for one session (and renaming or moving a folder changes its path).
 * @returns {{enabled: boolean, folders: string, folderPaths: string[]}} accounts are off unless enabled
 */
export function accountScope(settings, accountId) {
  const account = settings.scope.accounts?.[accountId];
  return {
    enabled: Boolean(account?.enabled),
    folders: FOLDER_SCOPES.includes(account?.folders) ? account.folders : 'inbox',
    folderPaths: Array.isArray(account?.folderPaths) ? account.folderPaths : [],
  };
}

/** Special folders can never be chosen for automatic processing. */
export function isExcludedFolder(folder) {
  return Boolean(folder?.isRoot || folder?.isVirtual || (folder?.specialUse ?? []).some((u) => EXCLUDED_SPECIAL_USE.includes(u)));
}

/** Whether automatic processing covers this folder. */
export function folderInScope(folder, settings) {
  if (!folder?.accountId || isExcludedFolder(folder)) return false;
  const scope = accountScope(settings, folder.accountId);
  if (!scope.enabled) return false;
  switch (scope.folders) {
    case 'all': return true;
    case 'selected': return scope.folderPaths.includes(folder.path);
    case 'except': return !scope.folderPaths.includes(folder.path);
    default: return (folder.specialUse ?? []).includes('inbox');
  }
}

/** Oldest message date automatic processing looks at. */
export function cutoffDate(settings, now = Date.now()) {
  return new Date(now - settings.automation.maxAgeDays * DAY_MS);
}

/**
 * Whether a message should be processed automatically.
 * @param {object} header Thunderbird MessageHeader (date, read, tags)
 * @param {{now?: number, processed?: boolean, corrected?: boolean}} [context] processed: in the local record;
 *   corrected: the user changed Preen's tags on it
 * @returns {{ok: boolean, reason: string|null}}
 */
export function eligibility(header, settings, { now = Date.now(), processed = false, corrected = false } = {}) {
  // Without a Message-ID Preen can't track the message; right-click still works.
  if (!header.headerMessageId) return { ok: false, reason: 'missing Message-ID' };
  if (corrected) return { ok: false, reason: CORRECTED };
  if (processed || header.tags?.includes(PROCESSED_TAG_KEY)) return { ok: false, reason: 'already processed' };
  if (settings.automation.unreadOnly && header.read) return { ok: false, reason: 'already read' };
  // The Date header is written by the sender. A future date is treated as now
  // (it passes); a back-dated message can still fall outside the window, as
  // Thunderbird doesn't tell add-ons when a message was actually received.
  const date = header.date ? new Date(header.date).getTime() : NaN;
  if (Number.isFinite(date) && date < cutoffDate(settings, now).getTime()) {
    return { ok: false, reason: `older than ${settings.automation.maxAgeDays} days` };
  }
  return { ok: true, reason: null };
}
