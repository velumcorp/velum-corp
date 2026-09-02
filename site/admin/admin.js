/* ==========================================================================
   VELUM ENTERPRISE - admin panel

   WHAT IS EDITABLE
   ----------------
   Every element on the site that carries a data-en attribute. That attribute
   already exists on every translatable string, so it doubles as the list of
   editable text without adding any new markup. It also means Spanish and
   English are always edited as a pair, which is the thing a generic
   click-to-edit tool gets wrong: it would change one and leave the other
   stale.

   HOW IT WRITES
   -------------
   By splicing strings, not by parsing and re-serialising. A DOMParser round
   trip would reformat the whole file and produce an unreadable diff on every
   save. Instead each editable element is located in the raw source, its two
   spans are recorded (the data-en attribute value, and the inner HTML), and
   edits are applied back-to-front so earlier offsets stay valid. A save
   touches only the characters that actually changed.
   ========================================================================== */
(function () {
  'use strict';

  var API = '/.netlify/functions/admin-api';

  var el = function (id) { return document.getElementById(id); };
  var gate = el('gate'), app = el('app');
  var state = {
    sites: [], site: null, page: null,
    source: '', sha: null, spans: [], edits: {}, prevLang: 'es'
  };

  /* ============================ 1. auth ================================= */
  var identity = window.netlifyIdentity;

  function showGate(msg, kind) {
    gate.hidden = false; app.hidden = true;
    var note = el('gate-note');
    note.textContent = msg || '';
    if (kind) note.setAttribute('data-kind', kind); else note.removeAttribute('data-kind');
  }

  if (!identity) {
    showGate('No se pudo cargar el inicio de sesión. Revisa la conexión.', 'error');
    return;
  }

  /* If Identity cannot reach its endpoint the widget never fires 'init', and a
     page that only reveals itself on init would sit blank forever. The gate is
     therefore the default view, and this only reports when init is late. */
  var inited = false;
  identity.on('init', function (user) {
    inited = true;
    user ? start(user) : showGate();
  });
  setTimeout(function () {
    if (!inited) {
      showGate(
        'No se pudo contactar con el servicio de identidad. En local esto es ' +
        'normal: el panel solo funciona en el sitio publicado.', 'error');
    }
  }, 4000);
  identity.on('login', function (user) { identity.close(); start(user); });
  identity.on('logout', function () { location.reload(); });
  identity.on('error', function (e) { showGate(String(e && e.message || e), 'error'); });
  identity.init();

  el('login').addEventListener('click', function () { identity.open('login'); });
  el('logout').addEventListener('click', function () { identity.logout(); });

  function token() {
    var u = identity.currentUser();
    return u ? u.jwt() : Promise.reject(new Error('No hay sesión.'));
  }

  function api(path, options) {
    return token().then(function (t) {
      return fetch(API + (path || ''), Object.assign({}, options, {
        headers: Object.assign(
          { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          (options && options.headers) || {}
        )
      }));
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ('Error ' + res.status));
        return body;
      });
    });
  }

  function escapeText(str) {
    var d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /* ============================ 2. status =============================== */
  function say(msg, kind) {
    var s = el('status');
    if (!msg) { s.hidden = true; return; }
    s.hidden = false;
    s.textContent = msg;
    s.setAttribute('data-kind', kind || 'busy');
  }

  /* ============================ 3. start =============================== */
  function start(user) {
    gate.hidden = true; app.hidden = false;
    el('who').textContent = user.email;
    say('Cargando…');

    api('').then(function (data) {
      state.sites = data.sites || [];
      var sel = el('site');
      sel.innerHTML = state.sites
        .map(function (s) { return '<option value="' + s.key + '">' + s.key + '</option>'; })
        .join('');
      sel.disabled = false;
      el('page').disabled = false;
      sel.addEventListener('change', fillPages);
      el('page').addEventListener('change', loadPage);
      fillPages();
    }).catch(function (e) {
      /* Leave the controls visibly out of action rather than as empty stubs,
         which read as a broken layout instead of a failed load. */
      ['site', 'page'].forEach(function (id) {
        el(id).innerHTML = '<option>No disponible</option>';
        el(id).disabled = true;
      });
      el('fields').innerHTML =
        '<p class="muted pad">No se pudieron cargar las páginas.<br>' +
        (/GITHUB_TOKEN/.test(e.message)
          ? 'Falta configurar el acceso a GitHub en Netlify. Consulta ADMIN.md, pasos 2 y 3.'
          : escapeText(e.message)) + '</p>';
      say(e.message, 'error');
      if (/role|sign in/i.test(e.message)) showGate(e.message, 'error');
    });
  }

  function currentSite() {
    return state.sites.filter(function (s) { return s.key === el('site').value; })[0];
  }

  function fillPages() {
    var site = currentSite();
    if (!site) return;
    el('page').innerHTML = site.pages
      .map(function (p) { return '<option value="' + p.path + '">' + p.label + '</option>'; })
      .join('');
    loadPage();
  }

  /* ==================== 4. find the editable spans ====================== */
  /* Locate every element carrying data-en, and record where its attribute
     value and its inner HTML live in the raw source. Nesting is handled by
     counting opening and closing tags of the same name. */
  function findSpans(src) {
    var spans = [];
    var re = /<([a-zA-Z][\w-]*)\b([^>]*\sdata-en\s*=\s*"([^"]*)")([^>]*)>/g;
    var m;

    while ((m = re.exec(src))) {
      var tag = m[1].toLowerCase();
      var whole = m[0];
      if (/\/>$/.test(whole)) continue;               /* self-closing, no inner text */

      /* where the data-en value sits inside the source */
      var attrRel = whole.indexOf(m[3], whole.indexOf('data-en'));
      var attrStart = m.index + attrRel;

      /* walk forward to the matching close tag */
      var innerStart = m.index + whole.length;
      var depth = 1, i = innerStart;
      var scan = new RegExp('<(/?)' + tag + '\\b', 'gi');
      scan.lastIndex = innerStart;
      var t, innerEnd = -1;
      while ((t = scan.exec(src))) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) { innerEnd = t.index; break; }
      }
      if (innerEnd === -1) continue;                  /* unbalanced, skip it */

      spans.push({
        i: spans.length,
        tag: tag,
        attrStart: attrStart,
        attrEnd: attrStart + m[3].length,
        innerStart: innerStart,
        innerEnd: innerEnd,
        es: src.slice(innerStart, innerEnd),
        en: m[3]
      });
      re.lastIndex = innerStart;                      /* allow nested matches */
    }
    return spans;
  }

  function decode(s) {
    var d = document.createElement('textarea');
    d.innerHTML = s;
    return d.value;
  }
  function encodeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /* Rebuild the file with every edit applied, back to front. */
  function render(src, spans, edits) {
    var out = src;
    var ordered = spans.slice().sort(function (a, b) { return b.innerStart - a.innerStart; });
    ordered.forEach(function (sp) {
      var e = edits[sp.i];
      if (!e) return;
      if (e.es !== undefined) {
        out = out.slice(0, sp.innerStart) + e.es + out.slice(sp.innerEnd);
      }
      if (e.en !== undefined) {
        out = out.slice(0, sp.attrStart) + encodeAttr(e.en) + out.slice(sp.attrEnd);
      }
    });
    return out;
  }

  /* ========================= 5. load a page ============================ */
  function loadPage() {
    var site = currentSite();
    var path = el('page').value;
    if (!site || !path) return;

    say('Cargando la página…');
    state.edits = {};
    markDirty();

    api('?site=' + encodeURIComponent(site.key) + '&path=' + encodeURIComponent(path))
      .then(function (data) {
        state.site = site.key;
        state.page = path;
        state.source = data.html;
        state.sha = data.sha;
        state.spans = findSpans(data.html);
        renderFields();
        refreshPreview();
        say(state.spans.length + ' textos editables en esta página.', 'ok');
        setTimeout(function () { say(''); }, 2500);
      })
      .catch(function (e) { say(e.message, 'error'); });
  }

  /* ========================== 6. field list ============================ */
  function labelFor(sp) {
    var text = decode(sp.es).replace(/<[^>]+>/g, ' ').trim();
    return text ? text.slice(0, 46) : '(' + sp.tag + ')';
  }

  function renderFields() {
    var box = el('fields');
    if (!state.spans.length) {
      box.innerHTML = '<p class="muted pad">Esta página no tiene textos marcados como editables.</p>';
      return;
    }
    box.innerHTML = state.spans.map(function (sp) {
      var hasMarkup = /<[a-z]/i.test(sp.es);
      return '' +
        '<div class="field" data-i="' + sp.i + '">' +
          '<div class="field__meta">' +
            '<span class="field__tag">' + sp.tag + '</span>' +
            '<button type="button" class="field__jump" data-jump="' + sp.i + '">Ver en la página</button>' +
          '</div>' +
          (hasMarkup
            ? '<p class="field__html">Contiene formato (por ejemplo &lt;br&gt;). Consérvalo tal cual.</p>'
            : '') +
          '<div class="field__pair">' +
            '<span class="field__lang">ES</span>' +
            '<textarea data-i="' + sp.i + '" data-lang="es" rows="2"></textarea>' +
            '<span class="field__lang">EN</span>' +
            '<textarea data-i="' + sp.i + '" data-lang="en" rows="2"></textarea>' +
          '</div>' +
        '</div>';
    }).join('');

    /* set values as properties, so no escaping games in the markup above */
    state.spans.forEach(function (sp) {
      box.querySelector('textarea[data-i="' + sp.i + '"][data-lang="es"]').value = sp.es;
      box.querySelector('textarea[data-i="' + sp.i + '"][data-lang="en"]').value = decode(sp.en);
    });

    box.addEventListener('input', onEdit);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-jump]');
      if (b) jumpTo(Number(b.dataset.jump));
    });
  }

  function onEdit(e) {
    var ta = e.target;
    if (ta.tagName !== 'TEXTAREA') return;
    var i = Number(ta.dataset.i), lang = ta.dataset.lang;
    var sp = state.spans[i];
    var original = lang === 'es' ? sp.es : decode(sp.en);

    state.edits[i] = state.edits[i] || {};
    if (ta.value === original) {
      delete state.edits[i][lang];
      if (!Object.keys(state.edits[i]).length) delete state.edits[i];
    } else {
      state.edits[i][lang] = ta.value;
    }
    ta.closest('.field').setAttribute('data-changed', String(!!state.edits[i]));
    markDirty();
    schedulePreview();
  }

  /* ========================== 7. preview =============================== */
  var previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 400);
  }

  function refreshPreview() {
    if (!state.source) return;
    var html = render(state.source, state.spans, state.edits);

    /* Root-relative asset paths need a base to resolve inside srcdoc. Mark
       each editable element so "Ver en la página" can scroll to it. */
    html = html
      .replace(/<head>/i, '<head><base href="' + location.origin + '/">')
      .replace(/(<[a-zA-Z][\w-]*\b[^>]*\sdata-en\s*=)/g, function (m0) { return m0; });

    var frame = el('preview');
    frame.srcdoc = html;
    frame.onload = function () {
      try {
        var doc = frame.contentDocument;
        doc.querySelectorAll('[data-en]').forEach(function (node, idx) {
          node.setAttribute('data-admin-i', idx);
        });
        if (state.prevLang === 'en') {
          var btn = doc.querySelector('.lang button[data-lang="en"]');
          if (btn) btn.click();
        }
      } catch (err) { /* cross-origin guard, not expected with srcdoc */ }
    };
  }

  function jumpTo(i) {
    var frame = el('preview');
    try {
      var node = frame.contentDocument.querySelector('[data-admin-i="' + i + '"]');
      if (!node) return;
      node.scrollIntoView({ block: 'center' });
      var prev = node.style.outline;
      node.style.outline = '2px solid #D4AF37';
      node.style.outlineOffset = '3px';
      setTimeout(function () { node.style.outline = prev; }, 1600);
    } catch (err) { /* ignore */ }
  }

  document.querySelectorAll('[data-prev-lang]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.prevLang = b.dataset.prevLang;
      document.querySelectorAll('[data-prev-lang]').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      refreshPreview();
    });
  });

  el('filter').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.field').forEach(function (f) {
      var i = Number(f.dataset.i);
      var hay = (state.spans[i].es + ' ' + state.spans[i].en).toLowerCase();
      f.hidden = q && hay.indexOf(q) === -1;
    });
  });

  /* =========================== 8. saving =============================== */
  function markDirty() {
    var n = Object.keys(state.edits).length;
    el('dirty').hidden = n === 0;
    el('dirty').textContent = n + (n === 1 ? ' cambio sin guardar' : ' cambios sin guardar');
    el('save').disabled = n === 0;
    el('revert').disabled = n === 0;
  }

  el('revert').addEventListener('click', function () {
    if (!confirm('¿Descartar todos los cambios sin guardar?')) return;
    state.edits = {};
    renderFields();
    refreshPreview();
    markDirty();
  });

  el('save').addEventListener('click', function () {
    var html = render(state.source, state.spans, state.edits);
    el('save').disabled = true;
    say('Guardando…');

    api('', {
      method: 'PUT',
      body: JSON.stringify({
        site: state.site,
        path: state.page,
        html: html,
        sha: state.sha,
        summary: el('summary').value.trim()
      })
    }).then(function (res) {
      state.source = html;
      state.sha = res.sha;
      state.spans = findSpans(html);
      state.edits = {};
      el('summary').value = '';
      renderFields();
      markDirty();
      el('saved').textContent = 'Guardado. El sitio se actualiza en un par de minutos.';
      say('Guardado y publicándose.', 'ok');
      setTimeout(function () { say(''); }, 4000);
    }).catch(function (e) {
      say(e.message, 'error');
      markDirty();
    });
  });

  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(state.edits).length) { e.preventDefault(); e.returnValue = ''; }
  });
})();
