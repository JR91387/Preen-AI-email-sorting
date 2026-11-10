// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Messages Preen itself is changing (classify, move, undo), so the tag-correction
// listener doesn't mistake Preen's own changes for the user's. Thunderbird
// reports an update shortly after it happens, hence a short window, not a flag.
// Kept in session storage as well as memory: the background page may be suspended
// between Preen's change and Thunderbird's report of it.

import { createSerializer } from '../core/serialize.js';

const WINDOW_MS = 10_000;
const KEY = 'ownUpdates';
const until = new Map();
const serialized = createSerializer();

// storage.session when Thunderbird has it (cleared on restart), else storage.local.
const area = () => messenger.storage.session ?? messenger.storage.local;

/** Call (and await) just before Preen updates or moves a message. */
export function noteOwnUpdate(messageId, now = Date.now()) {
  until.set(messageId, now + WINDOW_MS);
  return serialized(async () => {
    const { [KEY]: stored = {} } = await area().get(KEY);
    const kept = Object.fromEntries(Object.entries(stored).filter(([, end]) => end > now));
    kept[messageId] = now + WINDOW_MS;
    await area().set({ [KEY]: kept });
  });
}

/** True while a change to this message is (probably) Preen's own. */
export async function isOwnUpdate(messageId, now = Date.now()) {
  const end = until.get(messageId);
  if (end !== undefined && end > now) return true;
  until.delete(messageId);
  try {
    const { [KEY]: stored = {} } = await area().get(KEY);
    return (stored[messageId] ?? 0) > now;
  } catch (e) {
    console.warn('Preen: could not read the own-update window', e);
    return false;
  }
}
