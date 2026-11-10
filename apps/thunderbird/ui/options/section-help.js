// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// "About this section" texts for the settings page, one per section card,
// keyed by the section's id. Opened by the icon button in each card header.

export const SECTION_HELP = {
  's-view':
    'Choose how much of Preen\'s settings this page shows: Simple (the essentials), Standard (what most people use) or Everything (every setting, including advanced and debug). Settings you hide keep their values and still work, and Preen remembers your choice on this computer.',
  's-setup':
    'Four steps take you from install to Preen sorting your mail by itself. When every step is done, this section shrinks to one line; click it to see the steps again.',
  's-provider':
    'Preen sends mail straight to the provider you pick here (OpenRouter or TypeSafe), using your own API key, and no mail is sent until you agree. Your key is stored unencrypted in this Thunderbird profile, so use a key made just for Preen with a credit limit. Preen counts tokens but has no price built in: Test connection fills in your provider\'s price, and the monthly limit is an estimate. Your provider\'s credit limit is the hard stop.',
  's-automatic':
    'Choose the mailboxes Preen watches for new mail, and when it runs: as mail arrives, on a schedule (every 5 minutes to 24 hours), or only when you click Run now. Tick no mailboxes to keep it off. Right-click "Classify with Preen" works in any folder either way.',
  's-limits':
    'How much Preen may send, and how fast it works. Limits cover every request: automatic runs, right-click, folders and the toolbar button. 0 means no limit. Limits are checked before each message, so a request already in progress may finish after a limit is reached. For large folders, Medium or Low keeps the computer responsive.',
  's-accounts':
    'For each account, pick which folders are processed automatically and how much of each message is sent. Surface sends only details such as the sender, subject and attachment names, never the message text. Deep also sends about 2,000 characters of the text. Trash, Junk, Sent, Drafts, Outbox, Templates and Archives are never processed automatically.',
  's-people':
    'Preen asks Jev three questions about each message: is it from a real person, is someone waiting for my reply, and does it give me something to do (pay, sign, book, attend). The certainty sets how sure Jev must be before it counts: higher means fewer, safer results. Real person and Needs reply add a tag; a to-do is noted in the activity log and flagged if you tick "Also flag them". Flags sync to iCloud, Apple Mail and Gmail (as stars). Sender rules, added by right-clicking a message, always win and save a question. Categories (a separate section) pick one label per message; the Real person and Needs reply questions add yes/no tags.',
  's-junk':
    'Both are off by default. Junk adds the Preen/Junk tag and Thunderbird\'s own Junk mark. Preen never deletes mail and only moves it if you tick "Also move it to the Junk folder". Marking real mail as junk is the costly mistake, so the default certainty is high. Sensitive info checks each message on this computer for card, bank, ID and passport numbers and dates of birth, and notes it in the activity log (no tag). Separately, those numbers are replaced with <PII_Block> before anything is sent (on by default).',
  's-categories':
    'Your own tags. Jev picks the category whose description fits best, so the descriptions matter more than the names. Use "Is" for what belongs in a category and "Is not" for similar mail that belongs elsewhere. Each field holds up to 128 characters. Categories pick one label per message; questions add yes/no tags.',
  's-privacy':
    'What Jev sees: the sender, subject, date, number of recipients, attachment names, header hints, the kind of mailbox, and your personal context. With Deep it also sees part of the message text. Your personal context and languages go with every request. The activity history stays on this computer for the days you set.',
  's-corrections':
    'When you add or remove a Preen tag yourself, Preen notes the tag, the change and its own score, on this computer only (no sender, subject or text). Export them to see where Preen gets it wrong, or clear them.',
  's-stats':
    'Your totals are counted on this computer from the activity history and are only shown to you. Preen sends no usage statistics.',
  's-backup':
    'Save your settings to a file, or load them from one. Imported settings are shown for review and only take effect when you click Save. Your API key is left out unless you tick "Include my API key"; the file then holds it in plain text.',
  's-debug':
    'For troubleshooting. While on, Preen keeps every request sent to Jev and its answer exactly, including full message text, with Preen\'s decision and your settings (never your API key). It stays on this computer and is never sent automatically. While it is on, you can pick messages (the ones whose tags you corrected come first), preview exactly what would go, and send them to the Preen developer after a confirm; your API key, accounts and settings are never included. Turn it off when you are done; you can keep or delete the records.',
  's-advanced':
    'The default certainty for categories that don\'t set their own, the page colors, and dry run. An answer this close to its threshold is noted as unsure in the activity log. While dry run is on, "Classify with Preen" and automatic processing only log what they would do and change no messages.',
};
