// SPDX-License-Identifier: PolyForm-Shield-1.0.0

import { mergeWithDefaults } from '../core/settings-schema.js';
import { createSerializer } from '../core/serialize.js';

const KEY = 'settings';

const serialized = createSerializer();

export async function loadSettings() {
  const stored = await messenger.storage.local.get(KEY);
  return mergeWithDefaults(stored[KEY]);
}

/** Just the stored consent, in one read (no merge); undefined if none is stored yet. */
export async function readConsent() {
  const stored = await messenger.storage.local.get(KEY);
  return stored[KEY]?.consent;
}

export async function saveSettings(settings) {
  await messenger.storage.local.set({ [KEY]: settings });
}

/** Writes only `group.enabled` of the stored settings. */
function setEnabled(group, enabled) {
  return serialized(async () => {
    const stored = (await messenger.storage.local.get(KEY))[KEY] ?? {};
    stored[group] = { ...stored[group], enabled };
    await messenger.storage.local.set({ [KEY]: stored });
  });
}

/** Turns automatic processing on or off, writing only that field of the stored settings. */
export const setAutomationEnabled = (enabled) => setEnabled('automation', enabled);

/** Turns debug mode on or off, writing only that field of the stored settings. */
export const setDebugEnabled = (enabled) => setEnabled('debug', enabled);
