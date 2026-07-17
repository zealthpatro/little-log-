#!/bin/bash
# Refresh (or bump) the self-hosted Firebase compat SDK.
#
# WHY SELF-HOSTED: a service worker can only cache same-origin requests, so while the SDK came from
# gstatic it was never in the app's cache. Offline "worked" only while the browser/iOS happened to hold
# it in its own HTTP cache — and on an eviction the boot chain hard-failed to a blank screen. It was
# also the last third-party origin in the boot path (see the no-third-party-trackers promise).
#
# Usage:  bash tools/dl_firebase_sdk.sh            # re-download the current version
#         bash tools/dl_firebase_sdk.sh 10.13.0    # bump: downloads, repoints, prunes the old dir
# Then bump the sw.js CACHE and deploy. The pre-commit hook enforces the bump.
set -euo pipefail

CUR=$(grep -o 'vendor/firebase/[0-9.]*/' app/index.html | head -1 | cut -d/ -f3)
VER="${1:-$CUR}"
DIR="app/vendor/firebase/$VER"
FILES="firebase-app-compat firebase-auth-compat firebase-firestore-compat firebase-messaging-compat"

echo "▸ Firebase SDK: current=$CUR target=$VER"
mkdir -p "$DIR"
for f in $FILES; do
  URL="https://www.gstatic.com/firebasejs/$VER/$f.js"
  curl -fsS -o "$DIR/$f.js" "$URL" || { echo "✖ Download failed: $URL"; exit 1; }
  # A 404 page or an HTML error would silently become a "working" file that breaks the app at runtime.
  head -c 400 "$DIR/$f.js" | grep -qi "<!doctype\|<html" && { echo "✖ $f.js is HTML, not JS — bad version?"; exit 1; }
  [ "$(wc -c < "$DIR/$f.js")" -gt 10000 ] || { echo "✖ $f.js looks truncated"; exit 1; }
  echo "  ✓ $f.js  $(wc -c < "$DIR/$f.js") bytes"
done

if [ "$VER" != "$CUR" ]; then
  echo "▸ Repointing $CUR -> $VER"
  sed -i '' "s#vendor/firebase/$CUR/#vendor/firebase/$VER/#g" app/index.html app/sw.js app/firebase-messaging-sw.js
  rm -rf "app/vendor/firebase/$CUR"
  echo "  ✓ index.html, sw.js, firebase-messaging-sw.js repointed; $CUR pruned"
fi

# Every file the app loads must be in the SW ASSETS list, or an offline launch gets a shell with no SDK.
for f in $FILES; do
  grep -q "vendor/firebase/$VER/$f.js" app/sw.js || { echo "✖ $f.js is NOT in the sw.js ASSETS list — offline would break"; exit 1; }
done
echo "✓ All four are precached by sw.js. Now bump the sw.js CACHE version and deploy."
