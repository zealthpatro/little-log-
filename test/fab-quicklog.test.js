/* Quick-log FAB — the four behaviours the founder asked for, asserted rather than assumed.
 *
 *   1. present on EVERY view, in both shells (it was gated to view==='home' on the baby shell and
 *      absent entirely from the pregnancy shell)
 *   2. dismissible for the session, and NOT persisted
 *   3. the actions it offers are customisable, from Settings
 *   4. on/off is PER USER, never in the shared household blob
 *
 * Run: node tools/serve.js &   then   node test/fab-quicklog.test.js
 *
 * Two traps this file exists to stop repeating: quickPrefs() stores `pick` keyed BY STAGE and
 * quickChosen() returns KEYS not action objects; and the home tiles behind the sheet keep the
 * stage's full default set, so any assertion about what the sheet shows must be scoped to the
 * sheet, never to document.body.
 */
const puppeteer=require('puppeteer-core');
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x?('  '+x):''));} };
(async()=>{
 const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']});
 const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 // Base URL first, because a bare 8080 in a shared checkout is another tree's dev server and this
 // passes cheerfully against code that is not the code under test.
 await p.goto((process.argv[2]||'http://localhost:8080')+'/app/?e2e=1',{waitUntil:'networkidle2',timeout:60000});
 await new Promise(r=>setTimeout(r,2800));

 console.log('REQ 1 — present on all pages, not just baby home:');
 const r1=await p.evaluate(()=>{
   window.LL=window.LL||{}; window.LL.auth={currentUser:{uid:'U1'}}; window.LL.role='owner';
   localStorage.removeItem('cubby-quick-U1'); sessionStorage.removeItem('cubby-quick-hidden');
   state.pregnancy=null; viewingPreg=false;
   state.babies=[{id:'b1',name:'Ava',birth:Date.now()-86400000*60,country:'gb'}]; state.activeBabyId='b1';
   const out={baby:{}};
   ['home','log','album','health'].forEach(v=>{ view=v; window.render(); out.baby[v]=!!document.querySelector('.qadd'); });
   // pregnancy shell too
   state.babies=[]; state.pregnancy={stage:'expecting',due:Date.now()+86400000*60,ownerUid:'U1'};
   out.preg={};
   ['week','moments','care'].forEach(v=>{ pregView=v; window.render(); out.preg[v]=!!document.querySelector('.qadd'); });
   return out;
 });
 Object.entries(r1.baby).forEach(([v,has])=>ok('baby shell · '+v, has));
 Object.entries(r1.preg).forEach(([v,has])=>ok('pregnancy shell · '+v, has));

 console.log('\nREQ 2 — dismissible per session:');
 const r2=await p.evaluate(()=>{
   state.pregnancy=null; state.babies=[{id:'b1',name:'Ava',birth:Date.now()-86400000*60,country:'gb'}]; state.activeBabyId='b1';
   view='home'; window.render();
   const before=!!document.querySelector('.qadd');
   /* Call the REAL dismiss. This used to try a window.hideQuickFab that has never existed and then
      fall back to writing 'cubby-quick-hidden', the key from before the hide went per-uid, so the
      app never saw the flag and this assertion had been failing silently for as long as the gate
      went unrun. quickHiddenKey() is the source of truth: 'cubby-quick-hidden-'+quickUid(). */
   hideQuickFabForSession();
   window.render();
   const after=!!document.querySelector('.qadd');
   const flag=sessionStorage.getItem(quickHiddenKey());
   const persisted=localStorage.getItem('cubby-quick-'+quickUid())||'';
   return {before, after, flag, sessionScoped: flag==='1' && !/hidden/.test(persisted)};
 });
 ok('visible before dismissing', r2.before);
 ok('gone after dismissing', r2.after===false);
 ok('dismissal is SESSION scoped, not persisted', r2.sessionScoped, 'flag='+r2.flag);

 console.log('\nREQ 3 — customise what shows when tapped:');
 const r3=await p.evaluate(()=>{
   sessionStorage.removeItem('cubby-quick-hidden');
   const all=QUICK_ACTIONS.filter(a=>a.s.includes('baby')).map(a=>a.k);
   // choose a deliberately small custom set
   // Real schema: { on, pick: { <stage>: [keys] } }, and quickChosen() returns KEYS.
   const stage=quickStage();
   saveQuickPrefs({on:true, pick:{[stage]:['feed','sleep']}});
   window.render(); window.openQuickLog();
   // Scope to the SHEET. The home tiles behind it deliberately keep the stage's full default set
   // (quickLogActions), so reading document.body would count actions that are not in the sheet.
   const sheet=document.querySelector('.sheet.open')||document.querySelector('#sheet')||document.body;
   const shown=sheet.innerText;
   const chosen=quickChosen();
   return {all, stage, chosen, hasFeed:/Feed/i.test(shown), hasDiaper:/Nappy|Diaper/i.test(shown)};
 });
 ok('registry has more actions than chosen', r3.all.length>2, JSON.stringify(r3.all));
 ok('only the chosen two are active', JSON.stringify(r3.chosen)===JSON.stringify(['feed','sleep']), 'stage='+r3.stage+' chosen='+JSON.stringify(r3.chosen));
 ok('sheet shows a chosen action', r3.hasFeed);
 ok('sheet omits an unchosen action', r3.hasDiaper===false);

 console.log('\nREQ 4 — per-user on/off toggle, in the settings flow:');
 const r4=await p.evaluate(()=>{
   const out={};
   out.inSettings = (function(){ try{ window.openSettings(); return /Quick log|quick log/i.test(document.body.innerText); }catch(e){ return 'err:'+e.message; } })();
   try{ closeSheet(); }catch(e){}
   // turn OFF for this user
   const prefs=quickPrefs(); prefs.on=false; saveQuickPrefs(prefs);
   view='home'; window.render(); out.offHidesFab=!document.querySelector('.qadd');
   // a DIFFERENT user must be unaffected (per-user, not shared)
   window.LL.auth={currentUser:{uid:'U2'}}; localStorage.removeItem('cubby-quick-U2');
   window.render(); out.otherUserUnaffected=!!document.querySelector('.qadd');
   out.storedUnderUid = !!localStorage.getItem('cubby-quick-U1');
   out.notInSharedBlob = !(state.settings && 'quick' in state.settings);
   return out;
 });
 ok('quick-log row present in Settings', r4.inSettings===true, String(r4.inSettings));
 ok('toggling off hides the FAB', r4.offHidesFab);
 ok('another caregiver is UNAFFECTED (per-user)', r4.otherUserUnaffected);
 ok('prefs stored under the uid', r4.storedUnderUid);
 ok('NOT in the shared household blob', r4.notInSharedBlob);

 console.log('\nPage errors: '+(errs.length?errs.join(' | '):'none'));
 ok('no page errors', errs.length===0);
 console.log('\n'+pass+' passed, '+fail+' failed');
 await b.close(); process.exit(fail?1:0);
})();
