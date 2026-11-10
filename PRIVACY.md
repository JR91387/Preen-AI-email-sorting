# Preen privacy policy

Last updated: 9 November 2026. This policy covers Preen 0.0.29.

Preen is a Thunderbird add-on that sorts your mail with an AI model. This page lists what Preen sends, where it goes, and what it keeps on your computer. You can also read it inside Preen, under Settings, Provider & cost, Privacy policy.

## Where your data goes

Preen sends data to one place: the AI provider you choose in its settings, either OpenRouter or TypeSafe. It uses your own API key. Preen sends nothing until you agree in its settings.

Preen sends nothing to its developer. It has no usage statistics, no crash reports and no server of its own. The add-on can only connect to these two addresses:

- https://openrouter.ai/api/v1/systemone
- https://api.typesafe.ai/v1/systemone

## What each request contains

Preen sends one request for each message it sorts. Every request contains:

- the sender's name and address
- the subject and the date
- how many people the message was sent and copied to, but not their addresses
- the names of attachments, but not their contents
- yes or no answers that Preen works out from the headers on your computer: whether the message looks automated, looks written by a person, came from a mailing list, or failed a DMARC check. DMARC is a test that the sender's address is not forged. The headers themselves are not sent.
- whether the sender is in your address book
- the kind you chose for the account, such as Personal or Work, and your note about it, if you wrote one. Never the account's name or address.
- your personal context and languages, if you filled them in
- your category names and their descriptions

With the Surface depth, that is all. With the Deep depth, the request also contains up to about 2,000 characters of the message text, with quoted replies and signatures removed.

Before sending, Preen replaces card, bank and ID numbers it finds in the subject and text with a placeholder. This is on by default and can be turned off in Settings. It does not catch every way such numbers can be written.

Preen skips encrypted messages, messages that are too large, messages over your daily limit, and messages with no readable text when the depth is Deep.

Your API key goes only to the provider you chose, to sign each request.

What the provider does with your data is set by the provider's own terms. If your provider offers zero data retention, where it deletes your requests after answering, we recommend turning it on. Preen cannot check whether it is on.

## What stays on your computer

Preen keeps these in your Thunderbird profile and nowhere else:

- Your settings, including your API key. The key is stored unencrypted. It is left out of settings exports unless you choose to include it.
- The activity log and your tag corrections, kept for the period you set. You can clear them in Settings.
- Monthly totals shown in Settings, Statistics: counts of messages, tokens, cost, tags, errors and similar. They hold no sender, subject or message text.
- The debug log, only if you turn on debug mode. It holds the full requests and answers, including message text. You can save it as a file or clear it in Settings, Debug. Nothing from it is sent anywhere.

Preen shows no advertising.

## Permissions

Preen asks Thunderbird for permission to read and tag messages, read your accounts and address books, store its settings, add right-click menu items, and run on a schedule. It asks for permission to move mail only when you turn on "Also move it to the Junk folder".

## Removing your data

Uninstalling Preen removes its settings, API key, activity log and corrections from Thunderbird. Data already sent to your provider follows that provider's retention policy.

## Contact

To ask a question or make a request, open an issue at https://github.com/JR91387/Preen-AI-email-sorting/issues.
