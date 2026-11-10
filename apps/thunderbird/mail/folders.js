// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Finding folders and messages: for automatic processing, and for a
// right-clicked folder.

import { folderInScope, isExcludedFolder } from '../core/scope.js';
import { collectPages } from './paging.js';

/** Folders automatic processing covers, across all enabled accounts. */
export async function foldersInScope(settings) {
  const folders = [];
  for (const [accountId, account] of Object.entries(settings.scope.accounts)) {
    if (!account.enabled) continue;
    try {
      const found = await messenger.folders.query({ accountId });
      folders.push(...found.filter((f) => folderInScope(f, settings)));
    } catch (e) {
      console.warn(`Preen: could not list folders for account ${accountId}`, e);
    }
  }
  return folders;
}

/** Messages in a folder dated after `fromDate`, up to `limit`. */
export async function recentMessages(folderId, fromDate, limit) {
  const out = [];
  await collectPages(await messenger.messages.query({ folderId, fromDate }), (m) => {
    if (out.length >= limit) return true;
    out.push(m);
  });
  return out;
}

/**
 * Finds a folder's current ID from its account and path (folder IDs only last
 * for one session). Returns null if the folder no longer exists;
 * a failed query throws (and is not cached), so it can't pass for "gone".
 * @param {Map} [cache] reused within one run
 */
export async function resolveFolderId(accountId, path, cache = new Map()) {
  const key = `${accountId}\n${path}`;
  if (!cache.has(key)) {
    const found = await messenger.folders.query({ accountId, path });
    cache.set(key, found.find((f) => f.path === path)?.id ?? null);
  }
  return cache.get(key);
}

/** Looks a queued message up again; null if it was moved away or deleted. */
export async function findMessage(item, folderCache) {
  const folderId = await resolveFolderId(item.accountId, item.folderPath, folderCache);
  if (!folderId) return null;
  const list = await messenger.messages.query({ headerMessageId: item.headerMessageId, folderId });
  if (list.id) await messenger.messages.abortList(list.id).catch(() => {});
  return list.messages[0] ?? null;
}

/**
 * Queue item for a message header: identified by Message-ID, account and
 * folder path. A future Date header (set by the sender) counts as now, so it
 * can't jump ahead of genuinely new mail.
 */
export function queueItem(header, now = Date.now()) {
  const date = header.date ? Math.min(new Date(header.date).getTime(), now) : NaN;
  return {
    headerMessageId: header.headerMessageId,
    accountId: header.folder?.accountId,
    folderPath: header.folder?.path,
    date: Number.isFinite(date) ? new Date(date).toISOString() : '',
  };
}

/** A folder's subfolders at every depth, flattened. */
async function allSubFolders(folder) {
  const out = [];
  const walk = (list) => {
    for (const f of list ?? []) {
      out.push(f);
      walk(f.subFolders);
    }
  };
  walk(await messenger.folders.getSubFolders(folder.id, true));
  return out;
}

/**
 * Message ids for a right-clicked folder. The folder the user clicked is always
 * included, even a special one (it was chosen on purpose, e.g. a Spam folder to
 * check); with `subfolders`, special subfolders (Trash, Junk, Sent…) are skipped,
 * as they are for automatic processing.
 * Stops reading once `limit` ids are found (none by default).
 * @returns {Promise<{ids: number[], folders: number, skipped: string[], more: boolean}>}
 */
export async function folderMessageIds(folder, { subfolders = false, limit = Infinity } = {}) {
  const folders = [folder];
  const skipped = [];
  if (subfolders) {
    for (const f of await allSubFolders(folder)) {
      if (isExcludedFolder(f)) skipped.push(f.name ?? f.path ?? String(f.id));
      else folders.push(f);
    }
  }
  const ids = new Set();
  if (!(limit > 0)) return { ids: [], folders: folders.length, skipped, more: true };
  for (const f of folders) {
    const full = await collectPages(await messenger.messages.query({ folderId: f.id }), (m) => {
      ids.add(m.id);
      return ids.size >= limit;
    });
    if (full) return { ids: [...ids], folders: folders.length, skipped, more: true };
  }
  return { ids: [...ids], folders: folders.length, skipped, more: false };
}

/** The Junk folder of the account a message is in, or null when it has none. Errors propagate. */
export async function junkFolderFor(folder) {
  if (!folder?.accountId) return null;
  const found = await messenger.folders.query({ accountId: folder.accountId, specialUse: ['junk'] });
  return found[0] ?? null;
}

// Moving mail needs Thunderbird's "messagesMove" permission. It is optional: Settings
// asks for it when "Also move it to the Junk folder" is ticked.
export const MOVE_PERMISSION = { permissions: ['messagesMove'] };
export const NO_MOVE_PERMISSION = 'not moved: Preen isn\'t allowed to move mail (untick and tick "Also move it to the Junk folder" in Settings to allow it)';
export function canMoveMail() {
  return messenger.permissions.contains(MOVE_PERMISSION);
}
