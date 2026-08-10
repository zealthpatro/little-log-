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
    + '#logGuide .tp-src{font-size:12px;color:var(--ink-soft);font-weight:700;margin-top:12px;opacity:.8}';

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

  window.CubbyTeachUI = {
    page: page, brief: brief, dot: dot, go: go,
    cueCard: cueCard, homeCue: homeCue, dismiss: dismiss,
    _shortVersion: shortVersion
  };
})();
