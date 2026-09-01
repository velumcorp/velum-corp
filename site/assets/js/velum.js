/* ==========================================================================
   VELUM ENTERPRISE - site behaviour
   No scroll listeners anywhere: IntersectionObserver and CSS scroll-driven
   animations only. Everything degrades to a working, readable page if JS
   never runs, and to a static page under prefers-reduced-motion.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------------- 1. Language
     Spanish is the page default and what ships in the HTML, so the site is
     fully readable and indexable without JS. English lives in data-en-*.

     Language changes rewrite innerHTML, which destroys the word and line
     wrappers the motion layer adds. So applyLang fires velum:lang when it is
     done, and the motion layer re-splits on that event. Split always runs
     after applyLang, never before, or the ES cache would capture wrapper
     markup instead of clean text.                                            */
  var LANG_KEY = 'velum.lang';
  var ATTRS = ['placeholder', 'aria-label', 'alt', 'content', 'title'];

  function readStored() {
    try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
  }
  function store(v) {
    try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* private mode */ }
  }

  function applyLang(lang) {
    var en = lang === 'en';
    root.setAttribute('lang', en ? 'en' : 'es');

    document.querySelectorAll('[data-en]').forEach(function (el) {
      if (el.dataset.es === undefined) el.dataset.es = el.innerHTML;
      el.innerHTML = en ? el.dataset.en : el.dataset.es;
    });

    ATTRS.forEach(function (attr) {
      var key = 'data-en-' + attr;
      document.querySelectorAll('[' + key + ']').forEach(function (el) {
        var cache = 'es' + attr.replace(/-/g, '');
        if (el.dataset[cache] === undefined) el.dataset[cache] = el.getAttribute(attr) || '';
        el.setAttribute(attr, en ? el.getAttribute(key) : el.dataset[cache]);
      });
    });

    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
    store(lang);
    document.dispatchEvent(new CustomEvent('velum:lang', { detail: { lang: lang } }));
  }

  function initialLang() {
    var stored = readStored();
    if (stored === 'en' || stored === 'es') return stored;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'es';
    return nav.toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
  }

  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.dataset.lang); });
  });

  /* ---------------------------------------------------------------- 2. Nav */
  var burger = document.querySelector('.burger');
  var nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      nav.setAttribute('data-open', String(!open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        burger.setAttribute('aria-expanded', 'false');
        nav.setAttribute('data-open', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        burger.setAttribute('aria-expanded', 'false');
        nav.setAttribute('data-open', 'false');
        burger.focus();
      }
    });
  }

  /* Hairline under the masthead once the page has moved. A sentinel, not a
     scroll listener: no per-frame work. */
  var mast = document.querySelector('.masthead');
  if (mast && 'IntersectionObserver' in window) {
    var sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:100%;pointer-events:none';
    document.body.prepend(sentinel);
    new IntersectionObserver(function (entries) {
      mast.setAttribute('data-stuck', String(!entries[0].isIntersecting));
    }).observe(sentinel);
  }

  /* --------------------------------------------------------- 3. Text splitting
     Headings are split into masked lines; the manifesto is split into words
     that ink in as the reader passes through them. Both are cosmetic wrappers
     added at runtime, so the source HTML stays plain readable text.           */

  var SPLIT_HEADINGS = 'main h1, main h2, .house__name:not(.house__name--logo)';

  function alreadySplit(el) { return el.querySelector('.rl, .w') !== null; }

  /* Wrap each <br>-separated line in a mask. Inline markup inside a line is
     preserved; only the line breaks are used as split points. */
  function splitLines(el) {
    if (alreadySplit(el)) return;
    // A heading that is really a logotype (AL signs with its own artwork) has
    // no text to mask. Leave the artwork alone.
    if (el.querySelector('img, svg')) return;
    var html = el.innerHTML.trim();
    if (!html || !el.textContent.trim()) return;
    var lines = html.split(/<br\s*\/?>/i);
    // A long unbroken heading would wrap to unpredictable line counts, and the
    // mask only works when the wrapper matches the visual line. Leave it.
    if (lines.length === 1 && el.textContent.trim().length > 46) return;
    el.innerHTML = lines.map(function (line, i) {
      return '<span class="rl"><span class="rl__i" style="--l:' + i + '">' + line + '</span></span>';
    }).join('');
  }

  /* Wrap every word in a span carrying --p, its position through the whole
     passage as a 0..1 number. CSS turns that into either a stagger delay or a
     slice of the scroll range. Text nodes only, so any inline markup survives. */
  function splitWords(container) {
    if (alreadySplit(container)) return;
    var paras = [].slice.call(container.querySelectorAll('p'));
    var total = 0;
    var perPara = paras.map(function (p) {
      var n = (p.textContent.trim().match(/\S+/g) || []).length;
      total += n;
      return n;
    });
    if (!total) return;

    var seen = 0;
    paras.forEach(function (p, pi) {
      if (!perPara[pi]) return;
      var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      var texts = [];
      var n;
      while ((n = walker.nextNode())) texts.push(n);

      texts.forEach(function (node) {
        var parts = node.nodeValue.split(/(\s+)/);
        var frag = document.createDocumentFragment();
        parts.forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
            return;
          }
          var span = document.createElement('span');
          span.className = 'w';
          span.style.setProperty('--p', (seen / Math.max(total - 1, 1)).toFixed(4));
          span.textContent = part;
          seen++;
          frag.appendChild(span);
        });
        node.parentNode.replaceChild(frag, node);
      });
    });
  }

  function splitAll() {
    if (reduced.matches) return;
    document.querySelectorAll(SPLIT_HEADINGS).forEach(splitLines);
    var man = document.querySelector('.manifesto__lines');
    if (man) splitWords(man);
  }

  /* ------------------------------------------------------- 4. Scroll reveals */
  var io = null;

  function observeAll() {
    if (!io) return;
    document.querySelectorAll(
      '[data-reveal], .veilfig, .manifesto__lines, .band, .hrow, main h1, main h2'
    ).forEach(function (el) {
      if (!el.classList.contains('is-in')) io.observe(el);
    });
  }

  if ('IntersectionObserver' in window && !reduced.matches) {
    io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    document.querySelectorAll('[data-reveal-group]').forEach(function (group) {
      group.querySelectorAll('[data-reveal]').forEach(function (el, i) {
        el.style.setProperty('--d', (i * 90) + 'ms');
      });
    });
  } else {
    document.querySelectorAll('[data-reveal], .veilfig, .manifesto__lines, .band, .hrow')
      .forEach(function (el) { el.classList.add('is-in'); });
  }

  /* Language must be applied before anything is split, and everything must be
     re-split after each change, because applyLang rewrites innerHTML. */
  applyLang(initialLang());
  splitAll();
  observeAll();

  document.addEventListener('velum:lang', function () {
    splitAll();
    // Re-split headings lost their .is-in state on the inner spans, not the
    // heading itself, so anything already revealed stays revealed.
    observeAll();
  });

  /* ------------------------------------------------------------- 5. Contact
     Progressive enhancement over a plain Netlify form: without JS the form
     still posts and lands on /gracias.html.                                  */
  var form = document.getElementById('contact-form');
  if (form) {
    var okBox = document.getElementById('form-ok');
    var errBox = document.getElementById('form-err');
    var submit = form.querySelector('button[type="submit"]');

    function setInvalid(field, bad) {
      field.setAttribute('data-invalid', String(bad));
      var input = field.querySelector('input, textarea, select');
      if (input) input.setAttribute('aria-invalid', String(bad));
    }

    function validate() {
      var ok = true;
      var firstBad = null;
      form.querySelectorAll('.field').forEach(function (field) {
        var input = field.querySelector('input[required], textarea[required], select[required]');
        if (!input) return;
        var bad = !input.value.trim() ||
                  (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim()));
        setInvalid(field, bad);
        if (bad) { ok = false; if (!firstBad) firstBad = input; }
      });
      if (firstBad) firstBad.focus();
      return ok;
    }

    form.querySelectorAll('input, textarea, select').forEach(function (input) {
      input.addEventListener('input', function () {
        var field = input.closest('.field');
        if (field && field.getAttribute('data-invalid') === 'true') setInvalid(field, false);
      });
    });

    form.addEventListener('submit', function (e) {
      if (!validate()) { e.preventDefault(); return; }

      var cfg = window.VELUM_FORM || {};
      var fields = cfg.fields || {};
      if (!cfg.formId || !window.fetch) return;   /* not wired yet: post normally */

      e.preventDefault();

      /* Honeypot. A real person never fills a field they cannot see, so if it
         has content, accept the submission visually and send nothing. */
      var hp = form.querySelector('[name="bot-field"]');
      if (hp && hp.value.trim()) {
        form.reset();
        okBox.setAttribute('data-show', 'true');
        return;
      }

      okBox.setAttribute('data-show', 'false');
      errBox.setAttribute('data-show', 'false');
      submit.setAttribute('data-busy', 'true');

      var body = new URLSearchParams();
      Object.keys(fields).forEach(function (name) {
        var entry = fields[name];
        var input = form.elements[name];
        if (entry && input) body.append(entry, input.value);
      });

      /* Google Forms sends no CORS headers, so the response is opaque: a
         resolved promise means the request left the browser, not that Google
         liked it. That is the most any cross-origin form post can tell us. */
      fetch('https://docs.google.com/forms/d/e/' + cfg.formId + '/formResponse', {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }).then(function () {
        form.reset();
        okBox.setAttribute('data-show', 'true');
        okBox.focus();
      }).catch(function () {
        errBox.setAttribute('data-show', 'true');
        errBox.focus();
      }).then(function () {
        submit.removeAttribute('data-busy');
      });
    });
  }

  /* ------------------------------------------------------------ 6. Year */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
