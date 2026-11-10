#!/bin/bash
# SPDX-License-Identifier: PolyForm-Shield-1.0.0
#
# One-stop development script: run it after every code change. See --help.
set -euo pipefail

usage() {
  cat <<'HELP'

One-stop development script. Safe to re-run after every code change:
  1. installs Node.js if missing (asks first; needs sudo)
  2. runs the unit tests
  3. builds the add-on package
  4. creates a separate "preen-dev" Thunderbird profile (first run only)
  5. installs the add-on into that profile
  6. starts Thunderbird with the dev profile

Your everyday Thunderbird profile is never touched.

Options:
  --skip-tests   don't run the unit tests
  --no-launch    set everything up but don't start Thunderbird
  --profile NAME use the Thunderbird profile NAME, which must start with
                 "preen-" (default: preen-dev, or the PREEN_PROFILE
                 environment variable)
HELP
}

FLATPAK_APP="org.mozilla.thunderbird"
PROFILE_NAME="${PREEN_PROFILE:-preen-dev}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SKIP_TESTS=0
LAUNCH=1
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1 ;;
    --no-launch) LAUNCH=0 ;;
    --profile)
      [ $# -ge 2 ] || { echo "--profile needs a NAME (try --help)"; exit 1; }
      PROFILE_NAME="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
  shift
done
[[ "$PROFILE_NAME" =~ ^preen-[A-Za-z0-9._-]+$ ]] || { echo "Profile name must match preen-NAME (letters, digits, . _ -): $PROFILE_NAME"; exit 1; }

# Inside the Flatpak, ~/.thunderbird maps to this folder on the host.
TB_HOST_DIR="$HOME/.var/app/$FLATPAK_APP/.thunderbird"
PROFILE_HOST_DIR="$TB_HOST_DIR/$PROFILE_NAME"
PROFILE_SANDBOX_DIR="$HOME/.thunderbird/$PROFILE_NAME"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mxx %s\033[0m\n' "$1"; exit 1; }

# --- 1 + 2. Node.js and tests ----------------------------------------------
if [ "$SKIP_TESTS" -eq 1 ]; then
  warn "Skipping tests"
else
  step "Checking Node.js"
  if ! command -v node >/dev/null 2>&1; then
    read -r -p "Node.js is not installed. Install it now with 'sudo apt install nodejs npm'? [Y/n] " answer
    case "${answer:-y}" in
      [Yy]*) sudo apt install -y nodejs npm ;;
      *) fail "Node.js is needed for the tests. Re-run with --skip-tests to skip them." ;;
    esac
  fi
  echo "Node $(node --version)"

  step "Running unit tests"
  (cd "$ROOT" && npm test) || fail "Tests failed; fix them before loading the add-on (or use --skip-tests)."
fi

# --- 3. Build ---------------------------------------------------------------
step "Building the add-on"
sh "$ROOT/scripts/package.sh"
VERSION=$(node -p "require('$ROOT/apps/thunderbird/manifest.json').version")
ADDON_ID=$(sed -n 's/^ *"id": *"\([^"]*\)".*/\1/p' "$ROOT/apps/thunderbird/manifest.json" | head -n 1)
XPI="${PREEN_DIST:-$ROOT/dist}/preen-thunderbird-$VERSION.xpi"
[ -n "$ADDON_ID" ] || fail "Could not read the add-on ID from apps/thunderbird/manifest.json"

# --- 4. Dev profile ---------------------------------------------------------
step "Preparing the '$PROFILE_NAME' Thunderbird profile"
flatpak info "$FLATPAK_APP" >/dev/null 2>&1 || fail "Thunderbird Flatpak ($FLATPAK_APP) is not installed."

if pgrep -f -- "-P $PROFILE_NAME" >/dev/null 2>&1; then
  warn "The dev Thunderbird is running. Close it now, then press Enter (changes load on restart)."
  read -r _
  pgrep -f -- "-P $PROFILE_NAME" >/dev/null 2>&1 && fail "The dev Thunderbird is still running."
fi

if [ ! -d "$PROFILE_HOST_DIR" ]; then
  echo "Creating profile at $PROFILE_HOST_DIR"
  flatpak run "$FLATPAK_APP" --headless -CreateProfile "$PROFILE_NAME $PROFILE_SANDBOX_DIR" >/dev/null 2>&1 || true
  [ -d "$PROFILE_HOST_DIR" ] || fail "Thunderbird did not create the profile. Try: flatpak run $FLATPAK_APP -ProfileManager"
else
  echo "Profile already exists"
fi

# Development-only preferences for this profile, kept between marker lines in
# user.js (replaced on every run; anything outside them is left alone):
#  - enable add-ons installed by copying the file (no "allow this add-on?" prompt)
#  - check the profile's add-on folder at startup so rebuilt versions are picked up
#  - enable developer tools for debugging the add-on
USER_JS="$PROFILE_HOST_DIR/user.js"
BEGIN_MARK="// BEGIN Preen scripts/dev.sh"
END_MARK="// END Preen scripts/dev.sh"
touch "$USER_JS"
awk -v b="$BEGIN_MARK" -v e="$END_MARK" '$0 == b { skip = 1; next } $0 == e { skip = 0; next } !skip' "$USER_JS" > "$USER_JS.tmp"
{
  echo "$BEGIN_MARK"
  cat <<'EOF'
// Development profile only.
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.startupScanScopes", 1);
user_pref("xpinstall.signatures.required", false);
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.debugger.prompt-connection", false);
user_pref("mail.shell.checkDefaultClient", false);
EOF
  # A lab profile keeps its own safety prefs (written by the lab setup script) on top.
  if [ -f "$PROFILE_HOST_DIR/user-lab.js" ]; then
    cat "$PROFILE_HOST_DIR/user-lab.js"
  fi
  echo "$END_MARK"
} >> "$USER_JS.tmp"
mv "$USER_JS.tmp" "$USER_JS"

# --- 5. Install the add-on --------------------------------------------------
step "Installing Preen $VERSION into the dev profile"
mkdir -p "$PROFILE_HOST_DIR/extensions"
cp "$XPI" "$PROFILE_HOST_DIR/extensions/$ADDON_ID.xpi"
touch "$PROFILE_HOST_DIR/extensions/$ADDON_ID.xpi"
echo "Installed as extensions/$ADDON_ID.xpi"

# --- 6. Launch --------------------------------------------------------------
if [ "$LAUNCH" -eq 1 ]; then
  step "Starting Thunderbird with the dev profile"
  # -purgecaches: the add-on was just replaced by copying the file, which
  # bypasses Thunderbird's normal install, so make sure no stale copy of
  # Preen's pages or scripts is used.
  nohup flatpak run "$FLATPAK_APP" -P "$PROFILE_NAME" --no-remote -purgecaches >/dev/null 2>&1 &
  disown
  echo "Thunderbird is starting."
fi

cat <<EOF

First time? In the dev Thunderbird:
  1. Add a mail account (a test account, or your own; dry run is on by default, so nothing changes).
  2. Add-ons and Themes → Preen → Settings: pick a provider, paste your API key,
     click "Test connection", then "Save".
  3. Right-click some messages → "Preview with Preen (no changes)".
  Debugging: Tools → Developer Tools → Debug Add-ons → Preen → Inspect.

After changing code, just run this script again.
EOF
