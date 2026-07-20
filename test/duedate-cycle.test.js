/* Due date must follow the cycle length she already told us.
 *
 * Naegele's rule (LMP + 280 days) assumes a 28-day cycle ovulating on day 14. `savePlanning()`
 * collects `cycleLen` in the trying stage, but `confirmPositiveTest()` threw it away and dated
 * every pregnancy at a flat +280 days. For a 35-day cycle that is a WEEK early, on the number
 * the whole product hangs off: the week counter, the size-of card, the generated antenatal
 * schedule, and the report she hands a midwife.
 *
 * The deliberate non-goals asserted here:
 *   - an unknown or 28-day cycle must leave the classic calculation byte-identical, so nobody
 *     already using Cubby sees their due date move
 *   - the weeks-along door must NOT be adjusted (weeks are already the ground truth there,
 *     usually from a dating scan, so shifting them would double-count)
 *
 * Run: node tools/serve.js &   then   node test/duedate-cycle.test.js
 */
const puppeteer=require('puppeteer-core');
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x!==undefined?('  '+x):''));} };
const DAY=86400000;
(async()=>{
 const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']});
 const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://localhost:8080/app/?e2e=1',{waitUntil:'networkidle2',timeout:60000});
 await new Promise(r=>setTimeout(r,2800));

 console.log('The arithmetic:');
 const a=await p.evaluate(()=>{
   const DAY=86400000, L=Date.UTC(2026,0,1);
   const d=(c)=>(window.dueFromLmp(L,c)-L)/DAY;
   return { unknown:d(undefined), c28:d(28), c35:d(35), c21:d(21), c26:d(26),
            clampHigh:d(99), clampLow:d(3), junk:d('abc'),
            roundTrip:(window.lmpFromDue(window.dueFromLmp(L,35),35)===L),
            roundTrip28:(window.lmpFromDue(window.dueFromLmp(L,28),28)===L) };
 });
 ok('unknown cycle = classic 280 days (nobody existing moves)', a.unknown===280, a.unknown);
 ok('28-day cycle = classic 280 days', a.c28===280, a.c28);
 ok('non-numeric cycle falls back to 280', a.junk===280, a.junk);
 ok('35-day cycle = 287 days (a week later)', a.c35===287, a.c35);
 ok('21-day cycle = 273 days (a week earlier)', a.c21===273, a.c21);
 ok('26-day cycle = 278 days', a.c26===278, a.c26);
 ok('absurdly long cycle clamps at 40 -> 292', a.clampHigh===292, a.clampHigh);
 ok('absurdly short cycle clamps at 21 -> 273', a.clampLow===273, a.clampLow);
 ok('lmpFromDue is the exact inverse (35)', a.roundTrip);
 ok('lmpFromDue is the exact inverse (28)', a.roundTrip28);

 console.log('\nThe real path: trying -> positive test');
 const e=await p.evaluate(()=>{
   const DAY=86400000;
   window.persist=function(){}; window.startPregnancyAudit=function(cb){ cb&&cb(); };
   const lmpDate='2026-01-01', L=new Date(lmpDate+'T08:00').getTime();
   const run=(cycle)=>{
     state.pregnancy={ id:'p1', ownerUid:(window.myUid&&window.myUid())||'U1', stage:'planning',
       dueDate:null, lmp:L, cycleLen:cycle, country:'gb', precon:[], appts:[], moments:[] };
     window.openPositiveTest();
     const el=document.querySelector('#ptLmp'); if(el) el.value=lmpDate;
     const c=document.querySelector('#ptCountry'); if(c) c.value='gb';
     window.confirmPositiveTest();
     return { days:(state.pregnancy.dueDate-L)/DAY, stage:state.pregnancy.stage,
              appts:(state.pregnancy.appts||[]).length };
   };
   return { long:run(35), classic:run(28), short:run(24) };
 });
 ok('35-day cycle carries through to the pregnancy = 287 days', e.long.days===287, e.long.days);
 ok('28-day cycle unchanged at 280 days', e.classic.days===280, e.classic.days);
 ok('24-day cycle = 276 days', e.short.days===276, e.short.days);
 ok('still becomes an expecting pregnancy', e.long.stage==='expecting', e.long.stage);
 ok('still seeds the country antenatal schedule', e.long.appts>0, e.long.appts);

 console.log('\nThe weeks-along door must NOT be shifted:');
 const w=await p.evaluate(()=>{
   window.persist=function(){};
   // `pregDraft` is a top-level `let`, so it is a lexical binding and NOT a window property:
   // `window.pregDraft = x` silently creates a second, unread object. Assign it bare.
   pregDraft={mode:'weeks',weeks:20,days:0,country:'gb'};
   state.pregnancy={cycleLen:35};   // a stale cycle length must not leak into a scan-dated pregnancy
   const host=document.createElement('div');
   host.innerHTML='<input id="pgWeeks" value="20"><input id="pgDays" value="0"><input id="pgCountry" value="gb">';
   document.body.appendChild(host);
   window.savePregnancy();
   const p=state.pregnancy, DAY=86400000;
   return { fromLmp:Math.round((p.dueDate-p.lmp)/DAY) };
 });
 ok('weeks-along stays at a flat 280 (no double-count)', w.fromLmp===280, w.fromLmp);

 ok('no page errors', errs.length===0, errs[0]);
 console.log('\n'+pass+' passed, '+fail+' failed');
 await b.close(); process.exit(fail?1:0);
})();
