# Preen for Outlook

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

Office web add-ins (Office.js), written in JavaScript or TypeScript, with an XML manifest or the unified Microsoft 365 manifest. The new Outlook for Windows supports only web add-ins; COM and VSTO add-ins work only in classic Outlook. Add-ins work only with Microsoft accounts.

## How Preen would fit

An add-in can set categories on a message (Mailbox requirement set 1.8). Outlook documents no add-in event for newly received mail, so automatic sorting would need either the user to act on each message or a separate server service using Microsoft Graph change notifications.

## What it can reuse

The JavaScript in `packages/shared`, probably with a bundler. The Thunderbird-specific code would be replaced by Office.js calls.

## Store and packaging

Microsoft Marketplace (AppSource) or deployment by an organisation's admin in the Microsoft 365 admin center.

## Release tag

`outlook-vX.Y.Z` (reserved).

## Label

Issues and pull requests for this app use the `app:outlook` label (`.github/labels.json`).

## Open questions

- How to sort new mail automatically without a server.
- Whether moving mail and marking junk are possible from an add-in (Graph can move messages; unverified for junk).
- Gmail and other non-Microsoft accounts in Outlook can't use add-ins.

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview
- https://learn.microsoft.com/en-us/office/dev/add-ins/develop/event-based-activation
- https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/categories
- https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview
- https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/one-outlook
