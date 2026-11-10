// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The user's agreement to send mail to the AI provider. It is given for one
// provider; until it is, no message is sent.

import { PROVIDERS } from '../providers/index.js';

// The policy ships inside the add-on; the page renders PRIVACY.md.
export const PRIVACY_PAGE = 'ui/privacy/privacy.html';

export function hasConsent(settings) {
  const c = settings?.consent;
  return Boolean(c?.sendToProvider) && c.provider === settings.provider;
}

export function giveConsent(settings, now = new Date()) {
  return { ...settings, consent: { sendToProvider: now.toISOString(), provider: settings.provider } };
}

export function withdrawConsent(settings) {
  return { ...settings, consent: { sendToProvider: null, provider: null } };
}

export function waitingForConsent(label) {
  return `Waiting for your OK to send mail to ${label}`;
}

/**
 * What the user agrees to, for the provider `id`: a short summary and every item a request
 * includes with a plain reason for it. The last item is the one that depends on depth.
 */
export function consentText(id) {
  const label = PROVIDERS[id]?.label ?? id;
  return {
    label,
    summary: `Preen sends each message it sorts to ${label}, using your API key, so TypeSafe's Jev model can sort it. `
      + 'Surface sends no message text. Deep also sends about 2,000 characters of it. No message is sent until you agree.',
    fields: [
      { name: 'The sender (name and address)', why: 'It helps tell people from shops and newsletters.' },
      { name: 'The subject', why: 'It says what the message is about.' },
      { name: 'The date', why: 'It tells the model when the message was sent.' },
      { name: 'How many recipients (the number, not who)', why: 'Mail sent to many people is often a newsletter or a notice.' },
      { name: 'Attachment names (not what is inside)', why: 'A file name like invoice.pdf hints at the kind of mail.' },
      { name: 'Yes/no hints from the headers, including a failed DMARC check', why: 'They help spot automated mail and fake senders.' },
      { name: 'Whether the sender is a contact', why: 'Mail from people you know is not treated like mail from strangers.' },
      { name: 'The kind of mailbox, and your note about it if you wrote one', why: 'So Work mail can be sorted differently from Personal mail.' },
      { name: 'Your personal context and languages, if you filled them in', why: 'So the model can judge mail from your point of view.' },
      { name: 'Your categories and the questions Preen asks', why: 'They are the choices the model picks from.' },
      {
        name: 'Deep only: up to about 2,000 characters of the message text, with quoted replies and signatures removed',
        why: 'It gives the model more to go on, so sorting is more accurate.',
      },
    ],
    privacyPage: PRIVACY_PAGE,
  };
}
