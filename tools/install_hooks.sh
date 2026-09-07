#!/bin/sh
# The hooks are TRACKED, in .githooks, and core.hooksPath points git at them. That is the whole
# installer now: this script only verifies it, because the previous version was the bug.
#
#   sh tools/install_hooks.sh
#
# WHAT WENT WRONG BEFORE. This wrote pre-push into .git/hooks, which is untracked, and that worked
# until core.hooksPath was set to .githooks so the pre-commit hook could travel with a clone. Git
# then ignores .git/hooks completely. The pre-push hook stayed there, executable, and never ran
# again, so the full gate suite has not blocked a single push since. A hook that is never invoked
# cannot tell you it is not being invoked.
#
# pre-push runs the full local suite, because in this repo `git push` to main IS the deploy:
# Cloudflare builds from it. There is no staging step where a failure could be caught, so the last
# honest place to stop a bad change is here.
#
# Skippable with `git push --no-verify` when you know what you are doing. CI runs the Chrome-free
# subset on the other side, which is 19 of 100 gates, so a bypass hides most of the suite.
set -e
ROOT=$(git rev-parse --show-toplevel)

# Point git at the tracked directory. RELATIVE on purpose: git resolves a relative core.hooksPath
# against the repo root, so it survives a moved or copied checkout, and it matches what
# .claude/hooks/session-start.sh sets for every Claude session. Idempotent, safe in any worktree.
git config core.hooksPath .githooks

missing=0
for h in pre-commit pre-push; do
  path=$(git rev-parse --git-path "hooks/$h")
  if [ -f "$path" ] && [ -x "$path" ]; then
    echo "  ok   $h  ->  $path"
  else
    echo "  MISSING  $h  ->  $path"
    missing=1
  fi
done

# The dead copies are the trap that caused this. Say so rather than deleting somebody's files.
for h in pre-commit pre-push; do
  if [ -f "$ROOT/.git/hooks/$h" ]; then
    echo "  note: $ROOT/.git/hooks/$h still exists and git will NEVER run it (hooksPath wins)."
  fi
done

if [ "$missing" = "1" ]; then
  echo ""
  echo "A hook git resolves to is missing. Push protection is NOT in place."
  exit 1
fi
echo ""
echo "Hooks live. node tools/hooks_check.js asserts this in the suite."
