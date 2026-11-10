# Preen for Gmail (Google Workspace add-on)

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

A Google Workspace add-on, written in Apps Script (JavaScript) with a JSON manifest, or served from your own HTTP endpoint.

## How Preen would fit

An add-on runs when the user opens a message. Google offers no add-on trigger for newly received mail. Apps Script can apply labels, archive and move to spam or trash. Automatic sorting would need an hourly time trigger, which add-ons can run at most once an hour, or a separate server that uses the Gmail API's push notifications. Either route would change who handles the mail, because a script or server would handle it instead of only the user's computer.

## What it can reuse

`packages/shared`, either bundled into Apps Script or run on a server with the HTTP runtime. Both are unverified.

## Store and packaging

Google Workspace Marketplace, with app review and OAuth verification. Scopes that read or change mail may need a security assessment.

## Release tag

`gmail-vX.Y.Z`, reserved.

## Label

Issues and pull requests for this app use the `app:gmail` label (`.github/labels.json`).

## Open questions

- Which Gmail scopes an add-on needs, and the review they bring.
- Whether background sorting is acceptable for Preen's privacy promises.

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://developers.google.com/workspace/add-ons/concepts/workspace-triggers
- https://developers.google.com/apps-script/guides/triggers/installable
- https://developers.google.com/apps-script/reference/gmail/gmail-thread
- https://developers.google.com/workspace/marketplace/about-app-review
- https://developers.google.com/workspace/gmail/api/guides/push
