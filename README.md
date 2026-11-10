<p align="center">
  <img alt="Preen" src="docs/assets/photos/banner.jpg" width="800">
  <br><sub>Photo: hjburatynski via Pixabay</sub>
</p>

Preen is a Thunderbird add-on that sorts your mail with an AI model. For each message it asks the model what kind of message it is, then tags it in Thunderbird: **Real person**, **Needs reply** and **Junk**, plus categories (Personal, Work, Bills and Codes to start, and any you add).

- **The model judges, your settings decide.** The model returns probabilities. You set the thresholds that turn them into tags, and when Preen is unsure it does less, never more.
- **Your key, your provider.** Preen sends your mail to OpenRouter or TypeSafe with your own API key. It does not pass through a Preen server.
- **Statistics.** Settings → Statistics shows your own totals, counted on your computer. This version sends no usage statistics.
- **Safe to try.** Right-click a message and choose **Preview with Preen (no changes)** to see what Preen would do. You can review a preview and apply only what looks right. Changes can be undone, and daily limits cap how much mail is processed.
- **Small and readable.** Plain JavaScript, no runtime dependencies. A short build step only copies files into place.

**Status:** version 0.0.29, an early release. Needs Thunderbird 140 or newer.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg">
  <img alt="Preen pipeline: 1 Message, 2 Local checks, 3 Ask Jev, 4 Decide, 5 Apply or preview. Only step 3 leaves your computer." src="docs/assets/how-it-works.svg">
</picture>

1. **Message.** Thunderbird hands Preen a message.
2. **Local checks.** Preen notes header hints and whether the sender is a contact. Card and ID numbers are replaced with a placeholder (on by default).
3. **Ask Jev.** The message goes to the model (TypeSafe's Jev) through OpenRouter or TypeSafe. *Surface* sends metadata only; *Deep* adds the text.
4. **Decide.** Your thresholds turn the model's probabilities into tags, on your computer.
5. **Apply or preview.** A preview only logs what would change. Otherwise Preen sets tags, flags and Junk.

## What leaves your computer

Only step 3 sends data out, and you decide where: Preen sends message content to the provider you configure (OpenRouter or TypeSafe), using your own API key. Surface depth never sends the message text.

This version sends no usage statistics. The privacy policy ships inside Preen: Settings → Provider & cost → Privacy policy.

Debug mode (off by default) keeps a full log on your computer. Nothing from it can be sent in this version.

We recommend a zero-data-retention setup with your provider, where offered, so it doesn't keep your mail after answering.

## Get started

1. Get an API key from OpenRouter or TypeSafe, and set up zero data retention with them if they offer it. Make a separate key just for Preen and give it a credit limit, so a leaked key can only spend that much.
2. Download the `.xpi` from the [Releases](../../releases) page, or build it yourself: `npm run package` writes `dist/preen-thunderbird-<version>.xpi`.
3. In Thunderbird: **Add-ons and Themes**, the gear icon, **Install Add-on From File**, then pick the `.xpi`.
4. Open Preen's settings, paste your API key and click **Test connection**.
5. Right-click a few messages and choose **Preview with Preen (no changes)**, then check the results in the activity log.
6. Happy with what you see? Right-click and choose **Classify with Preen**, or pick accounts to process new mail automatically.

Release notes are in [apps/thunderbird/CHANGELOG.md](apps/thunderbird/CHANGELOG.md).

## Repository layout

| Path | Purpose |
|---|---|
| `apps/thunderbird/` | The Thunderbird add-on: manifest, background, mail, storage, UI. Plain ES modules, no runtime dependencies. |
| `apps/<other>/` | Planned apps, one folder each. Each holds only a `README.md` for now; see [Mail apps](#mail-apps). |
| `packages/shared/` | Code shared by all apps, with no mail-app calls: `core/` (rules, settings, cost, text) and `providers/` (requests to the AI provider). Each app links it in as `core/` and `providers/`. |
| `tests/` | Unit and UI tests (`node:test`). |
| `scripts/` | `build.sh` (build an app into `dist/<app>/`), `package.sh` (build and zip the .xpi) and `dev.sh` (dev install). |
| `docs/` | Developer notes, images and screenshots (`docs/screenshots/`). |

## Mail apps

Thunderbird is available now. Betterbird, SeaMonkey, Outlook, KMail, Claws Mail, Evolution, Gmail (Google Workspace add-on) and Apple Mail (macOS) are planned, not started; each has a folder in `apps/` with a README. Issues use one `app:<name>` label per app (`.github/labels.json`), and releases use one tag prefix per app, for example `thunderbird-v0.0.29`.

## Development

This repository holds every Preen app; each lives in `apps/<name>/` and shares `packages/shared/`.

- Test: `npm test`
- Build: `npm run build:thunderbird` copies the add-on, with the shared code, into `dist/thunderbird/` (git-ignored). To load it without packaging, use Thunderbird's Debug Add-ons page and pick `dist/thunderbird/manifest.json`. Rebuild after each change.
- Package: `npm run package` (writes `dist/preen-thunderbird-<version>.xpi`)
- Dev install: `npm run dev`
- Releases are tagged per app: `thunderbird-vX.Y.Z`.

<p align="center">
  <img alt="Groom your inbox. AI mail sorting for Thunderbird. Your key, your choices." src="docs/assets/photos/feather.jpg" width="800">
</p>

## About this project

Preen, the Thunderbird addon using Jev, was conceived, written and managed by [Jerry Reinitz](https://jerryreinitz.com), in partnership with large language models from Anthropic (Claude).

## License

Photos are from Pixabay; see [CREDITS.md](CREDITS.md).

Preen is licensed under the [PolyForm Shield License 1.0.0](LICENSE). You can use it for any purpose, including at work, except to provide a product or service that competes with Preen. It is source-available, not open source.
