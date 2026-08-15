/* The family drawn as itself: real bears, loss-safe, and it survives a solo parent. */
const p=require('/Users/m1promax/Downloads/little-log-pwa/tools/node_modules/puppeteer-core');
const C='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const s=ms=>new Promise(r=>setTimeout(r,ms));
const B='http://localhost:8123', DAY=86400000;
const d=new Date(); d.setHours(13,0,0,0); const CLOCK=d.getTime(), OFF=CLOCK-Date.now();
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+'  '+JSON.stringify(x).slice(0,170)))};
(async()=>{
 const b=await p.launch({executablePath:C,headless:'new',args:['--no-sandbox']});
 const look=async(members,info,st,label)=>{
  const ctx=await b.createBrowserContext(); const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push(e.message));
  await pg.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
  await pg.evaluateOnNewDocument(sh=>{const R=Date;function D(...a){return a.length===0?new R(R.now()+sh):new R(...a)}D.prototype=R.prototype;D.now=()=>R.now()+sh;D.parse=R.parse;D.UTC=R.UTC;window.Date=D;},OFF);
  await pg.setViewport({width:390,height:1100});
  await pg.goto(B+'/app/?e2e=1',{waitUntil:'networkidle2'});
  await pg.evaluate(s2=>{localStorage.setItem('little-log-v1',JSON.stringify(s2));localStorage.setItem('cubby-quick-uid','local');},st);
  await pg.reload({waitUntil:'networkidle2'}); await s(1900);
  const r=await pg.evaluate((mem,inf)=>{
    window.LL=window.LL||{}; window.LL.members=mem; window.LL.memberInfo=inf; window.LL.role='owner';
    window.LL.auth={currentUser:{uid:'u1',email:'a@b.c'}};
    const host=document.createElement('div'); host.id='fpHost';
    host.innerHTML=window.cubbyFamilyPortrait();
    document.body.appendChild(host);
    const fp=host.querySelector('.ll-fp');
    return {present:!!fp, avatars:fp?fp.querySelectorAll('.ll-fp-a').length:0,
      cubs:fp?fp.querySelectorAll('.ll-fp-cub').length:0,
      more:fp?(fp.querySelector('.ll-fp-more')||{}).textContent||'':'',
      name:(typeof householdName==='function'?householdName():'')};
  },members,info);
  console.log('\n'+label);
  console.log('   portrait:',r.present,' bears:',r.avatars,' cubs:',r.cubs,r.more?(' more:'+r.more):'', ' name:', JSON.stringify(r.name));
  await pg.close(); await ctx.close();
  return {...r,errs};
 };
 const base=(over)=>Object.assign({babies:[{id:'b1',name:'Robin',birth:CLOCK-90*DAY,routines:[]}],activeBabyId:'b1',
   events:[],settings:{seen:{home:1}},timers:{},milestones:[],meds:[],photos:[],vaccines:{},illnesses:[],pregnancy:null,notes:[]},over||{});

 let r=await look({u1:'owner'},{u1:{name:'Meera',role:'owner',relationship:'Mama Bear'}},base(),'1. solo parent, one baby');
 ok('a portrait is drawn', r.present, r);
 ok('one grown-up bear', r.avatars>=1, r);
 ok('and the cub', r.cubs===1, r);
 ok('no page errors', r.errs.length===0, r.errs);

 r=await look({u1:'owner',u2:'caregiver',u3:'caregiver'},
   {u1:{name:'Meera',role:'owner',relationship:'Mama Bear'},u2:{name:'Arjun',role:'caregiver',relationship:'Papa Bear'},u3:{name:'Sushila',role:'caregiver',relationship:'Nana Bear'}},
   base({babies:[{id:'b1',name:'Robin',birth:CLOCK-90*DAY,routines:[]},{id:'b2',name:'Wren',birth:CLOCK-90*DAY,routines:[]}]}),'2. three grown-ups, twins');
 ok('three bears', r.avatars>=3, r);
 ok('two cubs', r.cubs===2, r);

 r=await look({u1:'owner'},{u1:{name:'Meera',role:'owner',relationship:'Mama Bear'}},
   base({babies:[],activeBabyId:null,lossHolding:{local:{at:CLOCK}}}),'3. after a loss, no baby');
 ok('the portrait still draws the person', r.present&&r.avatars>=1, r);
 ok('and draws NO cub', r.cubs===0, r);
 ok('never names a baby who is gone', !/Robin/.test(r.name), r);

 await b.close();
 console.log('\n'+pass+' passed, '+fail+' failed');
 process.exit(fail?1:0);
})();
