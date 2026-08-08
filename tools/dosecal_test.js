// Gate for the medicine calendar course and the multi-baby dose alert.
//
// Two things live here that no other harness can see:
//
// 1. THE .ICS ITSELF. Dose times written into the parent's own calendar are the only reminder
//    mechanism Cubby has that reaches someone with the app closed today: no APNs key, no push cron,
//    no server, no App Store review. Which means the FILE is the product, and a malformed or
//    unbounded one is a wrong alarm in someone's calendar that we cannot recall. So this asserts the
//    bounded RRULE, the stable UIDs, the monotonic SEQUENCE, the real METHOD:CANCEL, and that no
//    entry ever starts in the past. It also asserts the REFUSAL: an "every few hours" schedule moves
//    every time a dose is logged, so it must never be offered a calendar entry.
//
// 2. THE TWIN BUG. babyMeds() filters by state.activeBabyId, so the other twin's overdue antibiotic
//    used to produce no pill, no toast and no haptic until you happened to switch babies. Worse, the
//    fix is only safe if every action ON that pill also resolves across babies: the Log button had to
//    stop looking the medicine up through babyMeds(), and the dose had to stop being stamped with
//    whoever was on screen. A pill whose buttons do nothing, or that files a dose against the wrong
//    child, is worse than the missing pill was.
//
// Uses the localhost-only ?e2e=1 boot hook, like uitest / perf_check / guide_test.
//
//   node tools/serve.js &   &&   node tools/dosecal_test.js [baseUrl]
const puppeteer=require('puppeteer-core');
const DAY=86400000;
const SEED={babies:[
   {id:'b1',name:'Aria',birth:Date.now()-200*DAY,sex:'F',routines:[]},
   {id:'b2',name:'Zara',birth:Date.now()-200*DAY,sex:'F',routines:[]}],
 activeBabyId:'b1',events:[],
 settings:{unit:'ml',wUnit:'kg',hUnit:'cm',tempUnit:'C',theme:'light',seen:{}},
 timers:{},milestones:[],meds:[],photos:[],vaccines:{},illnesses:[],pregnancy:null,notes:[]};
let fails=0,passes=0;
const ck=(ok,what,d)=>{ ok?(passes++,console.log('  ok   '+what)):(fails++,console.log('  FAIL '+what+(d?'  '+d:''))); };
(async()=>{
 const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--disable-gpu']});
 const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.setViewport({width:390,height:850,deviceScaleFactor:1});
 await p.goto((process.argv[2]||'http://localhost:8080')+'/app/?e2e=1',{waitUntil:'networkidle2'});
 await p.evaluate(s=>{localStorage.setItem('little-log-v1',JSON.stringify(s));localStorage.setItem('cubby-quick-uid','local');localStorage.setItem('cubby-theme:local','light');localStorage.removeItem('cubby-seen-local');},SEED);
 await p.reload({waitUntil:'networkidle2'});
 await new Promise(r=>setTimeout(r,1700));

 console.log('\n1. the medicine calendar course');
 const cal=await p.evaluate(()=>{
   window.__ics=[]; window.saveFile=function(href,fn,msg){ window.__lastName=fn; window.__lastMsg=msg; };
   // capture the blob text by stubbing createObjectURL
   const realCOU=URL.createObjectURL;
   URL.createObjectURL=function(blob){ window.__pending=blob; return 'blob:stub'; };
   state.meds=[{id:'m1',babyId:'b1',name:'Amoxicillin',dose:'5',unit:'ml',
     pattern:{type:'daily',times:['08:00','20:00']},remind:true,active:true,createdAt:Date.now()}];
   exportDoseCourse('m1',7);
   const blob=window.__pending;
   URL.createObjectURL=realCOU;
   return blob.text().then(t=>({ics:t, name:window.__lastName, seq:(medById('m1').ics||{}).seq, days:(medById('m1').ics||{}).days}));
 });
 const I=cal.ics;
 ck(/BEGIN:VCALENDAR/.test(I)&&/END:VCALENDAR/.test(I),'a well-formed VCALENDAR');
 ck((I.match(/BEGIN:VEVENT/g)||[]).length===2,'one event per dose time, not one with a multi-time rule','events: '+(I.match(/BEGIN:VEVENT/g)||[]).length);
 ck(/UID:cubby-med-m1-0@little-cubby\.com/.test(I)&&/UID:cubby-med-m1-1@little-cubby\.com/.test(I),'stable per-medicine per-slot UIDs');
 ck(/RRULE:FREQ=DAILY;COUNT=7/.test(I),'the repeat is BOUNDED by COUNT, so it ends by itself');
 ck((I.match(/BEGIN:VALARM/g)||[]).length===2&&/TRIGGER:PT0S/.test(I),'an alarm on each entry, at the dose time');
 ck(/DTSTART:\d{8}T\d{6}$/m.test(I)&&!/DTSTART[^\n]*Z/.test(I),'floating local time: no Z, no TZID, so it survives travel');
 ck(/SUMMARY:Amoxicillin 5ml/.test(I),'the summary names the medicine and dose');
 ck(cal.seq===1&&cal.days===7,'the course is recorded on the medicine','seq='+cal.seq+' days='+cal.days);
 // first occurrence must not be in the past
 const starts=[...I.matchAll(/DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/g)].map(m=>new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]).getTime());
 ck(starts.length===2 && starts.every(t=>t>Date.now()-60000),'no entry starts in the past');

 console.log('\n2. re-export updates rather than duplicates, and cancel really cancels');
 const again=await p.evaluate(()=>{
   const realCOU=URL.createObjectURL; URL.createObjectURL=function(bl){ window.__pending=bl; return 'blob:stub'; };
   exportDoseCourse('m1',7); const a=window.__pending;
   cancelDoseCourse('m1'); const c=window.__pending;
   URL.createObjectURL=realCOU;
   return Promise.all([a.text(),c.text()]).then(([x,y])=>({re:x,cancel:y,gone:!medById('m1').ics}));
 });
 ck(/SEQUENCE:2/.test(again.re),'a second export bumps SEQUENCE, so calendars update the same entries');
 ck(/METHOD:CANCEL/.test(again.cancel)&&/STATUS:CANCELLED/.test(again.cancel),'cancel publishes METHOD:CANCEL and STATUS:CANCELLED');
 ck(/SEQUENCE:3/.test(again.cancel),'the cancel outranks the export it is cancelling');
 ck(again.gone,'and the medicine no longer claims to be in a calendar');

 console.log('\n3. every few hours is refused, honestly');
 const ex=await p.evaluate(()=>{
   state.meds=[{id:'m2',babyId:'b1',name:'Calpol',dose:'2.5',unit:'ml',pattern:{type:'everyX',hours:6},remind:true,active:true,createdAt:Date.now()}];
   let said=''; const rt=window.toast; window.toast=m=>{said=m;};
   openDoseCalendar('m2'); window.toast=rt;
   openMedSheet('m2'); const html=document.getElementById('sheet').innerHTML;
   closeSheet();
   return {said, offersButton:/openDoseCalendar/.test(html), explains:/go stale/.test(html)};
 });
 ck(!ex.offersButton,'no calendar button on an every-few-hours medicine');
 ck(ex.explains,'and the sheet says why, instead of staying silent');
 ck(/Set times/.test(ex.said),'calling it directly is refused too','toast: '+ex.said);

 console.log('\n4. the twin alert bug');
 const tw=await p.evaluate(()=>{
   const eightHoursAgo=Date.now()-8*3600000;
   state.activeBabyId='b1';
   state.events=[];
   state.meds=[{id:'t1',babyId:'b2',name:'Amoxicillin',dose:'5',unit:'ml',
     pattern:{type:'everyX',hours:6},remind:true,active:true,createdAt:eightHoursAgo}];
   // a dose for Zara logged 8h ago -> next due 2h ago -> overdue
   state.events.push({id:'e1',babyId:'b2',type:'medicine',medId:'t1',medName:'Amoxicillin',dose:'5',unit:'ml',time:eightHoursAgo});
   go('home');
   const sc=document.getElementById('scroll').textContent;
   const before=(state.events||[]).filter(e=>e.type==='medicine').length;
   // the Log button on that pill must work AND land on Zara
   logDose('t1');
   const doses=(state.events||[]).filter(e=>e.type==='medicine');
   return {
     pill:/Amoxicillin/.test(sc),
     namesTheChild:/Zara/.test(sc),
     lastDoseFound: !!lastDose('t1'),
     logged: doses.length===before+1,
     landedOnZara: doses.length>before && doses.sort((a,b)=>b.time-a.time)[0].babyId==='b2'
   };
 });
 ck(tw.pill,'the other twin\'s overdue medicine now raises a pill while you are on Aria');
 ck(tw.namesTheChild,'and the pill says WHICH child it is for');
 ck(tw.lastDoseFound,'lastDose finds the sibling\'s dose (an everyX schedule used to never become due)');
 ck(tw.logged,'the Log button on that pill actually logs');
 ck(tw.landedOnZara,'and the dose lands on Zara, not on whoever was on screen');

 console.log('\n5. clean console');
 ck(errs.length===0,'no uncaught page errors',errs.join(' | '));
 console.log('\n'+(fails?'FAIL':'PASS')+' — '+passes+' passed, '+fails+' failed');
 await b.close(); process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
