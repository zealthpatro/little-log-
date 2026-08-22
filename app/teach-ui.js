/* Cubby — the teaching surfaces.
   ------------------------------------------------------------------------------------------------
   app/teach-data.js is the content, app/teach.js is the budget, and this is the only file that
   draws anything. Three depths, and depth is a property of the row rather than a separate list:

     one     the one-line answer. The info dot, and the answer search.
     chapter what it is and what it gives back. Two short paragraphs.
     page    the full explainer, for the handful of capabilities whose benefit is genuinely not
             obvious from the button. Why it is worth doing, what actually matters while you do it,
             how it works, and the payoff.

   NO OUTBOUND LINKS, ANYWHERE IN HERE. The reading room's carousel ends every article in a
   target="_blank" to /articles/<slug>/, which drops a one-handed parent onto the marketing site in
   a new tab and loses their place. A teaching page that does that has taught them to be careful
   about tapping things. So where a page has a matching article, its key points are pulled from
   reads-data.js and rendered INLINE as "the short version" — nothing to tap, nothing to leave, and
   still there when they come back.

   It reuses the log-guide overlay (CubbyGuide._mount/_paint/_shell) rather than standing up a
   second full-screen layer: one z-index, one stylesheet, one Escape handler. That also means it
   inherits the loss-safety refusal in mount(), which is the behaviour that matters most here.

   Everything drawn from this file mounts on document.body, never inside the app shell, so
   paintShell's diff cache stays valid and the #scroll node survives (iOS scroll momentum).
*/
(function () {
  'use strict';

  var CSS = ''
    + '#logGuide .tp-why{font-size:17px;line-height:1.55;font-weight:650;margin:2px 0 20px}'
    + '#logGuide .tp-lab{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:22px 0 10px}'
    + '#logGuide .tp-m{border:1.5px solid var(--line);background:var(--surface);border-radius:14px;padding:12px 14px;margin-bottom:9px}'
    + '#logGuide .tp-mh{font-size:14.5px;font-weight:800;margin-bottom:3px}'
    + '#logGuide .tp-mb{font-size:14px;line-height:1.5;color:var(--ink-soft);font-weight:600}'
    + '#logGuide .tp-how{list-style:none;margin:0;padding:0;counter-reset:tph}'
    + '#logGuide .tp-how li{counter-increment:tph;position:relative;padding:0 0 0 30px;margin-bottom:11px;font-size:14.5px;line-height:1.5;color:var(--ink-soft);font-weight:600}'
    + '#logGuide .tp-how li::before{content:counter(tph);position:absolute;left:0;top:0;width:21px;height:21px;border-radius:50%;background:var(--surface-2);color:var(--ink-soft);font-size:11.5px;font-weight:800;display:grid;place-items:center}'
    + '#logGuide .tp-pay{border-left:3px solid var(--feed);background:var(--surface);padding:13px 15px;border-radius:0 12px 12px 0;font-size:15px;line-height:1.5;font-weight:700;margin:22px 0 4px}'
    + '#logGuide .tp-short{border:1.5px solid var(--line);border-radius:14px;padding:4px 14px 12px;margin-top:8px;background:var(--surface)}'
    + '#logGuide .tp-sk{margin-top:11px}'
    + '#logGuide .tp-sh{font-size:14px;font-weight:800;margin-bottom:2px}'
    + '#logGuide .tp-ss{font-size:13.5px;line-height:1.5;color:var(--ink-soft);font-weight:600}'
    + '#logGuide .tp-src{font-size:12px;color:var(--ink-soft);font-weight:700;margin-top:12px;opacity:.8}'
    // the how-to index: native <details>, so open state, keyboard and reduced motion are free
    + '#logGuide .ht-dh{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:24px 0 9px}'
    + '#logGuide .ht-i{border:1.5px solid var(--line);background:var(--surface);border-radius:14px;margin-bottom:8px;overflow:hidden}'
    + '#logGuide .ht-i>summary{list-style:none;cursor:pointer;padding:12px 14px;min-height:44px;display:block}'
    + '#logGuide .ht-i>summary::-webkit-details-marker{display:none}'
    + '#logGuide .ht-i>summary::marker{content:""}'
    + '#logGuide .ht-t{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:800}'
    + '#logGuide .ht-t .ht-c{margin-left:auto;color:var(--ink-soft);font-size:13px;font-weight:800;transition:transform .18s ease}'
    + '#logGuide .ht-i[open] .ht-t .ht-c{transform:rotate(90deg)}'
    + '#logGuide .ht-o{font-size:13.5px;line-height:1.45;color:var(--ink-soft);font-weight:600;margin-top:3px}'
    + '#logGuide .ht-b{padding:0 14px 13px;border-top:1px solid var(--divider,var(--line))}'
    + '#logGuide .ht-w{font-size:14px;line-height:1.5;font-weight:700;margin:11px 0 6px}'
    + '#logGuide .ht-g{font-size:14px;line-height:1.5;color:var(--ink-soft);font-weight:600}'
    + '#logGuide .ht-more{margin-top:11px;border:none;border-radius:11px;padding:9px 15px;font-size:13.5px;font-weight:800;cursor:pointer;font-family:inherit;min-height:44px;background:var(--surface-2);color:var(--ink)}'
    + '#logGuide .ht-count{font-size:13px;color:var(--ink-soft);font-weight:600;margin:2px 0 0}'
    + '@media (prefers-reduced-motion: reduce){#logGuide .ht-i[open] .ht-t .ht-c{transition:none}}'
    // search
    + '#logGuide .ht-s{position:relative;margin:14px 0 2px}'
    + '#logGuide .ht-s input{width:100%;box-sizing:border-box;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);border-radius:13px;padding:13px 40px 13px 14px;font-family:inherit;font-size:16px;font-weight:600;min-height:44px}'
    + '#logGuide .ht-s input::placeholder{color:var(--ink-soft);font-weight:600}'
    + '#logGuide .ht-s input:focus{outline:2px solid var(--feed);outline-offset:1px}'
    + '#logGuide .ht-sx{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:none;background:none;color:var(--ink-soft);font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;display:none}'
    + '#logGuide .ht-s.has .ht-sx{display:block}'
    + '#logGuide .ht-none{font-size:14.5px;line-height:1.5;color:var(--ink-soft);font-weight:600;padding:18px 2px;display:none}'
    + '#logGuide .ht-hide{display:none}'
    // the monthly door
    + '#logGuide .md-in{font-size:16px;line-height:1.5;font-weight:650;margin:2px 0 18px;color:var(--ink-soft)}'
    + '#logGuide .md-r{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--surface);border:1.5px solid var(--line);border-radius:16px;padding:13px 14px;margin-bottom:9px;cursor:pointer;font-family:inherit;color:var(--ink);min-height:44px}'
    + '#logGuide .md-r:active{transform:scale(.985)}'
    + '#logGuide .md-m{flex:1;min-width:0}'
    + '#logGuide .md-t{display:block;font-size:15px;font-weight:800}'
    + '#logGuide .md-o{display:block;font-size:13px;font-weight:600;color:var(--ink-soft);line-height:1.4;margin-top:2px}'
    + '#logGuide .md-c{flex:0 0 auto;color:var(--ink-soft);font-size:15px;font-weight:800}'
    + '@media (prefers-reduced-motion: reduce){#logGuide .md-r:active{transform:none}}'
    /* COMPACT. A chapter is two short paragraphs. Given the full screen a page uses, it read as
       60% empty, which makes the app look like it ran out of things to say about its own feature.
       Inflating the copy to fill the screen would mean inventing content, so the presentation
       shrinks to fit the content instead: a centred dialog that ends where the words end. */
    + '#logGuide.lg-compact{background:rgba(0,0,0,.34);backdrop-filter:blur(2px);display:grid;place-items:center;padding:20px}'
    + '#logGuide.lg-compact .lg-top{position:absolute;top:0;right:0;left:0}'
    + '#logGuide.lg-compact .lg-body{flex:0 1 auto;max-width:360px;width:100%;max-height:78vh;background:var(--surface);border-radius:20px;padding:22px 20px 20px;box-shadow:0 18px 44px rgba(0,0,0,.22);animation:lgPop .22s ease}'
    + '#logGuide.lg-compact .lg-foot{display:none}'
    + '#logGuide.lg-compact .lg-h{font-size:23px;margin-bottom:10px}'
    + '#logGuide.lg-compact .lg-acts{margin-top:20px}'
    + '@keyframes lgPop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}'
    + '@media (prefers-reduced-motion: reduce){#logGuide.lg-compact .lg-body{animation:none}}';

  function G() { return window.CubbyGuide; }
  function rows() { return (window.CubbyTeachData && window.CubbyTeachData.rows) || {}; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function injectCss() {
    if (document.getElementById('tpCSS')) return;
    var st = document.createElement('style');
    st.id = 'tpCSS';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* The article's own key points, inline. reads-data.js already carries them as k:[{h,s}], which
     is why this costs no new content and cannot drift from the article. */
  function shortVersion(slug) {
    if (!slug || !window.READS) return '';
    var found = null;
    Object.keys(window.READS).forEach(function (g) {
      (window.READS[g] || []).forEach(function (r) { if (r.s === slug) found = r; });
    });
    if (!found || !found.k || !found.k.length) return '';
    var pts = found.k.slice(0, 4).map(function (p) {
      return '<div class="tp-sk"><div class="tp-sh">' + esc(p.h) + '</div>'
        + '<div class="tp-ss">' + esc(p.s) + '</div></div>';
    }).join('');
    return '<div class="tp-lab">The short version</div><div class="tp-short">' + pts
      + '<div class="tp-src">From Cubby\'s guide to ' + esc(String(found.t || '').toLowerCase()) + '</div></div>';
  }

  // The full explainer. Reached from an info dot, from the guide, or from a cue the parent tapped.
  function page(id) {
    var r = rows()[id];
    if (!r || r.depth !== 'page') return;
    var g = G();
    if (!g || !g._mount(r.label)) return;      // mount() carries the loss-safety refusal
    injectCss();

    var body = '<div class="lg-h">' + esc(r.label) + '</div>'
      + '<div class="tp-why">' + esc(r.why) + '</div>'
      + '<div class="tp-lab">What matters</div>'
      + (r.matters || []).map(function (m) {
          return '<div class="tp-m"><div class="tp-mh">' + esc(m[0]) + '</div>'
            + '<div class="tp-mb">' + esc(m[1]) + '</div></div>';
        }).join('')
      + '<div class="tp-lab">How it works</div>'
      + '<ul class="tp-how">' + (r.how || []).map(function (h) {
          return '<li>' + esc(h) + '</li>';
        }).join('') + '</ul>'
      + '<div class="tp-pay">' + esc(r.payoff) + '</div>'
      + shortVersion(r.read)
      + '<div class="lg-acts">'
      + '<button class="lg-try" style="background:var(--feed);color:var(--on-feed,var(--on-accent))" '
      + 'onclick="CubbyTeachUI.go(\'' + id + '\')">' + esc(actionLabel(r)) + '</button>'
      + '<button class="lg-read" onclick="CubbyGuide.close()">Close</button>'
      + '</div>';

    g._paint(g._shell(g._topClose(), body, 'You can log as much or as little as you like.'));
    if (window.CubbyTeach) window.CubbyTeach.markSeen(id);   // pull and push share one seen key
  }

  function actionLabel(r) {
    if (r.domain === 'circle') return 'Open ' + r.label.toLowerCase();
    return 'Try it';
  }

  function go(id) {
    var r = rows()[id];
    if (!r) return;
    if (G()) G().close();
    var name = String(r.fn || '').replace(/\(.*$/, '');
    if (name && typeof window[name] === 'function') window[name]();
    else if (typeof window.toast === 'function') window.toast('That one is not available here');
  }

  /* The quiet circled i. Same affordance the guide already uses, pointed at a registry row.
     stopPropagation so it can sit inside a row that is itself tappable. */
  function dot(id, label) {
    var r = rows()[id];
    if (!r) return '';
    var fn = r.depth === 'page' ? 'CubbyTeachUI.page'
           : r.depth === 'chapter' ? 'CubbyTeachUI.chapter' : 'CubbyTeachUI.brief';
    return '<button class="lg-i" onclick="event.stopPropagation();' + fn + '(\'' + id + '\')" '
      + 'aria-label="' + esc('What is this? ' + (label || r.label)) + '">i</button>';
  }

  /* A chapter: what it is, and what it gives back. Two short paragraphs and the real action.
     THIS USED TO BE A TOAST. The dot on a chapter row fired brief(), which flashed the one-line
     answer and vanished, so the what/get written for all 48 of them was reachable only through the
     How to use Cubby list and never from the thing itself. A parent tapping the dot beside Quick log
     got a sentence they had already read on the button, which teaches them the dot is not worth
     tapping. Same overlay as a page, less in it, because a chapter genuinely has less to say. */
  function chapter(id) {
    var r = rows()[id];
    if (!r || !r.what || !r.get) return brief(id);      // no content: do not open an empty screen
    var g = G();
    if (!g || !g._mount(r.label)) return;               // carries the loss-safety refusal
    injectCss();
    var body = '<div class="lg-h">' + esc(r.label) + '</div>'
      + '<div class="lg-what">' + esc(r.what) + '</div>'
      + '<div class="lg-get">' + esc(r.get) + '</div>'
      + shortVersion(r.read)
      + '<div class="lg-acts">'
      + '<button class="lg-try" style="background:var(--feed);color:var(--on-feed,var(--on-accent))" '
      + 'onclick="CubbyTeachUI.go(\'' + id + '\')">' + esc(actionLabel(r)) + '</button>'
      + '<button class="lg-read" onclick="CubbyGuide.close()">Close</button>'
      + '</div>';
    var ov = document.getElementById('logGuide');
    if (ov) ov.classList.add('lg-compact');       // shrink the frame to the content, not the reverse
    g._paint(g._shell(g._topClose(), body, ''));
    if (window.CubbyTeach) window.CubbyTeach.markSeen(id);
  }

  // The shallow answer, for a one-liner. There is nothing behind it, so a toast is the honest
  // shape: taking a whole screen to repeat one sentence teaches people to stop tapping the dot.
  function brief(id) {
    var r = rows()[id];
    if (!r) return;
    if (window.CubbyTeach) window.CubbyTeach.markSeen(id);
    if (typeof window.toast === 'function') window.toast(r.one);
  }

  /* An earned cue, drawn as a home card.
     THE DECISION IS MADE ONCE PER SESSION, NOT ONCE PER RENDER. ask() spends the allowance as a
     side effect, and render() runs many times per session — so asking inside the template would
     let two renders in one frame pick two different cues and flicker between them, and would burn
     the day's allowance on a paint the parent never saw. */
  var _chosen = null, _decided = false, _door = false;
  function homeCue() {
    if (!window.CubbyTeach) return '';
    if (!_decided) {
      var best = window.CubbyTeach.eligible()[0];
      _chosen = (best && window.CubbyTeach.ask(best)) ? best : null;
      /* The door only gets a look in when nothing the parent's own data earned is waiting. It is
         the long tail, not the urgent thing, and it can afford to wait another day. */
      _door = !_chosen && window.CubbyTeach.doorDue()
        && window.CubbyTeach.askMark('monthly-door');
      _decided = true;
    }
    if (_chosen) return cueCard(_chosen);
    if (_door) return doorCard();
    return '';
  }

  /* ---- the monthly door ------------------------------------------------------------------------
     One card a month, opening one screen of things this parent has not met. One interruption
     spent, six to eight taught, which is how the 44 rows that carry no trigger get reached at all
     without spending 44 more interruptions on them. */
  function doorCard() {
    return '<div class="coach"><div class="cm-ico">🐻</div>'
      + '<div class="cm-body"><div class="cm-t">A few things you have not met yet</div>'
      + '<div class="cm-s">Cubby can do a little more than you have needed so far. Here is what might be worth knowing now.</div>'
      + '<button class="btn-primary" style="margin-top:9px;padding:8px 14px;font-size:13px" '
      + 'onclick="CubbyTeachUI.door()">Have a look</button></div>'
      + '<button class="cm-x" onclick="CubbyTeachUI.dismissDoor()">Not now</button></div>';
  }

  function door() {
    var T = window.CubbyTeach;
    if (!T) return;
    var ids = T.unmet(8);
    if (!ids.length) return;
    var g = G();
    if (!g || !g._mount('A few things you have not met yet')) return;
    injectCss();
    var R = rows();
    var body = '<div class="lg-h">A few things you have not met yet</div>'
      + '<div class="md-in">Nothing here needs doing. It is only that Cubby holds more than the part you have needed so far.</div>'
      + ids.map(function (id) {
          var fn = R[id].depth === 'page' ? 'CubbyTeachUI.page'
                 : R[id].depth === 'chapter' ? 'CubbyTeachUI.chapter' : 'CubbyTeachUI.brief';
          return '<button class="md-r" onclick="' + fn + '(\'' + id + '\')">'
            + '<span class="md-m"><span class="md-t">' + esc(R[id].label) + '</span>'
            + '<span class="md-o">' + esc(R[id].one) + '</span></span>'
            + '<span class="md-c" aria-hidden="true">›</span></button>';
        }).join('')
      + '<div class="lg-acts"><button class="lg-read" onclick="CubbyGuide.close()">Close</button></div>';
    g._paint(g._shell(g._topClose(), body, 'All of this also lives in Settings, under How to use Cubby.'));
    /* Marked here rather than when the card was drawn: a card nobody opened has shown nobody
       anything, and should not cost them a month. */
    T.markDoor(ids);
  }

  // Dismissing without opening still costs the month, or the same card returns tomorrow.
  function dismissDoor() {
    if (window.CubbyTeach) window.CubbyTeach.markDoor([]);
    _door = false;
    if (typeof window.render === 'function') window.render();
  }

  function cueCard(id) {
    var r = rows()[id];
    if (!r) return '';
    var act = r.depth === 'page' ? 'CubbyTeachUI.page(\'' + id + '\')' : 'CubbyTeachUI.go(\'' + id + '\')';
    return '<div class="coach"><div class="cm-ico">🐻</div>'
      + '<div class="cm-body"><div class="cm-t">' + esc(r.label) + '</div>'
      + '<div class="cm-s">' + esc(r.one) + '</div>'
      + '<button class="btn-primary" style="margin-top:9px;padding:8px 14px;font-size:13px" '
      + 'onclick="' + act + '">Show me</button></div>'
      + '<button class="cm-x" onclick="CubbyTeachUI.dismiss(\'' + id + '\')">Not now</button></div>';
  }

  // Dismissing is as final as reading. The cue has had its turn and does not get another, this
  // session or ever, which is the difference between a cue and a nag.
  function dismiss(id) {
    if (window.CubbyTeach) window.CubbyTeach.markSeen(id);
    _chosen = null; _decided = true;
    if (typeof window.render === 'function') window.render();
  }

  /* ---- "How to use Cubby": one browsable index of everything ------------------------------------
     Everything the app can do, grouped, collapsed, and answerable without leaving the screen. Built
     on native <details> so the open state, keyboard access and reduced motion all come for free
     rather than being re-implemented badly in JS.

     PULL ONLY. It never opens itself and costs nothing from the allowance. It does honour `who`,
     because a caregiver browsing a full list and finding "How are you, in yourself?" would learn
     that a private record exists, and that is most of the harm already done.

     Opening a row does NOT mark it seen. Reading one line about a feature is not the same as having
     been taught it, and marking it would silently cancel a nudge that had something more to say. */
  var DOMAIN_ORDER = ['log', 'health', 'preg', 'trying', 'circle', 'memories', 'account'];
  var DOMAIN_NAME = {
    log: 'Everyday logging', health: 'Health and getting ready for the doctor',
    preg: 'While you are expecting', trying: 'While you are trying',
    circle: 'Sharing, and what stays private', memories: 'Photos and keepsakes',
    account: 'Your account and your data'
  };
  /* A group is named for the reader in front of it, not for the stage the rows were written in.
     Pregnancy rows can outlive the pregnancy: blood pressure still matters in the weeks after a
     birth, so that row stays browsable, and the fixed heading then told a woman nine days
     postpartum she was expecting, directly above a line saying she is not. Only the preg group
     does this, and only once she has had the baby. */
  function domainName(dom) {
    if (dom === 'preg') {
      var st = '';
      try { st = (typeof window.cubbyTeachCtx === 'function' ? window.cubbyTeachCtx() : {}).stage || ''; } catch (e) {}
      if (st && st !== 'pregnancy') return 'From your pregnancy, still yours';
    }
    return DOMAIN_NAME[dom] || dom;
  }

  /* Search over everything, so a question does not depend on guessing which group it lives under.
     Filtering happens in the DOM rather than by re-rendering: a re-render would collapse every open
     drawer and lose the caret, which is exactly what typing in a search field must not do.
     It matches the one-line answer and the chapter body too, not just the label, because a parent
     searches for their problem ("doctor", "nappy count", "who can see") rather than our nouns. */
  function howtoFilter(q) {
    var box = document.getElementById('htSearch');
    if (box) box.parentNode.classList.toggle('has', !!q);
    var n = String(q || '').toLowerCase().trim();
    var hits = 0;
    var items = document.querySelectorAll('#logGuide [data-teach]');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var hit = !n || el.getAttribute('data-teach').indexOf(n) !== -1;
      el.classList.toggle('ht-hide', !hit);
      if (hit) hits++;
      if (n && el.tagName === 'DETAILS') el.open = false;   // a filtered list should start closed
    }
    // A group heading with nothing under it is a dead line, so it goes too.
    var heads = document.querySelectorAll('#logGuide .ht-dh');
    for (var j = 0; j < heads.length; j++) {
      var any = false, sib = heads[j].nextElementSibling;
      while (sib && !sib.classList.contains('ht-dh')) {
        if (sib.hasAttribute && sib.hasAttribute('data-teach') && !sib.classList.contains('ht-hide')) { any = true; break; }
        sib = sib.nextElementSibling;
      }
      heads[j].classList.toggle('ht-hide', !any);
    }
    var none = document.getElementById('htNone');
    if (none) none.style.display = (n && !hits) ? 'block' : 'none';
    var count = document.getElementById('htCount');
    if (count) count.style.display = n ? 'none' : 'block';
  }
  function howtoClear() {
    var box = document.getElementById('htSearch');
    if (box) { box.value = ''; box.focus(); }
    howtoFilter('');
  }
  // Everything a row can be found by, lowercased once at render time rather than on every keystroke.
  function haystack(r) {
    return [r.label, r.one, r.what, r.get, r.why, r.payoff]
      .concat((r.matters || []).map(function (m) { return m[0] + ' ' + m[1]; }))
      .filter(Boolean).join(' ').toLowerCase();
  }

  function item(id) {
    var r = rows()[id];
    var body;
    if (r.depth === 'page') {
      body = '<div class="ht-w">' + esc(r.why) + '</div>'
        + '<button class="ht-more" onclick="CubbyTeachUI.page(\'' + id + '\')">The whole thing ›</button>';
    } else if (r.depth === 'chapter') {
      body = '<div class="ht-w">' + esc(r.what) + '</div><div class="ht-g">' + esc(r.get) + '</div>';
    } else {
      return '';   // a one-liner is already fully shown in the summary. An empty drawer is a dead tap.
    }
    return '<details class="ht-i" data-teach="' + esc(haystack(r)) + '"><summary>'
      + '<span class="ht-t">' + esc(r.label) + '<span class="ht-c" aria-hidden="true">›</span></span>'
      + '<span class="ht-o">' + esc(r.one) + '</span></summary>'
      + '<div class="ht-b">' + body + '</div></details>';
  }

  // A one-liner has nothing behind it, so it renders as a plain row rather than a drawer that opens
  // onto the same sentence you just read.
  function flat(id) {
    var r = rows()[id];
    return '<div class="ht-i" data-teach="' + esc(haystack(r)) + '" style="padding:12px 14px">'
      + '<span class="ht-t">' + esc(r.label) + '</span>'
      + '<span class="ht-o">' + esc(r.one) + '</span></div>';
  }

  function howto() {
    var g = G();
    if (!g || !g._mount('How to use Cubby')) return;   // carries the loss-safety refusal
    injectCss();
    var ids = window.CubbyTeach ? window.CubbyTeach.visible() : Object.keys(rows());
    var R = rows(), body = '<div class="lg-h">How to use Cubby</div>'
      + '<div class="lg-sub">Everything Cubby can do, and what each one gives you back. Nothing here will ever open itself.</div>'
      + '<div class="ht-s"><input id="htSearch" type="search" inputmode="search" autocomplete="off"'
      + ' placeholder="Search: nappies, doctor, who can see…"'
      + ' aria-label="Search everything Cubby can do"'
      + ' oninput="CubbyTeachUI.howtoFilter(this.value)">'
      + '<button class="ht-sx" type="button" aria-label="Clear search" onclick="CubbyTeachUI.howtoClear()">✕</button></div>'
      + '<div class="ht-none" id="htNone">Nothing matches that. Try a plainer word: the search looks at what each thing is for, not only its name.</div>';
    var shown = 0;
    DOMAIN_ORDER.forEach(function (dom) {
      var inDom = ids.filter(function (id) { return R[id].domain === dom; });
      if (!inDom.length) return;
      // deepest first: the ones worth explaining lead, the one-liners settle underneath
      var rank = { page: 0, chapter: 1, one: 2 };
      inDom.sort(function (a, b) {
        return (rank[R[a].depth] - rank[R[b].depth]) || (R[a].label < R[b].label ? -1 : 1);
      });
      body += '<div class="ht-dh">' + esc(domainName(dom)) + '</div>'
        + inDom.map(function (id) {
            shown++;
            return R[id].depth === 'one' ? flat(id) : item(id);
          }).join('');
    });
    body += '<div class="ht-count" id="htCount">' + shown + ' things Cubby can do, on this screen.</div>';
    g._paint(g._shell(g._topClose(), body, 'You can log as much or as little as you like.'));
  }

  // The permanent door in Settings. Never retires, every stage, every member.
  function settingsRow() {
    var chev = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    return '<div class="set-item" onclick="CubbyTeachUI.howto()" style="cursor:pointer">'
      + '<div class="si-ico" style="background:var(--feed-soft);color:var(--feed);font-size:18px">📖</div>'
      + '<div class="si-body"><div class="a">How to use Cubby</div>'
      + '<div class="b">Every feature, what it is for, and what it gives you back</div></div>'
      + '<span class="chev">' + chev + '</span></div>';
  }

  /* ---- an entry point on every bottom sheet ----------------------------------------------------
     openSheet is the one primitive every sheet in the app goes through, and each sheet renders its
     own <h2>. So matching that title against the registry gives all of them a contextual answer
     with no call-site edits at all.

     Matching by normalised label is only safe because no two rows share one: the gate asserts that,
     so a match can never be ambiguous. Anything unmatched gets NO dot, which is the correct answer
     for the confirmations ("Delete this entry?", "Log out?", "Stop tracking?") that make up most of
     the misses. A missing dot costs nothing; a dot onto the wrong capability costs trust.

     It also honours `who`, so a caregiver opening a sheet never gets an affordance pointing at a
     record that is supposed to be private to the owner. */
  var _labelMap = null, _akaList = null;
  function normLabel(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      .replace(/&amp;/g, '&').replace(/[^a-z0-9 &]/g, '').replace(/\s+/g, ' ').trim();
  }
  function labelMap() {
    if (_labelMap) return _labelMap;
    _labelMap = {};
    var R = rows();
    for (var id in R) {
      if (!Object.prototype.hasOwnProperty.call(R, id)) continue;
      var n = normLabel(R[id].label);
      if (n) _labelMap[n] = id;
    }
    return _labelMap;
  }

  /* Some sheets build their heading from data: "Aanya's stage", "A photo with Nana". Those can
     never match a fixed label, so a row may declare explicit alternates. Deliberately narrow: only
     strings a row opted into, only tried after an exact match fails, and the gate asserts no
     alternate is a substring of any other row's label or alternate, so this cannot quietly start
     matching the wrong sheet as the registry grows. */
  function akaMatch(title) {
    if (!title) return '';
    if (!_akaList) {
      _akaList = [];
      var R = rows();
      for (var id in R) {
        if (!Object.prototype.hasOwnProperty.call(R, id)) continue;
        (R[id].aka || []).forEach(function (a) { _akaList.push([normLabel(a), id]); });
      }
    }
    for (var i = 0; i < _akaList.length; i++) {
      if (_akaList[i][0] && title.indexOf(_akaList[i][0]) !== -1) return _akaList[i][1];
    }
    return '';
  }

  // Given a sheet's html, return it with a dot inside the first <h2>, or unchanged.
  function sheetDot(html) {
    try {
      if (!html || html.indexOf('<h2') === -1) return html;
      var m = html.match(/<h2([^>]*)>([\s\S]*?)<\/h2>/);
      if (!m) return html;
      if (m[2].indexOf('class="lg-i"') !== -1) return html;        // already carries one
      var title = normLabel(m[2].replace(/<[^>]*>/g, ''));
      var id = labelMap()[title] || akaMatch(title);
      if (!id) return html;
      if (window.CubbyTeach && window.CubbyTeach.visible().indexOf(id) === -1) return html;
      var d = dot(id);
      if (!d) return html;
      return html.replace(m[0], '<h2' + m[1] + '>' + m[2] + d + '</h2>');
    } catch (e) { return html; }
  }

  window.CubbyTeachUI = {
    page: page, chapter: chapter, brief: brief, dot: dot, go: go, sheetDot: sheetDot,
    cueCard: cueCard, homeCue: homeCue, dismiss: dismiss,
    howto: howto, settingsRow: settingsRow,
    howtoFilter: howtoFilter, howtoClear: howtoClear,
    door: door, doorCard: doorCard, dismissDoor: dismissDoor,
    _shortVersion: shortVersion, _haystack: haystack
  };
})();
