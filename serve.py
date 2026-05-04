#!/usr/bin/env python3
"""
Local development server for stlTexturizer.

Run:  python serve.py
Or:   python3 serve.py

Opens at http://localhost:8080 — hit Ctrl+C to stop.
"""

import http.server
import socketserver

PORT = 8080
DIRECTORY = '.'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    # Suppress default logging to keep console clean
    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    with socketserver.TCPServer(('', PORT), Handler) as httpd:
        print(f'\n  ✦  STL质感生成器  —  http://localhost:{PORT}')
        print(f'  ✦  Press Ctrl+C to stop\n')
        httpd.serve_forever()
