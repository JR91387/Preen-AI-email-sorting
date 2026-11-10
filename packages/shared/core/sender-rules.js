// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The user's own rule for a sender answers the Real person question, so Jev
// isn't asked it. Only "a real person" is tagged; "not a real person" just
// means no tag (and no question).

/**
 * @param {object} settings
 * @param {'person'|'service'|null} [senderRule] the user's rule for this sender
 *   ('person' = always a real person, 'service' = never)
 * @returns {{person: 'person'|'service'|null, reason: string|null}}
 */
export function presetPerson(settings, senderRule = null) {
  if (!settings.questions.person) return { person: null, reason: null };
  if (senderRule === 'person') return { person: 'person', reason: 'Real person (your rule for this sender)' };
  if (senderRule === 'service') return { person: 'service', reason: 'Not a real person (your rule for this sender)' };
  return { person: null, reason: null };
}
