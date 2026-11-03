"""Studio HTTP dispatch after the portal's shared origin/authentication gates."""
from urllib.parse import urlsplit
from urllib.request import Request
from urllib.request import HTTPRedirectHandler, build_opener


class NoArtworkRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("BBC artwork is unavailable")


def studio_get(handler, path, query):
    if not path.startswith("/api/studio/"):
        return False
    library = handler.server.library
    if path == "/api/studio/status":
        result = library.studio_status()
    elif path == "/api/studio/cloud":
        result = library.studio_cloud_catalogue(query)
    elif path == "/api/studio/cloud/item":
        result = library.studio_cloud_item(str(query.get("id", [""])[0]))
    elif path == "/api/studio/request":
        result = library.studio_request_status(str(query.get("id", [""])[0]))
    elif path == "/api/studio/artwork":
        url = str(query.get("url", [""])[0])
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in {"ichef.bbci.co.uk", "ichef.bbc.co.uk"} or parsed.username or parsed.password or parsed.port:
            raise ValueError("Choose BBC programme artwork")
        # Do not follow an upstream redirect to an arbitrary host.
        with build_opener(NoArtworkRedirect).open(Request(url, headers={"User-Agent": "MabelTV Studio"}), timeout=15) as response:
            if urlsplit(response.geturl()).hostname not in {"ichef.bbci.co.uk", "ichef.bbc.co.uk"}:
                raise ValueError("BBC artwork is unavailable")
            data = response.read(1024 * 1024)
        handler.stream_bytes(data, "image/jpeg")
        return True
    else:
        handler.json(404, {"error": "Studio route not found"})
        return True
    handler.json(200, result)
    return True


def studio_post(handler, path, payload):
    routes = {"/api/studio/jobs": "studio_add_jobs", "/api/studio/action": "studio_job_action",
              "/api/studio/worker": "studio_worker_poll", "/api/studio/iplayer": "studio_request",
              "/api/studio/cloud/refresh": "studio_cloud_refresh", "/api/studio/cloud/auth": "studio_cloud_auth",
              "/api/studio/cloud/confirm": "studio_cloud_confirm"}
    routes["/api/studio/cloud/operation"] = "studio_cloud_operation"
    routes["/api/studio/cloud/replace-original"] = "studio_cloud_replace_original"
    routes["/api/studio/cloud/optimise-preview"] = "studio_cloud_optimise_preview"
    routes["/api/studio/cloud/match"] = "studio_cloud_match"
    routes["/api/studio/subtitle"] = "studio_subtitle"
    routes["/api/studio/torrents/search"] = "studio_torrent_search"
    routes["/api/studio/torrents/inspect"] = "studio_torrent_inspect"
    if path not in routes:
        return False
    if path == "/api/studio/cloud/auth":
        origin = urlsplit(handler.headers.get("Origin", ""))
        local_test = handler.server.server_address[0] in {"127.0.0.1", "::1"} and handler.client_address[0] in {"127.0.0.1", "::1"}
        if origin.scheme != "https" and not local_test:
            handler.json(403, {"error": "Use your secure HTTPS portal address to connect iCloud"})
            return True
    handler.json(200, getattr(handler.server.library, routes[path])(payload))
    return True
