// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Address-book lookups. Only local address books are searched (no LDAP or
// other remote directories), and nothing is sent anywhere.

/** Email addresses listed in a vCard, lowercased. */
export function vCardEmails(vCard) {
  const emails = [];
  const unfolded = String(vCard ?? '').replace(/\r?\n[ \t]/g, '');
  for (const match of unfolded.matchAll(/^(?:[^\s:.]+\.)?EMAIL[^:\n]*:(.+)$/gim)) {
    emails.push(match[1].trim().toLowerCase());
  }
  return emails;
}

/**
 * Creates a lookup that caches answers for the duration of one batch.
 * @returns {(address: string) => Promise<boolean|null>} true/false for a saved contact or not;
 *   null when the lookup failed (the sender's status is unknown, not "not a contact")
 */
export function createContactLookup() {
  const cache = new Map();
  return async (address) => {
    const needle = String(address ?? '').toLowerCase();
    if (!needle) return false;
    if (!cache.has(needle)) {
      cache.set(needle, (async () => {
        try {
          const contacts = await messenger.addressBooks.contacts.query({ searchString: needle, includeRemote: false });
          return contacts.some((c) => vCardEmails(c.vCard).includes(needle));
        } catch (e) {
          console.warn('Preen: address book lookup failed', e);
          return null;
        }
      })());
    }
    return cache.get(needle);
  };
}
