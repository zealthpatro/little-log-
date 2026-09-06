#!/bin/sh
# Runs at SessionStart for EVERY session in this repo (tracked via .claude/settings.json). Its stdout
# is injected into Claude's context, so it says one useful thing and stops: is the pre-push safeguard
# actually live right now, and where the working rules are. For three weeks in Aug-Sep 2026 the answer
# was "no" and nothing said so (docs/postmortems/2026-09-04-pre-push-hook-dead-on-arrival.md).
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
if node "$ROOT/tools/hooks_check.js" >/dev/null 2>&1; then
  echo "Cubby: pre-push suite enforcement is LIVE (tools/hooks_check.js green). Working rules: .claude/rules/ways-of-working.md"
else
  echo "Cubby: WARNING pre-push suite enforcement is NOT live (node tools/hooks_check.js is red). A push to main deploys unverified. Run: sh tools/install_hooks.sh"
fi
exit 0
