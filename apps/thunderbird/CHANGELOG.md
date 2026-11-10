# Changelog

## 0.0.29

- Changed: Preen sends no usage statistics, and the settings for them are gone. Settings → Statistics still shows your own totals (messages sorted, tokens, cost), kept on your computer.
- Added: the privacy policy is part of Preen. The "Privacy policy" link in Settings opens it, even offline.
- Fixed: a safer way of drawing the icons in Settings. Nothing looks different.
- Fixed: the add-on file no longer includes stray files left by developer tools.

## 0.0.28

- Changed: Preen adds fewer tags and starts with fewer categories. The tags are Real person, Needs reply, Junk and Preen: processed. To-do, Review and Sensitive are no longer tags: a to-do is noted in the activity log (and flagged if you ask), a message Preen is unsure about gets no category and shows as Review on the activity page, and Sensitive is noted in the activity log. The categories to start with are Personal, Work, Bills and Codes, and the one-click Social, Jobs and Finance categories are gone.
- Changed: the Simple / Standard / Everything switch moved from the top bar to a new first Settings section, View. Settings now has 15 sections.
- Changed: dry run is now a row in Advanced and is off by default. Getting started has four steps; the "turn off dry run" step is gone. The activity page shows its dry run chip only while dry run is on.
- Added: an optional "Also share my category setup" switch under Statistics, off by default and locked while statistics are off. It adds category names, descriptions and options to the weekly report, never messages, senders or subjects, and "Show what will be sent" shows it. No report is sent yet because no server address is set.
- Docs: the wiki's Troubleshooting, FAQ and Settings pages use two-column tables, the diagram colours are readable in light and dark, and each page has a new header image. Screenshots now live in `docs/screenshots`.

## 0.0.27

- Settings is laid out in rows: each setting's label and control on the left, what it does on the right. On a narrow window the rows stack.
- The top bar lists everything from the left, after the title. Mode is a three-button switch (Simple, Standard, Everything, with one to three feathers) that shows the mode and changes it in one click. Dry run is a switch in the top bar that says whether it is on; it is amber while on and still asks before turning off. It is no longer in Getting started. Activity log is an icon button there (the left menu still has Activity), and the automatic-processing chip reads "Automatic on/off/paused".
- Daily allowance buttons show one, two or three feathers (Low, Medium, High) and a pen for Custom. Speed buttons show a bird: perched (Low), gliding (Medium), flying fast (High) and riding a rocket (No limit).
- Categories can be turned off with a switch in the Categories header, for example to use Preen only to catch junk. While off, Preen asks no category question and gives no category label, so each request is smaller; the yes/no checks you turned on still run and still tag. Your categories are kept for when you turn them back on. Save asks for at least one yes/no check while categories are off. Usage statistics count whether categories are on.
- Changing a setting and then changing it back by hand clears "Unsaved changes": the badge, the Save button's dot and the list of changes all go away, as if you had clicked Discard.

## 0.0.26

- Settings has three modes: Simple, Standard and Everything. Simple shows Provider & cost, Getting started (with the dry-run switch) and the mailboxes for automatic processing. Standard adds the schedule, limits and categories. Everything shows all 14 sections. The first time you open Settings a card asks which; the Mode chip at the top changes it later, and Preen remembers it. "Show all settings" is gone. Find (Ctrl+K) and links switch mode when they point at a setting the mode hides.
- Settings opens with Provider & cost first. Getting started is one line (the next step, and how many of the five are done) that opens to the steps, with a short demo of the right-click step beside them. The dry-run switch stays visible under it.
- A soft blue, green and orange wash sits behind the Settings page. The cards stay solid, and muted text is a little darker so it stays easy to read on it.
- The usage-statistics notice and switch no longer say Preen "sends" a report each week while no report server is set up; they say nothing is sent yet.
- Getting started step 3 says the preview results appear in the Activity log.

## 0.0.25

- Mail you corrected by hand is not re-tagged: automatic runs and Classify leave it alone ("You corrected this message"); Preview still runs on it. Activity and the popup offer "Classify anyway" for messages a Classify left alone.
- Activity rows show each tag's confidence as a percentage, the category's confidence and the main reason.
- "Review this run" on preview and dry-run rows (Activity): Apply or Skip each message, or Apply all. Applying uses the decisions already made, with no new provider requests, and can be undone like any other run. Preview and dry-run rows read "Would do".
- "Try it on the last 7 days" (Getting started and the popup): previews recent mail in the ticked mailboxes after showing the message count and a cost estimate; its review opens on the Activity page.
- Cost in dollars: Settings shows about how much 100 and 1,000 emails cost at your price, an estimate from your history (before any history, only what your categories add, and it says so). The monthly cost limit says why it needs a price, and a "Use $N" button suggests a starting limit. The popup shows an estimate before classifying or previewing several messages.
- Consent panel: a short summary, the full list of what is sent (each with a one-line reason) folded below, and the Surface / Deep choice in the panel.
- Automatic processing: a summary with an Off / Paused / On pill, the mailboxes it covers and what it uses; settings that do nothing while it is off are dimmed. The popup shows the same pill.
- Categories: a name counter (n / 40) beside the description counters, and a note that categories pick one label per message while questions add yes/no tags.
- Controls that save at once show a "Saved" check; controls that need Save show "Not saved yet" until you Save or Discard.
- Undo last run is in Settings → Statistics and the popup as well as Activity. Preen's own dialogs replace the browser's confirm and alert boxes.
- Statistics: column dates, a "Since last report" column and "Reset my statistics" (clears the monthly totals only; the activity log and corrections stay).
- Settings opens on the Essentials (Getting started, Provider & cost, Automatic processing, Limits & allowance, Categories); "Show all settings" shows the rest and is remembered. Find (Ctrl+K) still reaches every setting.
- Test connection says it sends no mail. The usage statistics notice waits until the first message is sorted.
- New Settings section, Statistics: your own totals (this month and all time), and anonymous usage statistics with an on/off switch, "Show what will be sent", the date of the next report and the result of the last one.
- Anonymous usage statistics are on by default: counts as ranges and setting choices, with no mail, names, addresses, category names, notes, API key or ID. First report 24 hours after first use, then every 7 days. If a report can't be sent, Preen gives up quietly after 10 seconds, keeps that period's counts and tries again a day later; you see no message. A notice in Getting started offers "Show what's sent" and "Turn off". No server address is set in this version, so nothing is sent yet.
- Statistics: more of your own totals, in small tables: errors by kind (one per failed message) and messages not tried after an error; skipped messages by reason; runs by type; corrections by tag kind and Review tags given; Surface and Deep; runs undone and messages restored; and the provider's response time per message. They are kept in the monthly summaries, so they stay when old activity is removed. The usage report adds the same counts for its period: error counts as exact numbers, the rest as ranges; no error messages and no category names.
- Settings opens once by itself right after Preen is first installed (not on updates), so Getting started and the usage-statistics switch are seen straight away.
- Debug: with debug mode on, you can choose messages (corrected ones first), preview exactly what would be sent to the Preen developer, and confirm. Nothing is sent yet because no server address is set; "Save as file" saves the same data.
- Text that said Preen has no server or no telemetry is corrected in the privacy policy, README, Settings help and the consent text.

## 0.0.24

- Declares the sensitiveDataUpload permission, which Thunderbird Add-ons requires for add-ons that send mail content to a third-party service. The privacy policy is dated and notes that the GitHub contact link works once the repository is public.

## 0.0.23

- Settings page redesigned: one scrolling page with a numbered list of sections on the left, clearer cards and status colours, and a "Find a setting" box (Ctrl+K).
- Clicking a section in the list brings that section to the top of the page.
- Dry run is now part of Getting started. When every step is done, Getting started shrinks to one "Setup complete" line; click it to see the steps again.
- Unsaved changes are listed in a tray, each with its old and new value, with Discard and Save.
- Each section's icon opens a short explanation of that section.
- New setting, Advanced → Appearance: Match Thunderbird (the default), Light or Dark. It applies to every Preen page.

## 0.0.22

- Settings: the API key note suggests a key made just for Preen with a credit limit, and the export warning says the file holds the key in plain text. Builds stop if the add-on's files contain anything that looks like a real key.
- Debug mode, off by default (Settings → Debug): keeps each request to Jev and its answer exactly, with Preen's decision and settings (never the API key), on this computer only, as long as the history. Export it as JSON, clear it, or see a row's exchange on the Activity page with "View raw exchange". A banner shows while it is on.

## 0.0.21

First tagged build (not yet on ATN).

- Sorts mail with TypeSafe's Jev model through OpenRouter or TypeSafe, using your own API key.
- Tags: Real person, Needs reply, To-do, Review, Junk, plus your own categories.
- Dry run on by default, undo, daily limits and an activity log.
- Asks before sending: no mail goes to the provider until you agree in Settings → Provider & cost. Consent is per provider and can be withdrawn at any time.
- Card, bank and ID numbers found by the local patterns are replaced with `<PII_Block>` in the subject and text sent to the provider. On by default; replaces the "Don't send these messages to the AI" option.
- Header hints, whether the sender is a saved contact, and a failed DMARC check are sent to Jev as facts. Contacts and senders with a "real person" rule now get the Junk question like any other mail; if the address book can't be read, Jev is told the sender is unknown. The "Skip the question when headers show bulk or automated mail" and "Senders in my address book are real people" settings are removed; your own sender rules still decide Real person.
- A category applies when its probability reaches the category's certainty; the separate hidden confidence check is removed.
- Junk mail can also get the Review tag when Preen is unsure of its category. Junk still gets no Needs reply or To-do tag.
- Settings: the token limits (per day, per month), "Messages per right-click run" and "Messages per run" are removed. Right-click runs take every message you choose, and the Speed buttons set how many messages an automatic run takes (10, 25, 50 or 100). Messages per day and the monthly cost limit stay.
- Settings: "Characters per field", "Characters of message text" and the "unsure" margin are removed. They are fixed at their old defaults (128 characters per category field, about 2,000 characters of message text with Deep, an unsure margin of 0.15).
- Settings: History "Entries at most" is removed. History is kept by days only.
- Fixed: a display name containing another address could make a message look like it came from a saved contact.
