// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Free Person/Service hints from email headers. `headers` uses lowercase
// header names as keys and arrays of values, as Thunderbird's getFull() returns.

// Header name prefixes added by common bulk-email sending services.
const BULK_SENDER_HEADER_PREFIXES = [
  ['x-mailgun-', 'Mailgun'],
  ['x-ses-', 'Amazon SES'],
  ['x-sg-', 'SendGrid'],
  ['x-mc-', 'Mailchimp'],
  ['x-mandrill-', 'Mandrill'],
  ['x-pm-message-id', 'Postmark'],
  ['x-sfmc-', 'Salesforce Marketing Cloud'],
];

// Local parts (before the @) that are almost never a person.
const SERVICE_LOCAL_PART = /^(no-?reply|do-?not-?reply|donotreply|notifications?|mailer-daemon|postmaster|bounces?)([+._-]|$)/i;

function first(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Extracts the address from `Name <addr@example.com>` or a bare address.
 * The real address comes last; earlier ones are display-name text the sender controls.
 */
export function extractAddress(mailbox) {
  const text = String(mailbox ?? '');
  const angle = [...text.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)].at(-1);
  if (angle) return angle[1].toLowerCase();
  const bare = text.match(/[^\s<>"]+@[^\s<>"]+/g);
  return bare ? bare.at(-1).toLowerCase() : '';
}

/**
 * @param {object} headers lowercase name → array of values
 * @param {string} [author] the From value, e.g. `Name <a@b.c>`
 * @returns {{service: string[], person: string[], mailingList: boolean,
 *   strongService: boolean}} `strongService` is true when the headers alone
 *   show the message is automated or bulk, even for mailing-list mail.
 */
export function headerSignals(headers = {}, author = first(headers, 'from')) {
  const service = [];
  const person = [];
  let strongService = false;
  // Discussion lists (where people write the posts) carry these. Precedence: bulk alone
  // marked every post to a users list as "not a real person".
  const mailingList = Boolean(headers['list-id'] || headers['list-post'] || headers['list-help']);

  const autoSubmitted = first(headers, 'auto-submitted');
  if (autoSubmitted && !/^\s*no\b/i.test(autoSubmitted)) {
    service.push(`Auto-Submitted: ${autoSubmitted.trim()}`);
    strongService = true;
  }

  const precedence = first(headers, 'precedence');
  if (precedence && /\b(bulk|list|junk)\b/i.test(precedence)) {
    service.push(`Precedence: ${precedence.trim()}`);
    // "list" (and on many lists "bulk") is also used by discussion lists where people
    // write the posts: on a list, bulk alone isn't enough to skip the question.
    if (/\bjunk\b/i.test(precedence) || (/\bbulk\b/i.test(precedence) && !mailingList)) strongService = true;
  }

  if (headers['x-autoreply'] || headers['x-autorespond']) {
    service.push('Auto-reply header');
    strongService = true;
  }
  if (headers['list-unsubscribe']) {
    service.push('List-Unsubscribe header');
    if (!mailingList) strongService = true;
  }
  if (headers['feedback-id']) {
    service.push('Feedback-ID header');
    strongService = true;
  }

  const names = Object.keys(headers);
  for (const [prefix, label] of BULK_SENDER_HEADER_PREFIXES) {
    if (names.some((n) => n.startsWith(prefix))) {
      service.push(`Sent through ${label}`);
      strongService = true;
    }
  }

  const address = extractAddress(author);
  const localPart = address.split('@')[0];
  if (localPart && SERVICE_LOCAL_PART.test(localPart)) {
    service.push(`Sender address ${address}`);
    strongService = true;
  }

  // A reply within a conversation, with no bulk signs, suggests a person.
  if (service.length === 0 && (headers['in-reply-to'] || headers['references'])) {
    person.push('Reply in a conversation');
  }

  return { service, person, mailingList, strongService };
}

/**
 * True when any Authentication-Results header records dmarc=fail. Any, not just the
 * topmost: the order Thunderbird keeps repeated headers in isn't documented, and a forged
 * extra header can only add a false "fail" (the worst case is asking the Junk question
 * about a genuine contact), while a sender can't remove the "fail" your provider added.
 */
export function dmarcFailed(headers = {}) {
  const all = headers['authentication-results'];
  const list = Array.isArray(all) ? all : all ? [all] : [];
  return list.some((ar) => /\bdmarc\s*=\s*fail\b/i.test(String(ar)));
}
