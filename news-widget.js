/* Cubby newsletter capture — a calm, explicit opt-in for visitors who aren't ready to sign in yet.
   Shown on the marketing site and at the end of every article. First-party only: posts the email to
   our own Worker (/api/newsletter), which stores it in an isolated Cloudflare D1 database (NEWSLETTER_DB). No third-party list broker, no
   pixel, no cookie. Keeps the "no third-party trackers" promise.

   Placement: replaces a [data-cubby-news] element if present (marketing site), else inserts before
   <footer class="src"> (articles), else appends to <main>. Self-guards against double-insert.

   Consent: the form's sole purpose is the newsletter, and the label says so plainly — submitting is
   the explicit opt-in (EMAIL.md §7). We store a consent timestamp + an unsubscribe token server-side
   so the eventual send stream (news. subdomain, Phase 2) can honour one-click unsubscribe. */
(function () {
  if (window.__cubbyNews) return; window.__cubbyNews = true;

  // GATE: the form stays hidden unless its backend can actually persist a signup. Now ON — the
  // endpoint writes to the isolated Cloudflare D1 store (NEWSLETTER_DB). Set this to false to
  // instantly hide the form everywhere via a single-file redeploy (no article changes needed).
  var ENABLED = true;
  if (!ENABLED) return;

  // Journey-matched copy: a pregnant visitor wants pregnancy notes; a baby-stage visitor wants baby
  // notes. We read the stage the site already tracks (set on / and /app/); default to a warm blend.
  function stage() {
    try { var s = localStorage.getItem('cubby-stage'); if (s === 'expecting' || s === 'baby') return s; } catch (e) {}
    return '';
  }
  function copyFor(s) {
    if (s === 'expecting') return { h: 'A calm note through your pregnancy', p: 'Every couple of weeks: what’s happening this stage, plus a few reads we loved. No spam, unsubscribe anytime.' };
    if (s === 'baby') return { h: 'A calm note as your baby grows', p: 'Every couple of weeks: a gentle guide for where you are, plus a few reads we loved. No spam, unsubscribe anytime.' };
    return { h: 'Stay close, every couple of weeks', p: 'A gentle guide for pregnancy and the early years, plus a few reads we loved. No spam, unsubscribe anytime.' };
  }

  function acq() { try { return JSON.parse(localStorage.getItem('cubby-acq') || 'null'); } catch (e) { return null; } }

  function styleOnce() {
    if (document.getElementById('cubby-news-style')) return;
    var st = document.createElement('style'); st.id = 'cubby-news-style';
    st.textContent =
      '.cubby-news{max-width:560px;margin:34px auto;background:#fff;border:1px solid #EADFCF;border-radius:18px;'
      + 'padding:24px 22px;box-shadow:0 6px 18px rgba(0,0,0,.05);font-family:"Nunito Sans",system-ui,sans-serif;text-align:center;}'
      + '.cubby-news h3{font-family:"Fraunces",Georgia,serif;font-size:21px;color:#2C2521;margin:0 0 6px;line-height:1.25;}'
      + '.cubby-news p{font-size:14px;color:#6E635B;line-height:1.5;font-weight:600;margin:0 0 16px;}'
      + '.cubby-news form{display:flex;gap:8px;max-width:420px;margin:0 auto;flex-wrap:wrap;}'
      + '.cubby-news input{flex:1 1 200px;min-width:0;border:1.5px solid #E0D7C7;border-radius:12px;padding:13px 14px;'
      + 'font-size:15px;font-family:inherit;color:#2C2521;background:#FBF7EF;}'
      + '.cubby-news input:focus{outline:none;border-color:#C97FA0;}'
      + '.cubby-news button{flex:0 0 auto;border:none;background:#C97FA0;color:#fff;font-size:15px;font-weight:800;'
      + 'padding:13px 20px;border-radius:12px;cursor:pointer;font-family:inherit;}'
      + '.cubby-news button:hover{filter:brightness(1.03);}.cubby-news button:disabled{opacity:.6;cursor:default;}'
      + '.cubby-news .cn-note{font-size:12px;color:#9a8d80;font-weight:700;margin:12px 0 0;}'
      + '.cubby-news .cn-msg{font-size:14px;color:#56A08E;font-weight:800;margin:6px 0 0;}'
      + '.cubby-news .cn-err{color:#b05a7a;}';
    document.head.appendChild(st);
  }

  function build() {
    var s = stage(), c = copyFor(s);
    var wrap = document.createElement('section');
    wrap.className = 'cubby-news';
    wrap.innerHTML =
      '<h3>' + c.h + '</h3><p>' + c.p + '</p>'
      + '<form novalidate>'
      + '<input type="email" name="email" inputmode="email" autocomplete="email" placeholder="you@email.com" aria-label="Your email" required>'
      + '<button type="submit">Get the guide</button>'
      + '</form>'
      + '<div class="cn-note">Free · private to you · we never sell your data 🐻</div>';
    var form = wrap.querySelector('form'), input = wrap.querySelector('input'), btn = wrap.querySelector('button');
    var note = wrap.querySelector('.cn-note');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input.value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showMsg('Please enter a valid email.', true); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      var a = acq() || {};
      fetch('/api/newsletter', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email, stage: s || 'unknown', source: location.pathname,
          utmSource: a.source || '', utmCampaign: a.campaign || '' })
      }).then(function (r) {
        if (r.ok) { form.style.display = 'none'; showMsg('You’re on the list 🐻 Watch your inbox in a couple of weeks.'); }
        else if (r.status === 429) { reset('One moment — try again shortly.'); }
        else if (r.status === 400) { reset('Please check that email and try again.'); }
        else { reset('Something went wrong — please try again.'); }
      }).catch(function () { reset('Network hiccup — please try again.'); });
    });

    function reset(msg) { btn.disabled = false; btn.textContent = 'Get the guide'; showMsg(msg, true); }
    function showMsg(msg, err) {
      var m = wrap.querySelector('.cn-msg') || document.createElement('div');
      m.className = 'cn-msg' + (err ? ' cn-err' : ''); m.textContent = msg;
      if (!m.parentNode) note.parentNode.insertBefore(m, note);
    }
    return wrap;
  }

  function insert() {
    styleOnce();
    var card = build();
    var placeholder = document.querySelector('[data-cubby-news]');
    if (placeholder) { placeholder.replaceWith(card); return; }
    var srcFoot = document.querySelector('main footer.src') || document.querySelector('footer.src');
    if (srcFoot && srcFoot.parentNode) { srcFoot.parentNode.insertBefore(card, srcFoot); return; }
    var main = document.querySelector('main'); (main || document.body).appendChild(card);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', insert);
  else insert();
})();
