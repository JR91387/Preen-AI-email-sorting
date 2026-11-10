#!/bin/sh
# SPDX-License-Identifier: PolyForm-Shield-1.0.0
# Builds an app into dist/<app>/ (default app: thunderbird). Symlinked shared
# code (core, providers) is copied in as real files, so the output is what
# ships. PREEN_DIST overrides the output directory (default: dist/ in the repo).
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
app="${1:-thunderbird}"
src="$root/apps/$app"
[ -f "$src/manifest.json" ] || { echo "No app at apps/$app" >&2; exit 1; }
out="${PREEN_DIST:-$root/dist}/$app"

rm -rf "${out:?}"
mkdir -p "$(dirname "$out")"
cp -rL "$src" "$out"
find "$out" -name CHANGELOG.md -exec rm -f {} +
# Hidden files and folders (.ruff_cache, .DS_Store, .gitkeep…) are tooling leftovers, never part of the add-on.
find "$out" -mindepth 1 -name '.*' -prune -exec rm -rf {} +
echo "Built $out"
