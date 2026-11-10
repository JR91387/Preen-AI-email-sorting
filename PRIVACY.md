# Preen privacy policy

Last updated: 9 November 2026

Preen is a Thunderbird add-on that sorts your mail with an AI model. This page explains what data Preen handles, where it goes, and what stays on your computer. You can also read it inside Preen: Settings → Provider & cost → Privacy policy.

## What Preen sends, and to whom

Preen sends message data to the AI provider you choose in its settings (OpenRouter or TypeSafe), using your own API key. No message data is sent to the provider until you agree in Preen's settings. This version sends no usage statistics. Debug submissions to the Preen developer exist (only when you send them) and are described below; in this version they are not sent either, because no server address is set.

For each message it sorts, Preen sends one request to that provider. **Every request includes:**

- the sender's name and address;
- the subject;
- the date;
- how many people the message was sent to and copied to (the counts only, not their addresses);
- the names of any attachments (not their contents);
- yes/no hints that Preen works out from the message headers on your computer: whether it looks automated, whether it looks written by a person, whether it came from a mailing list, and whether the sender failed a DMARC authentication check (the headers themselves are not sent);
- whether the sender is in your address book (yes, no or unknown);
- if you chose a kind for the account (for example Personal or Work): that kind, and your note about the mailbox if you wrote one; never the account's name or address;
- your personal context and the languages you read, if you filled them in;
- your category names and their "Is" and "Is not" descriptions, and the questions Preen asks (real person, needs reply, to-do, junk, category).

What else is sent depends on the depth you pick for the account:

- **Surface:** nothing else. The message text is not sent.
- **Deep:** also up to about 2,000 characters of the message text, with quoted replies and signatures removed first.

Every message Preen sorts is sent, including mail from your contacts and from senders you have a rule for; a sender rule only removes the "real person" question. Preen does not send messages it cannot read: encrypted messages, messages that are too large, and (with Deep) messages with no readable text are skipped, and so are messages skipped because a limit was reached or you have not agreed.

By default, card, bank and ID numbers that Preen's local patterns find in the subject or message text are replaced with `<PII_Block>` before sending; you can turn this off in Settings. These patterns do not catch every way such numbers can be written.

Your API key is sent only to the provider you chose, to sign each request.

What the provider does with the data is governed by the provider's own terms. We recommend a zero-data-retention (ZDR) setup with your provider where it is offered. Preen cannot control or verify it.

## Usage statistics

This version sends no usage statistics. Settings → Statistics shows your own totals, counted on your computer. They stay there.

## Debug submissions (only when you send them)

Debug submissions are available only while debug mode is on (Settings → Debug).

- **You choose the messages.** Preen lists the messages that have debug records, with the ones whose tags you corrected first. Nothing is selected for you.
- **You see exactly what goes.** "Preview" shows the data for the messages you ticked.
- **You confirm.** "Send" asks you first and names the number of messages. Nothing is sent automatically.

**What a submission contains,** for each message you choose:

- the request Preen sent to Jev, exactly as sent. This includes everything listed under "Every request includes" above, and with Deep depth the message text, after card, bank and ID numbers were replaced with `<PII_Block>`;
- Jev's answer;
- Preen's decision;
- your correction: the tags before and after, and each change with Preen's score for it;
- the time of the message, the time, status and duration of each request, and any error text;
- the submission format name, the Preen version and the date it was made.

Preen leaves out of a submission the settings snapshot, the message's entry id and Message-ID, the provider and the model field of the debug record. If your API key appears in a request, answer or error text, it is replaced with `[removed]`.

**Status in this version: not sent yet.** No server address is set, so the dialog says Preen cannot send yet. You can save the same data as a file instead.

**How long submissions are kept.** Not decided yet. This policy will say so before sending is turned on.


## What stays on your computer

Stored in your Thunderbird profile only:

- **Settings,** including your API key, in the add-on's local storage. The key is sent only to the provider you configured, and is left out of settings exports unless you choose to include it.
- **The activity log and your corrections,** in the add-on's local database, kept for the period you set. You can clear them at any time in Preen's settings.
- **The debug log,** only if you turn on debug mode: the full requests and answers, including message text, in the add-on's local database, kept as long as the activity log. It stays on your computer unless you choose messages to send (see "Debug submissions" below); you can export or clear it in Settings → Debug.
- **Monthly summaries,** in the add-on's local database: counts per month (messages, tokens, cost, tags, categories, errors, skips, runs, corrections, depth, undo and response times, as shown in Settings → Statistics). They have no sender, subject, error message or text, and are kept when old activity is removed.
- **Statistics state,** in the add-on's local storage: the date of first use and the date you last reset your statistics.

Preen shows no advertising.

## Permissions

Preen asks Thunderbird for permission to:

- read messages and their tags, and set them;
- read your accounts and address books (to recognize your contacts);
- store its settings;
- add a right-click menu;
- run on a schedule.

Moving mail to Junk needs an extra permission, which Preen requests only when you turn that option on. In this version, network access is limited to the two provider addresses. No address is set for debug submissions.

## Removing your data

Uninstalling Preen removes its settings, API key, activity log and corrections from Thunderbird. Data already sent to your provider is subject to that provider's retention policy.

## Contact

Questions or requests: open an issue at https://github.com/JR91387/preen-thunderbird-jev-addon-DEVELOPMENT/issues (available once the repository is public).
