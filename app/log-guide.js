/* Cubby — "What to log, and why".
   ------------------------------------------------------------------------------------------------
   A parent asked for something they could go back to that explained what each log is for. The
   Charter's one rule says that if a flow needs explaining it has already failed, and ONBOARDING.md
   rules out a multi-screen tour. Both stay true here, because this is not a tour: it never opens
   itself, it never blocks anything, it has no progress meter and no completion count, and it lives
   permanently in Settings so it is still there next week, when the question actually arrives.

   Pull, never push. The home card is offered once and then retires for good.

   Structurally this is the openReadCarousel pattern (app/index.html): one injected stylesheet, one
   node appended to document.body. It never touches the app shell, so paintShell's diff cache stays
   valid and the #scroll node survives — which is what keeps iOS scroll momentum alive.

   It reads app state through exactly one window: cubbyGuideCtx() in index.html. `state` is a
   top-level binding in that inline script and is not reachable from a separate file, and the guide
   has no business knowing how any of these facts are computed anyway.

   Nothing in here makes a clinical claim. The only age statements it carries are ones the app
   already ships and already hedges (solids around six months). Anything beyond that is a link to an
   article that was written and sourced for the purpose.
*/
(function () {
  'use strict';

  var CSS = ''
    + '#logGuide{position:fixed;inset:0;z-index:100002;background:linear-gradient(160deg,var(--bg-grad-1),var(--bg-grad-2));display:flex;flex-direction:column;font-family:inherit;color:var(--ink)}'
    + '#logGuide .lg-top{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 6px}'
    + '#logGuide .lg-back{min-width:44px;height:44px;border:none;background:var(--surface-2);color:var(--ink);border-radius:12px;padding:0 14px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}'
    + '#logGuide .lg-spacer{flex:1}'
    + '#logGuide .lg-x{width:44px;height:44px;flex:0 0 auto;border:none;background:var(--surface-2);color:var(--ink-soft);border-radius:50%;font-size:15px;cursor:pointer;font-family:inherit}'
    + '#logGuide .lg-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 20px 10px;animation:lgIn .28s ease}'
    + '#logGuide .lg-h{font-family:"Fraunces",Georgia,serif;font-size:27px;line-height:1.2;font-weight:700;margin:6px 0 8px}'
    + '#logGuide .lg-sub{font-size:15.5px;line-height:1.5;color:var(--ink-soft);font-weight:600;margin-bottom:6px}'
    + '#logGuide .lg-lab{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:20px 0 9px}'
    + '#logGuide .lg-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--surface);border:1.5px solid var(--line);border-radius:16px;padding:13px 14px;margin-bottom:9px;cursor:pointer;font-family:inherit;color:var(--ink);min-height:44px}'
    + '#logGuide .lg-row:active{transform:scale(.985)}'
    + '#logGuide .lg-ico{width:38px;height:38px;flex:0 0 auto;border-radius:11px;display:grid;place-items:center;font-size:19px}'
    + '#logGuide .lg-ico svg{width:19px;height:19px}'
    + '#logGuide .lg-rmid{flex:1;min-width:0}'
    + '#logGuide .lg-rt{display:block;font-size:15px;font-weight:800}'
    + '#logGuide .lg-rs{display:block;font-size:13px;font-weight:600;color:var(--ink-soft);line-height:1.4;margin-top:2px}'
    + '#logGuide .lg-chev{flex:0 0 auto;color:var(--ink-soft);font-size:15px;font-weight:800}'
    + '#logGuide .lg-more{width:100%;background:none;border:none;color:var(--ink-soft);font-family:inherit;font-size:13.5px;font-weight:800;padding:12px 0;cursor:pointer;text-align:left;min-height:44px}'
    + '#logGuide .lg-hid{display:none}'
    + '#logGuide .lg-what{font-size:17px;line-height:1.5;font-weight:700;margin:2px 0 14px}'
    + '#logGuide .lg-get{font-size:16px;line-height:1.55;color:var(--ink-soft);font-weight:600}'
    + '#logGuide .lg-chico{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:30px;margin-bottom:12px}'
    + '#logGuide .lg-chico svg{width:28px;height:28px}'
    + '#logGuide .lg-acts{display:flex;flex-direction:column;gap:10px;margin-top:26px}'
    + '#logGuide .lg-try{border:none;border-radius:15px;padding:15px 22px;font-size:15.5px;font-weight:800;cursor:pointer;font-family:inherit;min-height:44px}'
    + '#logGuide .lg-read{background:var(--surface);color:var(--ink);border:1.5px solid var(--line);border-radius:15px;padding:14px 22px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;min-height:44px}'
    + '#logGuide .lg-foot{padding:12px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--divider,var(--line));font-size:13px;font-weight:600;color:var(--ink-soft);text-align:center}'
    + '@keyframes lgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'
    + '@media (prefers-reduced-motion: reduce){#logGuide .lg-body{animation:none}#logGuide .lg-row:active{transform:none}}';

  /* One chapter per log. `line` is the one-glance benefit on the contents list, `what` is the
     mechanic, `get` is the honest return. Never an obligation, never a target, never a number the
     app cannot stand behind.
     The four with no label/ico/fn of their own inherit them from the shell's quick-log registry. */
  var CH = {
    feed: {
      line: 'So nobody has to ask when the last one was',
      what: 'Breast, bottle, water or solids, with a live timer for nursing.',
      get: 'You stop holding "when was the last one?" in your head, and whoever takes over can see it without asking.'
    },
    sleep: {
      line: 'A timer everyone in your circle can see',
      what: 'Start a nap with one tap and stop it when they wake. If they drifted off a while ago, you can log that it started earlier.',
      get: 'The timer shows on every phone in your circle, so nobody wakes a sleeping baby just to check.'
    },
    diaper: {
      line: 'The thing a doctor almost always asks about',
      what: 'Wet, dirty, both, or a dry check.',
      get: 'It is the thing a doctor almost always asks about, and it is easier to tap now than to remember later.'
    },
    pump: {
      line: 'Your stash and your rhythm in one place',
      what: 'How much you expressed, which side, and when.',
      get: 'Your stash and your rhythm in one place, instead of on the back of a receipt.'
    },
    activity: {
      line: 'Tummy time, baths, walks, and the photos with them',
      what: 'Tummy time, a bath, a walk, or just a line about the day. Add a photo if you took one.',
      get: 'The photo lands in your Album, ready to become something you keep.'
    },
    measure: {
      line: 'A gentle curve you can bring to your doctor',
      what: 'Weight and height, whenever you have them. One of the two is fine.',
      get: 'Over a few visits it draws a gentle curve you can bring to your doctor. It is a guide, never a diagnosis.'
    },
    milestone: {
      line: 'The firsts you will want to read back in a year',
      what: 'The firsts, from a library of ideas or in your own words.',
      get: 'These are the ones you will want to read back in a year. No pass, no fail, every baby in their own time.'
    },
    voice: {
      line: 'For when only one hand is free',
      what: 'Say a feed, a nap, a nappy or a pump out loud and Cubby writes it down. You always confirm before anything is saved.',
      get: 'For the times you have one hand free and it is not the one holding the phone.'
    },
    kicks: {
      line: 'You learn what usual looks like for your baby',
      what: 'Count the movements you feel in one sitting.',
      get: 'You learn what usual looks like for your baby, which is the thing that makes a change worth mentioning.'
    },
    contractions: {
      line: 'How long, and how far apart, without guessing',
      what: 'Time them, from the first twinge to the end of each one.',
      get: 'When you call, you can say how long and how far apart instead of guessing.'
    },
    symptom: {
      line: 'So appointments are not done from memory',
      what: 'How you are feeling, in your own words or from a list.',
      get: 'Appointments go better when you are not trying to remember three weeks at once.'
    },
    mood: {
      line: 'Never shared with your circle',
      what: 'A private line about how you are, not about how the pregnancy is.',
      get: 'It is never shared with your circle. Not now, not later, not by accident.'
    },
    /* Guide-only chapters. Real screens the app has always had, they just never had a quick-log
       tile, so nothing ever introduced them. */
    temp: {
      label: 'Temperature', ico: '🌡️', fn: 'openTemp()', tone: '--feed', soft: '--feed-soft',
      line: 'Times and numbers ready for the call',
      what: 'A reading, with plain guidance beside it.',
      get: 'If they are unwell you have the times and the numbers ready for the call. Cubby never diagnoses.'
    },
    med: {
      label: 'Medicine', ico: '💊', fn: 'openAddMed()', tone: '--sleep', soft: '--sleep-soft',
      line: 'Two people cannot double a dose that is written down',
      what: 'What you gave, how much, and when.',
      get: 'Two people caring for one baby cannot double a dose if the last one is written down.'
    },
    note: {
      label: 'Notes', ico: '✍️', fn: 'openNoteCompose()', tone: '--note', soft: '--note-soft',
      line: 'A word for whoever has baby next',
      what: 'A word for whoever has baby next. Everyone, or just one person.',
      get: 'Like "slight cold today, extra cuddles, last fed 8am". It saves a text, and it saves being asked twice.'
    }
  };

  /* A quick read only where an article already exists and was written for that question. Feed,
     sleep, activity and milestones change with age, so those resolve against months. An absent slug
     means no read button, never an invented one. */
  function readSlug(key, mo) {
    if (key === 'feed') return (mo != null && mo >= 5.5) ? 'starting-solids-around-6-months' : 'how-often-to-feed-newborn';
    if (key === 'sleep') return (mo != null && mo >= 4) ? 'baby-sleep-by-age' : 'newborn-sleep-what-is-normal';
    if (key === 'diaper') return 'bathing-washing-and-nappy-care';
    if (key === 'measure') return 'baby-growth-monitoring';
    if (key === 'activity') return (mo != null && mo < 6) ? 'tummy-time-for-babies' : 'play-development-stages-0-3-years';
    if (key === 'milestone') {
      if (mo == null) return '';
      if (mo < 3) return 'baby-development-2-months';
      if (mo < 7) return 'baby-development-4-months';
      if (mo < 11) return 'crawling-milestones';
      if (mo < 19) return 'when-babies-walk';
      return 'toddler-development-18-24-months';
    }
    return '';
  }

  /* Which logs earn a place at this age. Grounded only in behaviour the app already ships: the
     newborn ritual template, the solids flip at six months, and the child-stage quick-log reshuffle
     at eighteen. No feed counts, no sleep hours, no nappy targets — the app publishes none of those
     on purpose, and this guide is not the place to start. */
  function nowKeys(mo) {
    if (mo == null) return [];                       // no birthday on file: make no claim at all
    if (mo < 4) return ['feed', 'sleep', 'diaper', 'pump'];
    if (mo < 7) return ['feed', 'sleep', 'diaper', 'measure', 'milestone'];
    if (mo < 13) return ['feed', 'sleep', 'diaper', 'milestone'];
    return ['sleep', 'measure', 'milestone', 'activity'];
  }

  function ctx() {
    if (typeof window.cubbyGuideCtx !== 'function') return null;
    try { return window.cubbyGuideCtx(); } catch (e) { return null; }
  }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function callFn(spec) {
    var name = String(spec || '').replace(/\(.*$/, '');
    if (name && typeof window[name] === 'function') { window[name](); return true; }
    return false;
  }

  /* The chapter set for whoever is holding the phone, in two groups.
     `actions` comes from quickAvailable() in the shell, so the owner-only gate on Mood is already
     applied upstream and a caregiver can never be offered it here. */
  function chapters(c) {
    var byKey = {}, order = [], i, a;
    for (i = 0; i < (c.actions || []).length; i++) {
      a = c.actions[i];
      if (!CH[a.k]) continue;
      byKey[a.k] = { k: a.k, label: a.label, ico: a.ico, fn: a.fn, tone: a.tone, soft: a.soft };
      order.push(a.k);
    }
    if (c.stage === 'pregnancy') {
      /* The labour tools arrive when they are useful. Offering "time your contractions" at week 12
         is not information, it is a fright. Same thresholds the pregnancy home already uses. */
      order = order.filter(function (k) {
        if (k === 'kicks') return (c.week || 0) >= 28;
        if (k === 'contractions') return (c.week || 0) >= 36;
        return true;
      });
    } else {
      order.push('temp');
      order.push('med');
      // Notes are a handoff. With a circle of one there is nobody to hand off to, so teaching it
      // would be teaching a diary with no reader.
      if ((c.circleSize || 1) > 1) order.push('note');
    }
    var all = order.map(function (k) {
      return byKey[k] || { k: k, label: CH[k].label, ico: CH[k].ico, fn: CH[k].fn, tone: CH[k].tone, soft: CH[k].soft };
    });
    var inNow = {};
    nowKeys(c.stage === 'pregnancy' ? null : c.months).forEach(function (k) { inNow[k] = 1; });
    return {
      now: all.filter(function (x) { return inNow[x.k]; }),
      more: all.filter(function (x) { return !inNow[x.k]; })
    };
  }

  function swatch(x, cls) {
    return '<span class="' + cls + '" style="background:var(' + (x.soft || '--surface-2') + ',var(--surface-2));color:var(' + (x.tone || '--ink') + ',var(--ink))">' + (x.ico || '🐻') + '</span>';
  }

  function row(x) {
    return '<button class="lg-row" onclick="CubbyGuide.chapter(\'' + x.k + '\')">'
      + swatch(x, 'lg-ico')
      + '<span class="lg-rmid"><span class="lg-rt">' + esc(x.label) + '</span>'
      + '<span class="lg-rs">' + esc(CH[x.k].line) + '</span></span>'
      + '<span class="lg-chev" aria-hidden="true">›</span></button>';
  }

  var FOOT = 'You can log as much or as little as you like. A quiet day is a day too.';

  function shell(top, body) {
    return '<div class="lg-top">' + top + '</div>'
      + '<div class="lg-body">' + body + '</div>'
      + '<div class="lg-foot">' + FOOT + '</div>';
  }
  function topClose() {
    return '<div class="lg-spacer"></div><button class="lg-x" onclick="CubbyGuide.close()" aria-label="Close">✕</button>';
  }
  function topBack() {
    return '<button class="lg-back" onclick="CubbyGuide.contents()">‹ All logs</button>' + topClose();
  }

  function node() { return document.getElementById('logGuide'); }

  function onKey(e) { if (e && (e.key === 'Escape' || e.key === 'Esc')) close(); }

  function close() {
    var o = node();
    if (o) o.remove();
    document.removeEventListener('keydown', onKey);
  }

  function paint(html) {
    var o = node();
    if (!o) return;
    o.innerHTML = html;
    var b = o.querySelector('.lg-body');
    if (b) b.scrollTop = 0;
  }

  function contents() {
    var c = ctx();
    if (!c) return;
    var sub;
    if (c.stage === 'pregnancy' && c.planning) {
      sub = 'There is nothing to log yet, and that is fine. When there is, this is where it will be explained.';
    } else if (c.stage === 'pregnancy') {
      sub = 'What you can keep while you are expecting, and what each one gives you back.';
    } else if (!c.babyAge) {
      sub = 'What each log is for, and what it gives you back.';
    } else {
      sub = esc(c.babyName || 'Your little one') + ' is ' + esc(c.babyAge) + '. These are the ones that earn their place right now, and the rest are here when you need them.';
    }
    var ch = chapters(c);
    var body = '<div class="lg-h">What to log, and why</div><div class="lg-sub">' + sub + '</div>';
    if (ch.now.length) body += '<div class="lg-lab">Right now</div>' + ch.now.map(row).join('');
    if (ch.more.length) {
      if (ch.now.length) {
        body += '<button class="lg-more" onclick="CubbyGuide.toggleMore(this)" aria-expanded="false" aria-controls="lgMore">There is more when you need it ›</button>'
          + '<div class="lg-hid" id="lgMore">' + ch.more.map(row).join('') + '</div>';
      } else {
        body += '<div class="lg-lab">Everything you can keep</div>' + ch.more.map(row).join('');
      }
    }
    paint(shell(topClose(), body));
  }

  // Only ever render a chapter this person is actually offered, so no link or stale tap can reach
  // one that was gated away (mood for a caregiver, contractions at week 12).
  function offered(c, key) {
    if (!c || !CH[key]) return null;
    var ch = chapters(c), found = null;
    ch.now.concat(ch.more).forEach(function (x) { if (x.k === key) found = x; });
    return found;
  }

  function chapter(key) {
    var c = ctx(), found = offered(c, key);
    if (!found) return;
    var slug = readSlug(key, c.stage === 'pregnancy' ? null : c.months);
    var hasRead = !!(slug && typeof window.readBySlug === 'function' && window.readBySlug(slug));
    // The action carries the log's own colour, so a purple Sleep chapter does not end in an orange
    // button. Ink on an accent fill comes from the --on-<accent> rung, falling back to --on-accent:
    // only the accents that need the opposite polarity declare their own (sleep is the one).
    var tone = found.tone || '--feed';
    var tryStyle = 'background:var(' + tone + ',var(--feed));color:var(' + tone.replace(/^--/, '--on-') + ',var(--on-accent))';
    var body = swatch(found, 'lg-chico')
      + '<div class="lg-h">' + esc(found.label) + '</div>'
      + '<div class="lg-what">' + esc(CH[key].what) + '</div>'
      + '<div class="lg-get">' + esc(CH[key].get) + '</div>'
      + '<div class="lg-acts">'
      + '<button class="lg-try" style="' + tryStyle + '" onclick="CubbyGuide.tryIt(\'' + key + '\')">Try it</button>'
      + (hasRead ? '<button class="lg-read" onclick="CubbyGuide.read(\'' + slug + '\')">Quick read</button>' : '')
      + '</div>';
    paint(shell(topBack(), body));
  }

  function tryIt(key) {
    var found = offered(ctx(), key);
    if (!found) return;
    close();
    if (!callFn(found.fn) && typeof window.toast === 'function') window.toast('That one is not available here');
  }

  function read(slug) {
    close();
    if (typeof window.openReadCarousel === 'function') window.openReadCarousel(slug);
  }

  function toggleMore(btn) {
    var m = document.getElementById('lgMore');
    if (!m) return;
    var open = m.classList.toggle('lg-hid') === false;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? 'That is everything ‹' : 'There is more when you need it ›';
  }

  function open() {
    var c = ctx();
    // Loss safety. The holding screen is the whole screen on purpose. Nothing opens on top of it.
    if (!c || c.lossHolding) return;
    close();
    if (!document.getElementById('lgCSS')) {
      var st = document.createElement('style');
      st.id = 'lgCSS';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var ov = document.createElement('div');
    ov.id = 'logGuide';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'What to log, and why');
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);
    contents();
    // Offered once. Opening it counts the same as dismissing the card: the door in Settings is the
    // one that stays. It must never come back because a chapter went unread.
    if (typeof window.markSeen === 'function') window.markSeen('tip_logguide');
  }

  /* ---- the two doors rendered by the shell ---- */

  // The home offer. Retires on open or dismiss, and is gated on nothing else: a second caregiver
  // joining a household that already has a photo, a baby and 400 logged feeds is exactly the person
  // who has never been told what any of it is for.
  function homeCard(gsUp) {
    var c = ctx();
    if (!c || c.lossHolding) return '';
    if (typeof window.hasSeen === 'function' && window.hasSeen('tip_logguide')) return '';
    if (c.stage === 'pregnancy' && c.planning) return '';         // nothing to log yet: nothing to offer
    // While Get started is up, the guide rides as a row inside it (renderGetStarted, index.html)
    // rather than as a second card underneath. One card, one list. A new parent reading a
    // checklist should not have to notice a separate teaching card below it saying much the same.
    if (gsUp) return '';
    var who = (c.stage === 'pregnancy') ? 'while you are expecting' : ('for ' + esc(c.babyName || 'your little one') + ' right now');
    return '<div class="coach"><div class="cm-ico">🐻</div>'
      + '<div class="cm-body"><div class="cm-t">What to log, and why</div>'
      + '<div class="cm-s">A short guide to the logs that make sense ' + who + ', and what each one gives you back. It stays in Settings if you would rather read it later.</div>'
      + '<button class="btn-primary" style="margin-top:9px;padding:8px 14px;font-size:13px" onclick="cubbyOpenGuide()">Show me</button></div>'
      + '<button class="cm-x" onclick="CubbyGuide.dismissCard()">Not now</button></div>';
  }

  function dismissCard() {
    if (typeof window.markSeen === 'function') window.markSeen('tip_logguide');
    if (typeof window.render === 'function') window.render();
  }

  // The permanent door. Never retires, every stage, every member.
  function settingsRow() {
    var chev = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    return '<div class="set-item" onclick="cubbyOpenGuide()" style="cursor:pointer">'
      + '<div class="si-ico" style="background:var(--note-soft);color:var(--note);font-size:18px">🐻</div>'
      + '<div class="si-body"><div class="a">What to log, and why</div><div class="b">A short guide to each log and what it gives you back</div></div>'
      + '<span class="chev">' + chev + '</span></div>';
  }

  window.CubbyGuide = {
    open: open, close: close, contents: contents, chapter: chapter, tryIt: tryIt, read: read,
    toggleMore: toggleMore, homeCard: homeCard, settingsRow: settingsRow, dismissCard: dismissCard,
    // exposed for tools/guide_test.js
    _chapters: chapters, _nowKeys: nowKeys, _readSlug: readSlug
  };
  window.cubbyOpenGuide = open;
  window.cubbyCloseGuide = close;
})();
