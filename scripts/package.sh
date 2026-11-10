#!/bin/sh
# SPDX-License-Identifier: PolyForm-Shield-1.0.0
# Builds apps/thunderbird into dist/thunderbird/ and zips it into
# dist/preen-thunderbird-<version>.xpi. With --downloads, also copies it to
# ~/Downloads/preen-dev.xpi (for Thunderbird installs that can't read the repo).
# Stops if the build contains anything that looks like an API key or private key.
# PREEN_DIST overrides the output directory (default: dist/ in the repo).
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
dist="${PREEN_DIST:-$root/dist}"
build="$dist/thunderbird"
version=$(node -p "require('$root/apps/thunderbird/manifest.json').version")
out="$dist/preen-thunderbird-$version.xpi"

sh "$root/scripts/build.sh" thunderbird

# Refuse to pack anything that looks like a real key. The build is scanned
# rather than the .xpi, because zip compresses the files.
key_pattern='sk-or-v1-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{32,}|BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._~+/-]{20,}'
if hits=$(grep -rlE "$key_pattern" "$build"); then
  echo "Refusing to build: these files look like they contain a key:" >&2
  echo "$hits" >&2
  exit 1
fi

rm -f "$out"
if command -v zip >/dev/null 2>&1; then
  (cd "$build" && zip -qrD -X "$out" .)
else
  # No zip installed: Python's zipfile, with manifest.json at the archive root.
  python3 -I - "$build" "$out" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, src))
PY
fi
echo "Built $out"

if [ "${1:-}" = "--downloads" ]; then
  cp "$out" "$HOME/Downloads/preen-dev.xpi"
  echo "Copied to $HOME/Downloads/preen-dev.xpi"
fi
