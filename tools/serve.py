#!/usr/bin/env python3
"""Static dev server that never caches.

Python's http.server sends Last-Modified but no Cache-Control, so Chrome
applies heuristic caching and can serve a stale Overview.dc.html without
revalidating — which looks exactly like a code bug. This sends no-store on
everything, so a plain reload is always the current file.

    python3 tools/serve.py [port]
"""
import functools, http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8081


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
    print('serving %s on http://127.0.0.1:%d' % (sys.argv[0], PORT), flush=True)
    httpd.serve_forever()
