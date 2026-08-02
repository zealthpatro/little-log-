#!/bin/bash
# Build + upload the Cubby iOS app to TestFlight. Reproducible; run from the repo root.
#
# WHY THE ODD DANCE (archive unsigned -> hand-sign -> export)
# Builds 1-5 shipped BROKEN because of this exact step, so read before "simplifying" it:
#
#   1. `npx cap add ios` hardcodes CODE_SIGN_IDENTITY = "iPhone Developer" and leaves DEVELOPMENT_TEAM
#      empty. A Release archive with automatic signing therefore hunts for an *iOS App Development*
#      profile, which requires a registered device. The team has ZERO devices, so the archive fails with
#      "Your team has no devices from which to generate a provisioning profile".
#   2. The tempting workaround is CODE_SIGNING_ALLOWED=NO, and it "works" — the archive succeeds and the
#      export uploads. But it SKIPS the packaging step that embeds entitlements, so the app ships with
#      NONE. Builds 1-5 had no com.apple.developer.applesignin and no aps-environment: Sign in with Apple
#      was rejected by iOS and push could never register. Verified by dumping the signed IPA.
#   3. Forcing CODE_SIGN_IDENTITY="Apple Distribution" conflicts with automatic signing. Ad-hoc signing
#      ("-") is rejected outright by the iOS 26 SDK. Registering a device needs a UDID we don't have.
#
# So: archive unsigned (which works), then hand-sign the .app with the entitlements using the local
# DEVELOPMENT certificate, then let `-exportArchive` re-sign for distribution — it PRESERVES the
# entitlements it finds on the app. Verified end to end: the exported IPA carries both entitlements.
# The development cert is only a carrier; the shipped signature is the cloud distribution one.
#
# The App ID already has APPLE_ID_AUTH + PUSH_NOTIFICATIONS enabled, and the App Store profile grants
# com.apple.developer.applesignin — the app just has to CLAIM it.
#
# Usage:  bash tools/cap_ios_build.sh            # build + upload to TestFlight
#         bash tools/cap_ios_build.sh --local    # build + export an IPA locally, no upload
# See docs/plans/2026-07-15-native-wrapper-app-store.md
set -euo pipefail

KEY_ID="33AU4Z9QJ4"                                   # MUST be the Admin key; App-Manager cannot cloud-sign
ISSUER="6b58eca9-6e61-450a-8b7c-f49fcb03a7e6"
KEY_PATH="$HOME/.appstore-keys/AuthKey_${KEY_ID}.p8"  # never in the repo: the Worker serves the repo publicly
ARCHIVE="/tmp/Cubby.xcarchive"
DD="/tmp/cubby-dd"
OUT="/tmp/Cubby-export"
ENTITLEMENTS="ios/App/App/App.entitlements"
LOCAL=${1:-}

[ -f "$KEY_PATH" ] || { echo "✖ No API key at $KEY_PATH"; exit 1; }

echo "▸ Configuring the Xcode project (entitlements, plist, AppDelegate, icon)…"
ruby tools/cap_ios_configure.rb
python3 tools/gen_app_icon.py
python3 tools/gen_splash.py

# CalVer: year.ISOweek.release (founder-approved 2026-08-02). A second build in the same week:
# CUBBY_REL=2 bash tools/cap_ios_build.sh. Apple compares segments numerically, so 2027.4 > 2026.53.
VER="$(date +%G).$(date +%V | sed 's/^0//').${CUBBY_REL:-1}"
echo "▸ Version $VER (CalVer year.week.release)"

echo "▸ Archiving (unsigned — see the header for why)…"
rm -rf "$ARCHIVE" "$OUT"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$DD" \
  MARKETING_VERSION="$VER" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO archive \
  | grep -E "error:|ARCHIVE SUCCEEDED|ARCHIVE FAILED" || true

APP="$ARCHIVE/Products/Applications/App.app"
[ -d "$APP" ] || { echo "✖ Archive failed"; exit 1; }

# No Meta SDK in the binary, ever (tools/cap_strip_facebook.js should have run before cap sync).
FB=$(strings "$APP/App" | grep -ci fbsdk || true)
[ "$FB" = "0" ] || { echo "✖ $FB fbsdk strings in the binary — Meta's SDK got linked. Run tools/cap_strip_facebook.js + cap sync and rebuild."; exit 1; }
echo "  ✓ 0 fbsdk strings"

# The whole point of this script. Without it the entitlements are silently absent (builds 1-5).
IDENTITY=$(security find-identity -v -p codesigning | grep -m1 "Apple Development" | awk '{print $2}')
[ -n "$IDENTITY" ] || { echo "✖ No local signing certificate. Open Xcode once and sign in, or create one."; exit 1; }
echo "▸ Embedding entitlements (hand-signing with $IDENTITY)…"
codesign --force --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" --generate-entitlement-der "$APP"

# Fail loudly rather than ship another entitlement-less build.
for KEY in "com.apple.developer.applesignin" "aps-environment"; do
  codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q "$KEY" \
    || { echo "✖ $KEY missing from the archived app — the whole reason this script exists. Stopping."; exit 1; }
done
echo "  ✓ applesignin + aps-environment embedded"

if [ "$LOCAL" = "--local" ]; then
  cat > /tmp/ExportLocal.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>F5NVQV7NVB</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF
  PLIST=/tmp/ExportLocal.plist
else
  PLIST=native-build/ExportOptions.plist   # destination: upload -> no local IPA is written (normal)
fi

echo "▸ Exporting (re-signs for distribution, preserving the entitlements)…"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$PLIST" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER" \
  -exportPath "$OUT" | grep -E "error|Upload succeeded|EXPORT SUCCEEDED|EXPORT FAILED" || true

# "Redundant Binary Upload ... build number 'N'" (code 90189) means the PRIOR upload SUCCEEDED --
# manageAppVersionAndBuildNumber auto-bumps. Check scratchpad/asc.js before rebuilding.
echo "▸ Done. Verify the build state with: node scratchpad/asc.js"
