/* The reference display model for the home-screen widgets (plan 1, Task 5; roadmap 2.3, rules M1-M15).
 *
 *   createModel(copy, actions) -> renderModel(input) -> ViewModel
 *
 * `copy` is docs/widgets/widget-copy.json, `actions` the rows tools/widget_gen.js readQuickActions() reads from
 * app/index.html. Every customer string is read from `copy.strings` by key; nothing is typed here. Every clock,
 * day and date is computed with getUTC*, so the answer never depends on the machine's zone (contract note 5).
 * This file is the source of truth the Swift and Kotlin goldens are held to (widget-fixtures.json). */
'use strict';

const BASE = 'https://little-cubby.com/app/?';
const DAY = 86400000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const A11Y_KEY = { feed: 'feedFor', diaper: 'nappyFor', pump: 'pumpFor', activity: 'activityFor', health: 'healthFor', sleep: 'sleepFor', voice: 'sayItFor' };

function createModel(copy, actions) {
  const STR = copy.strings;
  const R = copy.rules;
  const DEFAULTS = copy.defaults;
  const VERSIONS = copy.snapshot.versions;

  function txt(key, vars) {
    const s = STR[key];
    if (!s) throw new Error('widget-copy.json has no key ' + key);
    return s.text.replace(/\{([a-z]+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m));
  }
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const emptyHeader = () => ({ name: null, age: null, fresh: null, ask: null, moment: null });
  const link = (go, baby) => BASE + 'go=' + go + '&baby=' + baby + '&from=widget';

  function renderModel(input) {
    const now = input.now;
    const ios = input.platform === 'ios';
    const family = input.family;
    const lock = family === 'lockRect' || family === 'lockInline';
    const isSmall = family === 'small';
    const cfg = input.config || {};
    const app = input.app;

    const result = (mode, message, url, header, rows, buttons, line) => ({
      mode, message, url, header: header || emptyHeader(), rows: rows || [], buttons: buttons || [], line: line || null,
    });
    const wordmark = () => result('wordmark', null, BASE + 'from=widget');

    /* ---- M5 clock and days -------------------------------------------------------------------- */
    function clock(ts) {
      const d = new Date(ts);
      const h = d.getUTCHours();
      return (h % 12 || 12) + ':' + pad2(d.getUTCMinutes()) + ' ' + (h >= 12 ? txt('time.pm') : txt('time.am'));
    }
    /* null while the time is on today's calendar day or under dayRuleMs old; else { yesterday: bool, text } */
    function dayOf(ts) {
      const dd = Math.floor(now / DAY) - Math.floor(ts / DAY);
      if (dd < 1 || now - ts <= R.dayRuleMs) return null;
      if (dd === 1) return { yesterday: true, text: txt('day.yesterday') };
      const d = new Date(ts);
      if (dd <= 6) return { yesterday: false, text: txt('weekday.' + WEEKDAYS[d.getUTCDay()]) };
      return { yesterday: false, text: txt('date.' + MONTHS[d.getUTCMonth()], { day: d.getUTCDate() }) };
    }

    /* ---- M1 source ---------------------------------------------------------------------------- */
    if (!app || VERSIONS.indexOf(app.v) < 0) return wordmark();
    if (app.state === 'signedOut') {
      return lock ? wordmark() : result('message', 'fallback.signedOut', BASE + 'from=widget');
    }
    if (app.state !== 'ok' || !Array.isArray(app.babies) || !app.babies.length) return wordmark();
    if (lock && app.lockScreen && app.lockScreen.hide) return wordmark();

    /* ---- M2 selection ------------------------------------------------------------------------- */
    const babies = app.babies;
    const byId = (id) => babies.find((b) => b.id === id) || null;
    const pickBaby = () => result('message', 'fallback.pickBaby', BASE + 'from=widget');
    let sel;
    if (cfg.baby && cfg.baby !== 'both') {
      const b = byId(cfg.baby);
      if (!b) return pickBaby();
      sel = [b];
    } else if (cfg.baby === 'both' && !lock) {
      if (babies.length !== 2) return pickBaby();
      sel = babies.slice();
    } else {
      const twinsDefault = !lock && app.twins && babies.length === 2;
      sel = twinsDefault ? babies.slice() : [byId(app.activeBabyId) || babies[0]];
    }

    /* ---- M3 merge ----------------------------------------------------------------------------- */
    const pull = input.pull || null;   // the model reads it only beside an ok app, and we are past that
    const napState = input.nap || null;
    let usedPull = false;
    const FIELDS = ['feed', 'sleep', 'nappy'];
    function merge(b) {
      const p = pull && Array.isArray(pull.babies) ? pull.babies.find((x) => x.id === b.id) || null : null;
      // nap: the newest `at` of app, pull and napState; a tie goes to the later source (napState, pull, app)
      const cand = [{ at: app.at, nap: b.nap || null, src: 'app' }];
      if (p) cand.push({ at: pull.at, nap: p.nap || null, src: 'pull' });
      const ns = napState && napState.babies ? napState.babies[b.id] : null;
      if (ns) cand.push({ at: ns.at, nap: ns.nap || null, src: 'nap' });
      let best = cand[0];
      cand.forEach((c) => { if (c.at >= best.at) best = c; });
      if (best.src === 'pull') usedPull = true;
      // last, by, healthOpen: the newer of app and pull, a null never erasing the older value
      const pullNewer = !!p && pull.at > app.at;
      const first = pullNewer ? p : b;
      const second = pullNewer ? b : p;
      const from = (get) => {
        const a = first ? get(first) : null;
        if (a !== null && a !== undefined) { if (first === p) usedPull = true; return a; }
        const c = second ? get(second) : null;
        if (c !== null && c !== undefined) { if (second === p) usedPull = true; return c; }
        return null;
      };
      // `by` names who logged the entry shown, so it follows the source its `last` came from (a null there
      // means "your own entry", never an older entry's name left behind a newer feed)
      const last = {}, by = {};
      FIELDS.forEach((f) => {
        const src = [first, second].find((x) => x && x.last && x.last[f] !== null && x.last[f] !== undefined) || null;
        if (src === p && p) usedPull = true;
        last[f] = src ? src.last[f] : null;
        by[f] = src && src.by && src.by[f] !== undefined ? src.by[f] : null;
      });
      const ill = from((x) => x.healthOpen);
      return { id: b.id, name: b.name, age: b.age || null, last, by, nap: best.nap, healthOpen: !!ill, moments: b.moments || [] };
    }
    const merged = sel.map(merge);
    const updated = usedPull ? Math.min(app.at, pull.at) : app.at;
    const stale = now - updated > R.staleMs;
    if (stale && family === 'lockInline') return wordmark();   // M4

    /* ---- M10 long nap ------------------------------------------------------------------------- */
    function isLong(m) {
      if (!m.nap) return false;
      const age = now - m.nap.start;
      if (age > R.napMaxMs) return true;
      const ackFresh = m.nap.ack !== null && m.nap.ack !== undefined && m.nap.ack > now - R.ackFreshMs;
      return age > R.napAskMs && !ackFresh;
    }

    /* ---- layout ------------------------------------------------------------------------------- */
    const illAny = merged.some((m) => m.healthOpen);
    let shown = merged;   // the babies the widget draws
    if (isSmall && merged.length === 2) {   // M8: small shows one baby, the one whose feed is newest
      const t = (m) => (m.last.feed === null ? -Infinity : m.last.feed);
      shown = [t(merged[1]) > t(merged[0]) ? merged[1] : merged[0]];
    }
    const twinsLayout = !lock && !isSmall && shown.length === 2;
    const sibling = twinsLayout && !app.twins;     // two babies of different ages set to Both (spec 6.4)
    const activeOf = () => shown.find((m) => m.id === app.activeBabyId) || shown[0];
    const names = (list) => list.map((m) => m.name).join(txt('names.and'));
    // the baby the buttons name, in a link
    const target = twinsLayout ? (sibling ? activeOf().id : 'both') : shown[0].id;
    const targetNames = twinsLayout ? (sibling ? activeOf().name : names(shown)) : shown[0].name;

    /* ---- M13 line ----------------------------------------------------------------------------- */
    let line = null, failure = null;
    if (!stale && !lock) {
      const pend = napState && napState.pending;
      if (pend) {
        if (now - pend.sentAt >= R.pendingMs) line = txt('state.checking');
      } else if (napState && napState.line && napState.line.until > now) {
        line = txt('line.' + napState.line.key);
        failure = napState.line.key;
      }
    }
    const pending = !!(napState && napState.pending);

    /* ---- M15 month days ----------------------------------------------------------------------- */
    const suffix = (m) => (m.unit === 'month' ? (m.n === 1 ? 'month1' : 'months') : (m.n === 1 ? 'year1' : 'years'));
    const activeMoment = (m) => m.moments.find((x) => x.at <= now && now < x.at + DAY) || null;
    const long = merged.filter(isLong);
    const ask = !lock && !isSmall && !twinsLayout && long.length > 0;   // M6: a long nap's ask, medium single only
    let moment = null, momentBaby = null, momentTotal = null;
    if (!stale && !lock && !ask) {
      const total = (m) => (m.unit === 'year' ? 12 * m.n : m.n);
      if (twinsLayout) {
        const act = shown.map((m) => ({ m, a: activeMoment(m) }));
        const on = act.filter((x) => x.a);
        const a11yOf = (x) => txt('a11y.moment.' + suffix(x.a), { name: x.m.name, age: x.a.n });
        if (on.length === 2 && on[0].a.unit === on[1].a.unit && on[0].a.n === on[1].a.n) {
          moment = { text: txt('twins.moment.' + suffix(on[0].a), { names: names(shown), age: on[0].a.n }), a11y: on.map(a11yOf).join(txt('names.and')) };
          momentBaby = on[0].m.id; momentTotal = total(on[0].a);
        } else if (on.length === 1) {
          moment = { text: txt('twins.moment.' + suffix(on[0].a), { names: on[0].m.name, age: on[0].a.n }), a11y: a11yOf(on[0]) };
          momentBaby = on[0].m.id; momentTotal = total(on[0].a);
        }
      } else {
        const m = shown[0], a = activeMoment(m);
        if (a) {
          const s = suffix(a);
          moment = {
            text: txt((isSmall ? 'small.moment.' : 'moment.') + s, { name: m.name, age: a.n }),
            a11y: txt('a11y.moment.' + s, { name: m.name, age: a.n }),
          };
          momentBaby = m.id; momentTotal = total(a);
        }
      }
    }

    /* ---- M6 header ---------------------------------------------------------------------------- */
    let header = emptyHeader();
    if (!lock) {
      const day = dayOf(updated);
      const time = clock(updated);
      const fresh = !day ? txt('header.updated', { time })
        : day.yesterday ? txt('header.updatedYesterday', { time }) : txt('header.updatedDay', { day: day.text, time });
      if (twinsLayout || isSmall) header = { name: null, age: null, fresh, ask: null, moment };
      else {
        const m = shown[0];
        const age = !ask && m.age ? txt('age.' + m.age.unit + (m.age.n === 1 ? '' : 's'), { age: m.age.n }) : null;
        header = { name: m.name, age, fresh, ask: ask ? txt('header.ask') : null, moment };
      }
    }

    /* ---- M12 body url ------------------------------------------------------------------------- */
    const mode = stale ? 'message' : 'full';
    let url;
    if (failure === 'noConnection' || failure === 'notSaved') url = link('sleep', target);
    else if (moment) url = BASE + 'go=monthcard&baby=' + momentBaby + '&m=' + momentTotal + '&from=widget';
    else if (shown.length === 1) url = BASE + 'baby=' + shown[0].id + '&from=widget';
    else url = BASE + 'from=widget';

    /* ---- M7, M8 rows -------------------------------------------------------------------------- */
    function timeParts(ts) {
      if (ts === null || ts === undefined) return { value: txt('status.notYet'), day: null, agoAt: null, said: txt('status.notYet'), clock: null };
      const d = dayOf(ts), c = clock(ts);
      return { value: c, day: d ? d.text : null, agoAt: ios && !d ? ts : null, said: d ? d.text + ' ' + c : c, clock: c };
    }
    function feedRow(m, label, withBy, who) {
      const p = timeParts(m.last.feed);
      return {
        baby: who, label, by: withBy && m.last.feed !== null ? m.by.feed : null,
        value: p.value, agoAt: p.agoAt, day: p.day, a11y: txt('a11y.lastFeed', { name: m.name, time: p.said }),
      };
    }
    function runningRow(m, label, who, value, dayText) {
      const c = clock(m.nap.start);
      return { baby: who, label, by: null, value, agoAt: null, day: dayText, a11y: txt('a11y.asleepSince', { name: m.name, time: c }) };
    }
    let rows = [];
    if (!stale) {
      if (lock) {
        const m = shown[0], p = timeParts(m.last.feed);
        rows.push({
          baby: null, label: txt('lock.lastFeed', { time: p.said }), by: null, value: null, agoAt: p.agoAt, day: null,
          a11y: txt('a11y.lastFeed', { name: m.name, time: p.said }),
        });
        if (family === 'lockRect') {
          if (m.nap) {
            const c = clock(m.nap.start);
            rows.push({
              baby: null, label: m.name + txt('sep.dot') + txt('lock.asleepSince', { time: c }), by: null, value: null, agoAt: null, day: null,
              a11y: txt('a11y.asleepSince', { name: m.name, time: c }),
            });
          } else if (m.last.sleep !== null) {
            const p2 = timeParts(m.last.sleep);
            rows.push({
              baby: null, label: m.name + txt('sep.dot') + txt('lock.woke', { time: p2.said }), by: null, value: null, agoAt: null, day: null,
              a11y: txt('a11y.lastSleep', { name: m.name, time: p2.said }),
            });
          }
        }
      } else if (isSmall) {
        rows.push(feedRow(shown[0], txt('small.lastFeed'), true, shown[0].name));
      } else if (twinsLayout) {
        shown.forEach((m) => {
          rows.push(m.nap ? runningRow(m, txt('status.asleepSince'), m.name, clock(m.nap.start), null)
            : feedRow(m, txt('status.lastFeed'), false, m.name));
        });
      } else {
        const m = shown[0];
        rows.push(feedRow(m, txt('status.lastFeed'), true, null));
        if (m.nap) {
          rows.push(runningRow(m, txt('status.sleep'), null,
            input.cellWidth >= R.asleepNowMinWidth ? txt('status.asleepNow') : txt('status.asleep'),
            txt('status.since', { time: clock(m.nap.start) })));
        } else {
          const p = timeParts(m.last.sleep);
          rows.push({
            baby: null, label: txt('status.lastSleep'), by: m.last.sleep !== null ? m.by.sleep : null, value: p.value, agoAt: p.agoAt, day: p.day,
            a11y: txt('a11y.lastSleep', { name: m.name, time: p.said }),
          });
        }
        const p = timeParts(m.last.nappy);
        rows.push({
          baby: null, label: txt('status.lastNappy'), by: m.last.nappy !== null ? m.by.nappy : null, value: p.value, agoAt: p.agoAt, day: p.day,
          a11y: txt('a11y.lastNappy', { name: m.name, time: p.said }),
        });
      }
    }

    /* ---- M9, M11, M14 buttons ----------------------------------------------------------------- */
    let buttons = [];
    if (!lock) {
      const act = (k) => actions.find((a) => a.key === k) || null;
      const allowed = (k, place) => { const a = act(k); return !!a && a.places.indexOf(place) >= 0 && (!a.platforms || a.platforms.indexOf(input.platform) >= 0); };
      const soft = (k, go, tgt, said) => ({
        k, label: act(k).label, style: 'soft', arrow: true, url: link(go, tgt), intent: null,
        a11y: txt('a11y.' + A11Y_KEY[k], { names: said }), dim: false,
      });
      const plain = (k) => {
        const a = act(k);
        if (k === 'health') {
          const ill = shown.filter((m) => m.healthOpen);
          if (twinsLayout && !sibling) {
            return ill.length === 1 ? soft(k, a.go, ill[0].id, ill[0].name) : soft(k, a.go, 'both', names(shown));
          }
        }
        return soft(k, a.go, target, targetNames);
      };
      const sleepButton = () => {
        const phaseA = plain('sleep');
        const dim = pending;
        let btn;
        if (sibling) btn = phaseA;
        else if (shown.some(isLong)) {
          const l = shown.find(isLong);
          btn = {
            k: 'sleep', label: isSmall ? txt('small.sleepStop') : txt('button.stopSleep'), style: 'soft', arrow: true, url: link('sleepfix', l.id), intent: null,
            a11y: txt('a11y.stopSleepOpensFor', { names: l.name }), dim: false,
          };
        } else if (input.phase === 'B' && input.token && !(failure === 'noConnection' || failure === 'notSaved' || failure === 'pickBaby')) {
          const u = napState && napState.undo;
          const running = shown.filter((m) => m.nap);
          const intentStop = (list) => {
            const starts = {};
            list.forEach((m) => { starts[m.id] = m.nap.start; });
            return { action: 'stop', babyIds: list.map((m) => m.id), starts };
          };
          if (u && u.until > now) {
            btn = {
              k: 'sleep', label: txt('button.undo'), style: 'solid', arrow: false, url: null,
              intent: { action: 'undo', babyIds: u.babyIds.slice(), starts: Object.assign({}, u.starts), undo: u.of },
              a11y: txt('a11y.undoFor', { names: u.babyIds.map((id) => (byId(id) || { name: id }).name).join(txt('names.and')) }), dim: false,
            };
          } else if (shown.length === 1) {
            const m = shown[0];
            const stop = !!m.nap;
            btn = {
              k: 'sleep',
              label: isSmall ? txt(stop ? 'small.sleepStop' : 'small.sleepStart') : txt(stop ? 'button.stopSleep' : 'button.startSleep'),
              style: 'solid', arrow: false, url: null,
              intent: stop ? intentStop([m]) : { action: 'start', babyIds: [m.id] },
              a11y: txt(stop ? 'a11y.stopSleepFor' : 'a11y.startSleepFor', { names: m.name }), dim: false,
            };
          } else if (!running.length) {
            btn = {
              k: 'sleep', label: txt('button.startBoth'), style: 'solid', arrow: false, url: null,
              intent: { action: 'start', babyIds: shown.map((m) => m.id) },
              a11y: txt('a11y.startSleepFor', { names: names(shown) }), dim: false,
            };
          } else {
            btn = {
              k: 'sleep', label: txt(running.length === 2 ? 'button.stopBoth' : 'button.stopSleep'), style: 'solid', arrow: false, url: null,
              intent: intentStop(running), a11y: txt('a11y.stopSleepFor', { names: names(running) }), dim: false,
            };
          }
        } else btn = phaseA;
        btn.dim = dim;
        return btn;
      };
      const make = (k) => (k === 'sleep' ? sleepButton() : plain(k));
      if (isSmall) {
        const ok = (k) => typeof k === 'string' && allowed(k, 'small');
        const first = ok(cfg.first) ? cfg.first : DEFAULTS.small[0];
        let second = ok(cfg.second) && cfg.second !== first ? cfg.second : null;
        if (!second) second = DEFAULTS.small.find((k) => k !== first);
        if (illAny && first !== 'health' && second !== 'health') second = 'health';
        buttons = [make(first), make(second)];
      } else {
        const fourth = illAny ? 'health' : (typeof cfg.button === 'string' && allowed(cfg.button, 'medium4') ? cfg.button : DEFAULTS.medium4);
        buttons = ['feed', 'sleep', 'diaper', fourth].map(make);
      }
    }

    return result(mode, stale ? 'fallback.stale' : null, url, header, rows, buttons, line);
  }
  return renderModel;
}

module.exports = { createModel };
