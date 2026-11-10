# Preen for SeaMonkey

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

SeaMonkey 2.53 uses the older XUL/XPCOM add-on system. Its release notes say it "does not currently support the WebExtensions add-on api" (only dictionaries and language packs in that format). Support for WebExtensions is described as planned, with no date.

## How Preen would fit

Not possible with today's add-on. Preen for SeaMonkey would need either SeaMonkey to support WebExtensions, or a separate legacy add-on.

## What it can reuse

Possibly the logic in `packages/shared`, inside a rewritten legacy add-on. Unverified.

## Store and packaging

The SeaMonkey add-ons site. Signing and review rules are not known yet.

## Release tag

`seamonkey-vX.Y.Z` (reserved).

## Label

Issues and pull requests for this app use the `app:seamonkey` label (`.github/labels.json`).

## Open questions

- Whether and when SeaMonkey adds WebExtensions support.
- How a legacy add-on would see new mail and set tags (unverified).

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://www.seamonkey-project.org/releases/seamonkey2.53.24/
- https://www.seamonkey-project.org/releases/seamonkey2.53.17/
