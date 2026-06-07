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

  async function savePick() {
    var p = pickState; if (!p) return;
    var avatar = { fur: p.fur, acc: p.acc };
    if (p.kind === 'member') {
      try {
        var uid = window.LL.auth.currentUser.uid;
        var u = {}; u['memberInfo.' + uid + '.avatar'] = avatar;
        await window.LL.db.collection('households').doc(window.LL.householdId).update(u);
      } catch (e) { /* ignore */ }
    } else {
      var b = (state.babies || []).filter(function (x) { return x.id === p.id; })[0];
      if (b) { b.avatar = avatar; persist(); }
    }
    cuClose();
    if (typeof render === 'function') render();
    if (typeof toast === 'function') toast('Avatar updated');
  }

  /* ---------- custom time picker ---------- */
  function pad(n) { return ('0' + n).slice(-2); }

  function openTimePicker(input) {
    var val = input.value || '';
    var hh, mm;
    if (/^\d{1,2}:\d{2}$/.test(val)) { hh = +val.split(':')[0]; mm = +val.split(':')[1]; }
    else { var d = new Date(); hh = d.getHours(); mm = d.getMinutes(); }
    var ap = hh < 12 ? 'AM' : 'PM';
    var h12 = hh % 12; if (h12 === 0) h12 = 12;
    var sel = { h: h12, m: mm, ap: ap };

    function col(id, items, cur, fmt) {
      return '<div class="cu-tcol" id="' + id + '">' + items.map(function (it) {
        return '<button class="cu-tcell' + (it === cur ? ' on' : '') + '" data-v="' + it + '">' + (fmt ? fmt(it) : it) + '</button>';
      }).join('') + '</div>';
    }
    var hours = []; for (var i = 1; i <= 12; i++) hours.push(i);
    var mins = []; for (var j = 0; j < 60; j++) mins.push(j);

    cuModal(
      '<div class="cu-head"><h2>Pick a time</h2><button id="cuX" class="cu-x">×</button></div>'
      + '<div class="cu-tdisp" id="cuTDisp">' + sel.h + ':' + pad(sel.m) + ' ' + sel.ap + '</div>'
      + '<div class="cu-time">'
      + col('cuH', hours, sel.h)
      + col('cuM', mins, sel.m, pad)
      + '<div class="cu-tcol cu-tap">'
      + '<button class="cu-tcell' + (sel.ap === 'AM' ? ' on' : '') + '" data-ap="AM">AM</button>'
      + '<button class="cu-tcell' + (sel.ap === 'PM' ? ' on' : '') + '" data-ap="PM">PM</button>'
      + '</div></div>'
      + '<button id="cuTDone" class="cu-btn">Done</button>'
    );

    function refreshDisp() { document.getElementById('cuTDisp').textContent = sel.h + ':' + pad(sel.m) + ' ' + sel.ap; }
    function wire(colId, key, attr) {
      var c = document.getElementById(colId);
      Array.prototype.forEach.call(c.querySelectorAll('.cu-tcell'), function (b) {
        b.onclick = function () {
          c.querySelectorAll('.cu-tcell').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          sel[key] = attr === 'ap' ? b.getAttribute('data-ap') : +b.getAttribute('data-v');
          refreshDisp();
          b.scrollIntoView({ block: 'center' });
        };
      });
      var on = c.querySelector('.cu-tcell.on'); if (on) on.scrollIntoView({ block: 'center' });
    }
    wire('cuH', 'h'); wire('cuM', 'm');
    // AM/PM column: wire its buttons directly
    Array.prototype.forEach.call(document.querySelectorAll('.cu-tap .cu-tcell'), function (b) {
      b.onclick = function () {
        document.querySelectorAll('.cu-tap .cu-tcell').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); sel.ap = b.getAttribute('data-ap'); refreshDisp();
      };
    });

    document.getElementById('cuX').onclick = cuClose;
    document.getElementById('cuTDone').onclick = function () {
      var h24 = sel.h % 12; if (sel.ap === 'PM') h24 += 12;
      input.value = pad(h24) + ':' + pad(sel.m);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      cuClose();
    };
  }
  window.openTimePicker = openTimePicker;

  // Intercept native time inputs everywhere (capture phase, before native UI).
  function intercept(e) {
    var t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'time') {
      e.preventDefault();
      if (!t.readOnly) t.setAttribute('readonly', 'readonly'); // stop native popup/keyboard
      t.blur();
      openTimePicker(t);
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
    + '.bear-av{overflow:hidden;padding:0!important;}.bear-av svg{width:100%;height:100%;display:block;}'
    + '.tl-byav{display:inline-block;width:16px;height:16px;border-radius:50%;overflow:hidden;vertical-align:middle;margin-right:5px;}.tl-byav svg{width:100%;height:100%;display:block;}';
  document.head.appendChild(st);
})();
