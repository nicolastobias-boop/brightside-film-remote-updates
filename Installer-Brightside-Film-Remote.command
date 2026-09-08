#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

show_message() {
  /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with title \"Brightside Film Remote\""
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display dialog "Først skal Node.js installeres. Jeg åbner den officielle downloadside. Vælg LTS-versionen, installer den, og dobbeltklik derefter på denne installer igen." buttons {"Åbn Node.js"} default button "Åbn Node.js" with title "Brightside Film Remote"'
  /usr/bin/open "https://nodejs.org/en/download"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  /usr/bin/osascript -e 'display dialog "Din Node.js-version er for gammel. Installer den aktuelle LTS-version, og kør derefter installeren igen." buttons {"Åbn Node.js"} default button "Åbn Node.js" with title "Brightside Film Remote"'
  /usr/bin/open "https://nodejs.org/en/download"
  exit 1
fi

echo "Installerer nødvendige komponenter …"
npm ci

echo "Bygger Brightside Film Remote til Apple Silicon …"
npm run dist:mac

APP_ZIP="$(find "$PWD/dist" -maxdepth 1 -type f -name '*arm64-mac.zip' -print | sort | tail -n 1)"
if [ -z "$APP_ZIP" ]; then
  show_message "Appen blev bygget, men installationspakken kunne ikke findes. Kontakt mig med teksten fra Terminal-vinduet."
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
/usr/bin/ditto -x -k "$APP_ZIP" "$TEMP_DIR"

APP_SOURCE="$TEMP_DIR/Brightside Film Remote.app"
if [ ! -d "$APP_SOURCE" ]; then
  show_message "Appen kunne ikke pakkes ud. Kontakt mig med teksten fra Terminal-vinduet."
  exit 1
fi

APPLICATIONS_DIR="$HOME/Applications"
APP_DESTINATION="$APPLICATIONS_DIR/Brightside Film Remote.app"
APP_BACKUP="$APPLICATIONS_DIR/Brightside Film Remote.previous.app"
/bin/mkdir -p "$APPLICATIONS_DIR"

/usr/bin/osascript -e 'tell application "Brightside Film Remote" to quit' 2>/dev/null || true
/bin/sleep 2
/bin/rm -rf "$APP_BACKUP"
if [ -d "$APP_DESTINATION" ]; then
  /bin/mv "$APP_DESTINATION" "$APP_BACKUP"
fi

if /usr/bin/ditto "$APP_SOURCE" "$APP_DESTINATION"; then
  /bin/rm -rf "$APP_BACKUP"
else
  /bin/rm -rf "$APP_DESTINATION"
  if [ -d "$APP_BACKUP" ]; then /bin/mv "$APP_BACKUP" "$APP_DESTINATION"; fi
  show_message "Installationen kunne ikke gennemføres. Den tidligere version er gendannet."
  exit 1
fi

/usr/bin/open -R "$APP_DESTINATION"
/usr/bin/osascript -e 'display dialog "Brightside Film Remote er installeret i din Applications-mappe. Finder viser appen nu. Første gang: højreklik på appen, vælg Åbn, og bekræft Åbn." buttons {"Færdig"} default button "Færdig" with title "Installation gennemført"'
