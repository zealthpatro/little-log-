/* A stuck parent must always have somewhere to go.
   appSignIn (the iOS wrapper and the installed PWA) and inviteSignIn (arriving from an invite)
   both used to end at "Free · Private to your family" with no outbound link at all. */
const p=require(__dirname+'/node_modules/puppeteer-core');
const C='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const s=ms=>new Promise(r=>setTimeout(r,ms));
const B=process.argv[2]||'http://localhost:8123';
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(x!==undefined?'  '+JSON.stringify(x).slice(0,200):'')))};
const SHELLS=[
 ['plain browser, from an invite','?join=Ab3xQ7mZ9pLk2RtVwY5nQz',null],
 ['iOS wrapper, from an invite','?join=Ab3xQ7mZ9pLk2RtVwY5nQz','native'],
 ['iOS wrapper, cold sign-in','','native'],
 ['installed PWA, cold sign-in','','standalone'],
];
(async()=>{
 const b=await p.launch({executablePath:C,headless:'new',args:['--no-sandbox']});
 for(const [label,q,shell] of SHELLS){
  const pg=await b.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
  if(shell==='native') await pg.evaluateOnNewDocument(()=>{window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'ios'};});
  if(shell==='standalone') await pg.evaluateOnNewDocument(()=>{const m=window.matchMedia.bind(window);
    window.matchMedia=q=>/standalone/.test(q)?{matches:true,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}:m(q);});
  await pg.setViewport({width:390,height:900});
  await pg.goto(B+'/app/'+q,{waitUntil:'networkidle2'});
  await pg.evaluate(()=>{try{sessionStorage.clear();localStorage.clear()}catch(e){}});
  await pg.goto(B+'/app/'+q,{waitUntil:'networkidle2'});
  await s(2600);
  const r=await pg.evaluate(()=>{
    const t=document.body.innerText||'';
    const help=document.querySelector('.lp-help');
    return {hasAddr:/support@little-cubby\.com/.test(t), helpText:help?help.innerText.replace(/\s+/g,' ').trim():'',
      faqLink:!!document.querySelector('.lp-help a[href="/faq/"]'),
      copyBtn:!!document.querySelector('.lp-help button')};
  });
  console.log('\n'+label);
  console.log('   '+(r.helpText||'(NO SUPPORT ROW)'));
  ok('a support address is on screen', r.hasAddr, r);
  ok('and it is copyable, not a bare mailto', r.copyBtn, r);
  if(shell) ok('no FAQ link where there is no way back', !r.faqLink, r);
  else ok('FAQ offered in a real browser', r.faqLink, r);
  ok('no page errors', errs.length===0, errs);
  await pg.close();
 }
 // The copy action itself.
 const pg=await b.newPage();
 const ctx=b.defaultBrowserContext(); await ctx.overridePermissions(B,['clipboard-read','clipboard-write']);
 await pg.goto(B+'/app/?join=Ab3xQ7mZ9pLk2RtVwY5nQz',{waitUntil:'networkidle2'}); await s(2400);
 await pg.click('.lp-help button'); await s(400);
 const after=await pg.evaluate(()=>({label:document.querySelector('.lp-help button').textContent,
   clip:(navigator.clipboard&&navigator.clipboard.readText)?null:'n/a'}));
 console.log('\ntapping the address');
 ok('it confirms it copied', /Copied/.test(after.label), after);
 await b.close();
 console.log('\n'+pass+' passed, '+fail+' failed');
 console.log(fail?'SUPPORT-REACH: FAIL':'SUPPORT-REACH: PASS');
 process.exit(fail?1:0);
})();
