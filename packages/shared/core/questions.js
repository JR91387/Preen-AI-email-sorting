// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Builds the System One request: the email as `state`, plus the questions.

import { ACCOUNT_TYPES } from './scope.js';
import { dmarcFailed } from './headers.js';

export const OTHER_CATEGORY = 'other';

/** The text Jev sees for one category: what it is, and optionally what it isn't. */
export function categoryCriterion(category) {
  const is = category.description.trim().replace(/[.\s]+$/, '');
  const isNot = category.excludes?.trim().replace(/[.\s]+$/, '');
  return isNot ? `${is}. Does NOT include: ${isNot}.` : `${is}.`;
}

/**
 * @param {object} [known] answers decided without the API, e.g. { person: 'service' };
 *   those questions are left out.
 */
export function buildQuestions(settings, known = {}) {
  const questions = {};
  // With category sorting off, no category question is asked at all.
  if (settings.categorySort?.enabled !== false) {
    const criteria = {};
    for (const c of settings.categories) criteria[c.name.trim()] = categoryCriterion(c);
    criteria[OTHER_CATEGORY] = 'None of the other options fit this email well.';
    questions.category = {
      type: 'choice',
      instructions: 'Which category best describes this email, from the point of view of its recipient?',
      criteria,
    };
  }
  if (settings.questions.person && !known.person) {
    questions.person = {
      type: 'noul',
      instructions:
        'Did one specific human personally type this email to the people it is addressed to? ' +
        'Answer no if it was generated, sent by a mail-merge or bulk-sending tool (even if personalised), ' +
        'or is a newsletter, blog post, notification or marketing message.',
    };
  }
  if (settings.questions.needsReply) {
    questions.needs_reply = {
      type: 'noul',
      instructions: 'Is a person waiting for the recipient to personally reply to this email?',
    };
  }
  if (settings.questions.toDo) {
    questions.to_do = {
      type: 'noul',
      instructions:
        'Does this email give the recipient a task they still have to do themselves, other than replying, such as ' +
        'paying, signing, booking, submitting or sending something? Answer no when nothing is left to do: codes or ' +
        'sign-in links they asked for, confirmations, tickets, receipts or statements for things already arranged ' +
        'or paid, and automatic payments. Answer no for tasks meant for other people on the email, marketing calls ' +
        'to action (shop, read more, sign up), newsletters, and emails that only need a reply.',
    };
  }
  if (settings.questions.junk) {
    questions.junk = {
      type: 'noul',
      instructions:
        'Is this email junk the recipient did not want: spam, a scam, phishing, or a malicious or deceptive message? ' +
        'Answer no for legitimate mail, including newsletters and marketing from companies the recipient deals with, ' +
        'and genuine personal or business mail, even when it mentions money, payments or links.',
    };
  }
  return questions;
}

/**
 * @param {object} email prepared email: author, toCount, ccCount, subject, date,
 *   attachments, headers, senderIsContact (true, false or 'unknown'), and optionally
 *   body and bodyTruncated. Without a body (Surface pass) no message text is included at all.
 * @param {object} signals result of headerSignals()
 */
export function buildState(email, settings, signals) {
  const hasBody = typeof email.body === 'string';
  const message = {
    from: email.author ?? '',
    to_count: email.toCount ?? 0,
    cc_count: email.ccCount ?? 0,
    subject: email.subject ?? '',
    date: email.date && Number.isFinite(new Date(email.date).getTime()) ? new Date(email.date).toISOString() : '',
    attachments: email.attachments ?? [],
    body_included: hasBody,
  };
  if (hasBody) {
    message.body = email.body;
    message.body_was_shortened = Boolean(email.bodyTruncated);
  }
  const state = {
    email: message,
    header_hints: {
      automated_signs: signals.service,
      personal_signs: signals.person,
      mailing_list: signals.mailingList,
    },
    sender_is_contact: email.senderIsContact ?? 'unknown',
    dmarc_failed: dmarcFailed(email.headers),
  };
  // The kind of mailbox, as context only: never the account's name or address.
  const account = settings.scope?.accounts?.[email.accountId];
  if (account?.type in ACCOUNT_TYPES) {
    state.mailbox = { context: `This email arrived in the recipient's ${ACCOUNT_TYPES[account.type]} mailbox.` };
    const note = account.note?.trim();
    if (note) state.mailbox.note = note;
  }
  const context = settings.personalContext?.trim();
  if (context) state.about_the_recipient = context;
  const languages = settings.recipientLanguages?.trim();
  if (languages) state.recipient_languages = languages;
  return state;
}

/** @returns {{state: object, questions: object}} (the model is added by the provider) */
export function buildRequest(email, settings, signals, known = {}) {
  return { state: buildState(email, settings, signals), questions: buildQuestions(settings, known) };
}
