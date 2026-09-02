#!/usr/bin/env python3
"""
Local development server for the Velum site and its admin panel.

    python tools/dev-server.py          then open http://localhost:8899

Serves site/ statically, and stands in for the Netlify function so the admin
panel is fully usable offline: pick a page, edit the text, press save, and the
file on disk changes. No Netlify, no GitHub token, no login.

WHY THIS EXISTS
---------------
The real panel needs three things that only exist on Netlify: Identity for
login, the function for reading and writing, and the GitHub token the function
carries. Locally the Identity widget cannot even read its settings, because the
deployed site sits behind Netlify's password and returns an HTML login page
where the widget expects JSON. Rather than stub all that out by hand, this
serves the same API shape against the local filesystem.

Saves here write straight to your working tree. They are not commits: review
with `git diff` and commit them yourself, or `git checkout .` to throw them
away. That makes this safe to experiment in.

LOCALHOST ONLY
--------------
There is no authentication here at all, which is exactly why it refuses to bind
to anything but the loopback address. The deployed panel is unaffected: Netlify
validates the Identity token itself before the real function runs, so the
client-side dev bypass cannot be used to reach the live site.
"""

import hashlib
import http.server
import json
import pathlib
import re
import socketserver
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FUNCTION = ROOT / "netlify" / "functions" / "admin-api.js"
API_PATH = "/.netlify/functions/admin-api"
PORT = 8899


def editable_pages():
    """Read the page allow-list out of the real function, so the two cannot
    drift apart. If the function grows a page, this picks it up for free."""
    if not FUNCTION.exists():
        return []
    src = FUNCTION.read_text(encoding="utf8")
    # drop comments first: the function carries a commented-out example
    # subdomain, and without this its pages show up as real editable entries
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    return [
        {"path": p, "label": l}
        for p, l in re.findall(r"path:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'", src)
    ]


PAGES = editable_pages()
ALLOWED = {p["path"] for p in PAGES}


def sha_of(text: str) -> str:
    """Stand-in for GitHub's blob sha. Only needs to change when the file does,
    so the panel's "someone else edited this" check behaves the same way."""
    return hashlib.sha1(text.encode("utf8")).hexdigest()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def log_message(self, fmt, *args):
        if API_PATH in (self.path or ""):
            sys.stderr.write("  admin  %s\n" % (fmt % args))

    # ---------------------------------------------------------------- helpers
    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _resolve(self, path):
        if path not in ALLOWED:
            return None, f"page not editable: {path}"
        f = ROOT / path
        if not f.exists():
            return None, f"not found on disk: {path}"
        return f, None

    # ------------------------------------------------------------------- GET
    def do_GET(self):
        if not self.path.startswith(API_PATH):
            return super().do_GET()

        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        path = (q.get("path") or [None])[0]

        if not path:
            return self._json(200, {
                "user": "local@velumcorp.com",
                "sites": [{"key": "localhost (archivos locales)", "pages": PAGES}],
            })

        f, err = self._resolve(path)
        if err:
            return self._json(400, {"error": err})
        html = f.read_text(encoding="utf8")
        return self._json(200, {"path": path, "sha": sha_of(html), "html": html})

    # ------------------------------------------------------------------- PUT
    def do_PUT(self):
        if not self.path.startswith(API_PATH):
            return self._json(405, {"error": "PUT is only for the admin API."})

        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self._json(400, {"error": f"bad request body: {e}"})

        path = payload.get("path")
        html = payload.get("html")
        sha = payload.get("sha")

        f, err = self._resolve(path)
        if err:
            return self._json(400, {"error": err})
        if not isinstance(html, str) or not html.strip():
            return self._json(400, {"error": "Nothing to save."})
        if not html.strip().lower().endswith("</html>"):
            return self._json(400, {"error": "That does not look like a complete page. Not saved."})

        current = f.read_text(encoding="utf8")
        if sha and sha != sha_of(current):
            return self._json(409, {
                "error": "The file changed on disk since you loaded it. "
                         "Reload the page in the panel and reapply your change."
            })

        f.write_text(html, encoding="utf8", newline="")
        print(f"  saved  {path}  ({len(html)} bytes)  -> review with: git diff")
        return self._json(200, {"ok": True, "sha": sha_of(html), "commit": None})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    if not SITE.exists():
        sys.exit(f"error: {SITE} not found. Run this from the repository.")
    print(f"Velum dev server")
    print(f"  site      {SITE}")
    print(f"  admin     http://localhost:{PORT}/admin/   (no login needed locally)")
    print(f"  editable  {len(PAGES)} pages: {', '.join(p['path'].split('/')[-1] for p in PAGES)}")
    print(f"  NOTE      saves write to your working tree, not to git.")
    print(f"            review with `git diff`, undo with `git checkout .`")
    print()
    # loopback only: this API has no auth by design
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
