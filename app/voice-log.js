/* Cubby — voice logging (v1).
   Speak (or type) a natural sentence → a rule grammar parses it into a structured
   event → a CONFIRMATION PREVIEW → one tap saves. Never auto-commits a heard entry
   (a misheard "20ml" vs "120ml" would corrupt a health log). ASR = the browser's
   built-in Web Speech API (no third-party infra); on unsupported devices the sheet
   degrades to typing. Smart structured parse is Pro (with a free taste); dictating a
   plain note is always free (accessibility floor).

   Depends on globals from index.html: openSheet, closeSheet, commitEvent, startSleep,
   stopSleep, render, toast, now, isPro, useTaste, openPro, escapeHtml, state. */
(function () {
  'use strict';

  function vCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function unitPref() { return ((window.state && state.settings && state.settings.unit) || 'ml'); }

  /* ---------- pure parser (unit-testable, no DOM) ---------- */
  // Returns an intent {kind,label,fields} or null (→ offer as a free note).
  function parseVoice(raw, nowMs) {
    var t = ' ' + String(raw || '').toLowerCase().replace(/[^\w\s.]/g, ' ').replace(/\s+/g, ' ') + ' ';
    if (!t.trim()) return null;

    function has() { for (var i = 0; i < arguments.length; i++) { if (t.indexOf(arguments[i]) !== -1) return true; } return false; }
    function firstNum() { var m = t.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; }
    function durationMs() {
      var ms = 0;
      var h = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
      var m = t.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
      if (h) ms += parseFloat(h[1]) * 3600000;
      if (m) ms += parseFloat(m[1]) * 60000;
      if (!ms) {
        if (has('half an hour', 'half hour')) ms = 1800000;
        else if (has('quarter hour', 'quarter of an hour')) ms = 900000;
        else if (has('an hour', 'one hour')) ms = 3600000;
      }
      return ms;
    }
    var unit = has('oz', 'ounce', 'ounces') ? 'oz' : 'ml';
    var side = has('left') ? 'left' : has('right') ? 'right' : (has('both side', 'both breast') ? 'both' : null);

    // 1) PUMP — distinct verbs, check before feed so "pumped 60ml" isn't a bottle.
    if (has('pump', 'expressed', 'expressing')) {
      var pAmt = firstNum();
      return { kind: 'pump', fields: { amount: pAmt || 0, unit: unit, side: side || 'both' },
        label: 'Pump · ' + (pAmt != null ? pAmt + unit : '—') + (side ? ' · ' + vCap(side) : '') };
    }

    // 2) DIAPER — before sleep, so "nappy" isn't mistaken for "nap".
    if (has('diaper', 'nappy', 'nappies', 'changed', 'poo', 'poop', 'pooped', 'pooed', 'pee', 'peed', 'wet', 'dirty', 'soiled', 'wee', 'weed')) {
      var wet = has('wet', 'pee', 'peed', 'wee', 'weed', 'number one');
      var dirty = has('dirty', 'poo', 'poop', 'pooped', 'pooed', 'soiled', 'number two', 'motion');
      var kind = has('both') || (wet && dirty) ? 'both' : dirty ? 'dirty' : wet ? 'wet' : has('dry', 'clean', 'nothing') ? 'dry' : null;
      if (kind) return { kind: 'diaper', fields: { kind: kind }, label: 'Diaper · ' + vCap(kind) + ' · now' };
    }

    // 3) SLEEP
    if (has('woke', 'wake', 'waking', 'awake', 'she is up', 'he is up', 'up now')) {
      return { kind: 'sleepStop', fields: {}, label: 'End the nap · now' };
    }
    if (has('sleep', 'asleep', 'sleeping', 'nap', 'napping', 'napped', 'slept', 'down for', 'put her down', 'put him down', 'put down', 'dozed', 'drowsy')) {
      var d = durationMs();
      if (d > 0) {
        return { kind: 'sleepPast', fields: { startMs: nowMs - d, endMs: nowMs, durMs: d },
          label: 'Sleep · ' + prettyDur(d) + ' · ended now' };
      }
      return { kind: 'sleepStart', fields: {}, label: 'Start a nap timer · now' };
    }

    // 4) FEED
    var feedVerb = has('fed', 'feed', 'feeding', 'gave', 'drank', 'ate', 'bottle', 'nursed', 'nursing', 'breast', 'latched', 'formula', 'milk', 'water');
    if (feedVerb) {
      if (has('water')) {
        var wAmt = firstNum();
        return { kind: 'feedWater', fields: { amount: wAmt || 0, unit: unit },
          label: 'Water' + (wAmt != null ? ' · ' + wAmt + unit : '') + ' · now' };
      }
      var amt = firstNum();
      var bottleish = has('bottle', 'formula') || (amt != null && (has('ml', 'oz', 'ounce', 'ounces') || !side));
      // Breast wins when there's a side or an explicit nurse/breast word and no amount+unit.
      if (has('breast', 'nursed', 'nursing', 'latched') || (side && amt == null)) {
        var dm = durationMs();
        return { kind: 'feedBreast', fields: { side: side || 'both', durMs: dm },
          label: 'Breast feed' + (side ? ' · ' + vCap(side) : '') + (dm > 0 ? ' · ' + prettyDur(dm) : '') + ' · now' };
      }
      if (bottleish && amt != null) {
        return { kind: 'feedBottle', fields: { amount: amt, unit: unit },
          label: 'Bottle · ' + amt + unit + ' · now' };
      }
      // bare "fed her" with nothing else → a breast feed with no detail
      if (has('fed', 'feed', 'feeding', 'nursed')) {
        return { kind: 'feedBreast', fields: { side: side || 'both', durMs: 0 },
          label: 'Breast feed' + (side ? ' · ' + vCap(side) : '') + ' · now' };
      }
    }

    return null; // → free note
  }

  function prettyDur(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 60) return mins + ' min';
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }

  /* ---------- execute a confirmed intent (structured = Pro-gated) ---------- */
  function execVoiceIntent(intent) {
    var f = intent.fields, tNow = (typeof now === 'function' ? now() : Date.now());
    switch (intent.kind) {
      case 'diaper': commitEvent({ type: 'diaper', kind: f.kind, time: tNow }); done('Diaper logged · ' + f.kind); break;
      case 'feedBottle': commitEvent({ type: 'feed', method: 'bottle', amount: f.amount, unit: f.unit, time: tNow }); saveUnit(f.unit); done('Bottle logged · ' + f.amount + f.unit); break;
      case 'feedWater': commitEvent({ type: 'feed', method: 'water', amount: f.amount, unit: f.unit, time: tNow }); done('Water logged'); break;
      case 'feedBreast': commitEvent({ type: 'feed', method: 'breast', side: f.side, time: tNow, dur: f.durMs || 0 }); done('Feed logged'); break;
      case 'pump': commitEvent({ type: 'pump', amount: f.amount, unit: f.unit, side: f.side, time: tNow }); saveUnit(f.unit); done('Pump logged'); break;
      case 'sleepPast': commitEvent({ type: 'sleep', time: f.startMs, end: f.endMs }); done('Sleep logged · ' + prettyDur(f.durMs)); break;
      case 'sleepStart': if (typeof startSleep === 'function') { startSleep(); } else { done('Nap started'); } break; // startSleep closes + navigates
      case 'sleepStop':
        // stopSleep early-returns when no timer exists; without this check the sheet closed
        // with nothing logged and nothing said — the worst failure class in a shared log.
        if (!napTimerRunning()) { done('No nap timer is running. Try saying "napped 2 hours".'); break; }
        if (typeof stopSleep === 'function' && window.state) { stopSleep(state.activeBabyId); }
        closeSheet(); if (typeof render === 'function') render(); break;
    }
  }
  function napTimerRunning() {
    try { return !!(typeof timersFor === 'function' && window.state && timersFor(state.activeBabyId).sleep); } catch (e) { return false; }
  }
  function saveUnit(u) { try { if (window.state && state.settings) { state.settings.unit = u; if (typeof persist === 'function') persist(); } } catch (e) {} }
  function done(msg) { closeSheet(); if (typeof render === 'function') render(); if (typeof toast === 'function') toast(msg); }

  /* ---------- Web Speech ASR ---------- */
  function speechSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  var _rec = null;
  function startDictation(onText, onDone, onError) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { onError('unsupported'); return; }
    var r = new SR();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
    var finalText = '';
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript;
      }
      onText((finalText + ' ' + interim).trim());
    };
    r.onerror = function (e) { onError(e && e.error ? e.error : 'error'); };
    r.onend = function () { onDone(finalText.trim()); };
    _rec = r;
    try { r.start(); } catch (err) { onError('start'); }
  }
  function stopDictation() { if (_rec) { try { _rec.stop(); } catch (e) {} } }

  /* ---------- sheet ---------- */
  var vs = null; // {mode:'listen'|'preview'|'note', text, intent, listening, err}
  var PRIVACY = 'Cubby uses your phone’s built-in dictation. On some phones the audio is processed by the device maker. Your entry stays private to your circle.';

  function openVoiceLog() {
    vs = { mode: 'input', text: '', intent: null, listening: false, err: '' };
    renderVoiceSheet();
    /* The mic does NOT start on open. It used to, so tapping "Say it" put a live microphone in the
       room before anyone had decided to speak, and on the first ever tap it fired the browser's
       permission prompt as if the app had asked for it rather than the person. The sheet already
       renders the mic button and the words "Tap the mic to speak"; that button is now the truth.
       voiceRetry still starts on its own, because "Try again" IS the person asking. */
  }

  function beginListen() {
    vs.listening = true; vs.err = ''; renderVoiceSheet();
    // Guard every callback on mode==='input': a late onend/onerror must never yank the
    // user back once they've already advanced to the preview/note step (or typed + continued).
    startDictation(
      function (txt) { if (vs.mode !== 'input') return; vs.text = txt; renderVoiceSheet(true); },
      function (finalTxt) { vs.listening = false; if (vs.mode !== 'input') return; vs.text = finalTxt || vs.text; toPreview(); },
      function (err) { vs.listening = false; if (vs.mode !== 'input') return; vs.err = (err === 'not-allowed' || err === 'service-not-allowed') ? 'mic-denied' : err; renderVoiceSheet(); }
    );
  }

  function toPreview() {
    var text = (vs.text || '').trim();
    if (!text) { renderVoiceSheet(); return; }
    var intent = parseVoice(text, (typeof now === 'function' ? now() : Date.now()));
    vs.intent = intent;
    vs.mode = intent ? 'preview' : 'note';
    renderVoiceSheet();
  }

  // called from the "type it" textarea submit
  window.voiceParseTyped = function () {
    var el = document.getElementById('vcTyped');
    if (el) vs.text = el.value;
    stopDictation();
    vs.listening = false;
    toPreview();
  };
  window.voiceRetry = function () { vs.mode = 'input'; vs.text = ''; vs.intent = null; if (speechSupported()) beginListen(); else renderVoiceSheet(); };
  window.voiceListenToggle = function () { if (vs.listening) { stopDictation(); } else { beginListen(); } };

  window.voiceSaveStructured = function () {
    if (!vs.intent) return;
    // "End the nap" with no running timer: be honest before the Pro gate, so the tap never
    // silently no-ops and never spends a taste on nothing.
    if (vs.intent.kind === 'sleepStop' && !napTimerRunning()) { done('No nap timer is running. Try saying "napped 2 hours".'); return; }
    // Smart structured parse = Pro (free taste). Note path stays free.
    if (typeof isPro === 'function' && !isPro() && typeof useTaste === 'function') {
      if (!useTaste('voice', 'Voice logging')) { return; } // tasted out → useTaste opens Pro
    }
    execVoiceIntent(vs.intent);
  };

  window.voiceSaveNote = function () {
    var text = (vs.text || '').trim();
    if (!text) { toast('Nothing to save yet'); return; }
    commitEvent({ type: 'activity', activity: null, mins: null, notes: text, time: (typeof now === 'function' ? now() : Date.now()) });
    done('Note saved');
  };

  window.voiceEditManually = function () {
    var k = vs.intent && vs.intent.kind;
    var f = (vs.intent && vs.intent.fields) || {};
    closeSheet();
    // route to the trusted manual sheet so a wrong hearing is fixed in the real UI
    var map = { diaper: 'openDiaper', feedBottle: 'openFeed', feedWater: 'openFeed', feedBreast: 'openFeed', pump: 'openPump', sleepPast: 'openSleep', sleepStart: 'openSleep', sleepStop: 'openSleep' };
    var fn = map[k];
    if (!fn || typeof window[fn] !== 'function') return;
    setTimeout(function () {
      // A finished nap carries its parsed times straight into the past-sleep sheet.
      if (k === 'sleepPast' && f.startMs && f.endMs && typeof openPastSleep === 'function') {
        try { logTimes = { when: f.startMs, end: f.endMs }; openPastSleep(false); return; } catch (e) {}
      }
      window[fn]();
      // Prefill the parsed draft so "Not right? Edit" starts from what she said, not a blank
      // sheet (the open* functions reset their drafts to defaults). Best-effort: any miss
      // simply leaves the plain sheet open.
      try {
        if ((k === 'feedBottle' || k === 'feedWater' || k === 'feedBreast') && typeof feedDraft !== 'undefined' && feedDraft) {
          feedDraft.method = (k === 'feedBottle') ? 'bottle' : (k === 'feedWater') ? 'water' : 'breast';
          if (k === 'feedBottle' && f.amount) { feedDraft.amount = f.amount; feedDraft.unit = f.unit || feedDraft.unit; }
          if (k === 'feedWater' && f.amount) { feedDraft.wAmount = f.amount; feedDraft.unit = f.unit || feedDraft.unit; }
          if (k === 'feedBreast' && f.side) { feedDraft.side = f.side; }
          if (typeof renderFeedSheet === 'function') renderFeedSheet();
        } else if (k === 'pump' && typeof pumpDraft !== 'undefined' && pumpDraft) {
          if (f.amount) pumpDraft.amount = f.amount;
          if (f.unit) pumpDraft.unit = f.unit;
          if (f.side) pumpDraft.side = f.side;
          if (typeof renderPumpSheet === 'function') renderPumpSheet();
        }
      } catch (e) {}
    }, 60);
  };

  window.openVoiceLog = openVoiceLog;

  function renderVoiceSheet(inPlace) {
    // Live-update transcript text without reopening (keeps the mic UI stable while listening).
    if (inPlace) { var live = document.getElementById('vcLive'); if (live) { live.textContent = vs.text || '…'; return; } }

    var body;
    if (vs.mode === 'preview' && vs.intent) {
      var tasteNote = (typeof isPro === 'function' && !isPro() && typeof tasteLeft === 'function')
        ? '<div class="csub" style="text-align:center;margin-top:8px">' + (tasteLeft('voice') > 0 ? tasteLeft('voice') + ' free ' + (tasteLeft('voice') === 1 ? 'try' : 'tries') + ' left ✨' : 'Voice logging is a Pro treat ✨') + '</div>'
        : '';
      body = '<h2>Ready to save?</h2>'
        + '<div class="sub">You said: “' + escapeHtml(vs.text) + '”</div>'
        + '<div class="opt" style="pointer-events:none;justify-content:center;font-weight:800;font-size:16px">🎙️ ' + escapeHtml(vs.intent.label) + '</div>'
        + '<button class="btn-primary" style="background:var(--feed)" onclick="voiceSaveStructured()">Save this</button>'
        + '<div style="display:flex;gap:8px;margin-top:8px">'
        + '<button class="btn-ghost" style="flex:1;margin:0" onclick="voiceEditManually()">Not right? Edit</button>'
        + '<button class="btn-ghost" style="flex:1;margin:0" onclick="voiceRetry()">Try again</button>'
        + '</div>'
        // The free door stays open on success too: what she said is never confiscated at the
        // Pro wall, it can always be kept as a plain note for the circle.
        + '<button class="btn-ghost" onclick="voiceSaveNote()">Save it as a note instead' + ((typeof isPro === 'function' && !isPro()) ? ' · free' : '') + '</button>'
        + tasteNote;
    } else if (vs.mode === 'note') {
      body = '<h2>Save it as a note?</h2>'
        + '<div class="sub">I couldn’t turn that into a feed, sleep or diaper, but I can keep it as a note for your circle.</div>'
        + '<div class="opt" style="pointer-events:none">📝 ' + escapeHtml(vs.text || '') + '</div>'
        + '<button class="btn-primary" style="background:var(--note)" onclick="voiceSaveNote()">Save as note</button>'
        + '<button class="btn-ghost" onclick="voiceRetry()">Try again</button>';
    } else {
      // input mode (listening or typing)
      var mic = speechSupported()
        ? '<button class="vc-mic ' + (vs.listening ? 'on' : '') + '" onclick="voiceListenToggle()" aria-label="' + (vs.listening ? 'Stop' : 'Start') + ' listening">🎙️</button>'
          + '<div class="csub" style="text-align:center">' + (vs.listening ? 'Listening… say it naturally, e.g. “fed her 120ml” or “wet diaper”' : 'Tap the mic to speak') + '</div>'
          + '<div id="vcLive" class="vc-live">' + escapeHtml(vs.text || '…') + '</div>'
        : '<div class="csub" style="text-align:center;margin-bottom:8px">Voice isn’t available on this device, but you can type it naturally below.</div>';
      var errLine = vs.err === 'mic-denied'
        ? '<div class="csub" style="text-align:center;color:var(--diaper)">Microphone is blocked. Allow it in your browser settings, or type below.</div>'
        : (vs.err ? '<div class="csub" style="text-align:center;color:var(--diaper)">Didn’t catch that — tap the mic again or type below.</div>' : '');
      body = '<h2>🎙️ Say it</h2>'
        + '<div class="sub">Just say what happened and Cubby writes the entry. Nothing saves until you confirm.</div>'
        + mic + errLine
        + '<div class="field" style="margin-top:10px"><label>Or type it</label>'
        + '<textarea id="vcTyped" placeholder="e.g. fed her 120ml, napped 2 hours, wet diaper">' + escapeHtml(vs.text || '') + '</textarea></div>'
        + '<button class="btn-primary" style="background:var(--feed)" onclick="voiceParseTyped()">Continue</button>'
        + '<div class="csub" style="text-align:center;margin-top:10px">' + PRIVACY + '</div>';
    }
    openSheet(body, 'feed');
  }

  // one-time styles
  try {
    if (!document.getElementById('vc-style')) {
      var s = document.createElement('style'); s.id = 'vc-style';
      s.textContent = '.vc-mic{display:block;margin:14px auto;width:88px;height:88px;border-radius:50%;border:none;font-size:38px;background:var(--feed-soft);color:var(--feed);cursor:pointer;transition:transform .15s}'
        + '.vc-mic.on{background:var(--feed);color:#fff;animation:vcpulse 1.3s ease-in-out infinite}'
        + '@keyframes vcpulse{0%,100%{box-shadow:0 0 0 0 rgba(0,0,0,.12)}50%{box-shadow:0 0 0 12px rgba(0,0,0,0)}}'
        // The live "what Cubby heard" readout. --card is now declared per theme (app/index.html):
        // it never was, so this resolved to the #fff fallback in BOTH themes and put cream --ink
        // text on a white box at 1.2:1 — the one line a parent has to read before anything is
        // saved. The box is defined by its border rather than its fill, so the border has to be
        // visible on dark too; rgba(0,0,0,.06) is not.
        + '.vc-live{min-height:44px;margin:6px 0 2px;padding:10px 12px;border-radius:12px;background:var(--card,#fff);border:1px solid rgba(0,0,0,.06);text-align:center;font-size:16px;color:var(--ink,#5F534A)}'
        + '[data-theme="night"] .vc-live{border-color:var(--line)}';
      document.head.appendChild(s);
    }
  } catch (e) {}

  // expose the parser for tests
  window.__parseVoice = parseVoice;
})();
