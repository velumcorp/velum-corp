# Squarespace bundle

Generated files. **Do not edit them by hand** - edit `../site/` and re-run:

```bash
python ../build-squarespace.py --base https://velum-corp.netlify.app
```

`--base` is the host that serves `/assets` (images, fonts, CSS, JS). Squarespace has no way to
serve a directory of files, so something else must. The default points at the Netlify deploy,
which can run with no custom domain attached and no DNS change at all.

---

## What is in here

| File | Where it goes in Squarespace |
|---|---|
| `00-site-header-injection.html` | Settings → Advanced → Code Injection → **Header** |
| `01-site-footer-injection.html` | Settings → Advanced → Code Injection → **Footer** |
| `page-home.html` | the home page → a Code Block |
| `page-houses.html` | page with slug `/houses` → a Code Block |
| `page-about.html` | page with slug `/about` → a Code Block |
| `page-contact.html` | page with slug `/contact` → a Code Block |

---

## Steps

1. **Header injection.** Settings → Advanced → Code Injection. Paste
   `00-site-header-injection.html` into the Header box. This loads the fonts, the stylesheet and
   the favicon, and hides Squarespace's own header and footer so the Velum masthead owns the page.

2. **Footer injection.** Paste `01-site-footer-injection.html` into the Footer box on the same
   screen. This loads the language toggle, the scroll reveals and the mobile nav.

3. **Pages.** Create four blank pages with the slugs above. On each one, add a **Code Block**,
   paste the matching `page-*.html`, and turn **Display Source off**. Set the block to full width.

4. **Page settings.** For each page, Page Settings → Advanced, and make sure no page-level header
   injection conflicts. Set the SEO title and description per page; the `<title>` and `<meta>` tags
   from the Netlify build are not carried across, because Squarespace owns the document head.

5. **Contact form.** Netlify Forms does not run on Squarespace, so the form was replaced with a
   marker comment in `page-contact.html`. Add a Squarespace **Form Block** where that comment sits.
   It will pick up the `.field` styling from `velum.css` automatically. Point its storage at the
   right inbox in the block's settings.

---

## Known limits of this route

These are inherent to putting a hand-built design inside Squarespace, not defects in the bundle.

- **Squarespace owns the `<head>`.** Per-page `<title>`, `<meta description>`, canonical URLs, the
  Open Graph tags and the JSON-LD organisation block do not transfer. Re-enter titles and
  descriptions in each page's SEO panel. Social share cards will use Squarespace's settings, not
  `/assets/img/og.jpg`.
- **Chrome overrides are template-dependent.** The CSS in the header injection hides Squarespace
  7.1's header and footer. If a built-in header still appears, inspect it, take its selector, and
  add it to the `CHROME_OVERRIDES` block in `../build-squarespace.py`.
- **The language toggle stores the choice in `localStorage`**, which works normally, but
  Squarespace's own navigation links are not translated. Either remove them from the Squarespace
  nav or accept that the built-in nav stays in one language.
- **Two hosts, two failure points.** Pages come from Squarespace, assets from the `--base` host.
  If that host goes away, the design loses its stylesheet and images.
- **Redirects.** The friendly URLs in `netlify.toml` (`/casas`, `/grupo`, `/contacto`) do not
  exist here. Recreate them in Settings → Advanced → URL Mappings if you want them.

If none of that is acceptable, Option B in `../DNS.md` moves the domain to Netlify and every one
of these limits disappears.
