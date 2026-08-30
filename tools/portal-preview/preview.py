#!/usr/bin/env python3
"""Serve the local portal UI against read-only data from a MabelTV appliance.

The preview intentionally rejects every mutating request.  It is for responsive
and visual development only; playback and television-control routes are never
started by the harness itself.
"""

from __future__ import annotations

import argparse
import mimetypes
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PI_ROOT = PROJECT_ROOT / "scripts" / "pi"
PORTAL_ROOT = PI_ROOT / "portal"

LOCAL_ASSETS = {
    "/manifest.json": PI_ROOT / "mabeltv-manifest.json",
    "/manifest.webmanifest": PI_ROOT / "mabeltv-manifest.json",
    "/service-worker.js": PI_ROOT / "service-worker.js",
    "/mabeltv-offline.js": PI_ROOT / "mabeltv-offline.js",
    "/hls.min.js": PI_ROOT / "hls.min.js",
    "/mabeltv-icon.png": PI_ROOT / "mabeltv-icon.png",
    "/apple-touch-icon.png": PI_ROOT / "apple-touch-icon.png",
    "/apple-touch-icon-180x180.png": PI_ROOT / "apple-touch-icon.png",
    "/icons/icon-192.png": PI_ROOT / "icons" / "icon-192.png",
    "/icons/icon-512.png": PI_ROOT / "icons" / "icon-512.png",
}

PORTAL_INCLUDE = re.compile(
    r"^[ \t]*<!-- portal-include:([A-Za-z0-9_./-]+\.html) -->[ \t]*$",
    re.MULTILINE,
)


def portal_document() -> bytes:
    document = (PI_ROOT / "mabeltv-library.html").read_text(encoding="utf-8")
    for _ in range(8):
        if not PORTAL_INCLUDE.search(document):
            return document.encode()

        def include(match: re.Match[str]) -> str:
            candidate = (PORTAL_ROOT / match.group(1)).resolve()
            if PORTAL_ROOT.resolve() not in candidate.parents or not candidate.is_file():
                raise OSError(f"Portal include is unavailable: {match.group(1)}")
            return candidate.read_text(encoding="utf-8").rstrip()

        document = PORTAL_INCLUDE.sub(include, document)
    raise OSError("Portal includes are nested too deeply")


class PreviewHandler(BaseHTTPRequestHandler):
    server: "PreviewServer"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/":
            self._serve_bytes(portal_document(), "text/html; charset=utf-8")
            return
        if parsed.path in LOCAL_ASSETS:
            self._serve_file(LOCAL_ASSETS[parsed.path])
            return
        if parsed.path.startswith("/portal/"):
            relative = parsed.path.removeprefix("/portal/")
            candidate = (PORTAL_ROOT / relative).resolve()
            if PORTAL_ROOT.resolve() in candidate.parents and candidate.is_file():
                self._serve_file(candidate)
                return
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self._proxy_read()

    def do_HEAD(self) -> None:
        self._proxy_read(head_only=True)

    def do_POST(self) -> None:
        self._reject_write()

    def do_PATCH(self) -> None:
        self._reject_write()

    def do_PUT(self) -> None:
        self._reject_write()

    def do_DELETE(self) -> None:
        self._reject_write()

    def _serve_file(self, path: Path) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix in {".html", ".css", ".js", ".json", ".svg"}:
            content_type += "; charset=utf-8"
        self._serve_bytes(data, content_type)

    def _serve_bytes(self, data: bytes, content_type: str) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _proxy_read(self, head_only: bool = False) -> None:
        target = f"{self.server.appliance}{self.path}"
        headers = {}
        if cookie := self.headers.get("Cookie"):
            headers["Cookie"] = cookie
        if byte_range := self.headers.get("Range"):
            headers["Range"] = byte_range
        try:
            request = Request(target, headers=headers, method="HEAD" if head_only else "GET")
            with urlopen(request, timeout=20) as response:
                body = b"" if head_only else response.read()
                self.send_response(response.status)
                for name in ("Content-Type", "Content-Range", "Accept-Ranges", "Set-Cookie"):
                    if value := response.headers.get(name):
                        self.send_header(name, value)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if body:
                    self.wfile.write(body)
        except HTTPError as error:
            body = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head_only:
                self.wfile.write(body)
        except (URLError, TimeoutError) as error:
            message = f"Read-only preview could not reach the appliance: {error}".encode()
            self.send_response(HTTPStatus.BAD_GATEWAY)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)

    def _reject_write(self) -> None:
        message = b"This local portal preview is read-only."
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(message)))
        self.end_headers()
        self.wfile.write(message)


class PreviewServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], appliance: str) -> None:
        self.appliance = appliance.rstrip("/")
        super().__init__(address, PreviewHandler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only MabelTV portal preview")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8099)
    parser.add_argument("--appliance", default="http://mabeltv.local:8080")
    args = parser.parse_args()
    print(f"Portal preview: http://{args.bind}:{args.port} -> {args.appliance} (GET/HEAD only)")
    server = PreviewServer((args.bind, args.port), args.appliance)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
