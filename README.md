# velum-corp

The Velum Enterprise website. Static HTML, no build step, no dependencies.

Bilingual Spanish and English, dark mode, and a Squarespace bundle generated from the same source.

---

## Run it

```bash
python -m http.server 8899 --directory site
```

Then open <http://127.0.0.1:8899>. Open it through a server rather than double-clicking the files:
every path is root-relative, so `file://` will not find the assets.

## Deploy to Netlify

Connect the repository. `netlify.toml` already sets `publish = "site"` with no build command, so
there is nothing to configure. Everything published lives in `site/`.

For the custom domain, read **[DNS.md](DNS.md)** first. The domain currently points at Squarespace
and the two cannot both serve the apex.

## Deploy to Squarespace

```bash
python build-squarespace.py --base https://velum-corp.netlify.app
```

Then follow [squarespace/README.md](squarespace/README.md). The trade-offs of that route are listed
at the bottom of that file.

---

## Layout

```
site/                     everything that gets published
  index.html              the story: origin, manifesto, six houses, positioning, contact
  houses.html             each house in depth
  about.html              origin, values, territory
  contact.html            form and details
  gracias.html            form success target (also works without JS)
  404.html
  assets/
    css/velum.css         the whole design system, one file
    js/velum.js           language, nav, scroll reveals, form
    js/velum-form-config.js  the ONLY file to edit to wire up the contact form
    fonts/                Cinzel, Montserrat, Bodoni Moda italic (self-hosted woff2)
    img/                  photography and textures, webp at 900w and 1600w
    logo/                 Velum lockups, favicons
    logo/analopez/        AnaLopez Cosmetics' own lockups
    icon/                 the brand's house marks and the star
  admin/                  the internal editing panel (see ADMIN.md)
netlify/functions/        admin-api.js: loads and commits pages for the panel
tools/google-form-ids.py  reads a Google Form and prints the contact form config
squarespace/              generated, do not hand-edit
build-squarespace.py      regenerates the above from site/
netlify.toml              publish directory, functions, headers, redirects
DNS.md                    Squarespace and Netlify records, and the conflict between them
ADMIN.md                  the editing panel: setup, use, adding a subdomain
```

---

## Where the content comes from

Nothing here was invented from scratch. The copy, palette, type and photography all come out of
`VELUM Enterprise/Vellum Brand/VELUM-Brand Kit`:

| Site | Kit |
|---|---|
| Manifesto, values, positioning, house descriptions | `04_Guidelines/build/strings.py` (both languages) |
| Palette tokens | `02_Color/velum-colors.css` |
| Cinzel Display and Montserrat, the scale and tracking | `03_Type/TYPOGRAPHY.md` |
| Every photograph | `07_Photography/References/` |
| The veil line drawing in the origin section | `05_Textures/velum-velo-oro.svg` |
| Logos, monogram, favicons, house marks, the star | `01_Logo/`, `06_Elements/` |
| AnaLopez Cosmetics' logotype and tagline | `AnaLopez/AnaLopez-Brand Kit/01_Logo/` |

The house paragraphs on `houses.html` are new writing, in the kit's voice. They describe what each
house does. They deliberately contain no figures, dates, client names or claims, because the kit
does not supply any and inventing them would be worse than saying less.

---

## Decisions worth knowing about

**Static HTML, not a framework.** The site has to be publishable through Squarespace's code
injection as well as Netlify. Nothing that needs a build survives that trip.

**The masthead carries the monogram, not the primary logo.** The kit sets a 180px minimum width on
the primary lockup, which cannot fit a 72px header. The monogram is the asset the kit assigns to
exactly this case. The primary lockup appears in the footer at 200px, above its minimum.

**The readable gold was darkened.** The kit nominates Oro Oscuro `#B8912B` as "gold that works as
text on a light ground", but it measures 2.60:1 on bone and fails WCAG AA. Small gold text uses
`#84681F`, the same hue and saturation at 4.66:1. `#B8912B` and `#D4AF37` are untouched everywhere
they are used as graphics, rules or the star, where contrast is not a factor.

**AnaLopez Cosmetics signs with its own logotype.** The kit's architecture rules say each house
signs with its own voice and no new logo is drawn per sector. It is the one house that already has
a full consumer identity, so it uses its own wordmark and its own display face for its tagline.
The rest of the page stays in Velum's palette and rhythm.

**No eyebrows, and no "what we are / what we are not" tables.** The small
uppercase label above a section heading is gone everywhere; a section's place on
the page already says what it is. The scorecard sections the brand manual uses
(competes on / does not compete on, it is / it is not, better / worse, where the
logo appears / where it does not, purpose / vision / mission) were rewritten as
prose or dropped. That material belongs in a brand deck, not on a public site.

**AL is written AnaLopez Cosmetics.** The `AL —` prefix came from the Velum
manual; the house's own kit calls it AnaLopez. The logotype artwork is used
wherever the mark appears, and the full name wherever it is set as text.

**Motion follows the Dishoom model:** a sticky hero the page scrolls up over, a
word-by-word ink fill on the manifesto tied to scroll position, headings that
rise out of a mask, and images that settle from a slight oversize. Where the
browser supports scroll-driven animations the manifesto fill is scrub-linked and
runs entirely on the compositor; elsewhere it degrades to a timed cascade.
Splitting text into words and lines happens at runtime, so the source HTML stays
plain readable text, and it re-runs on every language change.

**Spanish is what ships in the HTML.** English lives in `data-en` attributes and is swapped by JS.
That way the site is fully readable and indexable with JavaScript disabled, and Havana is the
primary audience. The trade-off is that search engines index the Spanish only; if English needs to
rank independently it wants separate URLs, which is a bigger change.

**The contact form posts to Google Forms.** Netlify Forms was the first
implementation, but it caps at 100 submissions a month on the free tier and
cannot work at all through Squarespace's code injection. Google Forms works in
both places, puts responses in Workspace where the team already is, and needs no
backend. The trade-off is that the endpoint is undocumented: it is a long-lived
and widely used technique, not a supported API, so it could change without
notice. Responses are also unfiltered for spam beyond the honeypot.

**Editing is by attribute, not by content model.** The admin panel finds
editable text by looking for `data-en`, which already marks every translatable
string. That avoids restructuring the site into markdown collections and adding
a build step, which is what an off-the-shelf CMS would have required, and which
would have broken the Squarespace path.

**Motion is gated.** Everything is IntersectionObserver or CSS scroll-driven animation. There is
not a single scroll event listener. All of it collapses under `prefers-reduced-motion: reduce`,
including the sticky hero, which reverts to a normal section.

---

## Before this goes live

- [ ] Replace `velum.enterprise` with the real domain in `canonical` tags, `sitemap.xml`,
      `robots.txt`, and the JSON-LD block in `index.html`
- [ ] Confirm the reply-time promise on `contact.html` ("two working days") is one you want to make
- [ ] Decide Squarespace or Netlify, then follow the matching option in `DNS.md`
- [ ] Wire up the contact form: build the Google Form, then run
      `python tools/google-form-ids.py "<form url>"` and paste the result into
      `site/assets/js/velum-form-config.js`
- [ ] Set up the admin panel: follow `ADMIN.md` (Identity, GitHub token, invites)

## Still open

`about.html` keeps a six-item values grid (Curiosity, Judgement, Closeness, Ambition, Rigour,
Openness), each with a one-line definition. It is the same species as the sections that were
already cut for reading like brand-manual content. It was left in place because it was not raised,
but it is the obvious next candidate: either fold it into a paragraph or drop it.
