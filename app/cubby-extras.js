/* ============================================================
   CUBBY EXTRAS
   - cubbyBear(): parametric SVG bear used as avatars
   - per-member + per-baby avatar variants (auto-assigned, changeable)
   - openBearPicker(): choose fur + accessory
   - custom warm time picker (replaces the native one)
   Loads after the app + store-firebase, talks to them via globals.
   ============================================================ */
(function () {
  /* ---------- colour helpers ---------- */
  function hx(n) { n = Math.max(0, Math.min(255, Math.round(n))); return ('0' + n.toString(16)).slice(-2); }
  function toRGB(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function lighten(hexc, amt) { var c = toRGB(hexc); return '#' + hx(c[0] + (255 - c[0]) * amt) + hx(c[1] + (255 - c[1]) * amt) + hx(c[2] + (255 - c[2]) * amt); }

  var FURS = ['#C4863F', '#9C6B3D', '#E0A96D', '#6E4E36', '#B8843A', '#D7B27E', '#8C8C8C', '#46403A'];
  var ACCS = ['none', 'glasses', 'bow', 'flower', 'cap', 'bowtie', 'headphones', 'crown'];
  var ACC_LABEL = { none: 'None', glasses: 'Glasses', bow: 'Bow', flower: 'Flower', cap: 'Beanie', bowtie: 'Bow tie', headphones: 'Headphones', crown: 'Crown' };

  function hashStr(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }
  function variantFor(seed) { var h = hashStr(seed); return { fur: FURS[h % FURS.length], acc: ACCS[Math.floor(h / FURS.length) % ACCS.length] }; }

  /* ---------- the bear ---------- */
  function accessory(acc, fur) {
    var D = '#42301F';
    switch (acc) {
      case 'glasses':
        return '<g fill="none" stroke="' + D + '" stroke-width="2.4"><circle cx="39" cy="53" r="8.5"/><circle cx="61" cy="53" r="8.5"/><path d="M47.5 53 h5"/></g>';
      case 'bow':
        return '<g fill="#E0719A"><path d="M50 23 L37 17 L37 31 Z"/><path d="M50 23 L63 17 L63 31 Z"/><circle cx="50" cy="24" r="4"/></g>';
      case 'flower':
        return '<g><g fill="#F2B6C6"><circle cx="71" cy="25" r="3.2"/><circle cx="75" cy="28" r="3.2"/><circle cx="73" cy="32" r="3.2"/><circle cx="68" cy="32" r="3.2"/><circle cx="66" cy="28" r="3.2"/></g><circle cx="70.6" cy="28.8" r="2.6" fill="#F4C84B"/></g>';
      case 'cap':
        return '<g><path d="M21 47 Q50 5 79 47 Z" fill="#5E6AA8"/><rect x="20" y="44" width="60" height="7" rx="3.5" fill="#4A5694"/><circle cx="50" cy="13" r="4.2" fill="#EEF1FF"/></g>';
      case 'bowtie':
        return '<g fill="#C0563E"><path d="M50 89 L39 84 L39 95 Z"/><path d="M50 89 L61 84 L61 95 Z"/><rect x="46.5" y="85" width="7" height="9" rx="2"/></g>';
      case 'headphones':
        return '<g><path d="M19 52 A31 31 0 0 1 81 52" fill="none" stroke="#3E3A36" stroke-width="4.5"/><rect x="13" y="50" width="11" height="17" rx="4.5" fill="#3E3A36"/><rect x="76" y="50" width="11" height="17" rx="4.5" fill="#3E3A36"/></g>';
      case 'crown':
        return '<path d="M35 30 L42 38 L50 27 L58 38 L65 30 L63 43 L37 43 Z" fill="#F4C84B" stroke="#E0A93B" stroke-width="1"/>';
      default: return '';
    }
  }

  function cubbyBear(o) {
    o = o || {};
    var fur = o.fur || FURS[0];
    var acc = o.acc || 'none';
    var bg = o.bg || lighten(fur, 0.74);
    var inner = lighten(fur, 0.6);
    var D = '#42301F';
    var dim = o.size ? ('width="' + o.size + '" height="' + o.size + '"') : 'width="100%" height="100%"';
    var s = '<svg ' + dim + ' viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:block">';
    s += '<circle cx="50" cy="50" r="50" fill="' + bg + '"/>';
    // ears
    s += '<circle cx="29" cy="31" r="12" fill="' + fur + '"/><circle cx="29" cy="31" r="6" fill="' + inner + '"/>';
    s += '<circle cx="71" cy="31" r="12" fill="' + fur + '"/><circle cx="71" cy="31" r="6" fill="' + inner + '"/>';
    // head
    s += '<circle cx="50" cy="56" r="30" fill="' + fur + '"/>';
    // blush
    s += '<ellipse cx="31" cy="66" rx="5.5" ry="3.6" fill="#E8927E" opacity=".45"/><ellipse cx="69" cy="66" rx="5.5" ry="3.6" fill="#E8927E" opacity=".45"/>';
    // muzzle
    s += '<ellipse cx="50" cy="64" rx="18" ry="14.5" fill="' + inner + '"/>';
    // eyes
    s += '<circle cx="39" cy="53" r="3.9" fill="' + D + '"/><circle cx="37.7" cy="51.7" r="1.3" fill="#fff"/>';
    s += '<circle cx="61" cy="53" r="3.9" fill="' + D + '"/><circle cx="59.7" cy="51.7" r="1.3" fill="#fff"/>';
    // nose + mouth
    s += '<ellipse cx="50" cy="60" rx="4.6" ry="3.4" fill="' + D + '"/>';
    s += '<path d="M50 63 v3 M50 66 q-4 4 -8 1 M50 66 q4 4 8 1" stroke="' + D + '" stroke-width="1.7" fill="none" stroke-linecap="round"/>';
    s += accessory(acc, fur);
    s += '</svg>';
    return s;
  }

  window.cubbyBear = cubbyBear;
  window.cubbyVariantFor = variantFor;

  window.memberAvatarSvg = function (uid, size) {
    var info = (window.LL && window.LL.memberInfo) || {};
    var m = info[uid] || {};
    var v = (m.avatar && m.avatar.fur) ? m.avatar : variantFor(uid || 'member');
    return cubbyBear({ fur: v.fur, acc: v.acc, size: size });
  };
  window.babyBearSvg = function (b, size) {
    if (!b) return '';
    var v = (b.avatar && b.avatar.fur) ? b.avatar : variantFor(b.id || b.name || 'baby');
    return cubbyBear({ fur: v.fur, acc: v.acc, size: size });
  };

  /* ---------- a small modal (independent of store-firebase's) ---------- */
  function cuModal(html) {
    cuClose();
    var ov = document.createElement('div'); ov.id = 'cuModalOv'; ov.className = 'cu-ov';
    ov.innerHTML = '<div class="cu-card">' + html + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) cuClose(); });
    return ov;
  }
  function cuClose() { var m = document.getElementById('cuModalOv'); if (m) m.remove(); }
  window.cuCloseModal = cuClose;
  window.cuModal = cuModal; // reused by the app's date picker so all pickers share one modal

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- avatar picker ---------- */
  var pickState = null; // {kind, id, fur, acc}

  function currentVariant(kind, id) {
    if (kind === 'member') {
      var m = (window.LL && window.LL.memberInfo && window.LL.memberInfo[id]) || {};
      return (m.avatar && m.avatar.fur) ? { fur: m.avatar.fur, acc: m.avatar.acc } : variantFor(id);
    }
    var b = (state.babies || []).filter(function (x) { return x.id === id; })[0];
    return (b && b.avatar && b.avatar.fur) ? { fur: b.avatar.fur, acc: b.avatar.acc } : variantFor(id);
  }

  window.openBearPicker = function (kind, id) {
    var v = currentVariant(kind, id);
    pickState = { kind: kind, id: id, fur: v.fur, acc: v.acc };
    renderPicker();
  };

  function renderPicker() {
    var p = pickState;
    var furs = FURS.map(function (f) {
      return '<button class="cu-sw' + (f === p.fur ? ' on' : '') + '" style="background:' + f + '" data-fur="' + f + '"></button>';
    }).join('');
    var accs = ACCS.map(function (a) {
      return '<button class="cu-acc' + (a === p.acc ? ' on' : '') + '" data-acc="' + a + '">' + esc(ACC_LABEL[a]) + '</button>';
    }).join('');
    cuModal(
      '<div class="cu-head"><h2>Choose a bear</h2><button id="cuX" class="cu-x">×</button></div>'
      + '<div class="cu-preview">' + cubbyBear({ fur: p.fur, acc: p.acc, size: 110 }) + '</div>'
      + '<div class="cu-label">Fur</div><div class="cu-swatches">' + furs + '</div>'
      + '<div class="cu-label">Accessory</div><div class="cu-accs">' + accs + '</div>'
      + '<button id="cuSave" class="cu-btn">Save</button>'
    );
    document.getElementById('cuX').onclick = cuClose;
    document.getElementById('cuSave').onclick = savePick;
    Array.prototype.forEach.call(document.querySelectorAll('.cu-sw'), function (b) {
      b.onclick = function () { pickState.fur = b.getAttribute('data-fur'); renderPicker(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.cu-acc'), function (b) {
      b.onclick = function () { pickState.acc = b.getAttribute('data-acc'); renderPicker(); };
    });
  }

  function savePick() {
    var p = pickState; if (!p) return;
    var avatar = { fur: p.fur, acc: p.acc };
    function finish() {
      cuClose();
      // The first-run identity sheet keeps its own bear preview (#llFrBear) open under this
      // picker; refresh it (and the local memberInfo it reads from) so the new bear shows at once
      // instead of waiting for the snapshot echo.
      if (p.kind === 'member') {
        try {
          var mi = window.LL && window.LL.memberInfo;
          if (mi) { mi[p.id] = mi[p.id] || {}; mi[p.id].avatar = avatar; }
          var fr = document.getElementById('llFrBear');
          if (fr && typeof window.memberAvatarSvg === 'function') fr.innerHTML = window.memberAvatarSvg(p.id, 84);
        } catch (e) {}
      }
      if (typeof render === 'function') render();
      if (typeof toast === 'function') toast('Avatar updated');
    }
    if (p.kind === 'member') {
      var btn = document.getElementById('cuSave');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      var done = false;
      function fail(e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        if (typeof toast === 'function') toast(window.cubbyErrText ? window.cubbyErrText(e, 'Could not save your bear just now. Mind trying again?') : 'Could not save your bear just now. Mind trying again?');
      }
      // Optimistic exit (same 6s pattern as the first-run sheet): the write lands in the local
      // cache immediately and syncs later, so the picker never hangs on a slow or absent network.
      var t = setTimeout(function () { if (done) return; done = true; finish(); }, 6000);
      try {
        var uid = window.LL.auth.currentUser.uid;
        var u = {}; u['memberInfo.' + uid + '.avatar'] = avatar;
        window.LL.db.collection('households').doc(window.LL.householdId).update(u)
          .then(function () { if (done) return; done = true; clearTimeout(t); finish(); })
          .catch(function (e) { if (done) return; done = true; clearTimeout(t); fail(e); });
      } catch (e) {
        // No signed-in user / local mode: nothing to save remotely, just close.
        if (!done) { done = true; clearTimeout(t); finish(); }
      }
    } else {
      var b = (state.babies || []).filter(function (x) { return x.id === p.id; })[0];
      if (b) { b.avatar = avatar; persist(); }
      finish();
    }
  }

  /* ---------- custom time picker (shared columns) ---------- */
  function pad(n) { return ('0' + n).slice(-2); }
  function to12(h24) { return { h: (h24 % 12) || 12, ap: h24 < 12 ? 'AM' : 'PM' }; }
  function to24(sel) { var h = sel.h % 12; if (sel.ap === 'PM') h += 12; return h; }

  function timeColsHTML(sel) {
    function col(id, items, cur, fmt) {
      return '<div class="cu-tcol" id="' + id + '">' + items.map(function (it) {
        return '<button class="cu-tcell' + (it === cur ? ' on' : '') + '" data-v="' + it + '">' + (fmt ? fmt(it) : it) + '</button>';
      }).join('') + '</div>';
    }
    var hours = []; for (var i = 1; i <= 12; i++) hours.push(i);
    var mins = []; for (var j = 0; j < 60; j++) mins.push(j);
    return '<div class="cu-time">' + col('cuH', hours, sel.h) + col('cuM', mins, sel.m, pad)
      + '<div class="cu-tcol cu-tap"><button class="cu-tcell' + (sel.ap === 'AM' ? ' on' : '') + '" data-ap="AM">AM</button>'
      + '<button class="cu-tcell' + (sel.ap === 'PM' ? ' on' : '') + '" data-ap="PM">PM</button></div></div>';
  }
  function wireTimeCols(sel, onChange) {
    function wire(colId, key) {
      var c = document.getElementById(colId); if (!c) return;
      var cells = c.querySelectorAll('.cu-tcell');
      Array.prototype.forEach.call(cells, function (b) {
        b.onclick = function () {
          Array.prototype.forEach.call(cells, function (x) { x.classList.remove('on'); });
          b.classList.add('on'); sel[key] = +b.getAttribute('data-v');
          if (onChange) onChange(); b.scrollIntoView({ block: 'center' });
        };
      });
      var on = c.querySelector('.cu-tcell.on'); if (on) on.scrollIntoView({ block: 'center' });
    }
    wire('cuH', 'h'); wire('cuM', 'm');
    Array.prototype.forEach.call(document.querySelectorAll('.cu-tap .cu-tcell'), function (b) {
      b.onclick = function () {
        document.querySelectorAll('.cu-tap .cu-tcell').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); sel.ap = b.getAttribute('data-ap'); if (onChange) onChange();
      };
    });
  }

  function openTimePicker(input) {
    var val = input.value || '', hh, mm;
    if (/^\d{1,2}:\d{2}$/.test(val)) { hh = +val.split(':')[0]; mm = +val.split(':')[1]; }
    else { var d = new Date(); hh = d.getHours(); mm = d.getMinutes(); }
    var t = to12(hh); var sel = { h: t.h, m: mm, ap: t.ap };
    cuModal('<div class="cu-head"><h2>Pick a time</h2><button id="cuX" class="cu-x">×</button></div>'
      + '<div class="cu-tdisp" id="cuTDisp">' + sel.h + ':' + pad(sel.m) + ' ' + sel.ap + '</div>'
      + timeColsHTML(sel) + '<button id="cuTDone" class="cu-btn">Done</button>');
    function disp() { document.getElementById('cuTDisp').textContent = sel.h + ':' + pad(sel.m) + ' ' + sel.ap; }
    wireTimeCols(sel, disp);
    document.getElementById('cuX').onclick = cuClose;
    document.getElementById('cuTDone').onclick = function () {
      input.value = pad(to24(sel)) + ':' + pad(sel.m);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      cuClose();
    };
  }
  window.openTimePicker = openTimePicker;

  /* ---------- unified "When?" picker (date + time) ---------- */
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayWord(y, mo, da) {
    var t = new Date(); var sd = new Date(y, mo, da);
    var t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    var diff = Math.round((sd - t0) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    if (diff === 1) return 'Tomorrow';
    return sd.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  window.openWhenPicker = function (ms, cb, title) {
    var d = ms ? new Date(ms) : new Date();
    var t12 = to12(d.getHours());
    var sel = { y: d.getFullYear(), mo: d.getMonth(), da: d.getDate(), h: t12.h, m: d.getMinutes(), ap: t12.ap };
    var view = { y: sel.y, mo: sel.mo }; // month shown in the inline calendar
    var MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function curLabel() { return dayWord(sel.y, sel.mo, sel.da) + ' · ' + sel.h + ':' + pad(sel.m) + ' ' + sel.ap; }
    // Inline calendar (reuses the app's .dp styles) instead of a native date input, so the date is
    // as crafted as the time wheels and handles any date (e.g. a born date months back).
    function calHTML() {
      var first = new Date(view.y, view.mo, 1).getDay();
      var days = new Date(view.y, view.mo + 1, 0).getDate();
      var tymd = ymd(new Date());
      var cells = '', i, dd;
      for (i = 0; i < first; i++) cells += '<span class="dp-c dp-bl"></span>';
      for (dd = 1; dd <= days; dd++) {
        var cymd = view.y + '-' + pad(view.mo + 1) + '-' + pad(dd);
        var isSel = (view.y === sel.y && view.mo === sel.mo && dd === sel.da);
        cells += '<button type="button" class="dp-c' + (isSel ? ' dp-on' : '') + (cymd === tymd ? ' dp-td' : '') + (cymd > tymd ? ' dp-x' : '') + '"' + (cymd > tymd ? ' disabled' : '') + ' data-d="' + dd + '">' + dd + '</button>';
      }
      return '<div class="dp dp-in-modal" id="cuCal">'
        + '<div class="dp-h"><button type="button" class="dp-nav" id="cuCalPrev">‹</button><span class="dp-t">' + MN[view.mo] + ' ' + view.y + '</span><button type="button" class="dp-nav" id="cuCalNext">›</button></div>'
        + '<div class="dp-w">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>'
        + '<div class="dp-g">' + cells + '</div></div>';
    }
    cuModal(
      '<div class="cu-head"><h2>' + esc(title || 'When?') + '</h2><button id="cuX" class="cu-x">×</button></div>'
      + '<div class="cu-tdisp" id="cuWDisp">' + curLabel() + '</div>'
      + '<div class="cu-daterow"><button class="cu-chip" data-day="0">Today</button><button class="cu-chip" data-day="-1">Yesterday</button></div>'
      + '<div id="cuCalWrap">' + calHTML() + '</div>'
      + timeColsHTML(sel) + '<button id="cuWDone" class="cu-btn">Done</button>'
    );
    function disp() { document.getElementById('cuWDisp').textContent = curLabel(); }
    function wireCal() {
      var prev = document.getElementById('cuCalPrev'), next = document.getElementById('cuCalNext');
      if (prev) prev.onclick = function () { view.mo--; if (view.mo < 0) { view.mo = 11; view.y--; } redrawCal(); };
      if (next) next.onclick = function () { view.mo++; if (view.mo > 11) { view.mo = 0; view.y++; } redrawCal(); };
      Array.prototype.forEach.call(document.querySelectorAll('#cuCal .dp-c'), function (b) {
        if (b.classList.contains('dp-bl') || b.disabled) return;
        b.onclick = function () {
          sel.y = view.y; sel.mo = view.mo; sel.da = +b.getAttribute('data-d');
          disp(); redrawCal(); // re-render so the selected-day highlight is always correct (no stale dp-on)
        };
      });
    }
    function redrawCal() { document.getElementById('cuCalWrap').innerHTML = calHTML(); wireCal(); }
    wireTimeCols(sel, disp);
    Array.prototype.forEach.call(document.querySelectorAll('.cu-chip'), function (b) {
      b.onclick = function () {
        var off = +b.getAttribute('data-day'); var dt = new Date(); dt.setDate(dt.getDate() + off);
        sel.y = dt.getFullYear(); sel.mo = dt.getMonth(); sel.da = dt.getDate(); view.y = sel.y; view.mo = sel.mo; disp(); redrawCal();
      };
    });
    wireCal();
    document.getElementById('cuX').onclick = cuClose;
    document.getElementById('cuWDone').onclick = function () {
      var out = new Date(sel.y, sel.mo, sel.da, to24(sel), sel.m, 0, 0).getTime();
      cuClose(); if (typeof cb === 'function') cb(out);
    };
  };

  // Native datetime-local -> the custom date+time "When?" picker (openWhenPicker), so the born
  // date and any datetime-local field match the diaper/nap picker instead of the OS widget.
  function openDateTimePicker(input) {
    var ms = input.value ? new Date(input.value).getTime() : Date.now();
    if (isNaN(ms)) ms = Date.now();
    window.openWhenPicker(ms, function (out) {
      var d = new Date(out);
      input.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'When?');
  }
  window.openDateTimePicker = openDateTimePicker;

  // Intercept native time AND datetime-local inputs everywhere (capture phase, before native UI),
  // so every time / date-time field uses the same custom picker as the diaper and nap flows.
  function intercept(e) {
    var t = e.target;
    if (t && t.tagName === 'INPUT' && (t.type === 'time' || t.type === 'datetime-local')) {
      e.preventDefault();
      if (!t.readOnly) t.setAttribute('readonly', 'readonly'); // stop native popup/keyboard
      t.blur();
      if (t.type === 'datetime-local') openDateTimePicker(t); else openTimePicker(t);
    }
  }
  document.addEventListener('mousedown', intercept, true);
  document.addEventListener('click', intercept, true);
  document.addEventListener('focusin', intercept, true);

  /* ---------- styles ---------- */
  var st = document.createElement('style');
  st.textContent =
    '.cu-ov{position:fixed;inset:0;z-index:100000;background:rgba(20,15,12,.5);display:flex;align-items:flex-end;justify-content:center;font-family:"Nunito Sans",system-ui,sans-serif;}'
    + '.cu-card{background:#fff;width:100%;max-width:440px;border-radius:22px 22px 0 0;padding:18px 20px 26px;max-height:88vh;overflow:auto;box-shadow:0 -8px 40px rgba(0,0,0,.25);}'
    + '@media(min-width:480px){.cu-ov{align-items:center;}.cu-card{border-radius:22px;}}'
    + '.cu-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}'
    + '.cu-head h2{font-family:"Fraunces",Georgia,serif;font-size:21px;margin:0;color:#2C2521;}'
    + '.cu-x{border:none;background:none;font-size:27px;line-height:1;color:#9a8d80;cursor:pointer;}'
    + '.cu-preview{width:110px;height:110px;margin:6px auto 14px;border-radius:50%;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.12);}'
    + '.cu-label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9a8d80;font-weight:700;margin:12px 0 8px;}'
    + '.cu-swatches{display:flex;flex-wrap:wrap;gap:10px;}'
    + '.cu-sw{width:38px;height:38px;border-radius:50%;border:3px solid transparent;cursor:pointer;}'
    + '.cu-sw.on{border-color:#2C2521;}'
    + '.cu-accs{display:flex;flex-wrap:wrap;gap:8px;}'
    + '.cu-acc{border:1px solid #E0D7C7;background:#FBF7EF;border-radius:999px;padding:8px 14px;font-size:13px;font-weight:600;color:#6E635B;cursor:pointer;font-family:inherit;}'
    + '.cu-acc.on{background:#C97FA0;color:#fff;border-color:#C97FA0;}'
    + '.cu-btn{border:none;border-radius:13px;padding:14px;font-size:16px;font-weight:700;background:#C97FA0;color:#fff;cursor:pointer;font-family:inherit;width:100%;margin-top:20px;}'
    + '.cu-tdisp{text-align:center;font-family:"Fraunces",Georgia,serif;font-size:30px;color:#2C2521;margin:4px 0 12px;}'
    + '.cu-time{display:flex;gap:10px;height:200px;}'
    + '.cu-tcol{flex:1;overflow-y:auto;scroll-behavior:smooth;background:#FBF7EF;border-radius:14px;padding:70px 0;-webkit-overflow-scrolling:touch;}'
    + '.cu-tap{flex:0 0 70px;}'
    + '.cu-tcell{display:block;width:100%;border:none;background:none;padding:11px 0;font-size:19px;color:#9a8d80;cursor:pointer;font-family:inherit;text-align:center;}'
    + '.cu-tcell.on{color:#2C2521;font-weight:800;background:rgba(201,127,160,.16);}'
    + '.cu-daterow{display:flex;gap:8px;align-items:center;margin:0 0 14px;flex-wrap:wrap;}'
    + '.cu-chip{border:1px solid #E0D7C7;background:#FBF7EF;border-radius:999px;padding:9px 14px;font-size:13px;font-weight:700;color:#6E635B;cursor:pointer;font-family:inherit;}'
    + '.time-strip{display:flex;align-items:center;gap:11px;background:var(--surface-2,#FBF7EF);border:1.5px solid var(--line,#E0D7C7);border-radius:14px;padding:12px 14px;margin:0 0 14px;cursor:pointer;}'
    + '.time-strip .ts-ico{color:var(--ink-soft,#9a8d80);display:flex;}.time-strip .ts-ico svg{width:20px;height:20px;}'
    + '.time-strip .ts-text{flex:1;display:flex;flex-direction:column;line-height:1.25;}'
    + '.time-strip .ts-cap{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft,#9a8d80);font-weight:700;}'
    + '.time-strip .ts-label{font-size:15px;font-weight:800;color:var(--ink,#2C2521);}'
    + '.time-strip .ts-edit{font-size:13px;font-weight:700;color:var(--star,#C97FA0);}'
    + '.visit-sum{white-space:pre-wrap;font-family:"Nunito Sans",ui-monospace,monospace;font-size:13px;line-height:1.5;background:var(--surface-2,#FBF7EF);border:1px solid var(--line,#E0D7C7);border-radius:12px;padding:14px;color:var(--ink,#2C2521);overflow-x:auto;margin:0 0 14px;}'
    + '.ll-rm{border:none;background:none;color:#C0563E;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;flex:0 0 auto;}'
    + '.gx-ctrl{display:flex;gap:8px;justify-content:space-between;margin:0 0 12px;flex-wrap:wrap;}'
    + '.gx-seg{display:inline-flex;background:var(--surface-2,#FBF7EF);border:1px solid var(--line,#E0D7C7);border-radius:10px;overflow:hidden;}'
    + '.gx-seg button{border:none;background:none;padding:7px 13px;font-size:12px;font-weight:800;color:var(--ink-soft,#9a8d80);cursor:pointer;font-family:inherit;}'
    + '.gx-seg button.on{background:var(--star,#C97FA0);color:#fff;}'
    + '.ll-fb{width:100%;min-height:120px;border:1px solid #E0D7C7;border-radius:12px;padding:12px;font-size:15px;font-family:inherit;resize:vertical;box-sizing:border-box;margin-bottom:12px;}'
    + '.greeting{font-family:var(--font-display),Georgia,serif;font-size:19px;font-weight:600;color:var(--ink,#2C2521);margin:2px 2px 2px;}'
    + '.greeting-sub{font-size:13px;color:var(--ink-soft,#9a8d80);font-weight:600;margin:0 2px 12px;}'
    + '.tip-line{display:flex;align-items:center;gap:10px;justify-content:space-between;background:var(--star-soft,#F6E1EC);border:1px solid var(--star,#C97FA0);border-radius:12px;padding:9px 12px;margin:0 0 12px;font-size:13px;color:var(--ink,#2C2521);font-weight:600;line-height:1.35;}'
    + '.tip-line button{border:none;background:rgba(0,0,0,.06);border-radius:8px;padding:5px 10px;font-size:12px;font-weight:800;color:var(--ink-soft,#6E635B);cursor:pointer;font-family:inherit;flex:0 0 auto;}'
    + '.gs-card{background:var(--surface,#fff);border:1px solid var(--line,#E0D7C7);border-radius:16px;padding:14px 16px;margin:0 0 16px;box-shadow:0 5px 14px var(--shadow,rgba(0,0,0,.06));}'
    + '.gs-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}'
    + '.gs-title{font-family:var(--font-display),Georgia,serif;font-size:17px;font-weight:600;color:var(--ink,#2C2521);}'
    + '.gs-x{border:none;background:none;font-size:22px;line-height:1;color:var(--ink-faint,#b3a99d);cursor:pointer;}'
    + '.gs-row{display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid var(--line,#efe6d6);cursor:pointer;}'
    + '.gs-row:first-of-type{border-top:none;}'
    + '.gs-check{flex:0 0 auto;width:22px;height:22px;border-radius:50%;border:2px solid var(--line,#E0D7C7);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:#fff;}'
    + '.gs-row.done .gs-check{background:var(--diaper,#56A08E);border-color:var(--diaper,#56A08E);}'
    + '.gs-row.done{cursor:default;}'
    + '.gs-body{flex:1;}'
    + '.gs-t{font-weight:800;font-size:14.5px;color:var(--ink,#2C2521);}'
    + '.gs-row.done .gs-t{color:var(--ink-soft,#9a8d80);text-decoration:line-through;}'
    + '.gs-s{font-size:12px;color:var(--ink-soft,#9a8d80);font-weight:600;margin-top:1px;}'
    + '.gs-go{flex:0 0 auto;color:var(--ink-faint,#b3a99d);}.gs-go svg{width:18px;height:18px;}'
    + '.pro-list{display:flex;flex-direction:column;gap:10px;margin:6px 0 16px;}'
    + '.pro-feat{display:flex;gap:12px;align-items:flex-start;background:var(--surface-2,#FBF7EF);border-radius:13px;padding:13px 14px;}'
    + '.pro-feat .pf-ico{font-size:20px;flex:0 0 auto;line-height:1.2;}'
    + '.pro-feat .pf-t{font-weight:800;font-size:14.5px;color:var(--ink,#2C2521);}'
    + '.pro-feat .pf-s{font-size:12.5px;color:var(--ink-soft,#9a8d80);font-weight:600;margin-top:2px;line-height:1.4;}'
    + '.pro-joined{text-align:center;background:var(--diaper-soft,#dff0ea);color:var(--diaper,#3f7d6c);font-weight:800;font-size:14px;padding:13px;border-radius:12px;}'
    + '.away-card{background:var(--feed-soft,#FBE8D8);border:1px solid var(--feed,#E29A3B);border-radius:14px;padding:13px 15px;margin:0 0 12px;cursor:pointer;}'
    + '.away-card .away-h{font-weight:800;font-size:13px;color:var(--ink-soft,#9a8d80);text-transform:uppercase;letter-spacing:.03em;}'
    + '.away-card .away-s{font-size:15px;color:var(--ink,#2C2521);font-weight:800;margin-top:3px;}'
    + '.away-card .away-by{font-size:12px;color:var(--ink-soft,#9a8d80);font-weight:600;margin-top:3px;}'
    + '.handoff-card{background:var(--surface,#fff);border:1px solid var(--line,#E0D7C7);border-radius:14px;padding:12px 15px;margin:0 0 12px;cursor:pointer;}'
    + '.handoff-card .ho-h{font-weight:800;font-size:13.5px;color:var(--ink,#2C2521);}'
    + '.handoff-card .ho-s{font-size:13px;color:var(--ink-soft,#6E635B);font-weight:600;margin-top:2px;line-height:1.4;}'
    + '.handoff-card.empty .ho-s{font-style:italic;}'
    + '.handoff-card .ho-by{font-size:11px;color:var(--ink-faint,#b3a99d);font-weight:700;margin-top:4px;}'
    + '.hm{margin-bottom:18px;}'
    + '.hm-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}'
    + '.hm-seg{display:inline-flex;background:var(--surface-2,#FBF7EF);border:1px solid var(--line,#E0D7C7);border-radius:9px;overflow:hidden;}'
    + '.hm-seg button{border:none;background:none;padding:5px 12px;font-size:12px;font-weight:800;color:var(--ink-soft,#9a8d80);cursor:pointer;font-family:inherit;}'
    + '.hm-seg button.on{background:var(--star,#C97FA0);color:#fff;}'
    + '.hm-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;}'
    + '.hm-label{width:54px;flex:0 0 54px;font-size:11px;font-weight:700;color:var(--ink-soft,#9a8d80);text-align:right;}'
    + '.hm-cells{display:flex;gap:3px;flex:1;}'
    + '.hm-cell{flex:1;height:22px;border-radius:5px;background:var(--surface-2,#FBF7EF);}'
    + '.hm-cell.empty{background:transparent;border:1px dashed var(--line,#E0D7C7);}'
    + '.hm-day{flex:1;text-align:center;font-size:10px;color:var(--ink-faint,#b3a99d);font-weight:700;}'
    + '.bear-av{overflow:hidden;padding:0!important;}.bear-av svg{width:100%;height:100%;display:block;}'
    + '.tl-byav{display:inline-block;width:16px;height:16px;border-radius:50%;overflow:hidden;vertical-align:middle;margin-right:5px;}.tl-byav svg{width:100%;height:100%;display:block;}'

    /* ---------- Night ----------
       The .cu-* modal (the shared date, time and bear-avatar sheet, so one of the most-opened
       surfaces in the app) was written as a hardcoded light card. It was readable, but it fired a
       full-brightness white sheet out of a dark app, which is the opposite of what someone logging
       a 3am feed needs. These are stated as Night overrides rather than as edits to the rules above
       so the light rendering is byte-for-byte what it already was.
       The calendar that renders INSIDE this card (.dp-in-modal) is themed alongside it in
       app/index.html; the two have to move together or the card flips and the dates stay dark. */
    + '[data-theme="night"] .cu-card{background:var(--card);}'
    + '[data-theme="night"] .cu-head h2,[data-theme="night"] .cu-tdisp{color:var(--ink);}'
    + '[data-theme="night"] .cu-x,[data-theme="night"] .cu-label{color:var(--ink-faint);}'
    + '[data-theme="night"] .cu-sw.on{border-color:var(--ink);}'
    + '[data-theme="night"] .cu-acc,[data-theme="night"] .cu-chip{background:var(--surface);border-color:var(--line);color:var(--ink-soft);}'
    + '[data-theme="night"] .cu-acc.on{background:var(--preg);border-color:var(--preg);color:var(--bg);}'
    + '[data-theme="night"] .cu-btn{background:var(--preg);color:var(--bg);}'
    + '[data-theme="night"] .cu-tcol{background:var(--surface);}'
    + '[data-theme="night"] .cu-tcell{color:var(--ink-faint);}'
    + '[data-theme="night"] .cu-tcell.on{color:var(--ink);background:var(--preg-soft);}'
    /* Two strays that were never tokenised at all: the remove link and the feedback box. */
    + '[data-theme="night"] .ll-rm{color:var(--danger);}'
    + '[data-theme="night"] .ll-fb{background:var(--surface);border-color:var(--line);color:var(--ink);}';
  document.head.appendChild(st);
})();
