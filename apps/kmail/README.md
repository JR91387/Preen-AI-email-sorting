# Preen for KMail

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

KMail plugins are C++ (KDE Frameworks, Akonadi). KMail's filters can also run an external program on each message ("Execute Command" or "Pipe Through", with placeholders such as `%{itemid}`), and filtering runs in the Akonadi mail filter agent as mail arrives.

## How Preen would fit

Two possible routes: a filter that runs a small Preen program on each new message, or a native C++ plugin. How a program would apply tags back in KMail is not confirmed.

## What it can reuse

Not inside KMail. A standalone JavaScript (Node) program using `packages/shared` could be called from a filter (unverified). Otherwise a rewrite in C++.

## Store and packaging

Linux distribution packages. Details unverified.

## Release tag

`kmail-vX.Y.Z` (reserved).

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
