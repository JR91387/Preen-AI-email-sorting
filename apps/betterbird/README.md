# Preen for Betterbird

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

Betterbird is a fork of Thunderbird ESR (Extended Support Release). It runs Thunderbird MailExtensions, which are JavaScript with the `messenger.*` APIs, the same technology as `apps/thunderbird`. Its current releases are based on Thunderbird 153 ESR.

## How Preen would fit

Preen probably needs no separate add-on. Betterbird says it is "100% compatible with Thunderbird's ESR version". It can install add-ons from addons.thunderbird.net or from a file. The Thunderbird `.xpi` needs Thunderbird 140 or newer, which Betterbird 153 meets. The work is to test the Thunderbird build on Betterbird and fixing anything that differs.

## What it can reuse

All of it, as is: the Thunderbird add-on and `packages/shared`.

## Store and packaging

The Thunderbird `.xpi`, installed from addons.thunderbird.net (ATN) or with "Install Add-on From File". Betterbird blocks add-ons that have no Betterbird-compatible version, so the listing's version range matters.

## Release tag

None of its own. Betterbird uses the Thunderbird release (`thunderbird-vX.Y.Z`). If a Betterbird-only build is ever needed, it would use `betterbird-vX.Y.Z`.

## Label

Issues and pull requests for this app use the `app:betterbird` label (`.github/labels.json`).

## Open questions

- Preen has not been tested on Betterbird yet.
- Which Betterbird versions Preen's ATN listing allows.

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://www.betterbird.eu/faq/
- https://www.betterbird.eu/addons/
- https://blog.betterbird.eu/category/releases
- https://webextension-api.thunderbird.net/en/latest/messages.html
