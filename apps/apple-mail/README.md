# Preen for Apple Mail (macOS)

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

A Mail app extension built with Apple's MailKit framework, in Swift or Objective-C, inside a signed Mac app. The user turns it on in Mail > Settings > Extensions.

## How Preen would fit

MailKit's message action handler is called as Mail downloads each message, so automatic sorting is possible. It can mark read or unread, flag, set a background colour, and move to Archive, Junk or Trash. It cannot set named tags or move to any other folder, so Preen's tags would have to map to flags and colours. Developers report it may only see mail going to the Inbox (unconfirmed by Apple).

## What it can reuse

Possibly `packages/shared` built into one file and run in JavaScriptCore, the JavaScript engine that ships with macOS, with the Swift side making the network requests (unverified). Otherwise a rewrite in Swift.

## Store and packaging

The Mac App Store. Direct download of a notarized app is reported but not confirmed by Apple.

## Release tag

`apple-mail-vX.Y.Z` (reserved).

## Label

Issues and pull requests for this app use the `app:apple-mail` label (`.github/labels.json`).

## Open questions

- How to show Preen's categories without named tags.
- Whether the handler sees mail outside the Inbox.
- Running the shared JavaScript in JavaScriptCore.

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://developer.apple.com/documentation/mailkit/memessageactionhandler
- https://developer.apple.com/documentation/mailkit/memessageaction
- https://developer.apple.com/documentation/mailkit/memessageactiondecision
- https://developer.apple.com/videos/play/wwdc2021/10168/
- https://support.apple.com/guide/mail/use-mail-extensions-mlhla9a93cd5/mac
- https://developer.apple.com/forums/thread/711845
