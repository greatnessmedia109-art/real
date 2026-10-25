(function () {
  var forms = document.querySelectorAll('form[data-lead]');
  if (!forms.length) return;
  var utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var utm = {};
  try {
    var saved = JSON.parse(sessionStorage.getItem('utm') || '{}');
    var q = new URLSearchParams(location.search);
    utmKeys.forEach(function (k) { if (q.get(k)) saved[k] = q.get(k).slice(0, 120); });
    sessionStorage.setItem('utm', JSON.stringify(saved));
    utm = saved;
  } catch (e) {}
  forms.forEach(function (form) {
    var status = form.querySelector('.lead-status');
    var button = form.querySelector('button[type=submit]');
    function put(name, value) {
      var el = form.querySelector('[name=' + name + ']');
      if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = name; form.appendChild(el); }
      el.value = value;
    }
    put('t', String(Date.now()));
    put('referrer', document.referrer || '');
    Object.keys(utm).forEach(function (k) { put(k, utm[k]); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      button.disabled = true;
      status.textContent = 'Sending…';
      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok) {
            form.hidden = true;
            var done = form.parentNode.querySelector('.lead-done');
            if (done) { done.hidden = false; done.focus(); }
          } else {
            status.textContent = (res.j && res.j.error) || 'Something went wrong. Please try again.';
            button.disabled = false;
          }
        })
        .catch(function () {
          status.textContent = 'Could not send. Check your connection and try again.';
          button.disabled = false;
        });
    });
  });
})();
