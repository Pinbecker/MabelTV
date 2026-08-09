#!/usr/bin/env python3
"""Local, parent-protected media library for a Mabel TV appliance.

The service deliberately uses only Python's standard library.  It is bound to
the home network by systemd, runs as the unprivileged mabeltv user, and never
serves a partial upload from the media folders watched by the TV application.
"""

from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import time
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


SUPPORTED_EXTENSIONS = {".mp4", ".m4v", ".mkv", ".mov", ".webm", ".avi", ".mpg", ".mpeg"}
CHUNK_LIMIT = 8 * 1024 * 1024
MAX_UPLOAD_BYTES = 64 * 1024 * 1024 * 1024
SESSION_SECONDS = 8 * 60 * 60
SAFE_NAME = re.compile(r"[^A-Za-z0-9 ._()&'\-]+")
EPISODE_NAME = re.compile(r"^s(\d{1,2})e(\d{1,3})\s*-\s*(.+)$", re.IGNORECASE)


INDEX = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mabel TV Library</title><style>
:root{--ink:#2b221c;--paper:#fff4d6;--red:#bf3d2e;--blue:#277e9b;--line:#d5bd82}*{box-sizing:border-box}body{margin:0;background:#e7c06a;color:var(--ink);font:16px system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:24px}.card{background:var(--paper);border:4px solid var(--ink);box-shadow:7px 7px 0 #916b24;padding:20px;margin:16px 0}h1{font:900 clamp(2rem,7vw,4rem)/.9 Georgia,serif;margin:0 0 8px}h2{margin:0 0 12px}button,input,select{font:inherit;padding:10px;border:2px solid var(--ink);background:#fff}button{cursor:pointer;background:var(--blue);color:white;font-weight:800}button.warn{background:var(--red)}button.plain{background:white;color:var(--ink)}.hidden{display:none}.muted{color:#6d5b46}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grow{flex:1}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.channel{border:2px solid var(--line);padding:14px;background:#fffdf5}.programme{border-top:1px solid var(--line);padding:8px 0;display:flex;gap:8px;align-items:center}.programme span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}progress{width:100%;height:22px}#notice{font-weight:bold;white-space:pre-wrap}.danger{color:#9f251d}.small{font-size:.85rem}@media(max-width:520px){main{padding:12px}.card{padding:14px;margin:12px 0}}
</style></head><body><main>
<section id="login" class="card"><h1>Mabel TV<br>Library</h1><p>Put new programmes onto Mabel TV from this phone or computer.</p><form id="loginForm" class="row"><input id="pin" class="grow" inputmode="numeric" autocomplete="current-password" type="password" placeholder="Parent PIN" required><button>Open library</button></form><p id="loginError" class="danger"></p></section>
<section id="app" class="hidden"><div class="card"><div class="row"><div class="grow"><h1>Mabel TV<br>Library</h1><span id="storage" class="muted"></span></div><button id="refresh" class="plain">Refresh TV library</button><button id="logout" class="plain">Lock</button></div><p id="notice"></p></div>
<section class="card"><h2>Add something new</h2><p class="muted">Choose its channel, choose a video, then leave this page open until the progress bar completes. Large uploads resume if the connection drops.</p><form id="uploadForm" class="row"><select id="channel" required></select><input id="file" class="grow" type="file" accept="video/*,.mkv,.m4v,.avi,.mpg,.mpeg" required><button>Upload &amp; publish</button></form><div id="uploadState" class="hidden"><p id="uploadText"></p><progress id="progress" max="1" value="0"></progress></div></section>
<section class="card"><h2>Channels &amp; programmes</h2><div id="channels" class="grid"></div></section>
<section class="card"><h2>Recycle bin</h2><p class="muted">Deleted programmes are kept here until permanently removed.</p><div id="bin"></div></section></section>
</main><script>
let library=null; const $=s=>document.querySelector(s);
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});if(r.status===401)throw new Error('Locked');const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Something went wrong');return body}
function notice(text,bad=false){$('#notice').textContent=text;$('#notice').className=bad?'danger':''}
async function load(){library=await api('/api/library');$('#storage').textContent=`${library.storage.free_gb.toFixed(1)} GB free of ${library.storage.total_gb.toFixed(1)} GB`; const select=$('#channel');select.innerHTML='';library.channels.forEach(c=>{let o=document.createElement('option');o.value=c.number;o.textContent=`CH ${c.number} — ${c.name}`;select.append(o)}); render()}
function button(text,fn,kind='plain'){let b=document.createElement('button');b.type='button';b.textContent=text;b.className=kind;b.onclick=fn;return b}
function render(){const root=$('#channels');root.innerHTML=''; library.channels.forEach(c=>{const box=document.createElement('article');box.className='channel';let title=document.createElement('div');title.className='row';let h=document.createElement('h2');h.className='grow';h.textContent=`CH ${c.number} · ${c.name}`;title.append(h,button(c.enabled?'Disable channel':'Enable channel',()=>manage('toggle-channel',{channel:c.number}),c.enabled?'plain':'warn'));box.append(title);let summary=document.createElement('p');summary.className='muted small';summary.textContent=`${c.enabled_programmes} of ${c.programmes.length} programmes enabled`;box.append(summary);c.programmes.forEach(p=>{let row=document.createElement('div');row.className='programme';let name=document.createElement('span');name.textContent=p.display_name;row.append(name,button(p.enabled?'Disable':'Enable',()=>manage('toggle-programme',{channel:c.number,file:p.name}),p.enabled?'plain':'warn'),button('Rename',()=>renameProgramme(c,p)));row.append(button('Bin',()=>{if(confirm(`Move “${p.display_name}” to the recycle bin?`))manage('trash',{channel:c.number,file:p.name})},'warn'));box.append(row)});root.append(box)}); const bin=$('#bin');bin.innerHTML='';if(!library.recycle.length){bin.textContent='Nothing in the recycle bin.'}library.recycle.forEach(x=>{let r=document.createElement('div');r.className='programme';let n=document.createElement('span');n.textContent=`${x.display_name} · ${x.channel_name}`;r.append(n,button('Restore',()=>manage('restore',{id:x.id})),button('Delete forever',()=>{if(confirm('Permanently delete this video? This cannot be undone.'))manage('delete',{id:x.id})},'warn'));bin.append(r)})}
async function manage(action,extra={}){try{notice('Working…');await api('/api/manage',{method:'POST',body:JSON.stringify({action,...extra})});await load();notice('Done. Mabel TV is refreshing its library.')}catch(e){notice(e.message,true)}}
async function renameProgramme(c,p){let name=prompt('Programme name (keep S01E02 - at the start for episodes):',p.display_name);if(name&&name.trim())await manage('rename',{channel:c.number,file:p.name,name:name.trim()})}
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{method:'POST',body:JSON.stringify({pin:$('#pin').value})});$('#login').classList.add('hidden');$('#app').classList.remove('hidden');await load()}catch(e){$('#loginError').textContent=e.message}};
$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload()}; $('#refresh').onclick=()=>manage('refresh');
$('#uploadForm').onsubmit=async e=>{e.preventDefault();let f=$('#file').files[0];if(!f)return;let channel=Number($('#channel').value);$('#uploadState').classList.remove('hidden');$('#progress').max=f.size;$('#progress').value=0;try{notice('Preparing upload…');let created=await api('/api/uploads',{method:'POST',body:JSON.stringify({channel,file_name:f.name,size:f.size})});let offset=created.offset||0;while(offset<f.size){let part=f.slice(offset,Math.min(offset+8388608,f.size));let r=await fetch('/api/uploads/'+created.id,{method:'PATCH',credentials:'same-origin',headers:{'Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:part});let body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Upload failed');offset=body.offset;$('#progress').value=offset;$('#uploadText').textContent=`Uploading ${(offset/1048576).toFixed(0)} MB of ${(f.size/1048576).toFixed(0)} MB…`} $('#uploadText').textContent='Published. Mabel TV is refreshing its library…';await load();notice('Published successfully.')}catch(e){notice(e.message,true);$('#uploadText').textContent='Upload paused. Choose the same file and upload again to resume.'}}
</script></body></html>"""


class Library:
    def __init__(self, args: argparse.Namespace) -> None:
        self.media_root = Path(args.media_root).resolve()
        self.channels_path = Path(args.channels).resolve()
        self.settings_path = Path(args.settings).resolve()
        self.incoming = self.media_root / ".incoming"
        self.bin = self.media_root / ".recycle-bin"
        self.pin = self.read_pin(Path(args.config))
        self.sessions: dict[str, float] = {}
        self.media_root.mkdir(parents=True, exist_ok=True)
        self.incoming.mkdir(mode=0o750, exist_ok=True)
        self.bin.mkdir(mode=0o750, exist_ok=True)

    @staticmethod
    def read_pin(path: Path) -> str:
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.startswith("MABELTV_LIBRARY_PIN="):
                    value = line.partition("=")[2].strip()
                    if value:
                        return value
        except OSError:
            pass
        return "0973"

    @staticmethod
    def read_json(path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return fallback

    @staticmethod
    def write_json(path: Path, value: Any) -> None:
        temporary = path.with_name(path.name + ".new")
        temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary, path)

    def channels(self) -> list[dict[str, Any]]:
        return self.read_json(self.channels_path, {}).get("channels", [])

    def channel(self, number: int) -> dict[str, Any]:
        for channel in self.channels():
            if channel.get("number") == number:
                return channel
        raise ValueError("Unknown channel")

    def safe_media_path(self, channel: dict[str, Any], file_name: str) -> Path:
        name = Path(file_name).name
        if name != file_name or not name or Path(name).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That is not a supported video file")
        folder = self.media_root / str(channel["folder"])
        folder.mkdir(mode=0o750, exist_ok=True)
        return folder / name

    def settings(self) -> dict[str, Any]:
        return self.read_json(self.settings_path, {"schema_version": 1})

    def library(self) -> dict[str, Any]:
        settings = self.settings()
        rules = settings.get("library", {})
        disabled_channels = set(rules.get("disabled_channels", []))
        disabled_programmes = rules.get("disabled_programmes", {})
        response = []
        for channel in self.channels():
            folder = self.media_root / str(channel["folder"])
            programmes = []
            for item in sorted(folder.glob("*") if folder.is_dir() else [], key=lambda p: p.name.lower()):
                if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
                    disabled = set(disabled_programmes.get(str(channel["number"]), []))
                    programmes.append({"name": item.name, "display_name": self.display_name(item.name), "enabled": item.name not in disabled})
            response.append({"number": channel["number"], "name": channel["name"], "enabled": channel["number"] not in disabled_channels, "programmes": programmes, "enabled_programmes": sum(p["enabled"] for p in programmes)})
        disk = shutil.disk_usage(self.media_root)
        return {"channels": response, "recycle": self.recycle_items(), "storage": {"free_gb": disk.free / 1024**3, "total_gb": disk.total / 1024**3}}

    @staticmethod
    def display_name(name: str) -> str:
        stem = Path(name).stem.replace("_", " ").strip()
        match = EPISODE_NAME.match(stem)
        if match:
            return f"S{int(match.group(1)):02} E{int(match.group(2)):02} · {match.group(3).strip()}"
        return stem

    def recycle_items(self) -> list[dict[str, str]]:
        values = []
        for manifest in self.bin.glob("*/manifest.json"):
            item = self.read_json(manifest, {})
            if item.get("id") and item.get("file_name"):
                values.append({"id": item["id"], "display_name": self.display_name(item["file_name"]), "channel_name": item.get("channel_name", "Unknown channel")})
        return sorted(values, key=lambda value: value["id"], reverse=True)

    def update_settings(self, mutator: Any) -> None:
        settings = self.settings()
        library = settings.setdefault("library", {})
        library.setdefault("disabled_channels", [])
        library.setdefault("disabled_programmes", {})
        mutator(library)
        self.write_json(self.settings_path, settings)

    def refresh_tv(self) -> bool:
        return subprocess.run(["sudo", "-n", "/usr/local/libexec/mabeltv-library-refresh"], check=False, capture_output=True).returncode == 0

    def probe(self, path: Path) -> None:
        result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "default=nw=1", str(path)], check=False, capture_output=True, text=True)
        if result.returncode != 0 or "codec_type=video" not in result.stdout:
            raise ValueError("Mabel TV could not find a video stream in that file")

    def upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        number, file_name, size = int(payload.get("channel")), str(payload.get("file_name", "")), int(payload.get("size", 0))
        channel = self.channel(number)
        self.safe_media_path(channel, file_name)
        if size <= 0 or size > MAX_UPLOAD_BYTES:
            raise ValueError("That file size is not supported")
        if shutil.disk_usage(self.media_root).free < size + 256 * 1024 * 1024:
            raise ValueError("There is not enough free space on Mabel TV")
        for meta in self.incoming.glob("*.json"):
            value = self.read_json(meta, {})
            if value.get("channel") == number and value.get("file_name") == file_name and value.get("size") == size:
                part = self.incoming / (value["id"] + ".part")
                return {"id": value["id"], "offset": part.stat().st_size if part.exists() else 0}
        upload_id = uuid.uuid4().hex
        self.write_json(self.incoming / (upload_id + ".json"), {"id": upload_id, "channel": number, "file_name": file_name, "size": size, "created": time.time()})
        return {"id": upload_id, "offset": 0}

    def upload_meta(self, upload_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        meta = self.read_json(self.incoming / (upload_id + ".json"), None)
        if not isinstance(meta, dict):
            raise ValueError("Upload not found")
        return meta

    def append_upload(self, upload_id: str, offset: int, content: bytes) -> dict[str, Any]:
        meta = self.upload_meta(upload_id)
        part = self.incoming / (upload_id + ".part")
        current = part.stat().st_size if part.exists() else 0
        if offset != current:
            return {"offset": current, "resumable": True}
        if len(content) == 0 or len(content) > CHUNK_LIMIT or current + len(content) > int(meta["size"]):
            raise ValueError("Invalid upload chunk")
        with part.open("ab") as output:
            output.write(content)
        current += len(content)
        result = {"offset": current, "complete": current == int(meta["size"])}
        if result["complete"]:
            channel = self.channel(int(meta["channel"]))
            destination = self.safe_media_path(channel, str(meta["file_name"]))
            if destination.exists():
                raise ValueError("A file with that name already exists in this channel")
            self.probe(part)
            os.replace(part, destination)
            (self.incoming / (upload_id + ".json")).unlink(missing_ok=True)
            result["refreshed"] = self.refresh_tv()
        return result

    def manage(self, payload: dict[str, Any]) -> None:
        action = payload.get("action")
        if action == "refresh":
            self.refresh_tv(); return
        if action in {"toggle-channel", "toggle-programme", "rename", "trash"}:
            channel = self.channel(int(payload.get("channel")))
        if action == "toggle-channel":
            number = channel["number"]
            def change(library: dict[str, Any]) -> None:
                values = set(library.get("disabled_channels", [])); values.symmetric_difference_update({number}); library["disabled_channels"] = sorted(values)
            self.update_settings(change)
        elif action == "toggle-programme":
            file_name = str(payload.get("file", "")); self.safe_media_path(channel, file_name)
            def change(library: dict[str, Any]) -> None:
                key = str(channel["number"]); values = set(library["disabled_programmes"].get(key, [])); values.symmetric_difference_update({file_name}); library["disabled_programmes"][key] = sorted(values)
            self.update_settings(change)
        elif action == "rename":
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file(): raise ValueError("Programme not found")
            proposed = SAFE_NAME.sub("", str(payload.get("name", "")).strip()).strip(". ")
            if not proposed: raise ValueError("Enter a programme name")
            destination = self.safe_media_path(channel, proposed + source.suffix)
            if destination.exists() and destination != source: raise ValueError("That name is already used in this channel")
            source.rename(destination)
            def change(library: dict[str, Any]) -> None:
                key = str(channel["number"]); values = library["disabled_programmes"].get(key, []); library["disabled_programmes"][key] = [destination.name if v == source.name else v for v in values]
            self.update_settings(change)
        elif action == "trash":
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file(): raise ValueError("Programme not found")
            item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"; destination_dir = self.bin / item_id; destination_dir.mkdir(mode=0o750)
            shutil.move(str(source), str(destination_dir / source.name))
            self.write_json(destination_dir / "manifest.json", {"id": item_id, "file_name": source.name, "folder": channel["folder"], "channel_name": channel["name"]})
        elif action in {"restore", "delete"}:
            item_id = str(payload.get("id", "")); directory = self.bin / item_id
            if not re.fullmatch(r"\d+-[a-f0-9]{8}", item_id) or not directory.is_dir(): raise ValueError("Recycle-bin item not found")
            manifest = self.read_json(directory / "manifest.json", {})
            if action == "restore":
                folder = self.media_root / str(manifest.get("folder", "")); file_name = str(manifest.get("file_name", "")); destination = folder / Path(file_name).name
                if not manifest.get("folder") or destination.exists(): raise ValueError("Cannot restore this item because a file with that name already exists")
                folder.mkdir(mode=0o750, exist_ok=True); shutil.move(str(directory / file_name), str(destination)); shutil.rmtree(directory)
            else:
                shutil.rmtree(directory)
        else:
            raise ValueError("Unknown library action")
        self.refresh_tv()


class Handler(BaseHTTPRequestHandler):
    server: "LibraryServer"
    def log_message(self, fmt: str, *args: Any) -> None: return
    def json(self, status: int, value: dict[str, Any], cookie: str | None = None) -> None:
        data = json.dumps(value).encode(); self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store")
        if cookie: self.send_header("Set-Cookie", cookie)
        self.end_headers(); self.wfile.write(data)
    def body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"));
        if length > 64 * 1024: raise ValueError("Request is too large")
        return json.loads(self.rfile.read(length) or b"{}")
    def authorised(self) -> bool:
        cookie = SimpleCookie(self.headers.get("Cookie")); token = cookie.get("mabeltv_library")
        return bool(token and self.server.library.sessions.get(token.value, 0) > time.time())
    def require(self) -> bool:
        if not self.authorised(): self.json(HTTPStatus.UNAUTHORIZED, {"error": "Parent PIN required"}); return False
        return True
    def do_GET(self) -> None:
        try:
            if self.path == "/":
                data = INDEX.encode(); self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
            if not self.require(): return
            if self.path == "/api/library": self.json(200, self.server.library.library()); return
            if self.path.startswith("/api/uploads/"):
                meta = self.server.library.upload_meta(self.path.rsplit("/", 1)[1]); part = self.server.library.incoming / (meta["id"] + ".part"); self.json(200, {"id": meta["id"], "offset": part.stat().st_size if part.exists() else 0}); return
            self.json(404, {"error": "Not found"})
        except ValueError as error: self.json(400, {"error": str(error)})
        except Exception: self.json(500, {"error": "The library had an unexpected problem"})
    def do_POST(self) -> None:
        try:
            if self.path == "/api/login":
                pin = str(self.body().get("pin", ""))
                if not hmac.compare_digest(pin, self.server.library.pin): self.json(403, {"error": "That PIN is not correct"}); return
                token = secrets.token_urlsafe(32); self.server.library.sessions[token] = time.time() + SESSION_SECONDS; self.json(200, {"ok": True}, f"mabeltv_library={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}"); return
            if self.path == "/api/logout": self.json(200, {"ok": True}, "mabeltv_library=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); return
            if not self.require(): return
            payload = self.body()
            if self.path == "/api/uploads": self.json(201, self.server.library.upload_create(payload)); return
            if self.path == "/api/manage": self.server.library.manage(payload); self.json(200, {"ok": True}); return
            self.json(404, {"error": "Not found"})
        except ValueError as error: self.json(400, {"error": str(error)})
        except Exception: self.json(500, {"error": "The library had an unexpected problem"})
    def do_PATCH(self) -> None:
        try:
            if not self.require(): return
            if not self.path.startswith("/api/uploads/"): self.json(404, {"error": "Not found"}); return
            length = int(self.headers.get("Content-Length", "0"));
            if length <= 0 or length > CHUNK_LIMIT: raise ValueError("Invalid upload chunk")
            result = self.server.library.append_upload(self.path.rsplit("/", 1)[1], int(self.headers.get("Upload-Offset", "-1")), self.rfile.read(length)); self.json(200, result)
        except ValueError as error: self.json(400, {"error": str(error)})
        except Exception: self.json(500, {"error": "The upload could not be completed"})


class LibraryServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], library: Library) -> None:
        super().__init__(address, Handler); self.library = library


def main() -> None:
    parser = argparse.ArgumentParser(description="Mabel TV local media library")
    parser.add_argument("--bind", default="0.0.0.0"); parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--media-root", default="/srv/mabeltv/media"); parser.add_argument("--channels", default="/var/lib/mabeltv/channels.json")
    parser.add_argument("--settings", default="/var/lib/mabeltv/settings.json"); parser.add_argument("--config", default="/etc/mabeltv/library.conf")
    args = parser.parse_args(); LibraryServer((args.bind, args.port), Library(args)).serve_forever()


if __name__ == "__main__": main()
