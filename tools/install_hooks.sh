#!/bin/sh
# Install the git hooks. Hooks live in .git/hooks, which is NOT tracked by git, so a fresh clone
# has none and this has to be run once per checkout:
#
#   sh tools/install_hooks.sh
#
# pre-push runs the full local gate suite, because in this repo `git push` to main IS the deploy:
# Cloudflare builds from it. There is no staging step in between where a failure could be caught,
# so the last honest place to stop a bad change is here.
#
# It is skippable with `git push --no-verify` when you know what you are doing. CI still runs the
# Chrome-free subset on the other side, so a bypass cannot hide a broken build entirely.
set -e
ROOT=$(git rev-parse --show-toplevel)
HOOKS="$ROOT/.git/hooks"
mkdir -p "$HOOKS"

cat > "$HOOKS/pre-push" <<'HOOK'
#!/bin/sh
# Full gate suite before anything reaches main, because pushing to main deploys it.
ROOT=$(git rev-parse --show-toplevel)
echo "Running gates before push (skip with --no-verify)..."
if ! node "$ROOT/tools/gates.js"; then
  echo ""
  echo "Push stopped: a gate failed. Fix it, or push with --no-verify if you have decided"
  echo "the failure is acceptable and written down why."
  exit 1
fi
HOOK
chmod +x "$HOOKS/pre-push"

# The SEO guard is fast and static, so it can afford to run on every commit rather than every push.
cat > "$HOOKS/pre-commit" <<'HOOK'
#!/bin/sh
ROOT=$(git rev-parse --show-toplevel)
python3 "$ROOT/tools/seo_check.py" || {
  echo "Commit stopped: the SEO guard failed."
  exit 1
}
HOOK
chmod +x "$HOOKS/pre-commit"

echo "Installed:"
echo "  pre-commit  seo_check.py"
echo "  pre-push    tools/gates.js  (full local suite, browser gates included)"
