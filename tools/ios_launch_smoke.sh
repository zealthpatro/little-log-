#!/bin/bash
# Launch gate for the native iOS app. Builds for a simulator on the NEWEST iOS installed, installs,
# launches, and fails unless the app is still running SECS later with no new crash report.
#
# WHY: TestFlight 2026.46.1 crashed at launch on every iPhone. iOS 27 kills an app built with the iOS 27
# SDK that has not adopted the UIScene lifecycle, and every check in cap_ios_build.sh was green because
# none of them ever RAN the app. cap_ios_build.sh runs this before it archives and stops on red, so a
# build that cannot open never reaches TestFlight again.
#
# Usage (repo root, after ruby tools/cap_ios_configure.rb):
#   bash tools/ios_launch_smoke.sh
#   CUBBY_SIM_UDID=<udid>   use this simulator instead of the newest iPhone
#   CUBBY_SMOKE_SECS=12     how long the app must stay up (default 12)
#   CUBBY_SMOKE_OUT=<dir>   where the build log and launch.png go (default $TMPDIR/cubby-launch-smoke)
# The project graded is the ios/ folder of the repo that CONTAINS this script (like tools/serve.js).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE=com.littlecubby.app
SECS=${CUBBY_SMOKE_SECS:-12}
OUT_DIR="${CUBBY_SMOKE_OUT:-${TMPDIR:-/tmp}/cubby-launch-smoke}"
DD="$OUT_DIR/dd"
REPORTS="$HOME/Library/Logs/DiagnosticReports"
mkdir -p "$OUT_DIR"
[ -d "$ROOT/ios/App/App.xcodeproj" ] || { echo "✖ No ios/App/App.xcodeproj under $ROOT"; exit 1; }

# The newest runtime's first iPhone: Apple's newest launch rules are the ones that bite.
UDID="${CUBBY_SIM_UDID:-}"
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices available -j | python3 -c '
import json, re, sys
devs = json.load(sys.stdin)["devices"]
def ver(k):
    m = re.search(r"iOS-(\d+)-(\d+)", k)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
for k in sorted((k for k in devs if ".iOS-" in k), key=ver, reverse=True):
    for d in devs[k]:
        if d["name"].startswith("iPhone"):
            print(d["udid"]); sys.exit(0)
')
fi
[ -n "$UDID" ] || { echo "✖ No iPhone simulator installed (Xcode > Settings > Components)."; exit 1; }
RUNTIME=$(xcrun simctl list devices -j | python3 -c '
import json, sys
u = sys.argv[1]
for k, v in json.load(sys.stdin)["devices"].items():
    if any(d["udid"] == u for d in v):
        print(k.rsplit(".", 1)[-1])
' "$UDID")
echo "▸ Launch smoke: $RUNTIME simulator $UDID, must stay up ${SECS}s"
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b >/dev/null

echo "▸ Building for the simulator (log: $OUT_DIR/build.log)…"
if ! xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme App -configuration Debug -sdk iphonesimulator \
    -destination "id=$UDID" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build > "$OUT_DIR/build.log" 2>&1; then
  grep -E "error:" "$OUT_DIR/build.log" | head -20 || true
  echo "✖ Simulator build failed"; exit 1
fi
APP="$DD/Build/Products/Debug-iphonesimulator/App.app"

# The name iOS puts on its own sheets: Google's sign-in sheet read "App" until 16 Nov 2026, because
# CFBundleName was Capacitor's $(PRODUCT_NAME). tools/cap_ios_configure.rb sets both keys.
for KEY in CFBundleName CFBundleDisplayName; do
  GOT=$(/usr/libexec/PlistBuddy -c "Print :$KEY" "$APP/Info.plist" 2>/dev/null || true)
  [ "$GOT" = "Cubby" ] || { echo "✖ $KEY is \"$GOT\", not \"Cubby\": iOS would call the app that on its own sheets (run ruby tools/cap_ios_configure.rb)"; exit 1; }
done

# Apple's privacy manifest must be IN the built app, not only in the project (tools/cap_ios_configure.rb step 7).
plutil -lint "$APP/PrivacyInfo.xcprivacy" >/dev/null 2>&1 \
  || { echo "✖ No valid PrivacyInfo.xcprivacy in the built app (run ruby tools/cap_ios_configure.rb)"; exit 1; }
# The root view controller must be Cubby's subclass, or a phone offline at first launch gets no error page
# at all (tools/cap_ios_configure.rb step 8; tools/native_error_page_check.js grades the source).
grep -rqa CubbyBridgeViewController "$APP/Base.lproj/Main.storyboardc" \
  || { echo "✖ The built Main.storyboard does not use CubbyBridgeViewController (run ruby tools/cap_ios_configure.rb)"; exit 1; }

xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP"
MARK="$OUT_DIR/.launched"; touch "$MARK"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
sleep "$SECS"

# Alive = a launchd job for the app with a numeric PID. A dead app shows "-" or no row at all.
PID=$(xcrun simctl spawn "$UDID" launchctl list 2>/dev/null \
  | awk -v b="UIKitApplication:$BUNDLE" 'index($3, b) == 1 && $1 ~ /^[0-9]+$/ { print $1 }' | head -1)
CRASH=$(find "$REPORTS" -name '*.ips' -newer "$MARK" -print0 2>/dev/null \
  | xargs -0 grep -l "\"bundleID\":\"$BUNDLE\"" 2>/dev/null | head -1 || true)
xcrun simctl io "$UDID" screenshot "$OUT_DIR/launch.png" >/dev/null 2>&1 || true

if [ -n "$PID" ] && [ -z "$CRASH" ]; then
  echo "  ✓ alive after ${SECS}s (pid $PID), no crash report; screenshot $OUT_DIR/launch.png"
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  exit 0
fi

echo "✖ The app did not stay running on $RUNTIME (pid: ${PID:-none})."
if [ -n "$CRASH" ]; then
  echo "  Crash report: $CRASH"
  python3 - "$CRASH" <<'PY' || true
import json, sys
raw = open(sys.argv[1]).read()
body = json.loads(raw[raw.index("\n") + 1:])
exc = body.get("exception", {})
print("  %s %s" % (exc.get("type", "?"), exc.get("signal", "")))
th = body["threads"][body.get("faultingThread", 0)]
for f in th.get("frames", [])[:6]:
    print("    %s" % f.get("symbol", "?"))
PY
fi
exit 1
