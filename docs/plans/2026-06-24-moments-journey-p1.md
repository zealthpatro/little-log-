# Moments → Journey, Phase 1 (free guided journey) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the Moments surfaces from blank/empty states into a gentle **guided journey** of prompts (timeline + milestone + relationship), never blank, with bear placeholder art — reusing the existing add-moment / add-milestone flows. Free. Loss-safe.

**Architecture:** No nav changes, no new screens. Weave a "Your journey" prompt section into the two existing surfaces — pregnancy `renderPregMoments()` (the Moments tab) and baby `renderMilestones()` (Album → Milestones sub-tab). Prompts are *generated* from existing data; **completion is derived** (a moment exists for that week, a milestone has `achievedAt`, a relationship capture has a photo) so we persist as little as possible. The only new persisted data: dismissed prompts, editable titles, and baby relationship captures. Tapping a prompt opens the **existing** capture flow, pre-filled. Bear placeholder art reuses `cubbyBear()` / `memberAvatarSvg()`.

**Privacy split (important):** pregnancy data is owner-owned (`households/{hid}/pregnancy/{ownerUid}`, NOT the shared app blob). So pregnancy journey bits (dismiss, title) live **inside `state.pregnancy`**; baby journey bits live in a new shared-blob key `state.journey`. Relationship captures in P1 are **baby-scope only** (the natural fit) → shared blob. This keeps zero pregnancy/maternal data in the shared blob and needs **no firestore.rules change** (the rule only blacklists `pregnancy`/`mhealth`/`maternalHealth` keys; `journey` is allowed).

**Tech Stack:** Vanilla JS single-file PWA (`app/index.html` ~7800 lines), `app/store-firebase.js` (Firestore sync), `app/cubby-extras.js` (bear SVG), `app/sw.js` (cache version). No build step, no unit-test framework. Verification = `node --check`, `node tools/smoke.js <url>/app/`, targeted Puppeteer probes via the localhost-only `?e2e=1` (seeded baby) / `?e2e=onboard` (empty owner) hooks, and screenshots at 390px via `tools/shot.js`.

---

## Conventions for THIS codebase (read before starting)

- **No real test framework.** "Write the failing test" = write a small Node/Puppeteer probe script under `/tmp/` that drives the local app via the `?e2e` hooks and asserts on real DOM, then watch it FAIL, build, watch it PASS. Internal state / attribute presence is NOT proof — assert on rendered DOM and (for layout) screenshots at 390px. (memory: "verify before done".)
- **Serve locally:** `node tools/serve.js` serves the repo; open `http://localhost:8080/app/?e2e=1` (seeded baby) or `?e2e=onboard`. Puppeteer scripts need `NODE_PATH="$(pwd)/node_modules"` and drive the installed Chrome via `tools/shot.js`'s puppeteer-core.
- **Syntax gate after every edit:** `node --check app/index.html` is NOT valid (HTML). Instead extract-check is impractical; rely on `node tools/smoke.js http://localhost:8080/app/` which loads the page and fails if JS throws / globals missing. Run it after each task.
- **SW bump = ship gate.** A git hook rejects commits to `app/**` unless `app/sw.js` CACHE is bumped. Bump to HEAD+1 dynamically right before committing (see Task 9), never hardcode.
- **Ship loop (Task 9 only, once P1 is whole):** verify → stage only the files this plan touches → bump SW → commit → `git push origin main` → poll prod on `/app/` (not `/app/index.html`; separate CF cache).
- **Charter / loss-safety is blocking.** No completion %, no streaks, no "you're behind" anywhere. Prompts are gentle invitations; a skipped/dismissed prompt is fine forever. Nothing guided while `state.lossHolding` is set; `loss:true` archives are read-only. (See Task 8 — it is not optional.)
- **Voice:** warm, brief, 2nd person, sentence case, no em-dashes, no jargon, no guilt. (memory: customer-facing voice.)

---

## Data model (final)

```js
// SHARED app blob (new key; baby-scope only). Serialized in appBlobFromState / restored in applyAppBlob.
state.journey = {
  titles:    { <babyId>: 'Aanya\'s first year' },   // auto-default, user-editable
  dismissed: { <promptKey>: 1 },                      // baby prompts waved off (never nag)
  rel:       { <babyId>: [ { id, relation, label, photoId, at } ] }  // relationship captures (photoId null = pending prompt the user added)
}

// OWNER-OWNED pregnancy doc (no shared-blob exposure). Lives inside state.pregnancy.
state.pregnancy.journey = {
  title: 'My pregnancy journey',   // auto-default, user-editable
  dismissed: { <promptKey>: 1 }
}
```

Prompt keys are stable strings, e.g. `pmonth:3`, `pscan:20`, `pbump`, `bmonth:4`, `bms:smile`, `brel:<uid>`, `brel:add:<relkey>:<id>`.

---

### Task 1: Journey state — persistence + accessors

**Files:**
- Modify: `app/store-firebase.js` — `appBlobFromState()` (405–420), `applyAppBlob()` (421–443)
- Modify: `app/index.html` — add accessors near the other state helpers (after `activeBaby()` ~line 1026)

**Step 1 — Add `journey` to the shared blob serialize.** In `appBlobFromState()` add after the `timers` line:
```js
    journey: state.journey || null,   // baby-scope guided-journey: titles, dismissed prompts, relationship captures (NOT pregnancy — that stays owner-owned)
```

**Step 2 — Restore it.** In `applyAppBlob()` add after the `state.timers` line:
```js
    state.journey = app.journey || null;
```

**Step 3 — Add accessors in `app/index.html`** (after `activeBaby()`):
```js
function journeyState(){ if(!state.journey) state.journey={}; return state.journey; }
function journeyRel(bid){ const j=journeyState(); if(!j.rel) j.rel={}; if(!j.rel[bid]) j.rel[bid]=[]; return j.rel[bid]; }
// scope: 'pregnancy' routes to the owner-owned pregnancy doc; else the shared baby blob.
function jDismissed(key, scope){
  if(scope==='pregnancy'){ const p=state.pregnancy; return !!(p&&p.journey&&p.journey.dismissed&&p.journey.dismissed[key]); }
  const j=journeyState(); return !!(j.dismissed&&j.dismissed[key]);
}
function jDismiss(key, scope){
  if(scope==='pregnancy'){ if(!state.pregnancy) return; if(!state.pregnancy.journey) state.pregnancy.journey={}; if(!state.pregnancy.journey.dismissed) state.pregnancy.journey.dismissed={}; state.pregnancy.journey.dismissed[key]=1; }
  else { const j=journeyState(); if(!j.dismissed) j.dismissed={}; j.dismissed[key]=1; }
  persist(); render();
}
```

**Step 4 — Verify.** `/tmp/p1-task1.js` (Puppeteer): load `?e2e=1`, then in-page `window.journeyState()` returns an object, `window.jDismiss('x','baby')` then `window.jDismissed('x','baby')===true`, and `appBlobFromState().journey` includes the dismissed key. Run; expect PASS. Also `node tools/smoke.js http://localhost:8080/app/` → PASS.

**Step 5 — Commit** (no SW bump yet if you batch; otherwise see Task 9). `git add app/store-firebase.js app/index.html`.

---

### Task 2: Relationship → bear placeholder art

**Files:**
- Modify: `app/index.html` — add near the other render helpers (after `babyAvatarBox()` ~2667)

**Step 1 — Map relationships to a distinct bear, reuse `cubbyBear()` (`app/cubby-extras.js:44`).** Accessories available: `glasses, bow, flower, cap, bowtie, headphones, crown`. Furs in `FURS`.
```js
// A warm placeholder bear per relationship, shown until the real photo exists.
const RELATION_BEAR = {
  nana:{fur:'#D7B27E',acc:'flower'}, grandma:{fur:'#D7B27E',acc:'flower'},
  grandpa:{fur:'#8C8C8C',acc:'glasses'}, papa:{fur:'#9C6B3D',acc:'none'}, mama:{fur:'#C4863F',acc:'bow'},
  auntie:{fur:'#E0A96D',acc:'bow'}, uncle:{fur:'#6E4E36',acc:'bowtie'},
  sibling:{fur:'#E0A96D',acc:'cap'}, friend:{fur:'#B8843A',acc:'headphones'}, other:{fur:'#C4863F',acc:'none'}
};
function relKeyFromLabel(label){ const s=(label||'').toLowerCase(); for(const k in RELATION_BEAR){ if(s.indexOf(k)>=0) return k; } if(s.indexOf('nan')>=0) return 'nana'; return 'other'; }
// uid present + a real circle member -> their own avatar bear; else a relationship bear.
function journeyBearArt(relation, uid, size){
  if(uid && typeof window.memberAvatarSvg==='function'){ const info=(window.LL&&window.LL.memberInfo)||{}; if(info[uid]) return window.memberAvatarSvg(uid, size||64); }
  const v = RELATION_BEAR[relation] || RELATION_BEAR.other;
  return (typeof window.cubbyBear==='function') ? window.cubbyBear({fur:v.fur, acc:v.acc, size:size||64}) : '🐻';
}
```

**Step 2 — Verify.** In `/tmp/p1-task2.js`: assert `window.journeyBearArt('nana').indexOf('<svg')===0` and `window.journeyBearArt('grandpa').indexOf('<svg')===0`. PASS.

**Step 3 — Commit.** `git add app/index.html`.

---

### Task 3: Prompt generators (derived completion, dismissed-filtered)

**Files:** Modify `app/index.html` — add after Task 2 helpers.

**Step 1 — Pregnancy prompts.** Reuse `pregWeek()`, `state.pregnancy.moments`, `momentSize()`.
```js
function journeyPromptsPreg(){
  const p=state.pregnancy; if(!p) return [];
  const wk=pregWeek();
  const moments=p.moments||[];
  const haveWeek=(w)=>moments.some(m=>+m.week===+w);
  const out=[];
  // the bump, this week
  out.push({key:'pbump', scope:'pregnancy', icon:'🤰', title:'Capture the bump', sub:'A photo this week, week '+wk, done:moments.some(m=>m.at>now()-7*86400000), onclick:"openAddMoment()"});
  // the scans people remember
  [12,20].forEach(w=>{ if(wk>=w-1) out.push({key:'pscan:'+w, scope:'pregnancy', icon:'🩻', title:'Your '+w+'-week scan', sub:'Save the scan photo', done:haveWeek(w), onclick:"openAddMomentAt("+w+")"}); });
  // a few recent months by week milestones
  return out.filter(x=>!jDismissed(x.key,'pregnancy'));
}
```

**Step 2 — Baby prompts.** Reuse `babyMonths()`, `MONTH_SLOTS`, `monthlyMap()`, `MILESTONES`, `achievedOf()`, `memberInfo`, `journeyRel()`.
```js
function journeyPromptsBaby(){
  const b=activeBaby(); if(!b) return [];
  const mo=Math.floor(babyMonths());
  const map=monthlyMap();
  const out=[];
  // month photos up to current age, not yet filled
  MONTH_SLOTS.filter(s=>s<=mo).forEach(s=>{ if(!map[s]) out.push({key:'bmonth:'+s, scope:'baby', icon:'🗓️', title:slotLabel(s)+' photo', sub:'One photo for '+slotLabel(s).toLowerCase(), done:false, onclick:"go('album');setTimeout(function(){albumGo&&albumGo('photos')},0)"}); });
  // next milestones (reuse the existing upcoming logic)
  MILESTONES.filter(m=>msVisible(m,b)&&!achievedOf(m.key)).sort((x,y)=>Math.abs(x.mo-mo)-Math.abs(y.mo-mo)).slice(0,3)
    .forEach(m=>out.push({key:'bms:'+m.key, scope:'baby', icon:m.emoji||'⭐', title:m.title, sub:'Mark it when it happens', done:false, onclick:"openMilestone('"+m.key+"')"}));
  // relationship prompts from the circle
  const info=(window.LL&&window.LL.memberInfo)||{}; const rel=journeyRel(b.id);
  Object.keys(info).forEach(uid=>{ const m=info[uid]||{}; const label=m.relationship||''; if(!label) return; const key='brel:'+uid; const have=rel.some(r=>r.relation==='uid:'+uid&&r.photoId); if(have) return; out.push({key:key, scope:'baby', art:journeyBearArt(relKeyFromLabel(label),uid,56), title:'A photo with '+label, sub:'Together', done:false, onclick:"openRelCapture('uid:"+uid+"',"+JSON.stringify(label)+")"}); });
  // user-added extra relationships (pending entries: photoId null)
  rel.filter(r=>!r.photoId&&r.relation.indexOf('uid:')!==0).forEach(r=>out.push({key:'brel:add:'+r.id, scope:'baby', art:journeyBearArt(r.relation,null,56), title:'A photo with '+r.label, sub:'Together', done:false, onclick:"openRelCapture("+JSON.stringify(r.relation)+","+JSON.stringify(r.label)+",'"+r.id+"')"}));
  return out.filter(x=>!jDismissed(x.key,'baby'));
}
```
*(Note: `albumGo` may be the album sub-tab switcher — confirm its name near `renderAlbum()` (6254) before using; if it differs, adjust the `bmonth` onclick.)*

**Step 3 — Verify.** `/tmp/p1-task3.js` on `?e2e=1`: `window.journeyPromptsBaby().length > 0`; each item has `title` and `onclick`; dismissing one (`jDismiss(item.key,'baby')`) removes it from the next call. On `?e2e=onboard` switched to a pregnancy stage (or a seeded preg), `journeyPromptsPreg().length>0`. PASS.

**Step 4 — Commit.**

---

### Task 4: Render the journey section + CSS (never-blank)

**Files:** Modify `app/index.html` — `renderPregMoments()` (3751), `renderMilestones()` (5907); add CSS in the `<style>` block (reuse `.mem-ready` / `.coach` idiom, ~628).

**Step 1 — Shared renderer.** Add a function that renders a prompt rail + a header with an editable title:
```js
function renderJourneySection(prompts, scope, titleText){
  if(state.lossHolding) return '';                 // loss-safe: nothing guided
  const tiles = prompts.map(p=>`<div class="jr-tile" onclick="${p.onclick}">
      <button class="jr-x" onclick="event.stopPropagation();jDismiss('${p.key}','${scope}')" aria-label="Not now">×</button>
      <div class="jr-art">${p.art||('<span class="jr-emoji">'+(p.icon||'📷')+'</span>')}</div>
      <div class="jr-t">${escapeHtml(p.title)}</div><div class="jr-s">${escapeHtml(p.sub||'')}</div>
    </div>`).join('');
  return `<div class="jr-wrap"><div class="jr-head"><div class="sec-title" style="margin:0">${escapeHtml(titleText)}</div></div>
    <div class="jr-rail">${tiles}</div></div>`;
}
```

**Step 2 — Wire pregnancy.** In `renderPregMoments()`, insert the journey section ABOVE the existing cards/empty-state so the tab is never blank:
```js
    ${renderJourneySection(journeyPromptsPreg(),'pregnancy', pregJourneyTitle())}
```
(Insert right after the "Add a moment" button line. `pregJourneyTitle()` from Task 7.)

**Step 3 — Wire baby.** In `renderMilestones()`, insert near the top (after the hero ring block, before "Coming up"):
```js
    ${renderJourneySection(journeyPromptsBaby(),'baby', babyJourneyTitle())}
```

**Step 4 — CSS** (mirror `.mem-ready`):
```css
.jr-wrap{margin:6px 0 16px}
.jr-rail{display:flex;gap:11px;overflow-x:auto;padding:2px 2px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.jr-rail::-webkit-scrollbar{display:none}
.jr-tile{position:relative;flex:0 0 132px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:13px;box-shadow:0 3px 9px var(--shadow);cursor:pointer;transition:transform .14s}
.jr-tile:active{transform:scale(.97)}
.jr-art{width:56px;height:56px;border-radius:14px;overflow:hidden;margin-bottom:8px;display:grid;place-items:center;background:var(--surface-2)}
.jr-art svg{width:100%;height:100%} .jr-emoji{font-size:26px}
.jr-t{font-weight:800;font-size:13.5px;color:var(--ink);line-height:1.25}
.jr-s{font-size:12px;color:var(--ink-soft);font-weight:600;margin-top:2px;line-height:1.3}
.jr-x{position:absolute;top:6px;right:6px;border:none;background:var(--surface-2);color:var(--ink-soft);width:22px;height:22px;border-radius:50%;font-size:14px;line-height:1;cursor:pointer}
```

**Step 5 — Verify (never-blank + layout).** `/tmp/p1-task4.js` on `?e2e=onboard` → create a fresh baby (or `?e2e=1` with milestones cleared): assert `.jr-rail .jr-tile` count ≥ 1 even with zero captures. Screenshot at 390px for both the pregnancy Moments tab and baby Album→Milestones; Read the PNGs and confirm tiles render with bear/emoji art and are horizontally scrollable. PASS.

**Step 6 — Commit.**

---

### Task 5: Wire prompt taps to existing capture flows

**Files:** Modify `app/index.html` — add small entry points near `openAddMoment()` (3773).

**Step 1 — Pre-filled add-moment by week** (pregnancy scan prompts):
```js
function openAddMomentAt(week){ momentDraft={photoData:null, week:+week||pregWeek(), note:''}; renderAddMoment(); }
```
(`openMilestone(key)` already exists at 5988 — milestone prompts use it directly. `go('album')` exists for month-photo prompts.)

**Step 2 — Verify.** `/tmp/p1-task5.js`: tap a scan prompt → assert the add-moment sheet opens with the week input pre-set; tap a milestone prompt → assert `openMilestone` sheet shows the right title. PASS.

**Step 3 — Commit.**

---

### Task 6: Relationship capture sheet + save + render captured

**Files:** Modify `app/index.html` — add after Task 5; mirror `attachMsPhoto` (6004) + `downscaleToData` (used in `loadMomentPhoto` 3790) + `openSheet`.

**Step 1 — Capture sheet** (photo + optional caption):
```js
let relDraft=null;
function openRelCapture(relation, label, pendingId){
  relDraft={relation, label, pendingId:pendingId||null, photoData:null};
  renderRelCapture();
}
function renderRelCapture(){
  const d=relDraft;
  openSheet(`<h2>A photo with ${escapeHtml(d.label)}</h2><div class="sub">A moment together, for the journey</div>
    <input type="file" id="relPhoto" accept="image/*" style="display:none" onchange="loadRelPhoto(this)">
    ${d.photoData?`<div class="food-preview"><img src="${d.photoData}"><button class="rm" onclick="relDraft.photoData=null;renderRelCapture()">×</button></div>`:`<button class="btn-ghost" style="margin:0" onclick="document.getElementById('relPhoto').click()">${I.camera} Choose a photo</button>`}
    <button class="btn-primary" style="background:var(--star)" onclick="saveRelMoment()">Save</button>`,'star');
}
function loadRelPhoto(input){ const f=input.files[0]; if(!f)return; downscaleToData(f,1200,0.8,(data)=>{ relDraft.photoData=data; renderRelCapture(); }); }
async function saveRelMoment(){
  const b=activeBaby(); if(!b||!relDraft) return;
  const d=relDraft; let photoId=null;
  if(d.photoData){ photoId=uid(); await PhotoStore.set(photoId,d.photoData); }
  const arr=journeyRel(b.id);
  if(d.pendingId){ const e=arr.find(r=>r.id===d.pendingId); if(e){ e.photoId=photoId; e.at=now(); } }
  else { arr.push({id:uid(), relation:d.relation, label:d.label, photoId, at:now()}); }
  relDraft=null; persist(); closeSheet(); render();
}
```

**Step 2 — "Add someone" control + render captured relationship photos.** In `renderMilestones()` (or the journey section), add a small "Add someone" affordance that pushes a pending rel entry (a relationship not in the circle), and render completed rel captures as small photo cards beneath the rail. Keep it light; reuse `.moment-card` styling. Captured entries (`photoId` set) drop out of the prompt list (handled in Task 3's `have` check) and appear as kept photos.

**Step 3 — Verify.** `/tmp/p1-task6.js` on `?e2e=1`: call `openRelCapture('aunt','Auntie Bear')`, set a data-URL photo into `relDraft.photoData`, `saveRelMoment()`; assert `journeyRel(activeBaby().id)` has an entry with a `photoId`, that `PhotoStore.map[photoId]` exists, that `appBlobFromState().journey.rel[...]` includes it, and that the corresponding prompt is gone from `journeyPromptsBaby()`. PASS. Screenshot the captured card.

**Step 4 — Commit.**

---

### Task 7: Editable auto-title

**Files:** Modify `app/index.html`.

**Step 1 — Default + edit accessors:**
```js
function babyJourneyTitle(){ const b=activeBaby(); const j=journeyState(); const t=j.titles&&j.titles[b.id]; return t||((b.name||'Baby')+'’s journey'); }
function setBabyJourneyTitle(v){ const b=activeBaby(); const j=journeyState(); if(!j.titles)j.titles={}; j.titles[b.id]=(v||'').slice(0,40); persist(); render(); }
function pregJourneyTitle(){ const p=state.pregnancy; return (p&&p.journey&&p.journey.title)||'My pregnancy journey'; }
function setPregJourneyTitle(v){ if(!state.pregnancy) return; if(!state.pregnancy.journey)state.pregnancy.journey={}; state.pregnancy.journey.title=(v||'').slice(0,40); persist(); render(); }
```

**Step 2 — Inline edit.** Make the `.jr-head` title tappable to open a tiny rename sheet (reuse `openSheet` with one text input). Pass an `onEdit` into `renderJourneySection` (or branch by scope). Keep it optional and unobtrusive — a small pencil affordance, not a demand.

**Step 3 — Verify.** Probe: `setBabyJourneyTitle('Test')` → `babyJourneyTitle()==='Test'` and it survives `applyAppBlob(appBlobFromState())`. PASS.

**Step 4 — Commit.**

---

### Task 8: Loss-safety pass (BLOCKING — not optional)

**Files:** `app/index.html`. Verify, don't assume.

**Checks:**
1. `renderJourneySection` already returns `''` when `state.lossHolding` (Task 4 Step 1) — confirm with a probe that sets `state.lossHolding={at:now()}` and re-renders: assert **no `.jr-rail`** appears anywhere.
2. A `pregnancyArchive` entry with `loss:true` must never produce a prompt and never resurface as "continue your journey." `journeyPromptsPreg()` reads only the *live* `state.pregnancy` (loss clears it), so this holds — add a probe with a `loss:true` archive present and assert `journeyPromptsPreg()` returns `[]` when there is no live pregnancy.
3. No completion %, no streak, no "X of Y", no "you're behind" strings anywhere in the journey UI. Grep the diff for `%`, `streak`, ` of `, `behind`, `complete` in the new code; remove any that imply progress pressure.
4. Prompts never assume an outcome ("when they arrive" framing only, and only where already used).

**Step — Verify** with `/tmp/p1-task8.js` covering checks 1–2; manual grep for check 3. All PASS. (memory: loss flow is charter-critical, don't regress.)

---

### Task 9: Ship (SW bump + full verify loop)

**Step 1 — Full local verify.** With `node tools/serve.js` running:
- `node tools/smoke.js http://localhost:8080/app/` → PASS (globals intact, no JS throw).
- `node tools/uitest.js` (authed harness) → PASS, no dead taps.
- Re-run `/tmp/p1-task{1,3,4,6,8}.js` → all PASS.
- Screenshots at 390px (pregnancy Moments + baby Album→Milestones, empty and populated) via `tools/shot.js`; Read PNGs; confirm warm, never-blank, on-brand.

**Step 2 — Adversarial review.** Run a Workflow review pass (3 dimensions: charter/loss-safety, privacy/persistence-split correctness, code-quality/dead-taps) over the diff; verify each finding; fix real ones.

**Step 3 — Bump SW dynamically (HEAD+1):**
```bash
head=$(git show HEAD:app/sw.js | grep -o "little-log-v[0-9]*" | head -1 | grep -o "[0-9]*"); next=$((head+1)); \
sed -i '' "s/little-log-v[0-9]*/little-log-v$next/" app/sw.js; echo "bumped to v$next"
```

**Step 4 — Commit only this plan's files.**
```bash
git add app/index.html app/store-firebase.js app/sw.js docs/plans/2026-06-24-moments-journey-p1.md
git commit -m "Moments->Journey P1: guided journey (timeline+milestone+relationship prompts, never-blank, bear placeholders); loss-safe; resolves PV1

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

**Step 5 — Confirm live.** Poll `https://little-cubby.com/app/` (not `/app/index.html`) until the new SW version serves; load `?e2e=1` is localhost-only so verify prod by hand-checking the Moments/Album surfaces render the journey rail. Tell the user it's live with the version number.

---

## Out of scope for P1 (do NOT build here)
- The slideshow / digital book export (P3). Watermark/Pro download+share gating (P3). Physical "register interest" form (P3).
- Month collage composer pages (P2).
- Pregnancy relationship-photo captures (deferred; pregnancy P1 is derived prompts only, to keep zero new pregnancy data in the shared blob).
- Commissioned relationship illustrations (P4) — P1 uses `cubbyBear()` placeholders.
