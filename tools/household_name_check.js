/* The family has a name, it falls back sensibly, and the fallback is never treated as chosen. */
const p=require('/Users/m1promax/Downloads/little-log-pwa/tools/node_modules/puppeteer-core');
const C='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const s=ms=>new Promise(r=>setTimeout(r,ms));
const B='http://localhost:8123', DAY=86400000;
const d=new Date(); d.setHours(13,0,0,0); const CLOCK=d.getTime(), OFF=CLOCK-Date.now();
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+'  '+JSON.stringify(x).slice(0,160)))};
(async()=>{
 const b=await p.launch({executablePath:C,headless:'new',args:['--no-sandbox']});
 const boot=async(st)=>{
  const pg=await b.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
  await pg.evaluateOnNewDocument(sh=>{const R=Date;function D(...a){return a.length===0?new R(R.now()+sh):new R(...a)}D.prototype=R.prototype;D.now=()=>R.now()+sh;D.parse=R.parse;D.UTC=R.UTC;window.Date=D;},OFF);
  await pg.setViewport({width:390,height:1000});
  await pg.goto(B+'/app/?e2e=1',{waitUntil:'networkidle2'});
  await pg.evaluate(s2=>{localStorage.setItem('little-log-v1',JSON.stringify(s2));localStorage.setItem('cubby-quick-uid','local');
    Object.keys(localStorage).forEach(k=>{if(k.indexOf('cubby-theme')===0)localStorage.removeItem(k)});},st);
  await pg.reload({waitUntil:'networkidle2'}); await s(1800); return {pg,errs};
 };
 const base=(over)=>Object.assign({babies:[{id:'b1',name:'Robin',birth:CLOCK-90*DAY,routines:[]}],activeBabyId:'b1',
   events:[],settings:{seen:{home:1}},timers:{},milestones:[],meds:[],photos:[],vaccines:{},illnesses:[],pregnancy:null,notes:[]},over||{});

 console.log('\n1. an unnamed family still reads naturally');
 {
  const {pg,errs}=await boot(base());
  const r=await pg.evaluate(()=>({name:householdName(), named:householdNamed()}));
  ok('falls back to the baby', r.name==="Robin's family", r);
  ok('but is NOT treated as chosen', r.named===false, r);
  ok('no page errors', errs.length===0, errs);
  await pg.close();
 }
 console.log('\n2. naming it sticks, and counts as chosen');
 {
  const {pg}=await boot(base());
  const r=await pg.evaluate(()=>{ setHouseholdName('The Patro family');
    return {name:householdName(), named:householdNamed(), stored:state.settings.householdName}; });
  ok('the name is used', r.name==='The Patro family', r);
  ok('it counts as chosen', r.named===true, r);
  ok('and it rides the SHARED settings blob', r.stored==='The Patro family', r);
  await pg.close();
 }
 console.log('\n3. loss-safe: no baby to name');
 {
  const {pg}=await boot(base({babies:[],activeBabyId:null,lossHolding:{local:{at:CLOCK}}}));
  const r=await pg.evaluate(()=>({name:householdName()}));
  ok('never names a baby who is not there', !/Robin/.test(r.name), r);
  await pg.close();
 }
 console.log('\n4. clearing it returns to the fallback');
 {
  const {pg}=await boot(base({settings:{seen:{home:1},householdName:'Temp'}}));
  const r=await pg.evaluate(()=>{ setHouseholdName('  ');
    return {name:householdName(), named:householdNamed(), key:('householdName' in state.settings)}; });
  ok('back to the computed name', r.name==="Robin's family", r);
  ok('and the key is removed, not blanked', r.key===false, r);
  await pg.close();
 }
 await b.close();
 console.log('\n'+pass+' passed, '+fail+' failed');
 process.exit(fail?1:0);
})();
