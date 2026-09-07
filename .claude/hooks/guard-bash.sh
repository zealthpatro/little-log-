#!/bin/sh
# PreToolUse hook on Bash, for every session and every model in this repo (tracked via
# .claude/settings.json). CLAUDE.md is context; this is enforcement. It DENIES the handful of commands
# that destroy work or bypass the gate suite, with the reason Claude will see, and passes everything
# else silently. The rules it enforces:
#
#   never delete anything, local included, without a yes and a check with live sessions
#   never push past the gates with --no-verify without writing down why
#
# HOW IT MATCHES, and why. The first version matched substrings of the whole command text and blocked
# `rm -rf /tmp/fresh-clone` (matched "rm -rf /") and a python heredoc that CONTAINED the string
# "rm -rf .claude/worktrees/abc" as a test fixture. A guard that blocks MENTIONS of a command, in tests,
# docs, memory notes and greps, is a guard people learn to route around. So this strips heredoc bodies
# and quoted strings, splits the command into shell segments (; && || | newline), and asks what each
# segment BEGINS with. Executing `git stash pop` is denied; echoing, grepping or writing the words is not.
#
# Test it: tools/harness_check.js pipes real commands through here and asserts allow AND deny, including
# that a heredoc mention and a scratch-dir rm are allowed.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
export GUARD_ROOT="$ROOT"
reason=$(node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  let cmd=""; try{ const j=JSON.parse(s); cmd=String((j.tool_input&&j.tool_input.command)||""); }catch(e){ process.exit(0); }
  // 1. drop heredoc bodies: <<TAG ... TAG and <<'"'"'TAG'"'"' ... TAG (quoted or not)
  cmd=cmd.replace(/<<-?\s*['"'"'"]?([A-Za-z_][A-Za-z0-9_]*)['"'"'"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g," ");
  // 2. drop quoted strings, so words inside them are data not commands
  cmd=cmd.replace(/'"'"'(?:[^'"'"'\\]|\\.)*'"'"'/g," ").replace(/"(?:[^"\\]|\\.)*"/g," ").replace(/`[^`]*`/g," ");
  // 3. split into simple commands and look at how each one starts
  const root=(process.env.GUARD_ROOT||"").replace(/\/+$/,"");
  const segs=cmd.split(/\n|;|&&|\|\||\|/).map(x=>x.replace(/^[\s(]+/,"").replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/,"").replace(/^(?:sudo|env|command|exec|nohup|time)\s+/,"").trim()).filter(Boolean);
  const tracked=["app","tools","test","docs",".git",".githooks",".claude","worker.js"];
  const isRepoPath=(raw)=>{ if(/^\/+$/.test(raw)) return "root"; const t=raw.replace(/\/+$/,""); if(root&&(t===root)) return "the repo";
    for(const d of tracked){ if(t===d||t==="./"+d||t.startsWith(d+"/")||t.startsWith("./"+d+"/")||(root&&(t===root+"/"+d||t.startsWith(root+"/"+d+"/")))) return "a tracked directory ("+d+")"; }
    if(/(^|\/)worktrees\//.test(t)||/\/worktrees$/.test(t)) return "a worktree"; return null; };
  const deny=(r)=>{ process.stdout.write(r); process.exit(0); };
  for(const seg of segs){
    if(/^git\s+push\b/.test(seg)&&/\s--no-verify\b/.test(seg)) deny("Blocked: --no-verify skips the gate suite, and a push to main is a deploy. Fix the failing gate, or get the founder'"'"'s yes and write down why in the commit.");
    if(/^git\s+worktree\s+(remove|prune)\b/.test(seg)) deny("Blocked: never delete a worktree. Other sessions are live in them and names are recycled (.claude/rules/ways-of-working.md). Run ListAgents, message live sessions, get a yes.");
    if(/^git\s+branch\s+(-D|--delete\s+--force|-[a-zA-Z]*D)\b/.test(seg)) deny("Blocked: never delete a branch without a yes. It may be the only copy of another session'"'"'s commits.");
    if(/^git\s+push\b/.test(seg)&&(/\s--delete\b/.test(seg)||/\s:\S+/.test(seg))) deny("Blocked: never delete a remote branch without a yes.");
    if(/^git\s+stash\s+(pop|drop|clear)\b/.test(seg)) deny("Blocked: the stash stack is shared across worktrees and sessions. Use a WIP commit; if you must stash, apply by SHA, never pop.");
    if(/^git\s+reset\s+--hard\b/.test(seg)||/^git\s+checkout\s+(--\s+)?\.\s*$/.test(seg)||/^git\s+restore\s+\.\s*$/.test(seg)||/^git\s+clean\s+-[a-zA-Z]*f/.test(seg)) deny("Blocked: this discards uncommitted work in a tree other sessions share. Commit -o your own files first, or get a yes.");
    const rm=/^rm\s+(-[a-zA-Z]*\s+)*(.*)$/.exec(seg);
    if(rm&&/^rm\s+(-[a-zA-Z]*\s+)*/.test(seg)&&/\s-[a-zA-Z]*r/.test(" "+seg.split(/\s+/).slice(0,3).join(" "))){
      for(const tok of rm[2].split(/\s+/).filter(t=>t&&!t.startsWith("-"))){ const what=isRepoPath(tok); if(what) deny("Blocked: never rm -r "+(what==="root"?"/":what)+" ("+tok+"). Scratch under /tmp is fine; say what you want removed here and get a yes."); }
    }
  }
});')
if [ -n "$reason" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$(printf '%s' "$reason" | sed 's/"/\\"/g')"
  exit 2
fi
exit 0
