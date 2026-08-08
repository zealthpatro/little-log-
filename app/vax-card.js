/* Cubby — "Add what they have already had", from the paper card.
   ------------------------------------------------------------------------------------------------
   The single biggest reason a parent arriving with an older baby abandons onboarding is typing in a
   dozen dated vaccine entries. So: photograph the card, check the rows, save.

   ON DEVICE ONLY, decided by the founder 2026-08-08. The photograph never leaves the phone. No
   upload, no Worker, no vision vendor. That keeps the promise the site already makes in words
   ("photos are not sent to any third-party image service", privacy/index.html) rather than
   rewriting it, and it is why this needed no privacy-policy change to ship.

   THE CONFIRMATION SCREEN IS THE FEATURE, not the reading. Cubby already holds the country schedule
   and the birthday, so this is a matching problem, not a transcription problem: for ~20 known rows
   you need a plausible date, constrained to after the birth, before today, and near the scheduled
   age. Where the device can read text we pre-fill; where it cannot, the same screen is a tidy table
   the parent fills from the card without leaving the app. Both paths end identically.

   NOTHING IS EVER WRITTEN WITHOUT THE PARENT LEAVING A DATE ON A ROW. No confidence threshold
   auto-saves, because a wrong vaccine date is a real harm and this is a medical record. The app
   already holds that line for voice logging.

   Free. PRO.md says never paywall safety or basics, and a vaccine record is both.
*/
(function () {
  'use strict';

  var CSS = ''
    + '#vaxCard{position:fixed;inset:0;z-index:100002;background:linear-gradient(160deg,var(--bg-grad-1),var(--bg-grad-2));display:flex;flex-direction:column;font-family:inherit;color:var(--ink)}'
    + '#vaxCard .vc-top{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 6px}'
    + '#vaxCard .vc-x{width:44px;height:44px;flex:0 0 auto;border:none;background:var(--surface-2);color:var(--ink-soft);border-radius:50%;font-size:15px;cursor:pointer;font-family:inherit}'
    + '#vaxCard .vc-sp{flex:1}'
    + '#vaxCard .vc-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 16px 10px}'
    + '#vaxCard .vc-h{font-family:"Fraunces",Georgia,serif;font-size:25px;line-height:1.2;font-weight:700;margin:4px 0 8px}'
    + '#vaxCard .vc-sub{font-size:15px;line-height:1.5;color:var(--ink-soft);font-weight:600;margin-bottom:14px}'
    + '#vaxCard .vc-shot{width:100%;max-height:34vh;object-fit:contain;border-radius:14px;border:1.5px solid var(--line);background:var(--surface-2);display:block;margin-bottom:6px}'
    + '#vaxCard .vc-zoom{font-size:12px;font-weight:800;color:var(--ink-soft);text-align:center;margin-bottom:14px}'
    + '#vaxCard .vc-lab{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:16px 0 8px}'
    + '#vaxCard .vc-row{display:flex;align-items:center;gap:10px;background:var(--surface);border:1.5px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:8px;min-height:44px}'
    + '#vaxCard .vc-rn{flex:1;min-width:0}'
    // Wraps rather than truncating: ellipsised, "Pneumococcal / PCV (1st dose)" and "(2nd dose)"
    // look identical, and on a transcription screen that is how the wrong date gets typed.
    + '#vaxCard .vc-rt{display:block;font-size:14.5px;font-weight:800;line-height:1.3}'
    + '#vaxCard .vc-rs{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);margin-top:1px}'
    + '#vaxCard .vc-d{flex:0 0 auto;width:140px;min-height:44px;border:1.5px solid var(--line);border-radius:11px;background:var(--surface-2);color:var(--ink);font-family:inherit;font-size:14px;font-weight:700;padding:8px 10px}'
    + '#vaxCard .vc-row.guess .vc-d{border-color:var(--star);background:var(--star-soft)}'
    + '#vaxCard .vc-row.done{opacity:.62}'
    + '#vaxCard .vc-foot{padding:10px 16px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--divider,var(--line));display:flex;flex-direction:column;gap:8px}'
    + '#vaxCard .vc-save{background:var(--diaper);color:var(--on-diaper,var(--on-accent));border:none;border-radius:15px;padding:15px 22px;font-size:15.5px;font-weight:800;cursor:pointer;font-family:inherit;min-height:44px}'
    + '#vaxCard .vc-ghost{background:none;border:none;color:var(--ink-soft);font-family:inherit;font-size:14px;font-weight:800;cursor:pointer;min-height:44px}'
    + '#vaxCard .vc-note{font-size:12.5px;font-weight:600;color:var(--ink-soft);text-align:center;line-height:1.45}';

  var ctxFn = function () { return (typeof window.cubbyVaxCtx === 'function') ? window.cubbyVaxCtx() : null; };
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ymd(ms) { var d = new Date(ms); var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  /* Schedules store fractional months (the NHS 8-week dose is 1.84), so printing dueMonths raw gave
     rows reading "due at about 1.84 months". Under three months a card is written in WEEKS, which is
     also how every schedule in the world states these doses: 1.84 -> 8 weeks, 2.76 -> 12, 3.68 -> 16. */
  function dueLabel(mo) {
    if (mo == null) return '';
    if (mo <= 0.1) return 'due at birth';
    if (mo < 3) return 'due at about ' + Math.round(mo * 4.345) + ' weeks';
    if (mo < 24) return 'due at about ' + Math.round(mo) + ' months';
    var y = mo / 12;
    return 'due at about ' + (Math.round(y * 2) / 2) + ' years';
  }

  /* ---------- reading the card, where the device can ---------- */

  var MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

  /* Every plausible reading of every date-looking thing in the text, as candidate timestamps.
     D/M versus M/D is NOT guessed here: both are emitted and the caller picks using the schedule,
     which is the whole reason this is a matching problem rather than a parsing one. */
  function dateCandidates(text) {
    var out = [], m, re;
    re = /\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})\b/g;
    while ((m = re.exec(text))) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y > 60 ? 1900 : 2000;
      [[a, b], [b, a]].forEach(function (p) {           // dd/mm and mm/dd, both offered
        if (p[1] >= 1 && p[1] <= 12 && p[0] >= 1 && p[0] <= 31) {
          var d = new Date(y, p[1] - 1, p[0], 12, 0, 0, 0);
          if (d.getFullYear() === y && d.getMonth() === p[1] - 1 && d.getDate() === p[0]) out.push(d.getTime());
        }
      });
    }
    re = /\b(\d{1,2})\s*[-\s]?\s*([A-Za-z]{3,})\s*[-,\s]?\s*(\d{2,4})\b/g;
    while ((m = re.exec(text))) {
      var mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mo == null) continue;
      var yy = +m[3]; if (yy < 100) yy += yy > 60 ? 1900 : 2000;
      out.push(new Date(yy, mo, +m[1], 12, 0, 0, 0).getTime());
    }
    return out;
  }

  /* The tokens that actually identify a dose on a card. Three characters minimum, and matched on a
     word boundary rather than as a substring: "6-in-1" yielded the token "in", which matched inside
     the word "clinic" and happily attached a clinic's date stamp to a vaccine nobody had had. A row
     whose whole name is short tokens simply is not auto-filled, which is the safe way to be wrong. */
  function nameTokens(name) {
    return String(name || '').split(/[^A-Za-z0-9]+/).filter(function (w) { return w.length >= 3; })
      .map(function (w) { return w.toLowerCase(); });
  }
  function hasToken(hay, t) {
    try { return new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(hay); }
    catch (e) { return false; }
  }

  /* Match schedule rows to dates. A candidate wins on three things, in order: it sits on or next to
     a line mentioning the vaccine, it falls between the birthday and today, and it is near the age
     the dose is scheduled for. Anything that fails the middle test is discarded outright: a clinic
     stamp from before the baby was born is not a dose. */
  function matchRows(lines, rows, birth) {
    var joined = lines.map(function (l) { return l.toLowerCase(); });
    var out = {};
    rows.forEach(function (r) {
      if (r.given) return;
      var toks = nameTokens(r.name), best = null, bestScore = -1;
      lines.forEach(function (line, li) {
        var hay = joined[li] + ' ' + (joined[li + 1] || '');
        var hits = toks.filter(function (t) { return hasToken(hay, t); }).length;
        if (!hits) return;
        var cands = dateCandidates(line + ' ' + (lines[li + 1] || ''));
        cands.forEach(function (t) {
          if (t > Date.now()) return;
          if (birth && t < birth - 86400000) return;          // before they existed
          var offBy = Math.abs(t - r.dueAt) / 86400000;
          if (offBy > 420) return;                            // more than ~14 months off the schedule
          var score = hits * 100 - offBy;
          if (score > bestScore) { bestScore = score; best = t; }
        });
      });
      if (best) out[r.i] = best;
    });
    return out;
  }

  function readImage(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { resolve(''); };
      fr.readAsDataURL(file);
    });
  }

  /* On-device text detection where the platform offers it. Absent on most browsers in 2026, which is
     exactly why the manual table is the product and this is the accelerant. Always resolves, never
     throws, and is wrapped in a timeout so a slow or wedged detector can never leave a parent on a
     spinner (the Then & Now freeze is the cautionary tale in the UX audit). */
  function detectLines(dataUrl) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v || []); } };
      setTimeout(function () { finish([]); }, 8000);
      try {
        if (typeof window.TextDetector !== 'function') return finish([]);
        var img = new Image();
        img.onerror = function () { finish([]); };
        img.onload = function () {
          try {
            new window.TextDetector().detect(img).then(function (blocks) {
              var out = [];
              (blocks || []).forEach(function (b) {
                if (b && b.rawValue) String(b.rawValue).split(/\r?\n/).forEach(function (l) {
                  if (l.trim()) out.push(l.trim());
                });
              });
              finish(out);
            }).catch(function () { finish([]); });
          } catch (e) { finish([]); }
        };
        img.src = dataUrl;
      } catch (e) { finish([]); }
    });
  }

  /* ---------- the screen ---------- */

  var st = null;   // {shot, rows, guesses:{i:ms}, values:{i:'yyyy-mm-dd'}, read:bool}

  function node() { return document.getElementById('vaxCard'); }
  function close() {
    var o = node(); if (o) o.remove();
    document.removeEventListener('keydown', onKey);
    st = null;
  }
  function onKey(e) { if (e && (e.key === 'Escape' || e.key === 'Esc')) close(); }

  function mount() {
    if (!document.getElementById('vaxCardCSS')) {
      var s = document.createElement('style'); s.id = 'vaxCardCSS'; s.textContent = CSS;
      document.head.appendChild(s);
    }
    var o = node();
    if (!o) {
      o = document.createElement('div'); o.id = 'vaxCard';
      o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
      o.setAttribute('aria-label', 'Add vaccines from the card');
      document.body.appendChild(o);
      document.addEventListener('keydown', onKey);
    }
    return o;
  }

  function paint(html) { var o = mount(); o.innerHTML = html; var b = o.querySelector('.vc-body'); if (b) b.scrollTop = 0; }
  function top() { return '<div class="vc-top"><div class="vc-sp"></div><button class="vc-x" onclick="CubbyVaxCard.close()" aria-label="Close">✕</button></div>'; }

  // Native date inputs, deliberately, and this is the one place the custom in-sheet picker is not
  // the right standard: this is a transcription TABLE of up to ~25 rows being copied off a document,
  // where a keyboard and a tab key beat twenty-five modal calendars. Each field is still 44px.
  function rowHtml(r) {
    var v = st.values[r.i] || '';
    var guessed = st.guesses[r.i] && v === ymd(st.guesses[r.i]);
    var sub = r.given
      ? ('already recorded' + (r.estimated ? ', estimated' : ''))
      : (guessed ? 'read from the card, check it' : dueLabel(r.dueMonths));
    return '<div class="vc-row' + (guessed ? ' guess' : '') + (r.given ? ' done' : '') + '">'
      + '<span class="vc-rn"><span class="vc-rt">' + esc(r.name) + '</span><span class="vc-rs">' + esc(sub) + '</span></span>'
      + '<input class="vc-d" type="date" max="' + ymd(Date.now()) + '"' + (r.given ? ' disabled' : '')
      + ' value="' + esc(v) + '" aria-label="Date given for ' + esc(r.name) + '"'
      + ' onchange="CubbyVaxCard.setDate(' + r.i + ',this.value)">'
      + '</div>';
  }

  function screenConfirm() {
    var c = ctxFn(); if (!c) return;
    var pending = st.rows.filter(function (r) { return !r.given; });
    var done = st.rows.filter(function (r) { return r.given; });
    var nGuessed = Object.keys(st.guesses).length;
    var sub = st.read
      ? (nGuessed
          ? 'We filled in ' + nGuessed + ' date' + (nGuessed === 1 ? '' : 's') + ' we could read. Check every one against the card, fix anything wrong, and leave a row blank if they have not had it.'
          : 'We could not read the dates on this photo, so the card is pinned above for you to copy from. Leave a row blank if they have not had it.')
      : 'Fill in the dates from the card. Leave a row blank if they have not had it.';
    paint(top()
      + '<div class="vc-body">'
      + '<div class="vc-h">Check these against the card</div>'
      + '<div class="vc-sub">' + esc(sub) + '</div>'
      + (st.shot ? '<img class="vc-shot" src="' + st.shot + '" alt="The vaccination card you photographed">'
                 + '<div class="vc-zoom">Pinch to zoom the photo</div>' : '')
      + '<div class="vc-lab">' + esc(c.country) + '</div>'
      + pending.map(rowHtml).join('')
      + (done.length ? '<div class="vc-lab">Already recorded</div>' + done.map(rowHtml).join('') : '')
      + '</div>'
      + '<div class="vc-foot">'
      + '<button class="vc-save" onclick="CubbyVaxCard.save()">Save these to the schedule</button>'
      + '<div class="vc-note">Nothing is saved until you tap that.' + (st.shot ? ' The photo stays on your phone.' : '') + '</div>'
      + '</div>');
  }

  function setDate(i, v) { if (st) st.values[i] = v || ''; }

  function begin(withPhoto) {
    var c = ctxFn(); if (!c) { if (window.toast) window.toast('Add your baby first'); return; }
    st = { shot: '', rows: c.rows, guesses: {}, values: {}, read: false };
    c.rows.forEach(function (r) { if (r.given && r.givenAt) st.values[r.i] = ymd(r.givenAt); });
    if (!withPhoto) { screenConfirm(); return; }

    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      if (window.showLoader) window.showLoader('Reading the card');
      readImage(f).then(function (dataUrl) {
        if (!dataUrl) { if (window.hideLoader) window.hideLoader(); if (window.toast) window.toast('Could not open that photo'); return; }
        st.shot = dataUrl;
        return detectLines(dataUrl).then(function (lines) {
          st.read = true;
          if (lines.length) st.guesses = matchRows(lines, st.rows, c.birth);
          Object.keys(st.guesses).forEach(function (i) { st.values[i] = ymd(st.guesses[i]); });
          if (window.hideLoader) window.hideLoader();
          screenConfirm();
        });
      }).catch(function () {
        if (window.hideLoader) window.hideLoader();
        // A failed read is not an error state: the card is still the source, so go to the table.
        st.read = true; screenConfirm();
      });
    };
    inp.click();
  }

  function save() {
    if (!st) return;
    var entries = [];
    st.rows.forEach(function (r) {
      if (r.given) return;
      var v = st.values[r.i];
      if (!v) return;
      var t = new Date(v + 'T12:00').getTime();
      if (!t || isNaN(t)) return;
      entries.push({ i: r.i, at: t });
    });
    if (!entries.length) { if (window.toast) window.toast('Add a date to at least one row'); return; }
    var n = (typeof window.cubbyVaxCommit === 'function') ? window.cubbyVaxCommit(entries) : 0;
    var shot = st.shot;
    close();
    if (window.toast) window.toast(n ? ('Recorded ' + n + ' dose' + (n === 1 ? '' : 's') + ' 🐻') : 'Nothing to save');
    /* The photo is discarded. It was a transcription aid, and the dates are what mattered.
       Keeping it is offered ONLY if a real implementation exists, because a card carries a name, a
       date of birth and often a hospital number, and household photos are readable by the whole
       circle (firestore.rules). A button that says "keep it" and then keeps nothing would be worse
       than no button, so this stays dark until cubbyKeepCardPhoto is wired. */
    if (n && shot && typeof window.cubbyKeepCardPhoto === 'function' && typeof window.confirmSheet === 'function') {
      window.confirmSheet({
        title: 'Keep the card photo?',
        body: 'You do not need to. The dates are saved either way. If you keep it, everyone in your circle can see it.',
        confirmLabel: 'Keep it', cancelLabel: 'No thanks',
        onConfirm: function () { window.cubbyKeepCardPhoto(shot); }
      });
    }
  }

  function open() {
    var c = ctxFn();
    if (!c) { if (window.toast) window.toast('Add your baby first'); return; }
    mount();
    paint(top()
      + '<div class="vc-body">'
      + '<div class="vc-h">Add what ' + esc(c.babyName || 'they') + ' has already had</div>'
      + '<div class="vc-sub">Photograph their vaccination card and Cubby will try to read the dates, or fill them in yourself. Either way you check every line before anything is saved.</div>'
      + '<div class="vc-note" style="text-align:left">The photo is read on your phone and never leaves it.</div>'
      + '</div>'
      + '<div class="vc-foot">'
      + '<button class="vc-save" onclick="CubbyVaxCard.begin(true)">📷 Use a photo of the card</button>'
      + '<button class="vc-ghost" onclick="CubbyVaxCard.begin(false)">Fill it in myself</button>'
      + '</div>');
  }

  window.CubbyVaxCard = { open: open, close: close, begin: begin, save: save, setDate: setDate,
    // for tools/vaxcard_test.js
    _matchRows: matchRows, _dateCandidates: dateCandidates };
  window.cubbyOpenVaxCard = open;
})();
