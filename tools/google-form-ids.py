#!/usr/bin/env python3
"""
Read a published Google Form and print the site's form config, filled in.

    python tools/google-form-ids.py "https://docs.google.com/forms/d/e/1FAI.../viewform"

Google embeds the whole question list in the page as FB_PUBLIC_LOAD_DATA_.
This pulls the entry ids out of it, matches them to the five fields the site
sends, and prints a ready-to-paste velum-form-config.js.

The form must be readable by anyone with the link, or Google returns a sign-in
page and there is nothing to parse.
"""

import json
import re
import sys
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}

# Our field name -> words that should appear in the Google question title.
# First match wins, so the more specific entries are listed first.
MATCH = {
    "nombre":  ["nombre", "name"],
    "correo":  ["correo", "email", "e-mail", "mail"],
    "empresa": ["empresa", "company", "proyecto", "project", "organi"],
    "casa":    ["casa", "house", "division", "división"],
    "mensaje": ["mensaje", "message", "comment", "consulta"],
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf8", "replace")


def form_id(url: str) -> str:
    m = re.search(r"/forms/d/e/([A-Za-z0-9_-]+)", url)
    if not m:
        m = re.search(r"/forms/d/([A-Za-z0-9_-]+)", url)
    if not m:
        sys.exit("error: could not find a form id in that URL.\n"
                 "       Expected .../forms/d/e/<id>/viewform")
    return m.group(1)


def questions(html: str):
    """Yield (title, entry_id) for every answerable question, in page order."""
    m = re.search(r"FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*</script>", html, re.S)
    if not m:
        if "accounts.google.com" in html or "Sign in" in html[:4000]:
            sys.exit("error: Google returned a sign-in page.\n"
                     "       Open the form > Send > link, and make sure it is shareable\n"
                     "       with anyone who has the link, then try again.")
        sys.exit("error: could not find the question data in the page.")
    data = json.loads(m.group(1))
    try:
        items = data[1][1]
    except (IndexError, TypeError):
        sys.exit("error: unexpected form data shape.")

    for item in items or []:
        try:
            title = (item[1] or "").strip()
            entries = item[4]
            if not entries:
                continue                      # section header, image, text block
            for e in entries:
                yield title, f"entry.{e[0]}"
        except (IndexError, TypeError):
            continue


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    url = sys.argv[1].strip().strip('"')
    fid = form_id(url)

    view = f"https://docs.google.com/forms/d/e/{fid}/viewform"
    try:
        html = fetch(view)
    except urllib.error.HTTPError as e:
        return sys.exit(f"error: {view} returned HTTP {e.code}")
    except Exception as e:
        return sys.exit(f"error: could not fetch the form: {e}")

    found = list(questions(html))
    if not found:
        sys.exit("error: the form has no questions.")

    print("Questions found, in order:\n")
    for i, (title, eid) in enumerate(found, 1):
        print(f"  {i}. {title or '(untitled)':<40} {eid}")

    # match by title, then fall back to position for anything still unmatched
    mapping, used = {}, set()
    for field, words in MATCH.items():
        for title, eid in found:
            if eid in used:
                continue
            low = title.lower()
            if any(w in low for w in words):
                mapping[field] = eid
                used.add(eid)
                break

    order = ["nombre", "correo", "empresa", "casa", "mensaje"]
    leftovers = [e for _, e in found if e not in used]
    guessed = []
    for field in order:
        if field not in mapping and leftovers:
            mapping[field] = leftovers.pop(0)
            guessed.append(field)

    missing = [f for f in order if f not in mapping]
    print()
    if guessed:
        print(f"  ! matched by position, not by title: {', '.join(guessed)}")
        print("    check these against the list above before trusting them.")
    if missing:
        print(f"  ! no question found for: {', '.join(missing)}")
        print("    add those questions to the form, or leave them blank to skip.")
    if not guessed and not missing:
        print("  all five fields matched by question title.")

    cfg = pathlib_config(fid, mapping, order)
    print("\n" + "=" * 72)
    print("Paste the block below over the one in site/assets/js/velum-form-config.js")
    print("=" * 72 + "\n")
    print(cfg)
    return 0


def pathlib_config(fid, mapping, order):
    lines = [f'  fields: {{']
    width = max(len(f) for f in order)
    for f in order:
        val = mapping.get(f, "")
        comma = "," if f != order[-1] else ""
        lines.append(f'    {f + ":":<{width + 2}} "{val}"{comma}')
    lines.append("  },")
    fields = "\n".join(lines)
    return (
        "window.VELUM_FORM = {\n"
        f'  formId: "{fid}",\n\n'
        f"{fields}\n\n"
        '  fallbackEmail: "support@velumcorp.com"\n'
        "};"
    )


if __name__ == "__main__":
    raise SystemExit(main())
