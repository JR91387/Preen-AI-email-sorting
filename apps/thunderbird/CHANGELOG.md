# Changelog

## 0.0.29

- Preen sends no usage statistics, and the settings for them are gone. Settings, Statistics still shows your own totals (messages sorted, tokens, cost), which stay on your computer.
- The privacy policy is part of Preen. The "Privacy policy" link in Settings opens it, even offline.
- Preen now draws the icons in Settings in a safer way. Nothing looks different.
- The add-on file no longer includes stray files left by developer tools.

## 0.0.28

- Preen adds fewer tags and starts with fewer categories. The tags are Real person, Needs reply, Junk and Preen: processed. To-do, Review and Sensitive are no longer tags. Preen notes a to-do in the activity log, and flags it if you ask. A message Preen is unsure about gets no category and shows as Review on the activity page. Preen notes Sensitive in the activity log. The categories to start with are Personal, Work, and Bills and Codes. The one-click Social, Jobs and Finance categories are gone.
- The Simple / Standard / Everything switch moved from the top bar to a new first Settings section, View. Settings now has 15 sections.
- Dry run is now a row in Advanced and is off by default. Getting started has four steps, and the "turn off dry run" step is gone. The activity page shows its dry run chip only while dry run is on.
- New optional switch under Statistics, "Also share my category setup". It is off by default and locked while statistics are off. It adds category names, descriptions and options to the weekly report, never messages, senders or subjects, and "Show what will be sent" shows it. Preen sends no report yet because no server address is set.
- The wiki's Troubleshooting, FAQ and Settings pages use two-column tables, the diagram colours are readable in light and dark, and each page has a new header image. Screenshots now live in `docs/screenshots`.

## 0.0.27

- Settings is laid out in rows. Each setting's label and control sit on the left, and what it does sits on the right. On a narrow window the rows stack.
- The top bar lists everything from the left, after the title. Mode is a three-button switch (Simple, Standard, Everything, with one to three feathers) that shows the mode and changes it in one click. Dry run is a switch in the top bar that says whether it is on. It is amber while on and still asks before turning off. It is no longer in Getting started. Activity log is an icon button there, and the left menu still has Activity. The automatic-processing chip reads "Automatic on/off/paused".
- Daily allowance buttons show one, two or three feathers (Low, Medium, High) and a pen for Custom. Speed buttons show a bird. A perched bird is Low, a gliding bird is Medium, a bird flying fast is High, and a bird riding a rocket is No limit.
- You can turn categories off with a switch in the Categories header, for example to use Preen only to catch junk. While categories are off, Preen asks no category question and gives no category label, so each request is smaller. The yes/no checks you turned on still run and still tag. Preen keeps your categories for when you turn them back on. Save asks for at least one yes/no check while categories are off. Usage statistics count whether categories are on.
- If you change a setting and then change it back by hand, "Unsaved changes" clears. The badge, the Save button's dot and the list of changes all go away, as if you had clicked Discard.

## 0.0.26

- Settings has three modes: Simple, Standard and Everything. Simple shows Provider & cost, Getting started (with the dry-run switch) and the mailboxes for automatic processing. Standard adds the schedule, limits and categories. Everything shows all 14 sections. The first time you open Settings, a card asks which mode you want. The Mode chip at the top changes it later, and Preen remembers it. "Show all settings" is gone. Find (Ctrl+K) and links switch mode when they point at a setting the current mode hides.
- Settings opens with Provider & cost first. Getting started is one line, showing the next step and how many of the five steps are done. It opens to the steps, with a short demo of the right-click step beside them. The dry-run switch stays visible under it.
- A soft blue, green and orange wash sits behind the Settings page. The cards stay solid, and muted text is a little darker so it stays easy to read on the wash.
- The usage-statistics notice and switch no longer say Preen "sends" a report each week while no report server is set up. They say Preen sends nothing yet.
- Getting started step 3 says the preview results appear in the Activity log.

## 0.0.25

- Preen does not re-tag mail you corrected by hand. Automatic runs and Classify leave it alone ("You corrected this message"), while Preview still runs on it. Activity and the popup offer "Classify anyway" for messages a Classify left alone.
- Activity rows show each tag's confidence as a percentage, the category's confidence and the main reason.
- "Review this run" on preview and dry-run rows (Activity) lets you Apply or Skip each message, or Apply all. Applying uses the decisions already made, makes no new provider requests, and you can undo it like any other run. Preview and dry-run rows read "Would do".
- "Try it on the last 7 days" (Getting started and the popup) previews recent mail in the ticked mailboxes after showing the message count and a cost estimate. Its review opens on the Activity page.
- Cost in dollars. Settings shows about how much 100 and 1,000 emails cost at your price, an estimate from your history. Before any history exists, it counts only what your categories add, and it says so. The monthly cost limit says why it needs a price, and a "Use $N" button suggests a starting limit. The popup shows an estimate before classifying or previewing several messages.
- The consent panel has a short summary, the full list of what Preen sends (each item with a one-line reason) folded below, and the Surface / Deep choice.
- Automatic processing has a summary with an Off / Paused / On pill, the mailboxes it covers and what it uses. Settings that do nothing while it is off are dimmed. The popup shows the same pill.
- Categories have a name counter (n / 40) beside the description counters, and a note that categories pick one label per message while questions add yes/no tags.
- Controls that save at once show a "Saved" check. Controls that need Save show "Not saved yet" until you Save or Discard.
- Undo last run is in Settings, Statistics and the popup as well as Activity. Preen's own dialogs replace the browser's confirm and alert boxes.
- Statistics gained column dates, a "Since last report" column and "Reset my statistics". Reset clears the monthly totals only. The activity log and corrections stay.
- Settings opens on the Essentials (Getting started, Provider & cost, Automatic processing, Limits & allowance, Categories). "Show all settings" shows the rest, and Preen remembers the choice. Find (Ctrl+K) still reaches every setting.
- Test connection says it sends no mail. The usage statistics notice waits until Preen sorts the first message.
- New Settings section, Statistics, shows your own totals (this month and all time), and had an on/off switch for anonymous usage statistics, "Show what will be sent", the date of the next report and the result of the last one.
- Anonymous usage statistics were on by default. They counted ranges and setting choices, with no mail, names, addresses, category names, notes, API key or ID. The first report was due 24 hours after first use, then every 7 days. If a report could not be sent, Preen gave up quietly after 10 seconds, kept that period's counts and tried again a day later, with no message to you. A notice in Getting started offered "Show what's sent" and "Turn off". No server address was set in this version, so Preen sent nothing.
- Statistics show more of your own totals in small tables. They cover errors by kind (one per failed message), messages not tried after an error, skipped messages by reason, runs by type, corrections by tag kind, Review tags given, Surface and Deep, runs undone, messages restored, and the provider's response time per message. They stay in the monthly summaries, so they stay when old activity is removed. The usage report added the same counts for its period, with error counts as exact numbers and the rest as ranges, and no error messages or category names.
- Settings opens once by itself right after you first install Preen, but not on updates, so you see Getting started and the usage-statistics switch straight away.
- Debug mode lets you choose messages (corrected ones first), preview exactly what Preen would send to the Preen developer, and confirm. Preen sent nothing because no server address was set. "Save as file" saves the same data.
- Text that said Preen has no server or no telemetry is corrected in the privacy policy, README, Settings help and the consent text.

## 0.0.24

- Preen declares the sensitiveDataUpload permission, which Thunderbird Add-ons requires for add-ons that send mail content to a third-party service. The privacy policy is dated and names the GitHub contact link.

## 0.0.23

- Settings is redesigned as one scrolling page with a numbered list of sections on the left, clearer cards and status colours, and a "Find a setting" box (Ctrl+K).
- Clicking a section in the list brings that section to the top of the page.
- Dry run is now part of Getting started. When every step is done, Getting started shrinks to one "Setup complete" line. Click it to see the steps again.
- Preen lists unsaved changes in a tray, each with its old and new value, with Discard and Save.
- Each section's icon opens a short explanation of that section.
- New setting, Advanced, Appearance, with Match Thunderbird (the default), Light or Dark. It applies to every Preen page.

## 0.0.22

- The API key note in Settings suggests a key made just for Preen with a credit limit, and the export warning says the file holds the key in plain text. Builds stop if the add-on's files contain anything that looks like a real key.
- Debug mode is off by default (Settings, Debug). It keeps each request to Jev and its answer exactly, with Preen's decision and settings (never the API key), on this computer only, for as long as the history. You can export it as JSON, clear it, or see a row's exchange on the Activity page with "View raw exchange". A banner shows while debug mode is on.

## 0.0.21

First tagged build, not yet on ATN (addons.thunderbird.net).

- Sorts mail with TypeSafe's Jev model through OpenRouter or TypeSafe, using your own API key.
- Tags are Real person, Needs reply, To-do, Review and Junk, plus your own categories.
- Dry run is on by default. The build also has undo, daily limits and an activity log.
- Preen asks before sending. No mail goes to the provider until you agree in Settings, Provider & cost. Consent is per provider, and you can withdraw it at any time.
- Preen replaces card, bank and ID numbers found by the local patterns with `<PII_Block>` in the subject and text sent to the provider. This is on by default and replaces the "Don't send these messages to the AI" option.
- Header hints, whether the sender is a saved contact, and a failed DMARC check go to Jev as facts. Contacts and senders with a "real person" rule now get the Junk question like any other mail. If Preen can't read the address book, it tells Jev the sender is unknown. The "Skip the question when headers show bulk or automated mail" and "Senders in my address book are real people" settings are removed. Your own sender rules still decide Real person.
- A category applies when its probability reaches the category's certainty. The separate hidden confidence check is removed.
- Junk mail can also get the Review tag when Preen is unsure of its category. Junk still gets no Needs reply or To-do tag.
- The token limits (per day, per month), "Messages per right-click run" and "Messages per run" are removed from Settings. Right-click runs take every message you choose, and the Speed buttons set how many messages an automatic run takes (10, 25, 50 or 100). Messages per day and the monthly cost limit stay.
- "Characters per field", "Characters of message text" and the "unsure" margin are removed from Settings. They are fixed at their old defaults: 128 characters per category field, about 2,000 characters of message text with Deep, and an unsure margin of 0.15.
- History "Entries at most" is removed from Settings. Preen keeps history by days only.
- A display name containing another address could make a message look like it came from a saved contact. This is fixed.
