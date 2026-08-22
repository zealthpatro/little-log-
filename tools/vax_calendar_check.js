/* Vaccine dates must reach the parent's own calendar, one entry per VISIT, honestly labelled. */
const p=require('/Users/m1promax/Downloads/little-log-pwa/tools/node_modules/puppeteer-core');
const C='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const s=ms=>new Promise(r=>setTimeout(r,ms));
// Base URL first: a hardcoded port grades whatever server happens to be listening, which in a
// shared checkout is another tree. tools/gates.js always passes one.
const B=process.argv[2]||'http://localhost:8123'; const DAY=86400000;
const d=new Date(); d.setHours(13,0,0,0); const CLOCK=d.getTime(), OFF=CLOCK-Date.now();
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(x!==undefined?'  '+JSON.stringify(x).slice(0,300):'')))};
(async()=>{
 const b=await p.launch({executablePath:C,headless:'new',args:['--no-sandbox']});
 const pg=await b.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
 await pg.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
 await pg.evaluateOnNewDocument(sh=>{const R=Date;function D(...a){return a.length===0?new R(R.now()+sh):new R(...a)}D.prototype=R.prototype;D.now=()=>R.now()+sh;D.parse=R.parse;D.UTC=R.UTC;window.Date=D;},OFF);
 await pg.setViewport({width:390,height:1400});
 await pg.goto(B+'/app/?e2e=1',{waitUntil:'networkidle2'});
 await pg.evaluate((n)=>{localStorage.setItem('little-log-v1',JSON.stringify({
   babies:[{id:'b1',name:'Wren',birth:n-10*86400000,sex:'F',country:'GB',routines:[]}],activeBabyId:'b1',
   events:[],settings:{seen:{home:1,health:1}},timers:{},milestones:[],meds:[],photos:[],vaccines:{},illnesses:[],pregnancy:null,notes:[]}));
   localStorage.setItem('cubby-quick-uid','local');
   Object.keys(localStorage).forEach(k=>{if(k.indexOf('cubby-theme')===0)localStorage.removeItem(k)});},CLOCK);
 await pg.reload({waitUntil:'networkidle2'}); await s(2000);

 const r=await pg.evaluate(()=>{
   go('health'); if(typeof healthGo==='function'){try{healthGo('vaccines')}catch(e){}}
   const plan=vaccinePlan();
   const visits=vaxUpcomingVisits(plan);
   // Build the file without downloading it, by intercepting the blob.
   let ics=''; const realBlob=window.Blob;
   window.Blob=function(parts,opts){ ics=String(parts[0]); return new realBlob(parts,opts); };
   const realSave=window.saveFile; window.saveFile=function(){};
   exportVaccineSchedule();
   window.Blob=realBlob; window.saveFile=realSave;
   // This used to read document.body.innerHTML, which on this page CONTAINS the inline script's own
   // source, so the regex matched the TEMPLATE that renders the row rather than the row. Measured:
   // with ${vaxCalendarRow(bb,plan)} deleted from renderVaccines it still reported "ok". Read the
   // element the parent can actually tap.
   const calRow=[...document.querySelectorAll('.add-row')].filter(e=>/in my calendar/.test(e.textContent||''));
   return {doses:plan.filter(v=>!v.given).length, visits:visits.length,
     firstNames:visits[0]?visits[0].names:[], ics,
     rowCount:calRow.length, rowHtml:calRow.length?calRow[0].textContent.trim():''};
 });

 console.log('\nA 10-day-old on the UK schedule');
 ok('the plan has many individual doses', r.doses>6, r.doses);
 ok('but they collapse into far fewer VISITS', r.visits>0 && r.visits<r.doses, {doses:r.doses,visits:r.visits});
 ok('the first visit bundles the doses that share it', r.firstNames.length>=1, r.firstNames);
 ok('a control appears on the vaccines screen', r.rowCount===1 && /in my calendar/.test(r.rowHtml), r);

 console.log('\nthe calendar file itself');
 const ev=(r.ics.match(/BEGIN:VEVENT/g)||[]).length;
 ok('one VEVENT per visit, not per dose', ev===r.visits, {vevents:ev,visits:r.visits});
 ok('all-day entries, because the clinic sets the hour', /DTSTART;VALUE=DATE:\d{8}/.test(r.ics));
 ok('no fake time is asserted', !/DTSTART:\d{8}T/.test(r.ics));
 ok('it warns the date is worked out from the birthday', /treat it as a guide/.test(r.ics), r.ics.slice(0,400));
 ok('it names the country schedule', /United Kingdom|UK/.test(r.ics));
 ok('an alarm two days ahead', /TRIGGER:-P2D/.test(r.ics));
 ok('commas are escaped, not deleted', r.ics.indexOf('\\,')>=0, (r.ics.match(/SUMMARY:.*/)||[''])[0]);
 ok('valid calendar envelope', /^BEGIN:VCALENDAR/.test(r.ics)&&/END:VCALENDAR$/.test(r.ics.trim()));
 ok('no page errors', errs.length===0, errs);
 console.log('\n  first entry:\n'+r.ics.split('BEGIN:VEVENT')[1].split('END:VEVENT')[0].trim().split('\r\n').map(l=>'    '+l).join('\n'));
 await b.close();
 console.log('\n'+pass+' passed, '+fail+' failed');
 process.exit(fail?1:0);
})();
