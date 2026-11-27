#!/bin/sh
# PreToolUse hook on Read and Bash, for every session and every model in this repo (tracked via
# .claude/settings.json). It stops a WHOLE read of a big file, which is the single largest token sink
# here: app/index.html, worker.js and the store files run to thousands of lines, and a chat that needs one
# function reads all of them, every time, into a context that then carries them for the rest of the session.
#
#   Read with no offset and no limit, of a file over CUBBY_BIG_READ_LINES lines (default 400): blocked
#   Bash `cat <file>` of such a file, NOT piped onward (cat f | head passes, cat f > g passes): blocked
#   Everything else passes: targeted reads, small files, files that do not exist (Read reports those),
#   directories, images and PDFs (Read pages those itself), and any input it cannot parse (fails OPEN).
#
# HOW IT MATCHES the Bash case, the same way .claude/hooks/guard-bash.sh does and for the same reason:
# heredoc bodies are dropped, quoted strings cannot split a command, and each shell segment is judged by
# what it BEGINS with, so `echo "cat app/index.html"` or a grep for the word cat is never blocked.
# This hook only ever blocks reads; it never allows anything guard-bash denies (both run, either can deny).
#
# Test it: tools/harness_check.js pipes synthetic Read and Bash calls through here and asserts block AND
# pass, and its --self-test removes the threshold and unwires the hook and requires red.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
export BIGREAD_ROOT="$ROOT"
reason=$(node -e '
const fs=require("fs"), path=require("path"), os=require("os"), { execFileSync }=require("child_process");
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{ j=JSON.parse(s); }catch(e){ process.exit(0); }
  const LIMIT=(()=>{ const n=parseInt(process.env.CUBBY_BIG_READ_LINES||"",10); return n>0?n:400; })();
  const base=String(j.cwd||process.env.BIGREAD_ROOT||process.cwd());
  const resolve=(p)=>{ p=String(p); if(p==="~"||p.startsWith("~/")) p=path.join(os.homedir(),p.slice(1)); return path.resolve(base,p); };
  // Read pages these itself (images, PDFs by pages, notebooks by cell), so a line count means nothing.
  const PAGED=/\.(png|jpe?g|gif|webp|bmp|ico|svgz|pdf|ipynb|heic|tiff?)$/i;
  const lines=(f)=>{ let st; try{ st=fs.statSync(f); }catch(e){ return 0; } if(!st.isFile()||PAGED.test(f)) return 0;
    try{ return parseInt(execFileSync("wc",["-l","--",f],{encoding:"utf8",timeout:4000}).trim().split(/\s+/)[0],10)||0; }catch(e){ return 0; } };
  const MSG=(n,f)=>"This file has "+n+" lines. Find the spot first (~/cubby-work/cfind <words> or grep -n), then Read with offset and limit. For an understanding question: ~/cubby-work/bulk-read --question \"...\" --paths <files>.\nFile: "+f;
  const block=(n,f)=>{ process.stdout.write(MSG(n,f)); process.exit(0); };
  const ti=j.tool_input||{};
  const set=(v)=>v!==undefined&&v!==null&&v!=="";
  if(j.tool_name==="Read"){
    if(!ti.file_path||set(ti.offset)||set(ti.limit)) process.exit(0);
    const f=resolve(ti.file_path), n=lines(f);
    if(n>LIMIT) block(n,f);
    process.exit(0);
  }
  if(j.tool_name!=="Bash") process.exit(0);
  let cmd=String(ti.command||"");
  // 1. drop heredoc bodies (as guard-bash does): cat <<EOF ... EOF writes a file, it reads nothing
  cmd=cmd.replace(/<<-?\s*['"'"'"]?([A-Za-z_][A-Za-z0-9_]*)['"'"'"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g," ");
  // 2. hide quoted strings behind placeholders, so a ; or | inside quotes cannot split a command, but a
  //    quoted file name still resolves: cat "app/index.html" is the same read as cat app/index.html
  const q=[]; const hide=(m)=>{ q.push(m.slice(1,-1)); return " \u0000"+(q.length-1)+"\u0000 "; };
  cmd=cmd.replace(/'"'"'(?:[^'"'"'\\]|\\.)*'"'"'/g,hide).replace(/"(?:[^"\\]|\\.)*"/g,hide).replace(/`[^`]*`/g," ");
  // 3. split into simple commands, remembering which separator FOLLOWS each one: a single | means the
  //    output goes to another program, not into the context
  const parts=cmd.split(/(\n|;|&&|\|\||\|&|\|)/);
  for(let i=0;i<parts.length;i+=2){
    const next=parts[i+1]||"";
    if(next==="|"||next==="|&") continue;
    const seg=parts[i].replace(/^[\s(]+/,"").replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/,"").replace(/^(?:sudo|env|command|exec|nohup|time)\s+/,"").trim();
    if(!/^cat(\s|$)/.test(seg)) continue;
    // output sent to a file is not read into the context
    if(/(^|[^<0-9&])>/.test(seg.replace(/\d?>&\d/g,""))) continue;
    const toks=seg.split(/\s+/).slice(1).map(t=>t.replace(/\u0000(\d+)\u0000/g,(m,k)=>q[+k]));
    for(const t of toks){
      if(!t||t==="-"||/^-/.test(t)||/^[<>|&]/.test(t)) continue;
      const f=resolve(t), n=lines(f);
      if(n>LIMIT) block(n,f);
    }
  }
});')
if [ -n "$reason" ]; then
  printf '%s\n' "$reason" >&2
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$(printf '%s' "$reason" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))')"
  exit 2
fi
exit 0
