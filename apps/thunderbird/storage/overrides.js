// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The user's Person/Service rules for particular senders, by email address.
// They always win over Jev.

import { createSerializer } from '../core/serialize.js';

export const OVERRIDES_KEY = 'senderOverrides';
export const SENDER_RULES = ['person', 'service'];

const serialized = createSerializer();

/** @returns {Promise<Record<string, 'person'|'service'>>} */
export async function readOverrides() {
  const stored = await messenger.storage.local.get(OVERRIDES_KEY);
  return stored[OVERRIDES_KEY] ?? {};
}

/**
 * Sets (or with `rule` null, removes) the rule for each address.
 * @param {string[]} addresses lowercase email addresses
 * @param {'person'|'service'|null} rule
 */
export function setOverride(addresses, rule) {
  return serialized(async () => {
    const rules = await readOverrides();
    for (const address of addresses) {
      if (!address) continue;
      if (SENDER_RULES.includes(rule)) rules[address] = rule;
      else delete rules[address];
    }
    await messenger.storage.local.set({ [OVERRIDES_KEY]: rules });
  });
}
