#!/usr/bin/env python3
"""Local preview server for the site: like `python3 -m http.server`, but every response says no-store,
so a browser never runs a stale main.js or stone.js after an edit (plain http.server lets browsers cache
modules heuristically, which made fixes look like they hadn't landed)."""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # Index-site/
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


NoStore.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".webp": "image/webp"})

if __name__ == "__main__":
    handler = functools.partial(NoStore, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Serving {ROOT} at http://localhost:{PORT}/site/ (no-store)")
        httpd.serve_forever()
