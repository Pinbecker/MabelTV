"""HTTP transport and routing for the local portal API."""

from __future__ import annotations

import json
import mimetypes
import re
import shutil
import sys
import threading
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .constants import CHUNK_LIMIT, SESSION_SECONDS
from .lg import RemoteTvActiveError
from .portal import CLASSIC_INDEX, INDEX, SERVICE_ROOT, WATCH_PAGE

STATIC_ASSETS = {
    "/mabeltv-icon.png": ("mabeltv-icon.png", "image/png"),
    "/mabeltv-pwa-icon.png": ("icons/icon-512.png", "image/png"),
    "/apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "/apple-touch-icon-180x180.png": ("apple-touch-icon.png", "image/png"),
    "/icons/icon-192.png": ("icons/icon-192.png", "image/png"),
    "/icons/icon-512.png": ("icons/icon-512.png", "image/png"),
    "/hls.min.js": ("hls.min.js", "text/javascript; charset=utf-8"),
    "/mabeltv-offline.js": ("mabeltv-offline.js", "text/javascript; charset=utf-8"),
    "/service-worker.js": ("service-worker.js", "text/javascript; charset=utf-8"),
    "/manifest.json": ("mabeltv-manifest.json", "application/manifest+json"),
    "/manifest.webmanifest": ("mabeltv-manifest.json", "application/manifest+json"),
}

PORTAL_ASSET_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
}

GET_JSON_ROUTES = {
    "/api/live": "live_tv_status",
    "/api/lg-tv/status": "lg_tv_status",
    "/api/library": "library",
    "/api/usb": "usb_volumes",
    "/api/adult/optimisations": "adult_optimisations",
    "/api/adult/viewing": "adult_viewing",
    "/api/activity": "activity_status",
    "/api/tmdb/status": "tmdb_status",
    "/api/status": "live_status",
}

POST_JSON_ROUTES = {
    "/api/live/control": ("live_tv_control", 200),
    "/api/lg-tv/action": ("lg_tv_action", 200),
    "/api/play-on-tv": ("play_on_tv", 200),
    "/api/remote/start": ("start_remote_stream", 200),
    "/api/external/start": ("start_external_stream", 200),
    "/api/offline/start": ("start_offline_download", 200),
    "/api/remote/position": ("remote_save_position", 200),
    "/api/remote/clear-position": ("remote_clear_position", 200),
    "/api/viewing-insights/delete": ("delete_viewing_sessions", 200),
    "/api/favourite": ("set_favourite", 200),
    "/api/tmdb/search": ("tmdb_search", 200),
    "/api/tmdb/apply": ("tmdb_apply", 200),
    "/api/tmdb/adult-series/search": ("adult_series_search", 200),
    "/api/tmdb/adult-series/apply": ("adult_series_apply", 200),
    "/api/adult/viewing": ("adult_viewing_update", 200),
    "/api/adult/netflix/play-tv": ("play_netflix_on_tv", 200),
    "/api/tmdb/channel": ("refresh_channel_show_metadata", 200),
    "/api/tmdb/programme": ("refresh_channel_programme_metadata", 200),
    "/api/adult/uploads": ("adult_upload_create", 201),
    "/api/adult/series/uploads": ("adult_series_upload_create", 201),
    "/api/uploads": ("upload_create", 201),
}

POST_NO_ARGUMENT_ROUTES = {
    "/api/live/stop": "stop_live_tv",
    "/api/remote/stop-tv": "remote_stop_tv",
    "/api/tmdb/channels": "refresh_channel_metadata",
}


class Handler(BaseHTTPRequestHandler):
    server: "LibraryServer"
    # Phone browsers can upload several chunks over one keep-alive connection.
    # HTTP/1.0 forces a close after every response and caused some phones to
    # stall before opening the next chunk request.
    protocol_version = "HTTP/1.1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(120)

    def end_headers(self) -> None:
        # Cloudflare and phone browsers keep ordinary asset connections idle.
        # A thread-per-connection server must close those after the response or
        # a small upstream connection pool can occupy every bounded worker.
        # Upload requests retain HTTP/1.1 keep-alive so multi-chunk phone
        # transfers continue to reuse their connection as intended.
        if not self.path.startswith("/api/uploads"):
            self.send_header("Connection", "close")
            self.close_connection = True
        super().end_headers()

    def log_message(self, fmt: str, *args: Any) -> None: return

    def unexpected(self, operation: str, error: Exception) -> None:
        print(f"{operation} failed: {error}", file=sys.stderr, flush=True)

    def security_headers(self, allow_inline_script: bool = False) -> None:
        script_source = "'self' 'unsafe-inline'" if allow_inline_script else "'self'"
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; style-src 'self' 'unsafe-inline'; "
                         f"script-src {script_source}; img-src 'self' data: https://image.tmdb.org; "
                         "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

    def json(self, status: int, value: dict[str, Any], cookie: str | None = None) -> None:
        data = json.dumps(value).encode(); self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store"); self.security_headers()
        if cookie: self.send_header("Set-Cookie", cookie)
        self.end_headers(); self.wfile.write(data)

    def file(self, path: Path, download_name: str) -> None:
        size = path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/gzip")
        self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.security_headers()
        self.end_headers()
        with path.open("rb") as source:
            shutil.copyfileobj(source, self.wfile, 1024 * 1024)

    def stream_file(self, path: Path, content_type: str,
                    cache_control: str = "no-store") -> None:
        size = path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", cache_control)
        self.security_headers()
        self.end_headers()
        with path.open("rb") as source:
            shutil.copyfileobj(source, self.wfile, 1024 * 1024)

    def stream_remote_media(self, path: Path) -> None:
        """Serve one authorised local file with HTTP range support for native players."""
        size = path.stat().st_size
        start, end = 0, size - 1
        requested = self.headers.get("Range", "")
        if requested:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested.strip())
            if not match:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
            # Native iPhone/iPad playback commonly asks for a suffix range
            # (for example ``bytes=-65536``) to read the MP4 index stored at
            # the end of an otherwise perfectly valid film.  Treating that
            # as bytes 0-65536 makes Safari discard the source as corrupt.
            if not match.group(1) and match.group(2):
                suffix_length = int(match.group(2))
                if suffix_length <= 0:
                    self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
                start = max(0, size - suffix_length)
                end = size - 1
            else:
                start = int(match.group(1)) if match.group(1) else 0
                end = int(match.group(2)) if match.group(2) else size - 1
            if start >= size or end < start:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
            end = min(end, size - 1)
        length = end - start + 1
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.PARTIAL_CONTENT if requested else HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Disposition", "inline")
        self.send_header("X-Content-Type-Options", "nosniff")
        if requested: self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-store")
        self.security_headers(); self.end_headers()
        try:
            with path.open("rb") as source:
                source.seek(start)
                remaining = length
                while remaining:
                    data = source.read(min(1024 * 1024, remaining))
                    if not data: break
                    self.wfile.write(data)
                    remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Native iOS playback opens and cancels several range requests
            # while it hands the file to AVPlayer.  That is normal client
            # behaviour, not a fault in the portal or the Pi.
            return

    def stream_bytes(self, data: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers()
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"));
        if length > 64 * 1024: raise ValueError("Request is too large")
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict): raise ValueError("Request must be a JSON object")
        return value

    def session_token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie")); token = cookie.get("mabeltv_library")
        return token.value if token else None

    def portal_design(self) -> str:
        """Return the requested presentation without changing authentication state."""
        cookie = SimpleCookie(self.headers.get("Cookie"))
        design = cookie.get("mabeltv_portal_design")
        return "classic" if design and design.value == "classic" else "experience"

    def authorised(self) -> bool:
        return (self.server.library.configured()
                and not self.server.library.portal_pin_required()) \
            or self.server.library.valid_session(self.session_token())

    def require(self) -> bool:
        if not self.authorised(): self.json(HTTPStatus.UNAUTHORIZED, {"error": "Parent PIN required"}); return False
        return True

    def same_origin(self) -> bool:
        origin = self.headers.get("Origin", "")
        if not origin:
            return True
        host = self.headers.get("Host", "")
        try:
            return urlsplit(origin).netloc == host
        except ValueError:
            return False

    def require_same_origin(self) -> bool:
        if not self.same_origin():
            self.json(HTTPStatus.FORBIDDEN, {"error": "This request did not come from Mabel TV"})
            return False
        return True

    def serve_html(self, document: str, *, inline_script: bool = False) -> None:
        data = document.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers(inline_script)
        self.end_headers()
        self.wfile.write(data)

    def serve_static_asset(self) -> bool:
        asset = STATIC_ASSETS.get(self.path)
        if asset is None:
            return False
        relative_path, content_type = asset
        asset_path = SERVICE_ROOT / relative_path
        if not asset_path.is_file():
            self.json(404, {"error": "Static asset not found"})
            return True
        self.stream_bytes(asset_path.read_bytes(), content_type)
        return True

    def serve_portal_asset(self, path: str) -> bool:
        if not path.startswith("/portal/"):
            return False
        portal_root = (SERVICE_ROOT / "portal").resolve()
        asset_path = (portal_root / path.removeprefix("/portal/")).resolve()
        if (portal_root not in asset_path.parents
                or asset_path.suffix not in PORTAL_ASSET_TYPES
                or not asset_path.is_file()):
            self.json(404, {"error": "Portal asset not found"})
            return True
        self.stream_file(asset_path, PORTAL_ASSET_TYPES[asset_path.suffix])
        return True

    def dispatch_json_get(self) -> bool:
        method_name = GET_JSON_ROUTES.get(self.path)
        if method_name is None:
            return False
        self.json(200, getattr(self.server.library, method_name)())
        return True

    def dispatch_json_post(self, payload: dict[str, Any]) -> bool:
        route = POST_JSON_ROUTES.get(self.path)
        if route is not None:
            method_name, status = route
            self.json(status, getattr(self.server.library, method_name)(payload))
            return True
        method_name = POST_NO_ARGUMENT_ROUTES.get(self.path)
        if method_name is None:
            return False
        self.json(200, getattr(self.server.library, method_name)())
        return True

    def handle_setup_post(self, address: str) -> bool:
        if self.path not in {"/api/setup/check", "/api/setup"}:
            return False
        if not self.server.library.login_allowed(address):
            self.json(HTTPStatus.TOO_MANY_REQUESTS, {
                "error": "Too many attempts. Wait five minutes and try again.",
            })
            return True
        payload = self.body()
        if not self.server.library.verify_setup_code(str(payload.get("setup_code", ""))):
            self.server.library.record_login_failure(address)
            self.json(HTTPStatus.FORBIDDEN, {"error": "That setup code is not correct"})
            return True
        self.server.library.clear_login_failures(address)
        result = self.server.library.complete_setup(payload)             if self.path == "/api/setup" else {"ok": True}
        self.json(200, result)
        return True

    def handle_login_post(self, address: str) -> bool:
        if self.path != "/api/login":
            return False
        if not self.server.library.configured():
            self.json(HTTPStatus.CONFLICT, {
                "error": "Finish first-time setup before signing in",
            })
            return True
        if not self.server.library.portal_pin_required():
            self.json(200, {"ok": True})
            return True
        if not self.server.library.login_allowed(address):
            self.json(HTTPStatus.TOO_MANY_REQUESTS, {
                "error": "Too many attempts. Wait five minutes and try again.",
            })
            return True
        pin = str(self.body().get("pin", ""))
        if not self.server.library.verify_pin(pin):
            self.server.library.record_login_failure(address)
            self.json(HTTPStatus.FORBIDDEN, {"error": "That PIN is not correct"})
            return True
        self.server.library.clear_login_failures(address)
        token = self.server.library.create_session()
        self.json(200, {"ok": True},
                  f"mabeltv_library={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}")
        return True

    def handle_usb_post(self, payload: dict[str, Any]) -> bool:
        if self.path != "/api/usb":
            return False
        action = str(payload.get("action", ""))
        routes = {
            "mount": lambda: self.server.library.usb_mount(str(payload.get("device", ""))),
            "eject": lambda: self.server.library.usb_eject(str(payload.get("volume", ""))),
            "play": lambda: self.server.library.usb_play(
                str(payload.get("volume", "")), str(payload.get("path", ""))),
            "import": lambda: self.server.library.start_usb_import(payload),
        }
        route = routes.get(action)
        if route is None:
            raise ValueError("Unknown USB action")
        self.json(200, route())
        return True

    def handle_adult_series_post(self, payload: dict[str, Any]) -> bool:
        if self.path == "/api/adult/series/watched":
            watched = payload.get("watched")
            if not isinstance(watched, bool):
                raise ValueError("Choose whether the episode is watched")
            if payload.get("scope") == "season":
                result = self.server.library.set_adult_season_watched(
                    str(payload.get("series", "")), payload.get("season"), watched)
            else:
                result = self.server.library.set_adult_episode_watched(
                    str(payload.get("series", "")), str(payload.get("file", "")), watched)
            self.json(200, result)
            return True
        if self.path == "/api/adult/series/restart":
            scope = str(payload.get("scope", ""))
            result = self.server.library.restart_adult_series_progress(
                str(payload.get("series", "")), scope,
                payload.get("season") if scope == "season" else None)
            self.json(200, result)
            return True
        return False

    def handle_management_post(self, payload: dict[str, Any]) -> bool:
        if self.path == "/api/manage":
            refreshed = self.server.library.manage(payload)
            action = payload.get("action")
            if not refreshed:
                message = ("The change was saved, but the TV could not refresh. "
                           "Use Refresh TV library to try again.")
            elif action == "optimise-adult":
                message = ("Optimising the original film in the background. "
                           "You can leave this page and return later.")
            elif action == "set-tv-settings":
                message = "TV settings applied on MabelTV now."
            else:
                message = "Done."
            self.json(200, {"ok": True, "refreshed": refreshed, "message": message})
            return True
        if self.path == "/api/account":
            self.server.library.change_pin(payload)
            self.json(200, {"ok": True},
                      "mabeltv_library=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            return True
        if self.path == "/api/identity":
            self.json(200, self.server.library.change_tv_name(payload))
            return True
        if self.path == "/api/system":
            output = self.server.library.admin_action(str(payload.get("action", "")))
            self.json(200, {"ok": True, "message": output})
            return True
        return False

    def do_GET(self) -> None:
        try:
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            if self.path == "/":
                document = CLASSIC_INDEX if self.portal_design() == "classic" else INDEX
                self.serve_html(document, inline_script="<script>" in document)
                return
            if self.serve_static_asset() or self.serve_portal_asset(parsed.path):
                return
            if parsed.path in {"/api/external/media", "/api/offline/media"}:
                token = str(query.get("stream", [""])[0])
                session = self.server.library.external_stream_session(token, begin=True)
                try:
                    self.stream_remote_media(Path(session["source"]))
                finally:
                    self.server.library.finish_external_request(token)
                return
            if parsed.path == "/api/external/subtitles":
                data = self.server.library.external_subtitles(
                    str(query.get("stream", [""])[0]))
                self.stream_bytes(data, "text/vtt; charset=utf-8")
                return
            if self.path == "/api/setup":
                self.json(200, self.server.library.public_setup())
                return
            if not self.require():
                return
            if parsed.path == "/watch/player":
                self.serve_html(WATCH_PAGE, inline_script=True)
                return
            if self.path == "/api/live/stream.m3u8":
                self.json(410, {"error": "The live picture now uses the portal frame feed"})
                return
            if parsed.path == "/api/live/frame.jpg":
                self.stream_bytes(self.server.library.live_tv_frame(), "image/jpeg")
                return
            if self.path.startswith("/api/live/segment-") or self.path == "/api/live/init.mp4":
                self.json(410, {"error": "The live picture now uses the portal frame feed"})
                return
            if self.dispatch_json_get():
                return
            if parsed.path == "/api/viewing-insights":
                try:
                    days = int(query.get("days", ["30"])[0])
                    offset = int(query.get("timezone_offset", ["0"])[0])
                except (TypeError, ValueError):
                    days, offset = 30, 0
                self.json(200, self.server.library.viewing_insights(days, offset))
                return
            if parsed.path == "/api/remote/media":
                session = self.server.library.remote_session(str(query.get("stream", [""])[0]))
                self.stream_remote_media(session["source"])
                return
            if parsed.path == "/api/remote/subtitles":
                data = self.server.library.remote_subtitles(str(query.get("stream", [""])[0]))
                self.stream_bytes(data, "text/vtt; charset=utf-8")
                return
            query_routes = {
                "/api/usb/browse": lambda: self.server.library.usb_browse(
                    str(query.get("volume", [""])[0]), str(query.get("path", [""])[0])),
                "/api/adult/discovery": lambda: self.server.library.adult_discovery(
                    str(query.get("q", [""])[0])),
                "/api/adult/title": lambda: self.server.library.adult_title_detail(
                    str(query.get("media_type", [""])[0]), str(query.get("tmdb_id", [""])[0])),
                "/api/adult/season": lambda: self.server.library.adult_title_season(
                    str(query.get("tmdb_id", [""])[0]), str(query.get("season", [""])[0])),
                "/api/adult/providers": lambda: self.server.library.adult_streaming_links(
                    str(query.get("media_type", [""])[0]), str(query.get("tmdb_id", [""])[0]),
                    str(query.get("refresh", ["0"])[0]) == "1"),
            }
            query_route = query_routes.get(parsed.path)
            if query_route is not None:
                self.json(200, query_route())
                return
            prefix_routes = (
                ("/api/usb/imports/", self.server.library.usb_import_status, "json"),
                ("/api/offline/preparations/", self.server.library.offline_preparation_status, "json"),
                ("/api/adult/artwork/", self.server.library.adult_artwork, "image"),
                ("/api/adult/series/artwork/", self.server.library.adult_series_artwork, "image"),
                ("/api/channel/artwork/", self.server.library.channel_artwork, "image"),
                ("/api/uploads/", self.server.library.upload_status, "json"),
            )
            for prefix, route, response_type in prefix_routes:
                if parsed.path.startswith(prefix):
                    result = route(parsed.path.rsplit("/", 1)[1])
                    if response_type == "image":
                        self.stream_file(result, "image/jpeg",
                                         "public, max-age=31536000, immutable")
                    else:
                        self.json(200, result)
                    return
            if self.path == "/api/support":
                self.file(self.server.library.support_bundle(), "mabeltv-support.tar.gz")
                return
            self.json(404, {"error": "Not found"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
        except ValueError as error:
            self.json(400, {"error": str(error)})
        except Exception as error:
            self.unexpected("GET", error)
            self.json(500, {"error": "The library had an unexpected problem"})

    def do_POST(self) -> None:
        try:
            if not self.require_same_origin():
                return
            address = self.client_address[0]
            if self.handle_setup_post(address) or self.handle_login_post(address):
                return
            if self.path == "/api/logout":
                self.server.library.revoke_session(self.session_token())
                self.json(200, {"ok": True},
                          "mabeltv_library=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
                return
            if self.path == "/api/portal-security":
                required = self.server.library.set_portal_pin_required(self.body())
                self.json(200, {"ok": True, "portal_pin_required": required},
                          "mabeltv_library=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
                return
            if not self.require():
                return
            payload = self.body()
            if self.dispatch_json_post(payload):
                return
            if self.path == "/api/external/release":
                self.json(200, self.server.library.release_external_stream(
                    str(payload.get("stream", ""))))
                return
            if self.path == "/api/remote/heartbeat":
                self.server.library.remote_session(str(payload.get("stream", "")))
                self.json(200, {"ok": True})
                return
            if self.path == "/api/remote/release":
                self.json(200, self.server.library.remote_release(
                    str(payload.get("stream", ""))))
                return
            if (self.handle_usb_post(payload)
                    or self.handle_adult_series_post(payload)):
                return
            if self.path.startswith("/api/uploads/"):
                self.json(200, self.server.library.upload_action(
                    self.path.rsplit("/", 1)[1], str(payload.get("action", ""))))
                return
            if self.handle_management_post(payload):
                return
            self.json(404, {"error": "Not found"})
        except RemoteTvActiveError as error:
            self.json(HTTPStatus.CONFLICT, {"error": str(error), "code": "tv-active"})
        except ValueError as error:
            self.json(400, {"error": str(error)})
        except Exception as error:
            self.unexpected("POST", error)
            self.json(500, {"error": "The library had an unexpected problem"})
    def do_PATCH(self) -> None:
        try:
            if not self.require_same_origin(): return
            if not self.require(): return
            if not self.path.startswith("/api/uploads/"): self.json(404, {"error": "Not found"}); return
            length = int(self.headers.get("Content-Length", "0"));
            if length <= 0 or length > CHUNK_LIMIT: raise ValueError("Invalid upload chunk")
            result = self.server.library.append_upload(self.path.rsplit("/", 1)[1], int(self.headers.get("Upload-Offset", "-1")), self.rfile.read(length)); self.json(200, result)
        except ValueError as error: self.json(400, {"error": str(error)})
        except Exception as error:
            self.unexpected("PATCH", error); self.json(500, {"error": "The upload could not be completed"})


class LibraryServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 16

    def __init__(self, address: tuple[str, int], library: Any) -> None:
        super().__init__(address, Handler)
        self.library = library
        self.worker_slots = threading.BoundedSemaphore(12)
        self.library.start_viewing_tracker()

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self.worker_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.worker_slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.worker_slots.release()

