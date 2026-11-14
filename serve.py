#!/usr/bin/env python3
"""STL质感生成器 — 本地静态服务器。

    python serve.py        # 或 python3 serve.py

浏览器不允许从 file:// 加载 ES Module 与纹理，必须通过 HTTP 访问。
上游 v1.5.x 使用 module Worker（export / preview / outlineWrap / step），
会并行请求多个 .js 文件，因此这里用 ThreadingHTTPServer 而非单线程 TCPServer。
依赖已全部本地化到 vendor/，运行时无需任何外部网络请求。

请不要改用 `python -m http.server`：它是单线程的，且部分 Python 版本把
.mjs 识别成 text/plain，会导致浏览器以严格 MIME 检查拒绝加载 ES Module。
"""

import http.server
import mimetypes
from pathlib import Path

# 显式固定 JS / WebP 的 MIME，避免不同 Python / Windows 注册表映射不一致。
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('image/webp', '.webp')

PORT = 8080
DIRECTORY = str(Path(__file__).resolve().parent)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # 简单静态服务器默认不带缓存头，更新版本后浏览器可能混用新旧 JS。
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('', PORT), Handler) as httpd:
        print(f'\n  ✦  STL质感生成器  —  http://localhost:{PORT}')
        print(f'  ✦  Press Ctrl+C to stop\n')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
