# Preen for Evolution

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

Native C/GObject extensions, using the EExtension framework that replaces the older EPlugin. GNOME developers point to C modules, and plugins have no Python bindings. Evolution's JavaScript plugins only change how messages are displayed or edited.

## How Preen would fit

A C extension that hooks into mail handling. Which hooks an extension gets for new mail, tags and junk is not confirmed.

## What it can reuse

Nothing for handling mail. Preen would need a rewrite in C or an external program.

## Store and packaging

Linux distribution packages or Flatpak. Details unverified.

## Release tag

`evolution-vX.Y.Z`, reserved.

## Label

Issues and pull requests for this app use the `app:evolution` label (`.github/labels.json`).

## Open questions

- Current extension documentation (the wiki pages are old).
- Hooks for incoming mail, tags, junk and moving (unverified).

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://wiki.gnome.org/Apps/Evolution/Extensions
- https://wiki.gnome.org/Apps/Evolution/EPlugin
- https://discourse.gnome.org/t/how-can-i-write-a-python-plugin-for-an-email-client-evolution/16496
