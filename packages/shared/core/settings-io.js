// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Settings export and import as a JSON file. The API key is left out unless
// the user asks for it. Imports are checked and never saved automatically.

import { mergeWithDefaults, validateSettings } from './settings-schema.js';

export const SETTINGS_FILE_FORMAT = 'preen-settings';
export const SETTINGS_FILE_VERSION = 1;

/** The object to write to a settings file. */
export function exportSettings(settings, { includeApiKey = false, now = new Date() } = {}) {
  const copy = structuredClone(settings);
  if (!includeApiKey) delete copy.apiKey;
  return {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    exportedAt: now.toISOString(),
    includesApiKey: Boolean(includeApiKey && settings.apiKey),
    settings: copy,
  };
}

/**
 * Reads a settings file.
 * @param {string} text file contents
 * @param {object} current the settings in use now
 * @param {string[]} accountIds accounts on this computer
 * @returns {{settings: object|null, errors: string[], notes: string[], incomingApiKey: string|null}}
 *   The current API key is always kept. If the file has a different key, it's
 *   returned as `incomingApiKey` so the caller can ask before using it: a
 *   shared or malicious file must never silently send mail to another account.
 */
export function parseSettingsFile(text, current, accountIds) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return { settings: null, errors: ['This file isn\'t valid JSON.'], notes: [], incomingApiKey: null };
  }
  if (file?.format !== SETTINGS_FILE_FORMAT || typeof file.settings !== 'object' || file.settings === null) {
    return { settings: null, errors: ['This isn\'t a Preen settings file.'], notes: [], incomingApiKey: null };
  }
  if (file.version > SETTINGS_FILE_VERSION) {
    return {
      settings: null, errors: ['This file was made by a newer version of Preen. Please update Preen first.'], notes: [], incomingApiKey: null,
    };
  }

  const notes = [];
  const settings = mergeWithDefaults(file.settings);

  const fileKey = typeof file.settings.apiKey === 'string' ? file.settings.apiKey.trim() : '';
  const currentKey = String(current.apiKey ?? '').trim();
  settings.apiKey = currentKey;
  // Agreeing to send mail is given here, never by a file.
  settings.consent = structuredClone(mergeWithDefaults(current).consent);
  const incomingApiKey = fileKey && fileKey !== currentKey ? fileKey : null;
  if (!fileKey && currentKey) notes.push('The file has no API key, so your current key was kept.');

  // Account IDs differ between computers: keep only accounts that exist here.
  const known = new Set(accountIds);
  let dropped = 0;
  for (const group of [settings.scope.accounts, settings.depth.accounts]) {
    if (!group || typeof group !== 'object') continue; // validateSettings reports it
    for (const id of Object.keys(group)) {
      if (!known.has(id)) {
        delete group[id];
        dropped++;
      }
    }
  }
  if (dropped) {
    notes.push('Some account settings were for accounts that aren\'t on this computer and were skipped. Check the Accounts section.');
  }

  const { errors } = validateSettings(settings);
  return { settings: errors.length ? null : settings, errors, notes, incomingApiKey: errors.length ? null : incomingApiKey };
}
