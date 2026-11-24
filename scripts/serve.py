#!/usr/bin/env python3
"""Local preview server for the site: like `python3 -m http.server`, but every response says no-store,
so a browser never runs a stale main.js or stone.js after an edit (plain http.server lets browsers cache
modules heuristically, which made fixes look like they hadn't landed)."""
import functools
import json
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # Index-site/
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


# the same security headers Vercel sends (vercel.json), so a CSP break shows up here before it ships
HEADERS = [(h["key"], h["value"]) for rule in json.loads((ROOT / "vercel.json").read_text())["headers"] for h in rule["headers"]]
HEADERS = [(k, v.replace("; upgrade-insecure-requests", "")) for k, v in HEADERS]   # localhost is plain http


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        for k, v in HEADERS:
            self.send_header(k, v)
        super().end_headers()

    # Local stand-in for api/waitlist.js (which runs on Vercel): accepts the signup without sending it anywhere.
    # An email containing "fail" returns an error, to try the form's error state.
    def do_POST(self):
        if self.path != "/api/waitlist":
            self.send_error(404); return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        ok = "fail" not in str(body.get("email", ""))
        out = json.dumps({"ok": ok}).encode()
        self.send_response(200 if ok else 502)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out)))
        self.end_headers(); self.wfile.write(out)


NoStore.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".webp": "image/webp"})

if __name__ == "__main__":
    handler = functools.partial(NoStore, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Serving {ROOT} at http://localhost:{PORT}/site/ (no-store)")
        httpd.serve_forever()
