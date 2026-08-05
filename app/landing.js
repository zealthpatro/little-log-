/* Cubby's signed-out screen. TWO different jobs, so two different screens:

   WEB (little-cubby.com/app/) = a landing page. The visitor arrived from a link or a search and has not
   decided yet, so it has to earn the sign-in: hero, features, how it works, Pro, footer.

   APP (the iOS/Android wrapper) = a sign-in screen. This person already searched the App Store, read the
   listing, downloaded and opened it. They are sold. Making them scroll a sales page to reach the buttons
   is friction at the exact moment we can least afford it, so the app gets a compact screen: brand, an
   auto-scrolling reminder of what they came for, and the buttons in the first fold.
   The wrapper also can't show the marketing page safely: it has no back button, so the nav/footer links
   would strand the user off /app/; an installed app must not sell itself an install; and App Review 3.1.1
   forbids pointing at a subscription bought outside Apple's IAP (Pro is register-interest until Aug 2026).
   Email sign-in is hidden natively too (store-firebase.js) because its link opens in Safari. */
(function () {
  function isNative() {
    try { return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()); } catch (e) { return false; }
  }
  function isIOS() {
    try { return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios'); } catch (e) { return false; }
  }

  /* The official Google "G", exactly as Google ships it: four brand colours, untouched. Their sign-in
     branding guidelines are a condition of using Google Sign-In, and they forbid recolouring, redrawing
     or distorting the mark — so this is the real artwork, never tinted to Cubby's palette. */
  var GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
    + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
    + '</svg>';
  /* "Continue with Google" is one of Google's approved labels. Built once and reused everywhere the
     button appears, so the two surfaces can never drift out of compliance separately. */
  var GOOGLE_BTN = '<button type="button" class="lp-cta ll-cta">' + GOOGLE_G + 'Continue with Google</button>';
  window.cubbyGoogleG = GOOGLE_G;
  window.cubbyGoogleBtn = GOOGLE_BTN;

  /* Icons shared by the web feature grid and the app carousel — drawn once, used twice. */
  var ICON = {
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13z"/></svg>',
    circle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><circle cx="17.2" cy="9.4" r="2.6"/><path d="M16 20a5.4 5.4 0 0 1 5.2-4.4"/></svg>',
    health: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v5a4 4 0 0 0 8 0V3"/><path d="M5 3H3.5M13 3h1.5"/><path d="M9 16v1a5 5 0 0 0 5 5 5 5 0 0 0 5-5v-3"/><circle cx="19" cy="11" r="2.2"/></svg>',
    keepsake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h3l2-3h8l2 3h3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><circle cx="12" cy="13" r="4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/></svg>'
  };

  /* The app carousel. Five, not eight: this is a reminder of why they downloaded, not a pitch. Every
     line is a feature that actually ships (truthful-copy rule), and every line is calm — a signed-out
     parent may be anxious, pregnant, or grieving, so nothing here counts, urges or assumes a baby. */
  var TILES = [
    [ICON.log, 'Log it in seconds', 'Feeds, sleep and nappies. One thumb, even at 3am.'],
    [ICON.circle, 'Everyone in sync', 'Parents, grandparents, the nanny. One shared log, live.'],
    [ICON.health, 'Health, handled', 'Gentle fever guidance, and a tidy summary for the doctor.'],
    [ICON.keepsake, 'Keep the moments', 'Milestones and memory cards from your own photos.'],
    [ICON.lock, 'Private to your family', 'No ads. We never sell your data.']
  ];

  function appSignIn(msg) {
    var tiles = TILES.map(function (t) {
      return '<div class="ac-tile"><div class="ac-ic">' + t[0] + '</div>'
        + '<div class="ac-t">' + t[1] + '</div><div class="ac-s">' + t[2] + '</div></div>';
    }).join('');
    var dots = TILES.map(function (_, i) {
      return '<span class="ac-dot' + (i === 0 ? ' on' : '') + '"></span>';
    }).join('');
    // The Apple/consent block is injected right after .ll-cta by store-firebase's showSignIn, so the
    // markup here stops at the Google button on purpose. On iOS, CSS order puts Apple first (platform
    // convention, and the smoothest path: Face ID, no account picker).
    return '<div class="lp lp-app' + (isIOS() ? ' lp-ios' : '') + '">'
      + '<div class="lp-app-top">'
      + '<div class="lp-logo"><img src="/app/spot-art/welcome_cub.webp" alt="Cubby"></div>'
      + '<h1 class="lp-name">Cubby</h1>'
      + '<p class="lp-app-tag">One calm place for everyone caring for your little one.</p>'
      + '</div>'
      + '<div class="ac-wrap"><div class="ac-track" id="acTrack">' + tiles + '</div>'
      + '<div class="ac-dots" id="acDots">' + dots + '</div></div>'
      + '<div class="lp-app-auth">'
      + GOOGLE_BTN
      + (msg ? '<div class="lp-msg">' + msg + '</div>' : '')
      + '</div>'
      + '<div class="lp-trust">Free · Private to your family</div>'
      + '</div>';
  }

  /* Auto-advance. Deliberately gentle and never a trap: it pauses the moment the parent touches it
     (their swipe wins, permanently), honours prefers-reduced-motion, and stops itself the instant the
     sign-in overlay goes away — otherwise it would tick forever behind the signed-in app. */
  var acTimer = null;
  function stopCarousel() { if (acTimer) { clearInterval(acTimer); acTimer = null; } }
  function startCarousel() {
    stopCarousel();
    var track = document.getElementById('acTrack');
    if (!track) return;
    var dots = document.getElementById('acDots');
    var slides = track.children.length;
    var i = 0, paused = false;

    function paint() {
      if (!dots) return;
      for (var d = 0; d < dots.children.length; d++) dots.children[d].classList.toggle('on', d === i);
    }
    // The parent taking over is a decision, not an interruption: don't fight them by resuming.
    ['touchstart', 'pointerdown', 'wheel'].forEach(function (ev) {
      track.addEventListener(ev, function () { paused = true; stopCarousel(); }, { passive: true });
    });
    track.addEventListener('scroll', function () {
      var w = track.clientWidth || 1;
      var n = Math.round(track.scrollLeft / w);
      if (n !== i && n >= 0 && n < slides) { i = n; paint(); }
    }, { passive: true });

    var reduce = false;
    try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce || paused) return;

    acTimer = setInterval(function () {
      if (!document.getElementById('acTrack')) { stopCarousel(); return; }  // signed in; the overlay is gone
      i = (i + 1) % slides;
      try { track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' }); } catch (e) { track.scrollLeft = i * track.clientWidth; }
      paint();
    }, 3600);
  }

  /* Did they arrive from someone's invite link? `?join=1` is set by the invite, and stashed to
     sessionStorage by stashDeepLink() so it survives the sign-in redirect. Carries no personal data. */
  function joinIntent() {
    try {
      if (/[?&]join=1/.test(location.search || '')) return true;
      return sessionStorage.getItem('cubby-join') === '1';
    } catch (e) { return false; }
  }

  /* The invitee's first screen. Someone they trust has already told them what Cubby is, so selling it
     again is noise — the job here is the opposite: get them signed in as the RIGHT person.

     The whole invite is matched on email address, so "use the address they invited" is the single
     most load-bearing sentence on this screen. Saying it here prevents the mismatch; the recovery
     screen after sign-in only cleans it up.

     Deliberately does NOT name the inviter or the baby. The invite doc is keyed by email and the
     rules require auth to read it, so pre-sign-in we genuinely do not know who this is from, and
     guessing warmly would be a lie. The names appear on the next screen, once we can actually read
     them. */
  function inviteSignIn(msg) {
    return '<div class="lp lp-app' + (isIOS() ? ' lp-ios' : '') + '">'
      + '<div class="lp-app-top">'
      + '<div class="lp-logo"><img src="/app/spot-art/invite_bears.webp" alt="Cubby"></div>'
      + '<h1 class="lp-name">You\'re invited</h1>'
      + '<p class="lp-app-tag">Someone has added you to their Cubby, the calm, private log they keep for their little one.</p>'
      + '</div>'
      + '<div class="lp-inv">'
      + '<div class="lp-inv-t">Sign in with the email address they invited</div>'
      + '<div class="lp-inv-s">That is how Cubby knows which family to let you into. If you use a different address, we will not find the invite.</div>'
      + '</div>'
      + '<div class="lp-app-auth">'
      + GOOGLE_BTN
      + (msg ? '<div class="lp-msg">' + msg + '</div>' : '')
      + '</div>'
      + '<div class="lp-trust">Free · Private to your family</div>'
      + '</div>';
  }

  window.cubbyLanding = function (msg) {
    // Before the native/web split: an invitee gets the same focused screen either way, including
    // when a universal link opens the invite straight into the installed app.
    if (joinIntent()) return inviteSignIn(msg);
    var native = isNative();
    if (native) {
      // showSignIn assigns this straight into innerHTML, so the nodes exist by the next tick.
      setTimeout(startCarousel, 0);
      return appSignIn(msg);
    }
    var cta = GOOGLE_BTN;
    var features = [
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13z"/></svg>', 'One-thumb logging', 'Feeds, sleep, nappies, pumping, logged in seconds, even at 3am.'],
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><circle cx="17.2" cy="9.4" r="2.6"/><path d="M16 20a5.4 5.4 0 0 1 5.2-4.4"/></svg>', 'Your whole care circle', 'Parents, grandparents, the nanny, daycare or playschool, anyone who helps sees the same log, live.'],
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><circle cx="5.8" cy="5.8" r="2.3"/><circle cx="18.2" cy="5.8" r="2.3"/><path d="M9.6 12.4h.01M14.4 12.4h.01M12 15.4h.01"/></svg>', 'Who did what', 'Know exactly who logged each feed, nap and nappy: you, your partner, or the nanny.'],
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="13" y="7" width="3" height="10"/></svg>', 'Growth charts', 'WHO & CDC percentile curves behind your baby\'s weight and height.'],
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v5a4 4 0 0 0 8 0V3"/><path d="M5 3H3.5M13 3h1.5"/><path d="M9 16v1a5 5 0 0 0 5 5 5 5 0 0 0 5-5v-3"/><circle cx="19" cy="11" r="2.2"/></svg>', 'Health, handled', 'Medicines and doses in one place, gentle fever guidance, and a one-tap summary for the doctor.'],
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h3l2-3h8l2 3h3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><circle cx="12" cy="13" r="4"/></svg>', 'Keepsakes', 'Monthly memory cards, milestones and a birth poster from your real moments.'],
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/></svg>', 'Private by design', 'Your log is locked to your family. No ads, and we never sell your data.'],
      ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>', 'See the day from anywhere', 'Checking in from work? Get a tidy recap of feeds, naps and meals, live.']
    ].map(function (f) {
      return '<div class="lp-feat"><div class="lp-fi">' + f[0] + '</div><div><div class="lp-ft">' + f[1] + '</div><div class="lp-fs">' + f[2] + '</div></div></div>';
    }).join('');
    var steps = [
      ['1', 'Sign in', native ? 'Ten seconds, and no password to remember.' : 'Ten seconds, no password, no app store.'],
      ['2', 'Add your baby', 'Name, birthday, and you\'re ready to log.'],
      ['3', 'Invite your partner', 'Start caring for your little one, together.']
    ].map(function (s) {
      return '<div class="lp-step"><div class="lp-sn">' + s[0] + '</div><div class="lp-st">' + s[1] + '</div><div class="lp-ss">' + s[2] + '</div></div>';
    }).join('');
    return '<div class="lp' + (native ? ' lp-native' : '') + '">'
      + (native ? '' : '<nav class="lp-nav"><a href="/" class="lp-nav-brand"><img src="/icons/logo-512.png" alt="Cubby">Cubby</a>'
      + '<span class="lp-nav-links"><a href="/features/">Features</a><a href="/articles/">Articles</a><a href="/pricing/">Pricing</a><a href="/faq/">FAQ</a></span></nav>')
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
      + (native ? '' : '<section class="lp-pro"><h2>Free forever, with Pro for the extras</h2>'
      + '<div class="lp-cmp">'
      + '<div class="lp-col"><div class="lp-col-h">Free</div><ul>'
      + '<li>Unlimited logging: feeds, sleep, nappies, pumping</li>'
      + '<li>Share with family &amp; caregivers (nanny, daycare)</li>'
      + '<li>Growth charts (WHO &amp; CDC)</li>'
      + '<li>Health nudges &amp; doctor-visit summary</li>'
      + '<li>Photos, memory cards &amp; milestones</li>'
      + '<li>Private, and no ads</li>'
      + '</ul></div>'
      + '<div class="lp-col lp-col-pro"><div class="lp-col-h">Pro <span class="lp-soon">Aug 2026</span></div><ul>'
      + '<li>The full keepsake studio: every template, font &amp; format</li>'
      + '<li>Watermark-free shares</li>'
      + '<li>Auto-enhance &amp; background cutout, on your device</li>'
      + '<li>Then &amp; Now keepsakes</li>'
      + '<li>Doctor PDF reports</li>'
      + '<li>A few free tastes of every treat</li>'
      + '</ul></div>'
      + '</div>'
      + '<p class="lp-pro-note">Cubby Pro launches August 2026. Free shares carry a small "made with Cubby · little-cubby.com" mark; Pro shares are clean. Rituals, push reminders &amp; insights are on the Pro roadmap for later. Sign in, then register for Pro from Settings, Cubby Pro, to claim your free trial at launch.</p></section>')
      + '<section class="lp-final"><h2>Everyone caring for your baby, in sync.</h2>' + cta + '<div class="lp-trust">Free · Private · made with 🐻</div>'
      + (native ? '' : '<div class="lp-pwa">No download, no app store. Add Cubby to your home screen for an app-like, offline-ready experience in any browser.</div>') + '</section>'
      + (native
        ? '<footer class="lp-foot">Cubby · a warm, private baby tracker 🐻</footer>'
        : '<footer class="lp-foot">Cubby · a warm, private baby tracker 🐻<br><a href="/">little-cubby.com</a> · <a href="/articles/">Articles</a> · <a href="/faq/">FAQ</a></footer>')
      + '</div>';
  };

  /* ---- theming ----------------------------------------------------------------------------
     These rules are injected into the app document (document.head, below), so the app's own
     custom properties from index.html's :root / [data-theme="night"] resolve here exactly as they
     do anywhere else. That is the whole fix: this screen had ZERO theme awareness, so a Night
     parent who signed out — including from the "Log out" on the bereavement holding screen — got a
     full cream page under a near-black status bar.

     Which screens follow the theme: ALL THREE (app sign-in, invite sign-in, and the web landing).
     Splitting them was considered and rejected. The overlay behind all three is one element with
     one background, so keeping the web landing cream while the app screens go dark needs a
     parent-of-child selector, and it would not have fixed the reported bug anyway: the browser PWA
     is where signing out lands most people, and the mismatch measured (cream page, #1A1614 chrome)
     is the same mismatch on the acquisition page. A visitor on a dark phone gets data-theme=night
     before they have ever chosen anything, so "acquisition stays cream" would mean shipping the bug
     to exactly the people we want to impress.

     How: light values are left byte-for-byte where a token's light value isn't identical, and the
     Night block at the bottom re-points those rules at the tokens. Where the literal already WAS
     the token's light value (#2C2521 = --ink, #6E635B = --ink-soft, #FBF7EF = --surface-2,
     #C97FA0 = --pump, #9A8C6E = --note, #56A08E = --diaper) the token is used inline instead, so
     there is nothing to override and light cannot drift. Same discipline the .cu-* modal and
     #cb-birth-arrival already use.

     What does NOT follow the theme: Google's button stays their white surface with their untouched
     four-colour G, and Apple's stays black, in both themes. Their branding guidelines fix the
     BUTTON, not the page behind it, and App Review 4.8 only asks that neither provider be more
     prominent — which the equal-height rule below still guarantees. */
  var st = document.createElement('style');
  st.textContent =
    '#llAuthOv.landing{display:block;align-items:initial;justify-content:initial;padding:0;overflow-y:auto;-webkit-overflow-scrolling:touch;background:linear-gradient(180deg,#FBF5E9,#F1E4CF);}'
    + '.lp{max-width:680px;margin:0 auto;padding:0 22px 56px;font-family:"Nunito Sans",system-ui,sans-serif;color:var(--ink,#2C2521);}'
    + '.lp-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 0 0;}'
    + '.lp-nav-brand{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:800;color:var(--ink-soft,#6E635B);text-decoration:none;}'
    + '.lp-nav-brand img{width:22px;height:22px;border-radius:7px;}'
    + '.lp-nav-links{display:flex;gap:2px;}'
    + '.lp-nav-links a{font-size:13px;font-weight:700;color:var(--ink-soft,#6E635B);text-decoration:none;padding:6px 8px;border-radius:8px;}'
    + '.lp-nav-links a:hover{background:var(--surface-2,#FBF7EF);color:var(--ink,#2C2521);}'
    + '.lp-hero{text-align:center;padding:40px 0 28px;}'
    + '.lp-logo img{width:88px;height:88px;border-radius:22px;box-shadow:0 8px 22px rgba(0,0,0,.12);display:block;margin:0 auto;}'
    + '.lp-name{font-family:"Fraunces",Georgia,serif;font-size:40px;margin:14px 0 6px;color:var(--ink,#2C2521);}'
    + '.lp-tag{font-size:17px;line-height:1.5;color:var(--ink-soft,#6E635B);max-width:440px;margin:0 auto 22px;font-weight:600;}'
    /* Google's sign-in branding guidelines, followed: their light-theme surface (#FFFFFF), their border
       (#747775) and their text colour (#1F1F1F), with the untouched four-colour G. It is deliberately
       NOT Cubby pink — recolouring their button or mark breaks the guidelines we agree to by using
       Google Sign-In. (Their spec asks for Roboto; we keep Nunito Sans because pulling Roboto from
       Google Fonts would put a third-party request back in the boot path, against the no-third-party
       promise the self-hosted fonts exist to keep. Their guidance allows a substitute when Roboto isn't
       available.) 15px padding + a 1px border matches Apple's 16px borderless height exactly, so
       neither provider is more prominent — which is also App Review 4.8. */
    + '.lp-cta{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;max-width:340px;margin:0 auto;'
    + 'border:1px solid #747775;background:#FFFFFF;color:#1F1F1F;font-size:17px;font-weight:800;padding:15px 22px;'
    + 'border-radius:15px;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(60,40,30,.08);}'
    + '.lp-cta svg{width:20px;height:20px;flex:0 0 auto;}'
    + '.lp-cta:hover{background:#F7F8F8;}'
    + '.lp-cta:active{background:#F1F3F4;}'
    + '.lp-cta:disabled{opacity:.6;cursor:default;}'
    + '.lp-msg{margin-top:12px;color:#b05a7a;font-size:13px;font-weight:700;}'
    + '.lp-trust{margin-top:12px;font-size:13px;color:#9a8d80;font-weight:700;}'
    // The invitee's one instruction. Sits where the feature carousel goes on the acquisition screen:
    // they were sold by the person who invited them, so this space is for getting the address right.
    + '.lp-inv{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-height:0;'
    + 'background:rgba(255,255,255,.62);border:1px solid #ECE0D2;border-radius:20px;padding:18px 18px;margin:8px 0;text-align:left;}'
    + '.lp-inv-t{font-weight:800;font-size:16px;color:var(--ink,#2C2521);line-height:1.35;}'
    + '.lp-inv-s{font-size:14px;color:#6B5D50;font-weight:600;line-height:1.5;margin-top:7px;}'
    + '.lp-why{text-align:center;padding:24px 6px 6px;}'
    + '.lp-why h2,.lp-steps-wrap h2,.lp-final h2,.lp-pro h2{font-family:"Fraunces",Georgia,serif;font-size:25px;color:var(--ink,#2C2521);margin:0 0 10px;line-height:1.25;}'
    + '.lp-why p{color:var(--ink-soft,#6E635B);font-size:15px;line-height:1.6;max-width:480px;margin:0 auto;font-weight:600;}'
    + '.lp-feats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:28px 0;}'
    + '.lp-feat{background:#fff;border-radius:16px;padding:16px;box-shadow:0 5px 14px rgba(0,0,0,.05);display:flex;gap:11px;align-items:flex-start;}'
    + '.lp-fi{flex:0 0 auto;width:40px;height:40px;border-radius:12px;background:var(--surface-2,#FBF7EF);color:var(--note,#9A8C6E);display:grid;place-items:center;}.lp-fi svg{width:22px;height:22px;}'
    + '.lp-ft{font-weight:800;font-size:15px;margin-bottom:3px;}'
    + '.lp-fs{font-size:13px;color:var(--ink-soft,#6E635B);line-height:1.45;font-weight:600;}'
    + '.lp-steps-wrap{text-align:center;margin:14px 0 8px;}'
    + '.lp-steps{display:flex;flex-direction:column;gap:14px;max-width:430px;margin:18px auto 0;text-align:left;}'
    + '.lp-step{background:#fff;border-radius:16px;padding:16px 18px 16px 64px;box-shadow:0 5px 14px rgba(0,0,0,.05);position:relative;}'
    + '.lp-sn{position:absolute;left:16px;top:15px;width:34px;height:34px;border-radius:50%;background:var(--pump,#C97FA0);color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;font-family:"Fraunces",Georgia,serif;}'
    + '.lp-st{font-weight:800;font-size:15px;}'
    + '.lp-ss{font-size:13px;color:var(--ink-soft,#6E635B);font-weight:600;margin-top:2px;}'
    + '.lp-pro{text-align:center;background:#fff;border:1px solid #EADFcf;border-radius:18px;padding:24px 20px;margin:30px 0 6px;box-shadow:0 5px 14px rgba(0,0,0,.05);}'
    + '.lp-pro-badge{display:inline-block;background:var(--pump,#C97FA0);color:#fff;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:4px 11px;border-radius:999px;margin-bottom:8px;}'
    + '.lp-pro p{color:var(--ink-soft,#6E635B);font-size:15px;line-height:1.55;max-width:460px;margin:0 auto;font-weight:600;}'
    + '.lp-pro-note{margin-top:14px !important;font-size:13px !important;color:#9a8d80 !important;}'
    + '.lp-cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0 4px;text-align:left;}'
    + '.lp-col{background:var(--surface-2,#FBF7EF);border:1px solid #EADFcf;border-radius:14px;padding:16px;}'
    + '.lp-col-pro{background:#fff;border-color:var(--pump,#C97FA0);}'
    + '.lp-col-h{font-family:"Fraunces",Georgia,serif;font-size:18px;font-weight:600;color:var(--ink,#2C2521);margin-bottom:10px;}'
    + '.lp-soon{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;background:var(--pump,#C97FA0);color:#fff;padding:2px 7px;border-radius:999px;vertical-align:middle;margin-left:4px;}'
    + '.lp-col ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;}'
    + '.lp-col li{font-size:13px;color:var(--ink-soft,#6E635B);font-weight:600;line-height:1.4;padding-left:21px;position:relative;}'
    + '.lp-col li::before{content:"✓";position:absolute;left:0;color:var(--diaper,#56A08E);font-weight:900;}'
    + '.lp-col-pro li::before{content:"✦";color:var(--pump,#C97FA0);}'
    + '@media(max-width:520px){.lp-cmp{grid-template-columns:1fr;}}'
    /* ---- app sign-in screen (native wrapper only) ---- */
    /* One viewport, no scrolling for the thing they came to do. The buttons sit at the bottom where the
       thumb already is; the carousel fills the space above instead of a sales pitch. */
    + '.lp-app{min-height:100dvh;display:flex;flex-direction:column;justify-content:space-between;'
    + 'padding:calc(28px + env(safe-area-inset-top)) 22px calc(20px + env(safe-area-inset-bottom));max-width:520px;gap:14px;}'
    + '.lp-app-top{text-align:center;}'
    + '.lp-app .lp-logo img{width:76px;height:76px;}'
    + '.lp-app .lp-name{font-size:34px;margin:10px 0 4px;}'
    + '.lp-app-tag{font-size:15.5px;line-height:1.5;color:var(--ink-soft,#6E635B);font-weight:600;margin:0 auto;max-width:300px;}'
    /* scroll-snap does the swiping; the timer only nudges scrollLeft, so a finger always wins.
       flex:1 + centring lets the carousel take the slack between the brand and the buttons, so the
       spacing stays even from a small iPhone SE up to a Pro Max instead of pooling at one end. */
    + '.ac-wrap{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-height:0;}'
    + '.ac-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;}'
    + '.ac-track::-webkit-scrollbar{display:none;}'
    + '.ac-tile{flex:0 0 100%;scroll-snap-align:center;text-align:center;padding:4px 10px;box-sizing:border-box;}'
    + '.ac-ic{width:54px;height:54px;margin:0 auto 10px;border-radius:17px;background:#fff;color:var(--note,#9A8C6E);display:grid;place-items:center;box-shadow:0 5px 14px rgba(0,0,0,.06);}'
    + '.ac-ic svg{width:27px;height:27px;}'
    + '.ac-t{font-family:"Fraunces",Georgia,serif;font-size:19px;color:var(--ink,#2C2521);margin-bottom:4px;}'
    + '.ac-s{font-size:14px;line-height:1.5;color:var(--ink-soft,#6E635B);font-weight:600;max-width:280px;margin:0 auto;}'
    + '.ac-dots{display:flex;justify-content:center;gap:6px;margin-top:12px;}'
    // The unselected dot is the same "off" grey the app's switches use, one token for both.
    + '.ac-dot{width:6px;height:6px;border-radius:50%;background:var(--switch-off,#DDD2C0);transition:background .3s,width .3s;}'
    + '.ac-dot.on{background:var(--pump,#C97FA0);width:18px;border-radius:3px;}'
    + '.lp-app-auth{display:flex;flex-direction:column;}'
    /* Apple first on iOS: the platform convention, and the least friction (Face ID, no account picker).
       store-firebase injects it after the Google button, so reorder visually rather than restructure. */
    + '.lp-ios .lp-app-auth .lp-apple{order:-1;margin-bottom:9px;margin-top:0;}'
    + '.lp-app-auth .ll-email-row,.lp-app-auth .ll-install-row{margin-top:10px;}'
    + '@media(max-height:700px){.lp-app .lp-logo img{width:60px;height:60px;}.lp-app .lp-name{font-size:28px;}'
    + '.lp-app-tag{font-size:14px;}.ac-ic{width:46px;height:46px;margin-bottom:8px;}.ac-t{font-size:17px;}}'
    + '.lp-final{text-align:center;padding:34px 0 6px;}'
    + '.lp-pwa{max-width:380px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#a99e92;font-weight:600;}'
    + '.lp-foot{text-align:center;color:#9a8d80;font-size:13px;font-weight:700;padding:28px 0 0;}'
    + '.lp-foot a{color:#b05a7a;font-weight:700;}'
    + '@media(max-width:480px){.lp-feats{grid-template-columns:1fr;}.lp-name{font-size:34px;}}'

    /* ---------- Night ----------
       Everything above whose literal was NOT already a token's light value. Stated as overrides so
       the light rendering is byte-for-byte what it has always been. */
    + '[data-theme="night"] #llAuthOv.landing{background:linear-gradient(180deg,var(--bg-grad-1),var(--bg-grad-2));}'
    /* Raised surfaces: on #1A1614 a shadow is invisible, so a card earns its edge from a hairline —
       the same rule the app's own cards use in Night. */
    + '[data-theme="night"] .lp-feat,[data-theme="night"] .lp-step,[data-theme="night"] .lp-pro,'
    + '[data-theme="night"] .ac-ic,[data-theme="night"] .lp-col{background:var(--surface);outline:1px solid var(--hairline);outline-offset:-1px;}'
    /* Free vs Pro reads by elevation in Light (cream card, white card). In Night elevation climbs in
       lightness rather than in shadow, so Pro takes the higher rung instead of the brighter white. */
    + '[data-theme="night"] .lp-col-pro{background:var(--surface-3);}'
    + '[data-theme="night"] .lp-col,[data-theme="night"] .lp-pro{border-color:var(--line);}'
    + '[data-theme="night"] .lp-col-pro{border-color:var(--pump);}'
    + '[data-theme="night"] .lp-inv{background:var(--surface);border-color:var(--line);}'
    + '[data-theme="night"] .lp-inv-s{color:var(--ink-soft);}'
    + '[data-theme="night"] .lp-trust,[data-theme="night"] .lp-pwa,[data-theme="night"] .lp-foot,'
    + '[data-theme="night"] .lp-pro-note{color:var(--ink-faint) !important;}'
    + '[data-theme="night"] .lp-msg,[data-theme="night"] .lp-foot a{color:var(--preg);}'
    /* The step numerals and the Pro pill sit ON an accent, and Night lightens every accent on
       purpose, so white ink there is worse at 3am than at noon. --on-accent is the dark-ink token. */
    + '[data-theme="night"] .lp-sn,[data-theme="night"] .lp-soon,'
    + '[data-theme="night"] .lp-pro-badge{color:var(--on-accent);}';
  document.head.appendChild(st);
})();
