# Preen for Claws Mail

## Status

Planned, not started. Nothing in this folder runs yet. Preen is available for Thunderbird today (`apps/thunderbird`).

## Platform

Native plugins in C, plus a Perl plugin (a Perl interface to the filtering system) and a Python plugin.

## How Preen would fit

The Perl filter script runs as part of filtering incoming mail and can mark and move messages. The Python plugin documents adding and removing tags and moving messages. Either could hand each message to Preen's logic.

## What it can reuse

Not inside Claws Mail, which has no JavaScript engine. An external JavaScript program called from a Perl or Python filter is possible (unverified). Otherwise a rewrite.

## Store and packaging

Linux distribution packages, for example `claws-mail-perl-filter` and `claws-mail-python-plugin`.

## Release tag

`claws-mail-vX.Y.Z` (reserved).

## Label

Issues and pull requests for this app use the `app:claws-mail` label (`.github/labels.json`).

## Open questions

- Whether the Python plugin can run on incoming mail, and which Python version it uses (its docs date from 2015).
- Marking junk from a plugin (unverified).

## Sources

Research notes, accessed 2026-11-09. Items marked unverified were not confirmed in the sources.

- https://www.claws-mail.org/plugins.php
- https://www.claws-mail.org/plugin.php?plugin=python
- https://manpages.debian.org/unstable/claws-mail-perl-filter/claws-mail-perl-filter.7.en.html
