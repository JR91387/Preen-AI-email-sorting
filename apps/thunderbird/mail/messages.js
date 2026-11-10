// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Reads what Preen needs from a Thunderbird message. Metadata and body are
// read separately so the body is only touched when a request will include it.

// Message text is not read for messages larger than this (attachments
// included): Deep falls back to metadata only.
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
// Text is cut to this many characters before HTML is converted. Preen sends at
// most a few thousand, so this only guards against huge or hostile messages.
export const MAX_RAW_TEXT_CHARS = 200_000;

/** Joins text parts, stopping at MAX_RAW_TEXT_CHARS. */
function joinCapped(parts, separator) {
  let out = '';
  for (const part of parts) {
    const room = MAX_RAW_TEXT_CHARS - out.length;
    if (room <= 0) break;
    out += (out ? separator : '') + String(part.content ?? '').slice(0, room);
  }
  return out;
}

const ENCRYPTED_CONTENT_TYPES = new Set([
  'multipart/encrypted',
  'application/pgp-encrypted',
  'application/pkcs7-mime',
  'application/x-pkcs7-mime',
]);

function isEncryptedPart(part) {
  if (!part) return false;
  if (ENCRYPTED_CONTENT_TYPES.has(String(part.contentType ?? '').toLowerCase())) return true;
  return (part.parts ?? []).some(isEncryptedPart);
}

// Fallback when listInlineTextParts isn't usable: first text/plain part body.
function findPlainTextBody(part) {
  if (!part) return null;
  if (String(part.contentType ?? '').toLowerCase() === 'text/plain' && typeof part.body === 'string') {
    return part.body;
  }
  for (const child of part.parts ?? []) {
    const found = findPlainTextBody(child);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Finds a message's current header. Thunderbird's internal IDs change after a
 * restart, so the Message-ID header is checked, and searched for if needed.
 * @returns {Promise<object|null>} null if the message no longer exists; a failed search throws
 */
export async function findMessageHeader(messageId, headerMessageId) {
  if (messageId !== undefined) {
    try {
      const m = await messenger.messages.get(messageId);
      if (!headerMessageId || m.headerMessageId === headerMessageId) return m;
    } catch {
      // fall through to a search
    }
  }
  if (!headerMessageId) return null;
  try {
    const list = await messenger.messages.query({ headerMessageId });
    if (list.id) await messenger.messages.abortList(list.id).catch(() => {});
    return list.messages[0] ?? null;
  } catch (e) {
    // An empty result is "not found" (null above); a failing search is not.
    console.warn('Preen: could not search for a message', e);
    throw e;
  }
}

/**
 * Headers and envelope data, no message text.
 * @returns {Promise<object>} metadata, or `{ skipped: 'encrypted', ... }`
 */
export async function getEmailMeta(messageId) {
  const header = await messenger.messages.get(messageId);
  // Never decrypt: encrypted mail must not be sent to a third party.
  const full = await messenger.messages.getFull(messageId, { decrypt: false });
  const base = {
    id: messageId,
    headerMessageId: header.headerMessageId,
    accountId: header.folder?.accountId ?? null,
  };
  if (isEncryptedPart(full)) return { ...base, skipped: 'encrypted' };

  let attachments = [];
  try {
    attachments = (await messenger.messages.listAttachments(messageId)).map((a) => a.name);
  } catch (e) {
    console.warn('Preen: could not list attachments', e);
  }

  // Thunderbird stores reply prefixes (Re:, RE: Re:, etc.) as flags rather than in
  // MessageHeader.subject, so restore them from the raw Subject header when present.
  let subject = header.subject;
  const rawSubject = (full.headers?.subject ?? [])[0];
  if (typeof rawSubject === 'string' && !rawSubject.includes('=?')) { // Skip RFC 2047 encoded words
    const trimmed = rawSubject.trim();
    const headerSubjectTrimmed = String(header.subject ?? '').trim();
    if (trimmed !== headerSubjectTrimmed && trimmed.endsWith(headerSubjectTrimmed)) {
      subject = trimmed;
    }
  }

  return {
    ...base,
    author: header.author,
    subject,
    date: header.date,
    size: header.size ?? 0,
    toCount: header.recipients?.length ?? 0,
    ccCount: header.ccList?.length ?? 0,
    headers: full.headers ?? {},
    attachments,
  };
}

/**
 * The readable message text (plain text, or HTML converted to plain text).
 * @param {number} [size] the message's size in bytes, from getEmailMeta()
 * @returns {Promise<{text: string}|{skipped: string}>}
 */
export async function getEmailBody(messageId, size = 0) {
  if (size > MAX_MESSAGE_BYTES) return { skipped: 'message too large' };
  let text = null;
  try {
    const parts = await messenger.messages.listInlineTextParts(messageId);
    const plain = parts.filter((p) => p.contentType?.toLowerCase() === 'text/plain');
    const html = parts.filter((p) => p.contentType?.toLowerCase() === 'text/html');
    if (plain.length) text = joinCapped(plain, '\n\n');
    else if (html.length) {
      text = await messenger.messengerUtilities.convertToPlainText(joinCapped(html, '\n'));
    }
  } catch (e) {
    console.warn('Preen: listInlineTextParts failed, using fallback', e);
  }
  if (text === null) {
    const full = await messenger.messages.getFull(messageId, { decrypt: false });
    text = (findPlainTextBody(full) ?? '').slice(0, MAX_RAW_TEXT_CHARS);
  }
  if (/-----BEGIN PGP MESSAGE-----/.test(text)) return { skipped: 'encrypted' };
  return { text };
}
