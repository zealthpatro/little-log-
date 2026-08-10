/* Cubby — the teaching ledger.
   ------------------------------------------------------------------------------------------------
   ONBOARDING.md used to say "pull, never push". It now says Cubby may speak first, but only once,
   only when the parent's own data has earned it, and never while something is wrong. This file is
   the "only once" and the "never while something is wrong". It renders nothing itself.

   TWO GUARDS, DOING DIFFERENT JOBS. An early draft collapsed them into one number and produced a
   system that was quiet for the wrong reason:

     the allowance  limits VOLUME on a good day  — 3/day to day 14, 2/day to day 60, 1/day after,
                                                   max one per session, 90-minute cooldown
     the ranking    limits INAPPROPRIATENESS     — the highest-value eligible cue takes the spend

   Raising the allowance does not weaken the second by one inch. On a fever morning the keepsake cue
   loses to the visit summary because health outranks memories, at any budget. That is asserted in
   tools/teach_gate.js rather than trusted.

   HARD REFUSALS RUN BEFORE SCORING, never inside it. `lossHolding` is the whole screen on purpose;
   a cue that merely lost a ranking contest could still win one tomorrow, and must not.

   HELD IS NOT DENIED. A cue that loses stays eligible and competes again. Only seen, stale and
   refused are permanent — which is what stops a rationed system quietly becoming a mute one.

   PULL AND PUSH SHARE ONE `seen` KEY. Reading about rituals via the info dot must mean the rituals
   nudge never fires. Asking a question can never be punished with an unsolicited lecture about it.

   State is per-user, keyed by uid, for the same reason the tips map is: a caregiver inheriting the
   owner's map reproduces a bug we already fixed once. It reads app state through exactly one
   window, cubbyTeachCtx(), because `state` is a top-level binding in the shell's inline script and
   is not reachable from a separate file.
*/
(function () {
  'use strict';

  var DAY = 86400000;
  var COOLDOWN = 90 * 60000;          // no two cues inside ninety minutes
  var DEFAULT_FRESH = 7 * DAY;        // a trigger nobody acted on stops asking

  /* Value. Deliberately coarse: the only property that has to hold is that the urgent domains
     outrank the pleasant ones, so a keepsake can never beat a fever. Tuning these is a one-place
     change and should happen against real testers, not in advance. */
  var DOMAIN_VALUE = {
    health: 60, circle: 45, preg: 45, log: 35, trying: 30, memories: 15, account: 10
  };
  // A page exists because that capability's benefit is NOT obvious from its button, so it should
  // never rank below a chapter. Omitting it here scored the deepest tier at zero.
  var DEPTH_VALUE = { page: 9, chapter: 6, one: 0 };

  /* Urgency belongs to the EVENT, not to the capability. Domain alone put a fever and a
     "your doses could go in your calendar" cue on the same score, and the tie broke alphabetically
     — which is how a dose calendar beat a sick baby. Anything not listed here scores zero and is
     ranked on domain and depth alone. */
  var EVENT_VALUE = {
    fever: 30, 'illness-started': 25, 'temp-logged': 20, birth: 22, 'week-36': 20,
    'condition-added': 18, 'med-added': 15, 'week-34': 12, 'second-caregiver': 12,
    'positive-test': 12, 'week-28': 10, 'birthday-set': 8, 'first-log': 8, 'trying-12mo': 8
  };

  function ctx() {
    if (typeof window.cubbyTeachCtx !== 'function') return null;
    try { return window.cubbyTeachCtx(); } catch (e) { return null; }
  }
  function rows() {
    return (window.CubbyTeachData && window.CubbyTeachData.rows) || {};
  }
  function now() { return (window.CubbyTeach && window.CubbyTeach._now) ? window.CubbyTeach._now() : Date.now(); }

  /* ---- per-user store ------------------------------------------------------------------------ */

  function key(c) { return 'cubby-teach:' + ((c && c.uid) || 'anon'); }
  function load(c) {
    try {
      var raw = localStorage.getItem(key(c));
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== 'object') o = {};
      o.seen = o.seen || {};          // cueId -> 1, permanent, shared by pull and push
      o.fired = o.fired || {};        // trigger name -> ms it first became true
      o.day = o.day || '';            // yyyy-mm-dd the allowance below belongs to
      o.spent = o.spent || 0;
      o.last = o.last || 0;
      return o;
    } catch (e) { return { seen: {}, fired: {}, day: '', spent: 0, last: 0 }; }
  }
  function save(c, o) {
    try { localStorage.setItem(key(c), JSON.stringify(o)); } catch (e) {}
  }
  function dayStamp(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /* One foregrounding of the app. The DAY carries the allowance, so ten opens across one night
     cannot spend ten cues — but within a single session only one may fire regardless. */
  function sessionSpent() {
    try { return sessionStorage.getItem('cubby-teach-session') === '1'; } catch (e) { return false; }
  }
  function markSessionSpent() {
    try { sessionStorage.setItem('cubby-teach-session', '1'); } catch (e) {}
  }

  /* ---- the allowance ------------------------------------------------------------------------- */

  // Decays as she gets competent. The fortnight of highest curiosity gets the most room; by day
  // sixty the app should mostly have stopped talking.
  function allowanceFor(dayN) {
    if (dayN <= 14) return 3;
    if (dayN <= 60) return 2;
    return 1;
  }
  function dayNumber(c) {
    var since = (c && c.installedAt) || 0;
    if (!since) return 1;
    return Math.max(1, Math.floor((now() - since) / DAY) + 1);
  }
  function todayBudget(c, o) {
    if (o.day !== dayStamp(now())) return allowanceFor(dayNumber(c));   // new day, full allowance
    return Math.max(0, allowanceFor(dayNumber(c)) - o.spent);
  }

  /* ---- triggers ------------------------------------------------------------------------------ */

  // Called by the app the moment something becomes true. Recording the FIRST time only is what
  // makes staleness meaningful: a trigger nobody acted on within its window stops asking forever.
  function fire(name) {
    var c = ctx(); if (!c) return;
    var o = load(c);
    if (o.fired[name]) return;
    o.fired[name] = now();
    save(c, o);
  }

  function triggerLive(o, row) {
    if (!row.earn) return false;
    var at = o.fired[row.earn.on];
    if (!at) return false;
    var fresh = row.earn.fresh ? parseFresh(row.earn.fresh) : DEFAULT_FRESH;
    return (now() - at) <= fresh;
  }
  function parseFresh(s) {
    var m = String(s).match(/^(\d+)([dh])$/);
    if (!m) return DEFAULT_FRESH;
    return parseInt(m[1], 10) * (m[2] === 'd' ? DAY : 3600000);
  }

  /* ---- who a row is for ---------------------------------------------------------------------- */

  // May only narrow. A row is never offered to somebody the shell would not open it for.
  function fits(c, row) {
    var w = row.who || {};
    if (w.stage && w.stage.indexOf(c.stage) === -1) return false;
    if (w.role && w.role !== 'any' && w.role !== c.role) return false;
    if (w.months && c.months != null) {
      if (w.months[0] != null && c.months < w.months[0]) return false;
      if (w.months[1] != null && c.months > w.months[1]) return false;
    }
    return true;
  }

  /* ---- refusals, checked BEFORE anything is scored ------------------------------------------- */

  function refusal(c, o, id, row) {
    if (!c) return 'no-context';
    if (c.lossHolding) return 'loss';            // the holding screen is the whole screen
    if (c.sheetOpen) return 'busy';
    if (!row) return 'unknown';
    if (o.seen[id]) return 'seen';               // pull marked this too
    if (!fits(c, row)) return 'not-for-them';
    if (!triggerLive(o, row)) return 'stale';
    return '';
  }

  function value(row) {
    return (DOMAIN_VALUE[row.domain] || 0) + (DEPTH_VALUE[row.depth] || 0)
      + ((row.earn && EVENT_VALUE[row.earn.on]) || 0);
  }

  /* Every currently-eligible cue, best first. The caller does not rank anything; the ledger can,
     because it holds the whole registry and the whole context. */
  function eligible() {
    var c = ctx(); if (!c) return [];
    var o = load(c), R = rows(), out = [];
    for (var id in R) {
      if (!Object.prototype.hasOwnProperty.call(R, id)) continue;
      if (refusal(c, o, id, R[id])) continue;
      out.push({ id: id, v: value(R[id]) });
    }
    out.sort(function (a, b) { return b.v - a.v || (a.id < b.id ? -1 : 1); });
    return out.map(function (x) { return x.id; });
  }

  /* ---- the one call every surface makes ------------------------------------------------------ */

  function ask(id) {
    var c = ctx(); if (!c) return false;
    var o = load(c), R = rows();
    if (refusal(c, o, id, R[id])) return false;
    if (sessionSpent()) return false;
    if (now() - o.last < COOLDOWN) return false;
    if (todayBudget(c, o) <= 0) return false;

    // Ranking. Losing here is HELD, not denied: nothing is written, so it competes again tomorrow.
    var best = eligible()[0];
    if (best && best !== id) return false;

    var stamp = dayStamp(now());
    if (o.day !== stamp) { o.day = stamp; o.spent = 0; }
    o.spent += 1;
    o.last = now();
    o.seen[id] = 1;
    save(c, o);
    markSessionSpent();
    return true;
  }

  // The info dot and the guide call this. Same map as push, on purpose.
  function markSeen(id) {
    var c = ctx(); if (!c) return;
    var o = load(c);
    if (o.seen[id]) return;
    o.seen[id] = 1;
    save(c, o);
  }
  function hasSeen(id) {
    var c = ctx(); if (!c) return false;
    return !!load(c).seen[id];
  }

  // Why a cue did not fire. For the gate and for debugging, never for the parent.
  function explain(id) {
    var c = ctx(); if (!c) return 'no-context';
    var o = load(c), R = rows();
    var r = refusal(c, o, id, R[id]);
    if (r) return r;
    if (sessionSpent()) return 'session-spent';
    if (now() - o.last < COOLDOWN) return 'cooldown';
    if (todayBudget(c, o) <= 0) return 'no-allowance';
    var best = eligible()[0];
    if (best && best !== id) return 'held-behind:' + best;
    return 'ok';
  }

  window.CubbyTeach = {
    ask: ask, fire: fire, markSeen: markSeen, hasSeen: hasSeen,
    eligible: eligible, explain: explain,
    // exposed for tools/teach_gate.js
    _allowanceFor: allowanceFor, _value: value, _dayNumber: dayNumber, _now: null
  };
})();
