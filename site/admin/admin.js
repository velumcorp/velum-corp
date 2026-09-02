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
  /* The chosen page lives in a real <select> so load and save keep one source
     of truth; the modal is only a friendlier way to set it. */
  var hiddenPage = document.createElement('select');
  hiddenPage.id = 'page';
  hiddenPage.hidden = true;
  document.documentElement.appendChild(hiddenPage);
  var gate = el('gate'), app = el('app');
  var state = {
    sites: [], site: null, page: null,
    source: '', sha: null, spans: [], edits: {}, prevLang: 'es',
    sections: [], order: null, hidden: {}, images: [], imgEdits: {}, assets: []
  };

  /* ============================ 1. auth =================================
     On localhost the Identity widget cannot even read its settings: it asks the
     deployed site, which sits behind Netlify's password and answers with an
     HTML login page where JSON is expected. So local development talks to
     tools/dev-server.py instead, which serves the same API against the files on
     disk and needs no login.

     This bypass is cosmetic and client-side only. It cannot be used to reach
     the live site: Netlify validates the Identity token before the real
     function runs, so a request without one never gets a user and is refused
     server-side no matter what the browser claims. */
  var LOCAL = ['localhost', '127.0.0.1', '::1'].indexOf(location.hostname) !== -1;
  var identity = window.netlifyIdentity;

  function showGate(msg, kind) {
    gate.hidden = false; app.hidden = true;
    var note = el('gate-note');
    note.textContent = msg || '';
    if (kind) note.setAttribute('data-kind', kind); else note.removeAttribute('data-kind');
  }

  /* Branch, never return: everything below this point still has listeners to
     register. An early return here silently leaves the save button wired to
     nothing, which looks exactly like a working button that does not work. */
  if (LOCAL) {
    document.title = 'LOCAL · ' + document.title;
    start({ email: 'modo local · sin sesión' });

  } else if (!identity) {
    showGate('No se pudo cargar el inicio de sesión. Revisa la conexión.', 'error');

  } else {
    /* If Identity cannot reach its endpoint the widget never fires 'init', and
       a page that only reveals itself on init would sit blank forever. The gate
       is the default view, and this only reports when init is late. */
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
  }

  el('login').addEventListener('click', function () {
    if (identity) identity.open('login');
  });
  el('logout').addEventListener('click', function () {
    if (LOCAL) { location.reload(); return; }
    identity.logout();
  });

  function token() {
    if (LOCAL) return Promise.resolve('local-dev');
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

    /* the image library is a static file, so it needs no API call and works
       the same locally and deployed. Regenerate it with
       tools/build-image-manifest.py after adding images. */
    fetch('/assets/img/manifest.json')
      .then(function (r) { return r.ok ? r.json() : { images: [] }; })
      .catch(function () { return { images: [] }; })
      .then(function (m) { state.assets = m.images || []; });

    api('').then(function (data) {
      state.sites = data.sites || [];
      var sel = el('site');
      sel.innerHTML = state.sites
        .map(function (s) { return '<option value="' + s.key + '">' + s.key + '</option>'; })
        .join('');
      sel.disabled = false;
      el('page').disabled = false;
      sel.addEventListener('change', fillPages);
      fillPages();
    }).catch(function (e) {
      /* Leave the controls visibly out of action rather than as empty stubs,
         which read as a broken layout instead of a failed load. */
      ['site', 'page'].forEach(function (id) {
        el(id).innerHTML = '<option>No disponible</option>';
        el(id).disabled = true;
      });
      el('body').innerHTML =
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
    el('who').textContent = site.key;
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
  /* Three stages, in this order, and the order matters:
       1. text   - rewrites only the inside of data-en elements
       2. images - rewrites whole <img> tags, whose offsets stage 1 cannot move
       3. sections - rewrites whole blocks, so it must come after anything that
                     addresses a position inside them
     Every stage works back to front so earlier offsets stay valid. */
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

    if (Object.keys(state.imgEdits).length) {
      var imgs = findImages(out);
      imgs.slice().sort(function (a, b) { return b.start - a.start; }).forEach(function (im) {
        var to = state.imgEdits[im.i];
        if (!to || to === im.family) return;
        out = out.slice(0, im.start) +
              swapImage(im.tag, im.family, to, assetFor(to)) +
              out.slice(im.end);
      });
    }

    if (state.order && moved()) out = applySections(out, state.order, state.hidden);
    return out;
  }

  function assetFor(family) {
    for (var i = 0; i < state.assets.length; i++) {
      if (state.assets[i].family === family) return state.assets[i];
    }
    return null;
  }


  /* ================== 4b. sections: find, move, hide =====================
     Sections are addressed by the data-block id stamped in the source, never
     by position. This is the lesson from Template Forge's selector module: an
     nth-of-type path is a route and breaks the moment anything moves above it,
     which is precisely what reordering does. A stamped id is a landmark and
     survives every move. */
  function findSections(src) {
    var out = [];
    var mStart = src.indexOf('<main');
    var mEnd = src.indexOf('</main>');
    if (mStart === -1 || mEnd === -1) return out;

    var re = /<section\b([^>]*)>/g;
    re.lastIndex = mStart;
    var m;
    while ((m = re.exec(src)) && m.index < mEnd) {
      var before = src.slice(mStart, m.index);
      /* top level only: every section opened before this one is already closed */
      if ((before.match(/<section\b/g) || []).length !==
          (before.match(/<\/section>/g) || []).length) continue;

      var depth = 1, i = m.index + m[0].length, end = -1;
      var scan = /<(\/?)section\b/g;
      scan.lastIndex = i;
      var t;
      while ((t = scan.exec(src))) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) { end = t.index + t[0].length; break; }
      }
      end = src.indexOf('>', end);
      if (end === -1) continue;
      end += 1;

      var attrs = m[1];
      var id = (attrs.match(/data-block="([^"]*)"/) || [])[1] || '';
      var inner = src.slice(m.index + m[0].length, end);
      var heading = (inner.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/) || [])[1] || '';
      heading = heading.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      /* Absorb the whitespace and any HTML comment directly above the section.
         The comment describes the section, so it must travel with it. Without
         this the reorder joined sections with a single separator and silently
         deleted every comment in <main>. */
      var gapFrom = out.length ? out[out.length - 1].end : src.indexOf('>', mStart) + 1;
      var gap = src.slice(gapFrom, m.index);
      var lead = (gap.match(/(\s*(?:<!--[\s\S]*?-->\s*)*)$/) || ['', ''])[1];
      var fixed = gap.slice(0, gap.length - lead.length);

      out.push({
        id: id,
        start: m.index - lead.length,
        end: end,
        lead: lead,
        /* anything other than whitespace and comments between two sections is
           real page content. It cannot be carried along, so its presence makes
           the run unsafe to reorder, and it must be written back verbatim when
           the order is unchanged. houses.html puts article rows here. */
        fixedRaw: fixed,
        fixedBefore: fixed.trim(),
        html: src.slice(m.index, end),
        hidden: /\shidden(\s|=|>)/.test(attrs),
        heading: heading,
        kind: /class="[^"]*\bband\b/.test(attrs) ? 'imagen a página completa'
            : /class="[^"]*\bhero\b/.test(attrs) ? 'portada'
            : /class="[^"]*\bmanifiesto|manifesto\b/.test(attrs) ? 'manifiesto'
            : 'sección'
      });
      re.lastIndex = end;
    }
    return out;
  }

  /* True only when nothing but whitespace and comments sits between sections.
     houses.html puts article rows in a .shell div between them; moving a
     section across that would drag unrelated content with it. */
  function reorderable(secs) {
    return secs.length > 1 && secs.every(function (x, i) { return i === 0 || !x.fixedBefore; });
  }

  /* Rebuild the run of sections in the given order. Each block carries its own
     leading whitespace and comment, so concatenating them preserves both. */
  function applySections(src, order, hidden) {
    var secs = findSections(src);
    if (!secs.length) return src;
    var byId = {};
    secs.forEach(function (x) { byId[x.id] = x; });

    var orig = secs.map(function (x) { return x.id; });
    var reordered = orig.join('|') !== order.join('|');
    if (reordered && !reorderable(secs)) return src;   /* refuse rather than mangle */

    var leads = secs.map(function (x) { return x.lead; });

    var pieces = order.map(function (id, idx) {
      var sec = byId[id];
      if (!sec) return '';
      var html = sec.html;
      var head = html.slice(0, html.indexOf('>') + 1);
      var isHidden = /\shidden(\s|=|>)/.test(head);
      if (hidden[id] && !isHidden) {
        html = html.replace(/^<section\b/, '<section hidden');
      } else if (!hidden[id] && isHidden) {
        html = html.replace(/^(<section\b[^>]*?)\shidden(?=[\s>])/, '$1');
      }
      /* Not reordering: put back everything that sat before this section,
         including any page content. Reordering: that case is already refused
         unless every gap was pure whitespace and comments, so fixedRaw is
         empty and only the slot's own spacing matters. */
      return reordered ? (leads[idx] + html) : (sec.fixedRaw + sec.lead + html);
    });

    var first = secs[0], last = secs[secs.length - 1];
    return src.slice(0, first.start) + pieces.join('') + src.slice(last.end);
  }

  /* ===================== 4c. images ==================================== */
  var IMG_RE = /<img\b[^>]*>/g;

  function findImages(src) {
    var out = [], m;
    IMG_RE.lastIndex = 0;
    while ((m = IMG_RE.exec(src))) {
      var tag = m[0];
      var src_ = (tag.match(/\ssrc="([^"]*)"/) || [])[1] || '';
      if (src_.indexOf('/assets/img/') !== 0) continue;   /* logos and icons stay put */
      out.push({
        i: out.length,
        start: m.index,
        end: m.index + tag.length,
        tag: tag,
        src: src_,
        family: familyOf(src_),
        alt: (tag.match(/\salt="([^"]*)"/) || [])[1] || ''
      });
    }
    return out;
  }

  function familyOf(url) {
    var file = url.split('/').pop();
    var m = file.match(/^(.+?)-\d+\.(webp|jpg)$/);
    return m ? m[1] : file.replace(/\.(webp|jpg)$/, '');
  }

  /* Swap one image family for another across src, srcset and the intrinsic
     size, so the tag stays internally consistent. */
  function swapImage(tag, from, to, meta) {
    var out = tag.split(from + '-').join(to + '-').split(from + '.').join(to + '.');
    if (meta && meta.w) {
      out = out.replace(/\swidth="\d+"/, ' width="' + meta.w + '"')
               .replace(/\sheight="\d+"/, ' height="' + meta.h + '"');
    }
    return out;
  }

  /* ========================= 5. load a page ============================ */
  function loadPage() {
    var site = currentSite();
    var path = el('page').value;
    if (!site || !path) return;

    say('Cargando la página…');
    state.edits = {};
    state.imgEdits = {};
    state.order = null;
    markDirty();

    api('?site=' + encodeURIComponent(site.key) + '&path=' + encodeURIComponent(path))
      .then(function (data) {
        state.site = site.key;
        state.page = path;
        state.source = data.html;
        state.sha = data.sha;
        state.spans = findSpans(data.html);
        state.sections = findSections(data.html);
        state.order = state.sections.map(function (x) { return x.id; });
        state.hidden = {};
        state.sections.forEach(function (x) { state.hidden[x.id] = x.hidden; });
        state.images = findImages(data.html);
        state.imgEdits = {};
        var lbl = (currentSite().pages.filter(function (p) { return p.path === path; })[0] || {}).label;
        el('page-name').textContent = lbl || path;
        if (!isPhone()) openSheet(view); else draw();
        refreshPreview();
        say(state.spans.length + ' textos editables en esta página.', 'ok');
        setTimeout(function () { say(''); }, 2500);
      })
      .catch(function (e) { say(e.message, 'error'); });
  }

  /* ======================= 6. the inspector ===========================
     One surface, three views. A view is either browsed from the dock or
     entered by tapping something in the page, which is the move borrowed from
     Template Forge: select on the canvas, edit in the panel. */

  var view = 'text';               /* 'text' | 'sections' | 'images' */
  var focusOn = null;              /* show a single item instead of the list */

  function isPhone() { return window.matchMedia('(max-width: 859px)').matches; }

  /* Has the section order or any hidden flag changed since the page loaded? */
  function moved() {
    if (!state.order || !state.sections.length) return false;
    var orig = state.sections.map(function (x) { return x.id; });
    if (orig.join('|') !== state.order.join('|')) return true;
    return state.sections.some(function (x) { return !!state.hidden[x.id] !== !!x.hidden; });
  }

  function openSheet(which, only) {
    view = which;
    focusOn = (only === undefined) ? null : only;
    el('sheet').hidden = false;
    el('scrim').hidden = !isPhone();
    el('filter').hidden = !(which === 'text' && focusOn === null);
    el('sheet-title').textContent =
      which === 'sections' ? 'Secciones' :
      which === 'images' ? (focusOn === null ? 'Imágenes' : 'Imagen') :
      (focusOn === null ? 'Textos' : 'Texto');
    document.querySelectorAll('.dock [data-view]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.view === which && focusOn === null));
    });
    draw();
  }

  function closeSheet() {
    focusOn = null;
    if (!isPhone()) { draw(); return; }     /* on desktop the column stays put */
    el('sheet').hidden = true;
    el('scrim').hidden = true;
    document.querySelectorAll('.dock [data-view]').forEach(function (b) {
      b.setAttribute('aria-pressed', 'false');
    });
  }

  function draw() {
    var box = el('body');
    if (!state.source) { box.innerHTML = '<p class="muted pad">Elige una página.</p>'; return; }
    box.innerHTML = view === 'sections' ? drawSections()
                  : view === 'images' ? drawImages()
                  : drawText();
    if (view === 'text') syncTextValues();
  }

  /* ---- text ---- */
  function drawText() {
    var list = focusOn === null ? state.spans : [state.spans[focusOn]];
    if (!list.length || !list[0]) return '<p class="muted pad">Nada que editar aquí.</p>';
    return list.map(function (sp) {
      var markup = /<[a-z]/i.test(sp.es);
      return '' +
        '<div class="row" data-i="' + sp.i + '" data-changed="' + (!!state.edits[sp.i]) + '">' +
          '<div class="row__top">' +
            '<span class="row__tag">' + sp.tag + '</span>' +
            '<button class="row__see" data-see="' + sp.i + '">Ver en la página</button>' +
          '</div>' +
          (markup ? '<p class="row__note">Contiene formato, por ejemplo &lt;br&gt;. Consérvalo.</p>' : '') +
          '<div class="pair">' +
            '<span>ES</span><textarea data-i="' + sp.i + '" data-lang="es" rows="2"></textarea>' +
            '<span>EN</span><textarea data-i="' + sp.i + '" data-lang="en" rows="2"></textarea>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  /* assigned as properties, so nothing has to be escaped into the markup */
  function syncTextValues() {
    el('body').querySelectorAll('textarea[data-i]').forEach(function (ta) {
      var sp = state.spans[Number(ta.dataset.i)];
      if (!sp) return;
      var e = state.edits[sp.i] || {};
      ta.value = ta.dataset.lang === 'es'
        ? (e.es !== undefined ? e.es : sp.es)
        : (e.en !== undefined ? e.en : decode(sp.en));
    });
  }

  /* ---- sections ---- */
  function drawSections() {
    if (!state.order || !state.order.length) return '<p class="muted pad">Esta página no tiene secciones.</p>';
    var orig = state.sections.map(function (x) { return x.id; });
    var canMove = reorderable(state.sections);
    return (canMove ? '' :
      '<p class="muted pad small">Aquí hay contenido entre las secciones, así que no se ' +
      'pueden reordenar sin arrastrarlo. Sí se pueden ocultar.</p>') +
      state.order.map(function (id, idx) {
        var sec = state.sections.filter(function (x) { return x.id === id; })[0] || {};
        var isHidden = !!state.hidden[id];
        var isMoved = orig[idx] !== id || isHidden !== !!sec.hidden;
        return '' +
          '<div class="sec" data-id="' + id + '" data-moved="' + isMoved + '" data-hidden="' + isHidden + '">' +
            '<span class="sec__name">' + escapeText(sec.heading || id) +
              '<span class="sec__what">' + escapeText(sec.kind || '') + ' · ' + escapeText(id) + '</span>' +
            '</span>' +
            '<span class="sec__acts">' +
              '<button data-act="up" data-id="' + id + '" aria-label="Subir"' + (idx === 0 || !canMove ? ' disabled' : '') + '>&uarr;</button>' +
              '<button data-act="down" data-id="' + id + '" aria-label="Bajar"' + (idx === state.order.length - 1 || !canMove ? ' disabled' : '') + '>&darr;</button>' +
              '<button data-act="hide" data-id="' + id + '" aria-label="Mostrar u ocultar" data-on="' + isHidden + '">' + (isHidden ? 'OFF' : 'ON') + '</button>' +
              '<button data-act="see" data-id="' + id + '" aria-label="Ver">&rarr;</button>' +
            '</span>' +
          '</div>';
      }).join('');
  }

  /* ---- images ---- */
  function drawImages() {
    var list = focusOn === null ? state.images : [state.images[focusOn]];
    if (!list.length || !list[0]) return '<p class="muted pad">Esta página no usa fotografías intercambiables.</p>';
    return list.map(function (im) {
      var current = state.imgEdits[im.i] || im.family;
      var meta = assetFor(current);
      return '' +
        '<div class="img" data-i="' + im.i + '" data-changed="' + (!!state.imgEdits[im.i]) + '">' +
          '<div class="img__top">' +
            '<img src="' + (meta ? meta.thumb : im.src) + '" alt="">' +
            '<div>' +
              '<p class="img__alt">' + escapeText(im.alt || 'sin texto alternativo') + '</p>' +
              '<span class="img__cur">' + escapeText(current) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="picker">' +
            state.assets.filter(function (a) { return a.widths.length; }).map(function (a) {
              return '<button data-i="' + im.i + '" data-fam="' + a.family + '" ' +
                     'aria-pressed="' + (a.family === current) + '">' +
                     '<img src="' + a.thumb + '" alt="" loading="lazy">' +
                     '<span>' + escapeText(a.label) + '</span></button>';
            }).join('') +
          '</div>' +
        '</div>';
    }).join('');
  }

  /* ---- one delegated listener for the whole inspector ---- */
  el('body').addEventListener('input', function (e) {
    var ta = e.target;
    if (ta.tagName !== 'TEXTAREA') return;
    var i = Number(ta.dataset.i), lang = ta.dataset.lang, sp = state.spans[i];
    var original = lang === 'es' ? sp.es : decode(sp.en);
    state.edits[i] = state.edits[i] || {};
    if (ta.value === original) {
      delete state.edits[i][lang];
      if (!Object.keys(state.edits[i]).length) delete state.edits[i];
    } else {
      state.edits[i][lang] = ta.value;
    }
    var row = ta.closest('.row');
    if (row) row.setAttribute('data-changed', String(!!state.edits[i]));
    markDirty();
    schedulePreview();
  });

  el('body').addEventListener('click', function (e) {
    var see = e.target.closest('[data-see]');
    if (see) { jumpTo(Number(see.dataset.see)); return; }

    var fam = e.target.closest('button[data-fam]');
    if (fam) {
      var i = Number(fam.dataset.i);
      if (state.images[i].family === fam.dataset.fam) delete state.imgEdits[i];
      else state.imgEdits[i] = fam.dataset.fam;
      draw(); markDirty(); schedulePreview();
      return;
    }

    var act = e.target.closest('button[data-act]');
    if (!act) return;
    var id = act.dataset.id, k = state.order.indexOf(id);
    if (act.dataset.act === 'up' && k > 0) {
      state.order.splice(k - 1, 0, state.order.splice(k, 1)[0]);
    } else if (act.dataset.act === 'down' && k < state.order.length - 1) {
      state.order.splice(k + 1, 0, state.order.splice(k, 1)[0]);
    } else if (act.dataset.act === 'hide') {
      state.hidden[id] = !state.hidden[id];
    } else if (act.dataset.act === 'see') {
      jumpToBlock(id); return;
    }
    draw(); markDirty(); schedulePreview();
  });

  el('filter').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    el('body').querySelectorAll('.row').forEach(function (r) {
      var sp = state.spans[Number(r.dataset.i)];
      r.hidden = q && (sp.es + ' ' + sp.en).toLowerCase().indexOf(q) === -1;
    });
  });

  /* ---- dock and sheet ---- */
  document.querySelectorAll('.dock [data-view]').forEach(function (b) {
    b.addEventListener('click', function () {
      var open = !el('sheet').hidden && view === b.dataset.view && focusOn === null;
      if (open && isPhone()) closeSheet(); else openSheet(b.dataset.view);
    });
  });
  el('sheet-close').addEventListener('click', closeSheet);
  el('scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el('pages-modal').hidden) el('pages-modal').hidden = true;
    else if (e.key === 'Escape' && !el('save-modal').hidden) el('save-modal').hidden = true;
    else if (e.key === 'Escape') closeSheet();
  });

  /* ---- page switcher ---- */
  el('pages').addEventListener('click', function () {
    drawPageList();
    el('pages-modal').hidden = false;
  });
  el('pages-cancel').addEventListener('click', function () { el('pages-modal').hidden = true; });
  el('pages-modal').addEventListener('click', function (e) {
    if (e.target === el('pages-modal')) { el('pages-modal').hidden = true; return; }
    var b = e.target.closest('[data-path]');
    if (!b) return;
    el('page').value = b.dataset.path;
    el('pages-modal').hidden = true;
    loadPage();
  });

  function drawPageList() {
    var site = currentSite();
    if (!site) return;
    el('page-list').innerHTML = site.pages.map(function (p) {
      return '<button data-path="' + p.path + '" aria-current="' +
             (p.path === el('page').value) + '">' + escapeText(p.label) + '</button>';
    }).join('');
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
        wireCanvas(doc);
      } catch (err) { /* cross-origin guard, not expected with srcdoc */ }
    };
  }

  /* Tapping the page selects what was tapped: the nearest editable text, or
     the image itself. This is what makes the panel feel like editing the page
     rather than filling in a form about it. */
  function wireCanvas(doc) {
    doc.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('img');
      if (img && (img.getAttribute('src') || '').indexOf('/assets/img/') === 0) {
        var fam = familyOf(img.getAttribute('src'));
        for (var k = 0; k < state.images.length; k++) {
          if (state.images[k].family === fam) { openSheet('images', k); break; }
        }
        e.preventDefault(); return;
      }
      var node = e.target.closest && e.target.closest('[data-admin-i]');
      if (node) {
        openSheet('text', Number(node.getAttribute('data-admin-i')));
        e.preventDefault(); return;
      }
      var sec = e.target.closest && e.target.closest('[data-block]');
      if (sec) openSheet('sections');
    }, true);

    /* links would navigate the preview away from the page being edited */
    doc.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (a) e.preventDefault();
    });

    var hint = el('hint');
    if (hint) setTimeout(function () { hint.hidden = true; }, 4000);
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

  /* =========================== 8. saving =============================== */
  function markDirty() {
    var n = Object.keys(state.edits).length
          + Object.keys(state.imgEdits).length
          + (moved() ? 1 : 0);
    el('dirty-n').textContent = n;
    el('save').disabled = n === 0;
    el('save-label').textContent = n === 0 ? 'Guardar' : 'Guardar';
  }

  el('save').addEventListener('click', function () {
    var n = Object.keys(state.edits).length
          + Object.keys(state.imgEdits).length
          + (moved() ? 1 : 0);
    el('save-summary').textContent =
      n === 1 ? 'Se publicará 1 cambio en esta página.'
              : 'Se publicarán ' + n + ' cambios en esta página.';
    el('saved').textContent = '';
    el('save-modal').hidden = false;
  });
  el('save-cancel').addEventListener('click', function () { el('save-modal').hidden = true; });
  el('save-modal').addEventListener('click', function (e) {
    if (e.target === el('save-modal')) el('save-modal').hidden = true;
  });

  el('revert').addEventListener('click', function () {
    if (!confirm('¿Descartar todos los cambios sin guardar?')) return;
    state.edits = {};
    state.imgEdits = {};
    state.order = state.sections.map(function (x) { return x.id; });
    state.hidden = {};
    state.sections.forEach(function (x) { state.hidden[x.id] = x.hidden; });
    el('save-modal').hidden = true;
    draw();
    refreshPreview();
    markDirty();
  });

  el('save-go').addEventListener('click', function () {
    var html = render(state.source, state.spans, state.edits);
    el('save-go').disabled = true;
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
      state.sections = findSections(html);
      state.order = state.sections.map(function (x) { return x.id; });
      state.hidden = {};
      state.sections.forEach(function (x) { state.hidden[x.id] = x.hidden; });
      state.images = findImages(html);
      state.edits = {};
      state.imgEdits = {};
      el('summary').value = '';
      el('save-modal').hidden = true;
      draw();
      markDirty();
      el('saved').textContent = 'Guardado. El sitio se actualiza en un par de minutos.';
      say('Guardado y publicándose.', 'ok');
      setTimeout(function () { say(''); }, 4000);
      el('save-go').disabled = false;
    }).catch(function (e) {
      say(e.message, 'error');
      el('save-go').disabled = false;
      markDirty();
    });
  });

  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(state.edits).length) { e.preventDefault(); e.returnValue = ''; }
  });
})();
