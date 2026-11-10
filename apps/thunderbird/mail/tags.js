// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Makes sure Preen's tags exist in Thunderbird. Tags the user already has
// (including ones they renamed or recolored) are left alone.

import { tagSpecs, TAG_NAME_PREFIX, PROCESSED_TAG_KEY } from '../core/tags.js';
import { ownTagKeys } from '../core/actions.js';

/**
 * Creates missing tags.
 * @returns {Promise<string[]>} keys of the tags that were created
 */
export async function ensureTags(settings) {
  const list = await messenger.messages.tags.list();
  const existing = new Set(list.map((t) => t.key));
  const created = [];
  for (const spec of tagSpecs(settings)) {
    if (existing.has(spec.key)) continue;
    await messenger.messages.tags.create(spec.key, spec.name, spec.color);
    created.push(spec.key);
  }
  return created;
}

/**
 * Tag keys Preen may replace on a message: its own tags for the current
 * settings, plus Thunderbird tags it created earlier (named "Preen/…" or
 * "Preen: …"), e.g. from a renamed or deleted category.
 */
export async function managedTagKeys(settings) {
  const managed = ownTagKeys(settings);
  // A failed list throws: replacing nothing would leave stale and new tags together.
  for (const tag of await messenger.messages.tags.list()) {
    // With "Tag processed messages" off, existing processed tags stay put.
    if (tag.key === PROCESSED_TAG_KEY && !settings.markProcessed.tag) continue;
    if (tag.tag?.startsWith(TAG_NAME_PREFIX) || tag.tag?.startsWith('Preen:')) managed.add(tag.key);
  }
  return managed;
}
