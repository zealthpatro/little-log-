/* Cubby landing page, shown to signed-out visitors. Primary CTA = Continue with Google. */
(function () {
  window.cubbyLanding = function (msg) {
    var cta = '<button class="lp-cta ll-cta">Continue with Google</button>';
    var features = [
      ['⚡', 'One-thumb logging', 'Feeds, sleep, nappies, pumping, logged in seconds, even at 3am.'],
      ['👨‍👩‍👧', 'Share with family, live', 'Both parents, grandparents, the nanny, everyone sees the same log, instantly.'],
      ['🐻', 'Who did what', 'Every entry shows who logged it: Mama Bear, Papa Bear, each with their own cub.'],
      ['📈', 'Growth charts', 'WHO & CDC percentile curves behind your baby\'s weight and height.'],
      ['🩺', 'Health, handled', 'Medicine reminders, gentle fever guidance, and a one-tap summary for the doctor.'],
      ['📸', 'Keepsakes', 'Monthly memory cards, milestones and a birth poster from your real moments.'],
      ['🔒', 'Private by design', 'Your log is locked to your family. No ads, and we never sell your data.'],
      ['📲', 'Works like an app', 'Add to your home screen, full-screen, offline-ready, no app store.']
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
      + '<div class="lp-logo"><img src="icons/logo-512.png" alt="Cubby"></div>'
      + '<h1 class="lp-name">Cubby</h1>'
      + '<p class="lp-tag">The warm, private way for your whole family to care for your little one, together.</p>'
      + cta
      + (msg ? '<div class="lp-msg">' + msg + '</div>' : '')
      + '<div class="lp-trust">Free · Private to your family · No app store</div>'
      + '</header>'
      + '<section class="lp-why"><h2>Caring for a baby is a team sport.</h2>'
      + '<p>But the details (the last feed, the nap, the medicine) usually live in one parent\'s head, or on one phone. Cubby keeps everyone who cares for your baby on the same page, in real time.</p></section>'
      + '<section class="lp-feats">' + features + '</section>'
      + '<section class="lp-steps-wrap"><h2>How it works</h2><div class="lp-steps">' + steps + '</div></section>'
      + '<section class="lp-pro"><div class="lp-pro-badge">Coming soon</div><h2>Cubby Pro</h2>'
      + '<p>Cubby is free for the essentials, always. Pro will add smart, adaptive routines (feeds, naps, tummy time, day 0 to 365), push reminders, HD photos &amp; unlimited storage, PDF doctor reports, and sleep &amp; feed insights.</p>'
      + '<p class="lp-pro-note">Sign in, then join the waitlist from Settings, Cubby Pro.</p></section>'
      + '<section class="lp-final"><h2>Everyone caring for your baby, in sync.</h2>' + cta + '<div class="lp-trust">Free · Private · made with 🐻</div></section>'
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
    + '.lp-why h2,.lp-steps-wrap h2,.lp-final h2{font-family:"Fraunces",Georgia,serif;font-size:25px;color:#2C2521;margin:0 0 10px;line-height:1.25;}'
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
    + '.lp-pro-note{margin-top:10px !important;font-size:13px !important;color:#9a8d80 !important;}'
    + '.lp-final{text-align:center;padding:34px 0 6px;}'
    + '.lp-foot{text-align:center;color:#9a8d80;font-size:12.5px;font-weight:700;padding:28px 0 0;}'
    + '@media(max-width:480px){.lp-feats{grid-template-columns:1fr;}.lp-name{font-size:34px;}}';
  document.head.appendChild(st);
})();
