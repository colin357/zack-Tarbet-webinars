/* ============================================================================
   Tarbet Mortgage Team - webinar site
   Handles registration submission, validation, countdown, local-time display,
   and the calendar links on the thank-you page. No dependencies.
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_KEY = 'tmt:lastRegistration';

  /* ------------------------------------------------------------- helpers */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function isValidEmail(value) {
    // Deliberately permissive: catch obvious typos, let the CRM do the rest.
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
  }

  function digits(value) { return String(value || '').replace(/\D/g, ''); }

  function isValidPhone(value) {
    var d = digits(value);
    // 10 digits, or 11 starting with a US country code.
    return d.length === 10 || (d.length === 11 && d.charAt(0) === '1');
  }

  function formatPhone(value) {
    var d = digits(value).slice(0, 10);
    if (d.length < 4) return d;
    if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }

  function setFieldError(input, message) {
    var field = input.closest('.field');
    if (!field) return;
    var msg = $('.field__msg', field);
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      if (!msg) {
        msg = document.createElement('span');
        msg.className = 'field__msg';
        field.appendChild(msg);
      }
      msg.textContent = message;
    } else {
      input.removeAttribute('aria-invalid');
      if (msg) msg.remove();
    }
  }

  /** Marketing attribution: keep whatever the ad or email link carried. */
  function trackingParams() {
    var params = new URLSearchParams(window.location.search);
    var out = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'].forEach(function (key) {
      var value = params.get(key);
      if (value) out[key] = value;
    });
    return out;
  }

  /* -------------------------------------------------- lead destinations */

  function parseEndpoints(article) {
    try {
      var list = JSON.parse(article.getAttribute('data-endpoints') || '[]');
      return Array.isArray(list) ? list.filter(function (d) { return d && d.url; }) : [];
    } catch (err) {
      return [];
    }
  }

  /**
   * Posts one registration to one destination. Never rejects — the caller gets
   * a result object either way, so one bad endpoint cannot break the others.
   *
   * keepalive lets the request finish even though we navigate away to Zoom or
   * the thank-you page immediately afterwards.
   */
  function postLead(dest, data) {
    var done = function (ok, extra) {
      var r = { name: dest.name || 'Webhook', required: dest.required !== false, ok: ok };
      if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) r[k] = extra[k]; } }
      return r;
    };

    return fetch(dest.url, {
      method: 'POST',
      // Content type is per-destination: Apps Script needs text/plain to stay a
      // CORS "simple request", since it does not answer an OPTIONS preflight.
      headers: { 'Content-Type': dest.contentType || 'application/json' },
      body: JSON.stringify(data),
      mode: dest.noCors ? 'no-cors' : 'cors',
      keepalive: true
    }).then(
      function (res) {
        // An opaque (no-cors) response tells us nothing, so treat it as sent.
        if (res.type === 'opaque') return done(true, { opaque: true });
        return done(res.ok, { status: res.status });
      },
      function (err) { return done(false, { error: String(err) }); }
    );
  }

  /** Resolves early if a destination hangs; keepalive keeps it going regardless. */
  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; resolve(fallback); }
      }, ms);
      promise.then(function (value) {
        if (!settled) { settled = true; clearTimeout(timer); resolve(value); }
      });
    });
  }

  /* ------------------------------------------------- local time + countdown */

  function timeIn(date, timeZone) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
      }).format(date);
    } catch (err) {
      return '';
    }
  }

  function initLocalTime(article, start) {
    var target = $('[data-local-time]', article);
    if (!target) return;

    var siteZone = article.getAttribute('data-tz');
    var localZone;
    try {
      localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (err) {
      return;
    }
    if (!localZone || !siteZone) return;

    // Only worth showing when the viewer is actually somewhere else.
    if (timeIn(start, localZone) === timeIn(start, siteZone)) return;

    target.textContent = 'In your time zone that is ' + timeIn(start, localZone) + '.';
    target.hidden = false;
  }

  function initCountdown(article, start) {
    var box = $('[data-countdown]', article);
    if (!box) return;

    var note = $('[data-countdown-note]', box);
    var cells = {
      days: $('[data-cd="days"]', box),
      hours: $('[data-cd="hours"]', box),
      minutes: $('[data-cd="minutes"]', box)
    };

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function tick() {
      var diff = start.getTime() - Date.now();
      box.hidden = false;

      if (diff <= 0) {
        box.className = 'countdown countdown--live';
        if (note) note.textContent = 'This session has started.';
        return false;
      }

      var mins = Math.floor(diff / 60000);
      if (cells.days) cells.days.textContent = pad(Math.floor(mins / 1440));
      if (cells.hours) cells.hours.textContent = pad(Math.floor((mins % 1440) / 60));
      if (cells.minutes) cells.minutes.textContent = pad(mins % 60);
      return true;
    }

    if (tick()) setInterval(tick, 30000);
  }

  /* ------------------------------------------------------- sticky CTA bar */

  function initStickyCta(article) {
    var bar = $('[data-sticky-cta]', article);
    var card = $('.register__card', article);
    if (!bar || !card || !('IntersectionObserver' in window)) return;

    bar.hidden = false; // CSS keeps it off-screen until it is marked visible

    function show(on) {
      if (on) {
        bar.setAttribute('data-visible', '');
        document.documentElement.classList.add('has-stickybar');
      } else {
        bar.removeAttribute('data-visible');
        document.documentElement.classList.remove('has-stickybar');
      }
    }

    new IntersectionObserver(
      function (entries) {
        // Only once the form has scrolled past the top of the viewport, so the
        // bar never covers the form it is pointing at.
        var e = entries[0];
        show(!e.isIntersecting && e.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    ).observe(card);

    // Tapping the bar should land on the form, not just jump the hash.
    $$('a[href="#register"]', article).forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var first = $('#firstName', card);
        if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 450);
      });
    });
  }

  /* ------------------------------------------------------------ the form */

  function initForm(article) {
    var form = $('[data-register]', article);
    if (!form) return;

    var errorBox = $('[data-form-error]', form);
    var submitBtn = $('[data-submit]', form);
    var phone = $('#phone', form);

    if (phone) {
      phone.addEventListener('input', function () {
        var pos = phone.selectionStart === phone.value.length;
        phone.value = formatPhone(phone.value);
        if (pos) phone.setSelectionRange(phone.value.length, phone.value.length);
      });
    }

    // Clear a field's error as soon as the visitor starts fixing it.
    $$('input, select', form).forEach(function (input) {
      input.addEventListener('input', function () { setFieldError(input, ''); });
    });

    function showError(message) {
      if (!errorBox) return;
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    function validate() {
      var problems = 0;
      var checks = [
        ['#firstName', function (v) { return v.trim().length >= 1; }, 'Enter your first name.'],
        ['#lastName', function (v) { return v.trim().length >= 1; }, 'Enter your last name.'],
        ['#email', isValidEmail, 'Enter a valid email address.'],
        ['#phone', isValidPhone, 'Enter a 10-digit mobile number.']
      ];

      checks.forEach(function (check) {
        var input = $(check[0], form);
        if (!input) return;
        if (check[1](input.value)) {
          setFieldError(input, '');
        } else {
          setFieldError(input, check[2]);
          problems++;
        }
      });

      var extra = $('#extra', form);
      if (extra && extra.required && !extra.value.trim()) {
        setFieldError(extra, 'This field is required.');
        problems++;
      }

      var consent = $('#consent', form);
      if (consent && !consent.checked) {
        setFieldError(consent, 'Please check the box so we can send you the link.');
        problems++;
      }

      if (problems) {
        var firstBad = $('[aria-invalid="true"]', form);
        if (firstBad) firstBad.focus();
      }
      return problems === 0;
    }

    function payload() {
      var data = {};
      new FormData(form).forEach(function (value, key) {
        if (key === 'company_website') return; // honeypot, never forwarded
        data[key] = value;
      });

      data.consent = !!$('#consent', form).checked;
      data.phone = digits(data.phone);
      data.webinar_slug = article.getAttribute('data-slug');
      data.webinar_title = article.getAttribute('data-title');
      data.webinar_starts_at = article.getAttribute('data-start');
      data.page_url = window.location.href;
      data.referrer = document.referrer || '';
      data.submitted_at = new Date().toISOString();

      var tracking = trackingParams();
      Object.keys(tracking).forEach(function (key) { data[key] = tracking[key]; });

      return data;
    }

    function rememberForThankYou() {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          title: article.getAttribute('data-title'),
          slug: article.getAttribute('data-slug'),
          start: article.getAttribute('data-start'),
          ics: '/webinars/' + article.getAttribute('data-slug') + '/' + article.getAttribute('data-slug') + '.ics',
          google: (function () {
            var link = $('.calendar-links a[href*="calendar.google.com"]', article);
            return link ? link.href : '';
          })(),
          zoom: article.getAttribute('data-zoom') || ''
        }));
      } catch (err) { /* private browsing: not worth failing the signup over */ }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (errorBox) errorBox.hidden = true;

      // Bots fill hidden fields. Pretend it worked and drop it.
      var honeypot = $('#company_website', form);
      if (honeypot && honeypot.value) {
        window.location.href = '/thank-you/';
        return;
      }

      if (!validate()) return;

      var endpoints = parseEndpoints(article);
      var zoom = article.getAttribute('data-zoom');

      if (!endpoints.length && !zoom) {
        showError('Registration for this class is not open yet. Please check back shortly.');
        return;
      }

      rememberForThankYou();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving your seat...';

      // Nowhere to record the lead: the form is just a front door for Zoom.
      if (!endpoints.length) {
        window.location.href = zoom;
        return;
      }

      var data = payload();

      Promise.all(
        endpoints.map(function (dest) {
          return withTimeout(postLead(dest, data), 8000, {
            name: dest.name || 'Webhook',
            required: dest.required !== false,
            ok: false,
            timedOut: true
          });
        })
      ).then(function (results) {
        var failedRequired = [];

        results.forEach(function (r) {
          if (r.ok) return;
          // Surfaced for debugging; a non-required failure never reaches the user.
          if (window.console && console.warn) {
            console.warn('Registration not confirmed by ' + r.name + ':',
              r.timedOut ? 'timed out' : (r.error || 'HTTP ' + r.status));
          }
          if (r.required) failedRequired.push(r);
        });

        // Never strand a registrant: if Zoom is configured, send them there
        // regardless of what the back end did.
        if (!failedRequired.length || zoom) {
          window.location.href = zoom || '/thank-you/';
          return;
        }

        submitBtn.disabled = false;
        submitBtn.textContent = 'Save my seat';
        showError('Something went wrong on our end. Please try again, or email us and we will register you manually.');
      });
    });
  }

  /* ------------------------------------------------------- thank-you page */

  function initThankYou() {
    var slot = $('[data-calendar-links]');
    if (!slot) return;

    var saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    } catch (err) {
      saved = null;
    }
    if (!saved) return;

    var detail = $('[data-thanks-detail]');
    if (detail && saved.title) {
      detail.textContent =
        'You are registered for ' + saved.title + '. Check your email for the Zoom link — it usually arrives within a couple of minutes.';
    }

    var html = '';
    if (saved.google) {
      html += '<a class="btn btn--ghost" href="' + saved.google + '" target="_blank" rel="noopener noreferrer">Google Calendar</a>';
    }
    if (saved.ics) {
      html += '<a class="btn btn--ghost" href="' + saved.ics + '" download>Apple / Outlook</a>';
    }
    slot.innerHTML = html;
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    var article = $('.webinar');
    if (article) {
      var start = new Date(article.getAttribute('data-start'));
      if (!isNaN(start.getTime())) {
        initLocalTime(article, start);
        initCountdown(article, start);
      }
      initForm(article);
      initStickyCta(article);
    }
    initThankYou();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
