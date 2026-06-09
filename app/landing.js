/* Cubby landing page, shown to signed-out visitors. Primary CTA = Continue with Google. */
(function () {
  window.cubbyLanding = function (msg) {
    var cta = '<button class="lp-cta ll-cta">Continue with Google</button>';
    var features = [
      ['⚡', 'One-thumb logging', 'Feeds, sleep, nappies, pumping, logged in seconds, even at 3am.'],
      ['👨‍👩‍👧', 'Your whole care circle', 'Parents, grandparents, the nanny, daycare or playschool, anyone who helps sees the same log, live.'],
      ['🐻', 'Who did what', 'Know exactly who logged each feed, nap and nappy: you, your partner, or the nanny.'],
      ['📈', 'Growth charts', 'WHO & CDC percentile curves behind your baby\'s weight and height.'],
      ['🩺', 'Health, handled', 'Medicine reminders, gentle fever guidance, and a one-tap summary for the doctor.'],
      ['📸', 'Keepsakes', 'Monthly memory cards, milestones and a birth poster from your real moments.'],
      ['🔒', 'Private by design', 'Your log is locked to your family. No ads, and we never sell your data.'],
      ['📋', 'See the day from anywhere', 'Checking in from work? Get a tidy recap of feeds, naps and meals, live.']
    ].map(function (f) {
      return '<div class="lp-feat"><div class="lp-fi">' + f[0] + '</div><div><div class="lp-ft">' + f[1] + '</div><div class="lp-fs">' + f[2] + '</div></div></div>';
    }).join('');
    var steps = [
      ['1', 'Sign in with Google', 'Ten seconds, no password, no app store.'],
      ['2', 'Add your baby', 'Name, birthday, and you\'re ready to log.'],
      ['3', 'Invite your partner', 'Start caring for your little one, together.']
    ].map(function (s) {
      return '<div class="lp-step"><div class="lp-sn">' + s[0] + '</div><div class="lp-st">' + s[1] + '</div><div class="lp-ss">' + s[2] + '</div></div>';
    }).join('');
    return '<div class="lp">'
      + '<header class="lp-hero">'
      + '<div class="lp-logo"><img src="/icons/logo-512.png" alt="Cubby"></div>'
      + '<h1 class="lp-name">Cubby</h1>'
      + '<p class="lp-tag">A warm, private baby log for everyone who cares for your little one: parents, grandparents, the nanny, daycare and more.</p>'
      + cta
      + (msg ? '<div class="lp-msg">' + msg + '</div>' : '')
      + '<div class="lp-trust">Free · Private to your family · Ready in seconds</div>'
      + '</header>'
      + '<section class="lp-why"><h2>Caring for a baby is a team sport.</h2>'
      + '<p>But the details (the last feed, the nap, the medicine) usually live in one parent\'s head, or on one phone. Cubby keeps everyone who cares for your baby, parents, grandparents, the nanny, daycare, on the same page, in real time.</p></section>'
      + '<section class="lp-feats">' + features + '</section>'
      + '<section class="lp-steps-wrap"><h2>How it works</h2><div class="lp-steps">' + steps + '</div></section>'
      + '<section class="lp-why lp-working"><h2>Made for working parents</h2>'
      + '<p>Leave your little one with a nanny, grandparent or daycare and still feel close. They log the feeds, naps and meals; you see it the moment it happens, and get a tidy recap of the whole day, from wherever you are.</p></section>'
      + '<section class="lp-pro"><h2>Free forever, with Pro for the extras</h2>'
      + '<div class="lp-cmp">'
      + '<div class="lp-col"><div class="lp-col-h">Free</div><ul>'
      + '<li>Unlimited logging: feeds, sleep, nappies, pumping</li>'
      + '<li>Share with family &amp; caregivers (nanny, daycare)</li>'
      + '<li>Growth charts (WHO &amp; CDC)</li>'
      + '<li>Health nudges &amp; doctor-visit summary</li>'
      + '<li>Photos, memory cards &amp; milestones</li>'
      + '<li>Private, and no ads</li>'
      + '</ul></div>'
      + '<div class="lp-col lp-col-pro"><div class="lp-col-h">Pro <span class="lp-soon">soon</span></div><ul>'
      + '<li>Smart adaptive routines (day 0 to 365)</li>'
      + '<li>Push reminders &amp; alerts</li>'
      + '<li>HD photos &amp; cloud backup</li>'
      + '<li>Nutrition tracker from meal photos &amp; logs</li>'
      + '<li>PDF doctor reports &amp; export</li>'
      + '<li>Sleep &amp; feed insights</li>'
      + '</ul></div>'
      + '</div>'
      + '<p class="lp-pro-note">Sign in, then join the Pro waitlist from Settings, Cubby Pro.</p></section>'
      + '<section class="lp-final"><h2>Everyone caring for your baby, in sync.</h2>' + cta + '<div class="lp-trust">Free · Private · made with 🐻</div>'
      + '<div class="lp-pwa">No download, no app store. Add Cubby to your home screen for an app-like, offline-ready experience in any browser.</div></section>'
      + '<footer class="lp-foot">Cubby · a warm, private baby tracker 🐻</footer>'
      + '</div>';
  };

  var st = document.createElement('style');
  st.textContent =
    '#llAuthOv.landing{display:block;align-items:initial;justify-content:initial;padding:0;overflow-y:auto;-webkit-overflow-scrolling:touch;background:linear-gradient(180deg,#FBF5E9,#F1E4CF);}'
    + '.lp{max-width:680px;margin:0 auto;padding:0 22px 56px;font-family:"Nunito Sans",system-ui,sans-serif;color:#2C2521;}'
    + '.lp-hero{text-align:center;padding:52px 0 28px;}'
    + '.lp-logo img{width:88px;height:88px;border-radius:22px;box-shadow:0 8px 22px rgba(0,0,0,.12);display:block;margin:0 auto;}'
    + '.lp-name{font-family:"Fraunces",Georgia,serif;font-size:40px;margin:14px 0 6px;color:#2C2521;}'
    + '.lp-tag{font-size:17px;line-height:1.5;color:#6E635B;max-width:440px;margin:0 auto 22px;font-weight:600;}'
    + '.lp-cta{display:block;width:100%;max-width:340px;margin:0 auto;border:none;background:#C97FA0;color:#fff;font-size:17px;font-weight:800;padding:16px 22px;border-radius:15px;cursor:pointer;font-family:inherit;box-shadow:0 8px 20px rgba(201,127,160,.35);}'
    + '.lp-cta:hover{filter:brightness(1.03);}'
    + '.lp-msg{margin-top:12px;color:#b05a7a;font-size:13px;font-weight:700;}'
    + '.lp-trust{margin-top:12px;font-size:12.5px;color:#9a8d80;font-weight:700;}'
    + '.lp-why{text-align:center;padding:24px 6px 6px;}'
    + '.lp-why h2,.lp-steps-wrap h2,.lp-final h2,.lp-pro h2{font-family:"Fraunces",Georgia,serif;font-size:25px;color:#2C2521;margin:0 0 10px;line-height:1.25;}'
    + '.lp-why p{color:#6E635B;font-size:15.5px;line-height:1.6;max-width:480px;margin:0 auto;font-weight:600;}'
    + '.lp-feats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:28px 0;}'
    + '.lp-feat{background:#fff;border-radius:16px;padding:16px;box-shadow:0 5px 14px rgba(0,0,0,.05);display:flex;gap:11px;align-items:flex-start;}'
    + '.lp-fi{font-size:22px;flex:0 0 auto;line-height:1.2;}'
    + '.lp-ft{font-weight:800;font-size:14.5px;margin-bottom:3px;}'
    + '.lp-fs{font-size:13px;color:#6E635B;line-height:1.45;font-weight:600;}'
    + '.lp-steps-wrap{text-align:center;margin:14px 0 8px;}'
    + '.lp-steps{display:flex;flex-direction:column;gap:14px;max-width:430px;margin:18px auto 0;text-align:left;}'
    + '.lp-step{background:#fff;border-radius:16px;padding:16px 18px 16px 64px;box-shadow:0 5px 14px rgba(0,0,0,.05);position:relative;}'
    + '.lp-sn{position:absolute;left:16px;top:15px;width:34px;height:34px;border-radius:50%;background:#C97FA0;color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;font-family:"Fraunces",Georgia,serif;}'
    + '.lp-st{font-weight:800;font-size:15px;}'
    + '.lp-ss{font-size:13px;color:#6E635B;font-weight:600;margin-top:2px;}'
    + '.lp-pro{text-align:center;background:#fff;border:1px solid #EADFcf;border-radius:18px;padding:24px 20px;margin:30px 0 6px;box-shadow:0 5px 14px rgba(0,0,0,.05);}'
    + '.lp-pro-badge{display:inline-block;background:#C97FA0;color:#fff;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:4px 11px;border-radius:999px;margin-bottom:8px;}'
    + '.lp-pro p{color:#6E635B;font-size:14.5px;line-height:1.55;max-width:460px;margin:0 auto;font-weight:600;}'
    + '.lp-pro-note{margin-top:14px !important;font-size:13px !important;color:#9a8d80 !important;}'
    + '.lp-cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0 4px;text-align:left;}'
    + '.lp-col{background:#FBF7EF;border:1px solid #EADFcf;border-radius:14px;padding:16px;}'
    + '.lp-col-pro{background:#fff;border-color:#C97FA0;}'
    + '.lp-col-h{font-family:"Fraunces",Georgia,serif;font-size:18px;font-weight:600;color:#2C2521;margin-bottom:10px;}'
    + '.lp-soon{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;background:#C97FA0;color:#fff;padding:2px 7px;border-radius:999px;vertical-align:middle;margin-left:4px;}'
    + '.lp-col ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;}'
    + '.lp-col li{font-size:12.5px;color:#6E635B;font-weight:600;line-height:1.4;padding-left:21px;position:relative;}'
    + '.lp-col li::before{content:"✓";position:absolute;left:0;color:#56A08E;font-weight:900;}'
    + '.lp-col-pro li::before{content:"✦";color:#C97FA0;}'
    + '@media(max-width:520px){.lp-cmp{grid-template-columns:1fr;}}'
    + '.lp-final{text-align:center;padding:34px 0 6px;}'
    + '.lp-pwa{max-width:380px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#a99e92;font-weight:600;}'
    + '.lp-foot{text-align:center;color:#9a8d80;font-size:12.5px;font-weight:700;padding:28px 0 0;}'
    + '@media(max-width:480px){.lp-feats{grid-template-columns:1fr;}.lp-name{font-size:34px;}}';
  document.head.appendChild(st);
})();
