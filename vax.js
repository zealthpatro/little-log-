/* Cubby vaccine-schedule birthday calculator.
   Progressive enhancement: the schedule table is fully rendered in static HTML
   (crawlable). This only fills the "Your date" column once a parent picks a birthday.
   Rows carry data-weeks or data-months; the input has id="dob". */
(function () {
  var input = document.getElementById('dob');
  if (!input) return;

  function fmt(d, locale) {
    try { return d.toLocaleDateString(locale || undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  function addWeeks(d, w) { var x = new Date(d.getTime()); x.setDate(x.getDate() + w * 7); return x; }
  function addMonths(d, m) { var x = new Date(d.getTime()); x.setMonth(x.getMonth() + m); return x; }

  function recompute() {
    var v = input.value;
    var cells = document.querySelectorAll('td.when');
    if (!v) { cells.forEach(function (c) { c.textContent = ''; }); return; }
    var birth = new Date(v + 'T00:00:00');
    if (isNaN(birth.getTime())) return;
    var locale = document.documentElement.getAttribute('lang') || undefined;
    cells.forEach(function (c) {
      var row = c.closest('tr');
      var w = row.getAttribute('data-weeks');
      var m = row.getAttribute('data-months');
      var due;
      if (w != null) due = addWeeks(birth, parseFloat(w));
      else if (m != null) due = addMonths(birth, parseFloat(m));
      else { c.textContent = ''; return; }
      c.textContent = fmt(due, locale);
    });
  }
  input.addEventListener('change', recompute);
  input.addEventListener('input', recompute);
})();
