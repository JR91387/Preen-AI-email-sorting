# Preen for KMail

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

KMail plugins are C++ and use KDE Frameworks and Akonadi. KMail's filters can also run an external program on each message, with "Execute Command" or "Pipe Through" and placeholders such as `%{itemid}`. Filtering runs in the Akonadi mail filter agent as mail arrives.

## How Preen would fit

Two routes are possible. One is a filter that runs a small Preen program on each new message. The other is a native C++ plugin. How a program would apply tags back in KMail is not confirmed.

## What it can reuse

Nothing inside KMail. A standalone Node program that uses `packages/shared` could run from a filter (unverified). Otherwise Preen needs a rewrite in C++.

## Store and packaging

Linux distribution packages. Details unverified.

## Release tag

`kmail-vX.Y.Z`, reserved.

## Label

Issues and pull requests for this app use the `app:kmail` label (`.github/labels.json`).

## Open questions

- Official documentation for third-party filter actions or plugins.
- How to set tags and junk from an external program.

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://docs.kde.org/stable_kf6/en/kmail/kmail2/filters.html
- https://github.com/KDE/kmail/blob/master/agents/mailfilteragent/mailfilteragent.desktop
- https://datagirl.xyz/posts/kontact_plugin_writing.html (third-party tutorial)
