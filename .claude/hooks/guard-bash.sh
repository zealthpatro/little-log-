#!/bin/sh
# PreToolUse hook on Bash. CLAUDE.md is context, not enforcement; this is the enforcement. It reads
# the tool call from stdin and DENIES the handful of commands that destroy work or bypass the suite,
# for every session and every model, with the reason Claude will see. Everything else passes silently.
#
#   never delete anything, local included, without a yes and a check with live sessions
#   never push past the gates with --no-verify without writing down why
#
# Test it: tools/harness_check.js pipes real commands through here and asserts allow vs deny.
cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String((j.tool_input&&j.tool_input.command)||""))}catch(e){process.stdout.write("")}})')
deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 2
}
case "$cmd" in
  *"--no-verify"*)
    deny "Blocked: --no-verify skips the gate suite, and a push to main is a deploy. Fix the failing gate, or get the founder's yes and write down why in the commit." ;;
  *"git worktree remove"*|*"git worktree prune"*"--"*|*"rm -rf"*".claude/worktrees"*|*"rm -r"*"worktrees/"*)
    deny "Blocked: never delete a worktree. Other sessions are live in them and names are recycled (see .claude/rules/ways-of-working.md). Run ListAgents, message live sessions, and get a yes first." ;;
  *"git branch -D"*|*"git push"*"--delete"*|*"git push"*" :"*)
    deny "Blocked: never delete a branch without a yes. It may be the only copy of another session's commits." ;;
  *"git stash pop"*|*"git stash drop"*|*"git stash clear"*)
    deny "Blocked: the stash stack is shared across worktrees and sessions. Use a WIP commit; if you must stash, apply by SHA, never pop." ;;
  *"git reset --hard"*|*"git checkout -- ."*|*"git checkout ."*|*"git clean -f"*|*"git restore ."*)
    deny "Blocked: this discards uncommitted work in a tree other sessions share. Commit -o your own files first, or get a yes." ;;
  *"rm -rf "*"/app"*|*"rm -rf "*"/tools"*|*"rm -rf "*"/.git"*|*"rm -rf /"*)
    deny "Blocked: never rm -rf a tracked directory or the repo. Say what you want removed and get a yes." ;;
esac
exit 0
