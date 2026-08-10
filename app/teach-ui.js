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
    + '@media (prefers-reduced-motion: reduce){#logGuide .ht-i[open] .ht-t .ht-c{transition:none}}';

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
    var fn = r.depth === 'page' ? 'CubbyTeachUI.page' : 'CubbyTeachUI.brief';
    return '<button class="lg-i" onclick="event.stopPropagation();' + fn + '(\'' + id + '\')" '
      + 'aria-label="' + esc('What is this? ' + (label || r.label)) + '">i</button>';
  }

  // The shallow answer, for rows that do not warrant a page. A toast, because one line does not
  // deserve a full screen and taking one over would teach people to stop tapping the dot.
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
  var _chosen = null, _decided = false;
  function homeCue() {
    if (!window.CubbyTeach) return '';
    if (!_decided) {
      var best = window.CubbyTeach.eligible()[0];
      _chosen = (best && window.CubbyTeach.ask(best)) ? best : null;
      _decided = true;
    }
    return _chosen ? cueCard(_chosen) : '';
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
    return '<details class="ht-i"><summary>'
      + '<span class="ht-t">' + esc(r.label) + '<span class="ht-c" aria-hidden="true">›</span></span>'
      + '<span class="ht-o">' + esc(r.one) + '</span></summary>'
      + '<div class="ht-b">' + body + '</div></details>';
  }

  // A one-liner has nothing behind it, so it renders as a plain row rather than a drawer that opens
  // onto the same sentence you just read.
  function flat(id) {
    var r = rows()[id];
    return '<div class="ht-i" style="padding:12px 14px">'
      + '<span class="ht-t">' + esc(r.label) + '</span>'
      + '<span class="ht-o">' + esc(r.one) + '</span></div>';
  }

  function howto() {
    var g = G();
    if (!g || !g._mount('How to use Cubby')) return;   // carries the loss-safety refusal
    injectCss();
    var ids = window.CubbyTeach ? window.CubbyTeach.visible() : Object.keys(rows());
    var R = rows(), body = '<div class="lg-h">How to use Cubby</div>'
      + '<div class="lg-sub">Everything Cubby can do, and what each one gives you back. Nothing here will ever open itself.</div>';
    var shown = 0;
    DOMAIN_ORDER.forEach(function (dom) {
      var inDom = ids.filter(function (id) { return R[id].domain === dom; });
      if (!inDom.length) return;
      // deepest first: the ones worth explaining lead, the one-liners settle underneath
      var rank = { page: 0, chapter: 1, one: 2 };
      inDom.sort(function (a, b) {
        return (rank[R[a].depth] - rank[R[b].depth]) || (R[a].label < R[b].label ? -1 : 1);
      });
      body += '<div class="ht-dh">' + esc(DOMAIN_NAME[dom] || dom) + '</div>'
        + inDom.map(function (id) {
            shown++;
            return R[id].depth === 'one' ? flat(id) : item(id);
          }).join('');
    });
    body += '<div class="ht-count">' + shown + ' things Cubby can do, on this screen.</div>';
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

  window.CubbyTeachUI = {
    page: page, brief: brief, dot: dot, go: go,
    cueCard: cueCard, homeCue: homeCue, dismiss: dismiss,
    howto: howto, settingsRow: settingsRow,
    _shortVersion: shortVersion
  };
})();
