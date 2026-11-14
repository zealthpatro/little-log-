#!/bin/sh
# Install the nightly bug-bash (tools/nightly.sh) as a launchd job, com.cubby.nightly, 02:30 local.
#
#   sh tools/install_nightly.sh            CHECK ONLY: lint the plist, check the ops clone, print what
#                                          would be installed. Changes nothing.
#   sh tools/install_nightly.sh --install  write ~/Library/LaunchAgents/com.cubby.nightly.plist and load it
#   sh tools/install_nightly.sh --run-now  after --install: start tonight's run immediately
#
# The weekly health check (com.cubby.weekly-health) is a separate job and is left exactly as it is.
#
# Before --install, the ops clone must exist with its own node_modules (nightly.sh refuses without them,
# and it cannot borrow them from ~/Downloads, which launchd cannot read):
#   ls ~/cubby-ops/little-log-pwa/tools/node_modules ~/cubby-ops/little-log-pwa/test/node_modules
set -e
LABEL=com.cubby.nightly
HERE=$(cd "$(dirname "$0")/.." && pwd)
TEMPLATE="$HERE/tools/launchd/$LABEL.plist"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
CLONE="$HOME/cubby-ops/little-log-pwa"
MODE=check
for a in "$@"; do case "$a" in --install) MODE=install ;; --run-now) MODE=run ;; esac; done

TMP=$(mktemp -t cubby-nightly-plist)
sed "s#__HOME__#$HOME#g" "$TEMPLATE" > "$TMP"
plutil -lint "$TMP"
grep -q '__HOME__' "$TMP" && { echo "the template still has __HOME__ after substitution"; exit 1; }

problems=0
[ -d "$CLONE/.git" ] || { echo "✋ no ops clone at $CLONE (git clone https://github.com/<owner>/little-log-pwa $CLONE)"; problems=1; }
for d in tools test; do
  [ -d "$CLONE/$d/node_modules" ] || { echo "✋ $CLONE/$d/node_modules is missing (copy it in; launchd cannot read ~/Downloads)"; problems=1; }
done
[ -d "$HOME/cubby-reports" ] || echo "note: $HOME/cubby-reports will be created by the first run"
if [ -f "$DEST" ]; then echo "note: $DEST already exists and would be replaced"; fi

case "$MODE" in
  check)
    echo "CHECK ONLY. Would write $DEST (02:30 daily, from $CLONE) and load it with launchctl."
    echo "Nothing was changed. Run with --install to do it."
    rm -f "$TMP"
    exit $problems ;;
  install)
    [ "$problems" = 0 ] || { echo "not installing until the problems above are fixed"; rm -f "$TMP"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/cubby-reports"
    cp "$TMP" "$DEST"; rm -f "$TMP"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$DEST"
    launchctl print "gui/$(id -u)/$LABEL" | grep -E 'state|path' || true
    echo "installed: $DEST" ;;
  run)
    rm -f "$TMP"
    launchctl kickstart "gui/$(id -u)/$LABEL" && echo "started; watch $HOME/cubby-reports/nightly-launchd.log" ;;
esac
