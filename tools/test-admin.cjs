/* ==========================================================================
   Tests for the admin panel's HTML surgery, run against the real shipped
   site/admin/admin.js rather than a copy of it.

       node tools/test-admin.cjs

   Why this exists: the panel rewrites the actual pages of the live site, so a
   mistake here is a broken page in production. Two real bugs were caught by
   these checks that inspecting the UI did not reveal:

     - a section reorder silently deleted every HTML comment in <main>
     - the content between sections on houses.html was dropped

   Both looked perfectly fine on screen. Only a byte comparison found them.
   ========================================================================== */
const fs = require('fs');

const src = fs.readFileSync('site/admin/admin.js', 'utf8');

/* Pull a function out of the shipped file by matching braces, so the test
   exercises the code that actually runs rather than a copy of it. */
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* The panel's own state and helpers, reduced to what the surgery reads. */
const state = { imgEdits: {}, order: null, hidden: {}, assets: [] };
const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const assetFor = () => null;
const moved = () => false;

eval(src.match(/var IMG_RE = [^\n]+/)[0] + '\n' +
  ['findSpans', 'encodeAttr', 'render', 'findSections', 'reorderable',
    'applySections', 'findImages', 'familyOf', 'swapImage'].map(grab).join('\n'));

const files = ['index.html', 'houses.html', 'about.html',
  'contact.html', 'gracias.html', '404.html'];
const count = (s, re) => (s.match(re) || []).length;
let fail = 0;

for (const f of files) {
  const html = fs.readFileSync('site/' + f, 'utf8');
  const spans = findSpans(html);
  const secs = findSections(html);
  const ids = secs.map((s) => s.id);
  const hidden = {};
  secs.forEach((s) => { hidden[s.id] = s.hidden; });
  const imgs = findImages(html);
  const can = reorderable(secs);

  /* ---- text ---------------------------------------------------------- */
  state.imgEdits = {};
  state.order = null;
  const textIdentity = render(html, spans, {}) === html;
  const slicesOk = spans.every((s) =>
    html.slice(s.innerStart, s.innerEnd) === s.es &&
    html.slice(s.attrStart, s.attrEnd) === s.en);

  let textEdit = true;
  let diff = 0;
  if (spans.length) {
    const t = spans.find((s) => !/<[a-z]/i.test(s.es)) || spans[0];
    const out = render(html, spans, { [t.i]: { es: 'PRUEBA_ES', en: 'PROBE_EN' } });
    textEdit = out.includes('PRUEBA_ES') && out.includes('PROBE_EN');
    let a = 0;
    while (a < html.length && html[a] === out[a]) a++;
    let b = 0;
    while (b < html.length - a && html[html.length - 1 - b] === out[out.length - 1 - b]) b++;
    diff = Math.max(html.length, out.length) - a - b;
  }

  /* ---- sections ------------------------------------------------------ */
  const secIdentity = applySections(html, ids, hidden) === html;

  let commentsOk = true;
  let tagsOk = true;
  let orderOk = true;
  if (can && ids.length > 2) {
    const m = ids.slice();
    [m[1], m[2]] = [m[2], m[1]];
    const out = applySections(html, m, hidden);
    commentsOk = count(out, /<!--/g) === count(html, /<!--/g);
    tagsOk = [/<section/g, /<\/section>/g, /<div/g, /<\/div>/g, /<img/g]
      .every((re) => count(out, re) === count(html, re));
    orderOk = findSections(out).map((s) => s.id).join('|') === m.join('|');
  }

  let hideOk = true;
  if (ids.length) {
    const h = Object.assign({}, hidden);
    h[ids[0]] = true;
    const out = applySections(html, ids, h);
    hideOk = /<section hidden/.test(out) && applySections(out, ids, hidden) === html;
  }

  /* a page with content between its sections must refuse, never mangle */
  let refuseOk = true;
  if (!can && ids.length > 2) {
    const m = ids.slice();
    [m[0], m[1]] = [m[1], m[0]];
    refuseOk = applySections(html, m, hidden) === html;
  }

  /* ---- images -------------------------------------------------------- */
  let imgOk = true;
  if (imgs.length) {
    const im = imgs.find((i) => !/\.svg$/.test(i.src)) || imgs[0];
    const to = im.family === 'matter-apex' ? 'threshold-fog' : 'matter-apex';
    const out = swapImage(im.tag, im.family, to, { w: 1600, h: 873 });
    imgOk = !out.includes(im.family) && out.includes(to) &&
      count(out, /src=/g) === count(im.tag, /src=/g) &&
      count(out, /srcset=/g) === count(im.tag, /srcset=/g);
  }

  const checks = {
    textIdentity, slicesOk, textEdit,
    secIdentity, commentsOk, tagsOk, orderOk, hideOk, refuseOk,
    imgOk
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (bad.length) fail++;

  console.log(
    `  ${f.padEnd(14)} text=${String(spans.length).padStart(3)} ` +
    `secs=${String(ids.length).padStart(2)} imgs=${String(imgs.length).padStart(2)} ` +
    `move=${can ? 'y' : 'n'} diff=${String(diff).padStart(3)}ch  ` +
    (bad.length ? 'FAIL: ' + bad.join(', ') : 'all ok'));
}

console.log(fail
  ? `\n${fail} file(s) failed`
  : '\nevery page survives text, section and image edits byte for byte');
process.exit(fail ? 1 : 0);
