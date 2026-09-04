#!/usr/bin/env python3
"""Local, parent-protected media library for a KidsTV appliance.

The service deliberately uses only Python's standard library.  It is bound to
the home network by systemd, runs as the unprivileged mabeltv user, and never
serves a partial upload from the media folders watched by the TV application.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import queue
import re
import secrets
import signal
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen


SUPPORTED_EXTENSIONS = {".mp4", ".m4v", ".mkv", ".mov", ".webm", ".avi", ".mpg", ".mpeg"}
CHUNK_LIMIT = 8 * 1024 * 1024
MAX_UPLOAD_BYTES = 64 * 1024 * 1024 * 1024
SESSION_SECONDS = 8 * 60 * 60
PLAYBACK_WIDTH = 1280
PLAYBACK_HEIGHT = 720
PLAYBACK_FPS = 30
MAX_CONVERSION_TEMP_C = 78.0
RESUME_CONVERSION_TEMP_C = 72.0
USB_IMPORT_RESERVE_BYTES = 256 * 1024 * 1024
USB_MAX_SELECTION_FILES = 2000
USB_IDLE_SECONDS = 60.0
USB_POWER_POLL_SECONDS = 5.0
TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TMDB_BACKDROP_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w1280"
WATCHMODE_API_BASE_URL = "https://api.watchmode.com/v1"
LG_WEBOS_DEFAULT_PORT = 3001
LG_WEBOS_CLIENT_KEY_PATH = "/var/lib/mabeltv/secrets/lg-webos-client-key"
NETFLIX_TV_APP_ID = "netflix"
ADULT_DISCOVERY_CACHE_SECONDS = 24 * 60 * 60
ADULT_PROVIDER_CACHE_SECONDS = 7 * 24 * 60 * 60
ADULT_PROVIDER_MAX_CACHE_SECONDS = 29 * 24 * 60 * 60
OPENSUBTITLES_API_BASE_URL = "https://api.opensubtitles.com/api/v1"
OPENSUBTITLES_USER_AGENT = "MabelTV/0.2.5"
SUBTITLE_EXTENSIONS = {".srt", ".vtt", ".ass", ".ssa"}
REMOTE_BROWSER_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm"}
REMOTE_SESSION_SECONDS = 2 * 60
EXTERNAL_VLC_SESSION_SECONDS = 6 * 60 * 60
EXTERNAL_DOWNLOAD_SESSION_SECONDS = 30 * 60
OFFLINE_PREPARED_CACHE_SECONDS = 2 * 24 * 60 * 60
REMOTE_RESUME_MIN_SECONDS = 30.0
REMOTE_COMPLETION_MIN_SECONDS = 180.0
REMOTE_COMPLETION_FRACTION = 0.05
VIEWING_SAMPLE_SECONDS = 15.0
VIEWING_SESSION_GAP_SECONDS = 120.0
VIEWING_MIN_SESSION_SECONDS = 120.0
VIEWING_MAX_SESSIONS = 50000
VIEWING_RETENTION_DAYS = 3650
UPLOAD_SOURCE_GRACE_SECONDS = 45
SAFE_NAME = re.compile(r"[^A-Za-z0-9 ._()&'\-]+")
EPISODE_NAME = re.compile(r"^s(\d{1,2})e(\d{1,3})\s*-\s*(.+)$", re.IGNORECASE)
PIN_PATTERN = re.compile(r"\d{4,8}")
PBKDF2_ITERATIONS = 260_000
PRODUCT_NAME = "KidsTV"
DEFAULT_CHANNELS = [
    {"number": 1, "name": "Kids TV", "folder": "kids-tv", "aspect": "crop",
     "content_type": "shows"},
    {"number": 2, "name": "Cartoons", "folder": "cartoons", "aspect": "crop",
     "content_type": "shows"},
    {"number": 3, "name": "Films", "folder": "films", "aspect": "fit",
     "content_type": "films"},
    {"number": 4, "name": "Family Videos", "folder": "family", "aspect": "fit",
     "content_type": "films"},
]


INDEX = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mabel TV Library</title><style>
:root{--ink:#2b221c;--paper:#fff4d6;--red:#bf3d2e;--blue:#277e9b;--line:#d5bd82}*{box-sizing:border-box}body{margin:0;background:#e7c06a;color:var(--ink);font:16px system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:24px}.card{background:var(--paper);border:4px solid var(--ink);box-shadow:7px 7px 0 #916b24;padding:20px;margin:16px 0}h1{font:900 clamp(2.25rem,5vw,3.6rem)/.92 Georgia,serif;margin:0 0 8px}h2{margin:0 0 12px}button,input,select{font:inherit;padding:10px;border:2px solid var(--ink);background:#fff}button{cursor:pointer;background:var(--blue);color:white;font-weight:800}button.warn{background:var(--red)}button.plain{background:white;color:var(--ink)}.hidden{display:none}.muted{color:#6d5b46}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grow{flex:1}.upload-form{display:grid;grid-template-columns:minmax(210px,.7fr) minmax(300px,1.4fr) auto;gap:10px}.upload-form>*{min-width:0}.channel-toolbar{display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin-bottom:14px}.channel-toolbar label{display:grid;gap:5px;font-weight:800}.channel{border:2px solid var(--line);padding:18px;background:#fffdf5}.channel-header{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}.programme-list{max-height:540px;overflow:auto;border-bottom:1px solid var(--line)}.programme{border-top:1px solid var(--line);padding:10px 0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.programme-name{min-width:0;overflow-wrap:anywhere}.programme-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}progress{width:100%;height:22px}#notice{font-weight:bold;white-space:pre-wrap}.danger{color:#9f251d}.small{font-size:.85rem}@media(max-width:680px){main{padding:12px}.card{padding:14px;margin:12px 0}.upload-form{grid-template-columns:1fr}.programme{grid-template-columns:1fr}.programme-actions{justify-content:flex-start}.programme-actions button{flex:1}h1{font-size:2.4rem}}
</style></head><body><main>
<section id="login" class="card"><h1>Mabel TV<br>Library</h1><p>Put new programmes onto Mabel TV from this phone or computer.</p><form id="loginForm" class="row"><input id="pin" class="grow" inputmode="numeric" autocomplete="current-password" type="password" placeholder="Parent PIN" required><button>Open library</button></form><p id="loginError" class="danger"></p></section>
<section id="app" class="hidden"><div class="card"><div class="row"><div class="grow"><h1>Mabel TV<br>Library</h1><span id="storage" class="muted"></span></div><button id="refresh" class="plain">Refresh TV library</button><button id="logout" class="plain">Lock</button></div><p id="notice"></p></div>
<section class="card"><h2>Add something new</h2><p class="muted">Choose its channel and a video. Mabel TV checks the file, then publishes the original straight to that channel. Uploads resume safely if the connection drops.</p><form id="uploadForm" class="upload-form"><select id="channel" required></select><input id="file" type="file" accept="video/*,.mkv,.m4v,.avi,.mpg,.mpeg" required><button>Upload &amp; publish</button></form><div id="uploadState" class="hidden"><p id="uploadText"></p><progress id="progress" max="1" value="0"></progress></div></section>
<section class="card"><h2>Channels &amp; programmes</h2><div class="channel-toolbar"><label>Show channel<select id="manageChannel"></select></label><span id="channelSummary" class="muted"></span></div><div id="channels"></div></section>
<section class="card"><h2>Recycle bin</h2><p class="muted">Deleted programmes are kept here until permanently removed.</p><div id="bin"></div></section></section>
</main><script>
let library=null,selectedManageChannel=null; const $=s=>document.querySelector(s);
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});if(r.status===401)throw new Error('Locked');const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Something went wrong');return body}
function notice(text,bad=false){$('#notice').textContent=text;$('#notice').className=bad?'danger':''}
async function load(preferredUploadChannel=null){library=await api('/api/library');$('#storage').textContent=`${library.storage.free_gb.toFixed(1)} GB free of ${library.storage.total_gb.toFixed(1)} GB`;const upload=$('#channel'),manage=$('#manageChannel');let uploadChoice=String(preferredUploadChannel??upload.value??'');let manageChoice=String(selectedManageChannel??manage.value??uploadChoice);upload.innerHTML='';manage.innerHTML='';library.channels.forEach(c=>{for(let select of [upload,manage]){let o=document.createElement('option');o.value=c.number;o.textContent=`CH ${c.number} — ${c.name}`;select.append(o)}});if(!library.channels.some(c=>String(c.number)===uploadChoice))uploadChoice=String(library.channels[0]?.number??'');if(!library.channels.some(c=>String(c.number)===manageChoice))manageChoice=uploadChoice;upload.value=uploadChoice;manage.value=manageChoice;selectedManageChannel=Number(manageChoice);render()}
function button(text,fn,kind='plain'){let b=document.createElement('button');b.type='button';b.textContent=text;b.className=kind;b.onclick=fn;return b}
function render(){const root=$('#channels'),channel=library.channels.find(c=>c.number===selectedManageChannel);root.innerHTML='';$('#channelSummary').textContent=channel?`${channel.enabled_programmes} of ${channel.programmes.length} programmes enabled`:'';if(channel){const box=document.createElement('article');box.className='channel';let title=document.createElement('div');title.className='channel-header';let h=document.createElement('h2');h.textContent=`CH ${channel.number} · ${channel.name}`;title.append(h,button(channel.enabled?'Disable channel':'Enable channel',()=>manage('toggle-channel',{channel:channel.number}),channel.enabled?'plain':'warn'));box.append(title);let list=document.createElement('div');list.className='programme-list';channel.programmes.forEach(p=>{let row=document.createElement('div');row.className='programme';let name=document.createElement('span');name.className='programme-name';name.textContent=p.display_name;name.title=p.display_name;let actions=document.createElement('div');actions.className='programme-actions';actions.append(button(p.enabled?'Disable':'Enable',()=>manage('toggle-programme',{channel:channel.number,file:p.name}),p.enabled?'plain':'warn'),button('Rename',()=>renameProgramme(channel,p)),button('Bin',()=>{if(confirm(`Move “${p.display_name}” to the recycle bin?`))manage('trash',{channel:channel.number,file:p.name})},'warn'));row.append(name,actions);list.append(row)});box.append(list);root.append(box)}const bin=$('#bin');bin.innerHTML='';if(!library.recycle.length){bin.textContent='Nothing in the recycle bin.'}library.recycle.forEach(x=>{let r=document.createElement('div');r.className='programme';let n=document.createElement('span');n.className='programme-name';n.textContent=`${x.display_name} · ${x.channel_name}`;let actions=document.createElement('div');actions.className='programme-actions';actions.append(button('Restore',()=>manage('restore',{id:x.id})),button('Delete forever',()=>{if(confirm('Permanently delete this video? This cannot be undone.'))manage('delete',{id:x.id})},'warn'));r.append(n,actions);bin.append(r)})}
async function manage(action,extra={}){try{notice('Working…');await api('/api/manage',{method:'POST',body:JSON.stringify({action,...extra})});await load();notice('Done.')}catch(e){notice(e.message,true)}}
async function renameProgramme(c,p){let name=prompt('Programme name (keep S01E02 - at the start for episodes):',p.display_name);if(name&&name.trim())await manage('rename',{channel:c.number,file:p.name,name:name.trim()})}
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{method:'POST',body:JSON.stringify({pin:$('#pin').value})});$('#login').classList.add('hidden');$('#app').classList.remove('hidden');await load()}catch(e){$('#loginError').textContent=e.message}};
$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload()}; $('#refresh').onclick=()=>manage('refresh'); $('#manageChannel').onchange=e=>{selectedManageChannel=Number(e.target.value);render()};
function uploadChunk(id,offset,part,finalChunk=false){return new Promise((resolve,reject)=>{let request=new XMLHttpRequest();request.open('PATCH','/api/uploads/'+id,true);request.withCredentials=true;request.timeout=finalChunk?2700000:30000;request.setRequestHeader('Upload-Offset',String(offset));request.setRequestHeader('Content-Type','application/offset+octet-stream');request.onload=()=>{let body={};try{body=JSON.parse(request.responseText)}catch(_){}if(request.status<200||request.status>=300){reject(new Error(body.error||'Upload failed'));return}resolve(body)};request.onerror=()=>reject(new Error('The connection to Mabel TV was lost'));request.ontimeout=()=>reject(new Error(finalChunk?'Optimising took too long. Choose the same file to resume.':'The phone did not receive this chunk response'));request.send(part)})}
async function resilientUploadChunk(id,offset,part,finalChunk=false){try{return await uploadChunk(id,offset,part,finalChunk)}catch(error){if(finalChunk)throw error;let saved=await api('/api/uploads/'+id);if(Number.isFinite(saved.offset)&&saved.offset>offset)return saved;throw error}}
$('#uploadForm').onsubmit=async e=>{e.preventDefault();let f=$('#file').files[0];if(!f)return;let channel=Number($('#channel').value),finalResult={};$('#uploadState').classList.remove('hidden');$('#progress').max=f.size;$('#progress').value=0;try{notice('Preparing upload…');let created=await api('/api/uploads',{method:'POST',body:JSON.stringify({channel,file_name:f.name,size:f.size})});let offset=created.offset||0;while(offset<f.size){let part=f.slice(offset,Math.min(offset+8388608,f.size)),finalChunk=offset+part.size>=f.size;if(finalChunk)$('#uploadText').textContent='Uploading final chunk, then publishing the original video…';finalResult=await resilientUploadChunk(created.id,offset,part,finalChunk);offset=finalResult.offset;$('#progress').value=offset;if(!finalChunk)$('#uploadText').textContent=`Uploading ${(offset/1048576).toFixed(0)} MB of ${(f.size/1048576).toFixed(0)} MB…`}selectedManageChannel=channel;await load(channel);$('#file').value='';$('#progress').value=0;$('#uploadText').textContent='';$('#uploadState').classList.add('hidden');notice(finalResult.refreshed?`Published to CH ${channel} and available now. Choose another video to upload.`:`Published to CH ${channel}. The TV library refresh is still running.`)}catch(e){notice(e.message,true);$('#uploadText').textContent='Upload paused. Choose the same file and upload again to resume.'}}
</script></body></html>"""


PORTAL_INCLUDE = re.compile(
    r"^[ \t]*<!-- portal-include:([A-Za-z0-9_./-]+\.html) -->[ \t]*$",
    re.MULTILINE,
)


def load_portal_document(index_path: Path) -> str:
    """Assemble the portal from private server-side HTML partials."""
    portal_root = (index_path.parent / "portal").resolve()
    document = index_path.read_text(encoding="utf-8")
    for _ in range(8):
        if not PORTAL_INCLUDE.search(document):
            return document

        def include(match: re.Match[str]) -> str:
            candidate = (portal_root / match.group(1)).resolve()
            if portal_root not in candidate.parents or not candidate.is_file():
                raise OSError(f"Portal include is unavailable: {match.group(1)}")
            return candidate.read_text(encoding="utf-8").rstrip()

        document = PORTAL_INCLUDE.sub(include, document)
    raise OSError("Portal includes are nested too deeply")


def load_index() -> str:
    """Load the maintainable product UI, retaining the embedded legacy UI as fallback."""
    try:
        return load_portal_document(Path(__file__).with_name("mabeltv-library.html"))
    except OSError:
        return INDEX


INDEX = load_index()


def load_classic_index() -> str:
    """Load the preserved previous portal as an optional presentation shell."""
    try:
        return load_portal_document(Path(__file__).with_name("mabeltv-library-classic.html"))
    except OSError:
        return INDEX


CLASSIC_INDEX = load_classic_index()


def load_watch_page() -> str:
    try:
        return Path(__file__).with_name("mabeltv-watch.html").read_text(encoding="utf-8")
    except OSError:
        return "<!doctype html><title>MabelTV</title><p>The remote player is unavailable.</p>"


WATCH_PAGE = load_watch_page()


class LiveStream:
    """A private, low-latency HLS mirror of the programme currently on TV."""

    PREVIEW_IDLE_SECONDS = 12.0

    def __init__(self, library: "Library") -> None:
        self.library = library
        self.root = Path("/var/cache/mabeltv/live-stream")
        self.lock = threading.RLock()
        self.process: subprocess.Popen[bytes] | None = None
        self.signature: tuple[str] | None = None
        self.preview_process: subprocess.Popen[bytes] | None = None
        self.preview_signature: tuple[str, bool] | None = None
        self.preview_frame = b""
        self.preview_generation = 0
        self.preview_error = ""
        self.preview_updated = threading.Condition(self.lock)
        self.preview_last_request = 0.0
        self.preview_idle_timer: threading.Timer | None = None

    @staticmethod
    def _terminate_process(process: subprocess.Popen[bytes],
                           privileged: bool = False) -> None:
        if process.poll() is not None:
            return
        if privileged:
            # The preview encoder crosses a sudo boundary because kmsgrab
            # needs DRM capabilities. An unprivileged killpg can stop sudo
            # while leaving its root FFmpeg child orphaned and still capturing
            # at 10 fps. The fixed helper terminates only the validated PID
            # recorded by mabeltv-screen-capture.
            try:
                subprocess.run(
                    ["sudo", "-n", "/usr/local/libexec/mabeltv-screen-capture-stop"],
                    check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=5,
                )
            except (OSError, subprocess.TimeoutExpired):
                pass
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def _schedule_preview_idle_locked(self) -> None:
        if self.preview_idle_timer:
            self.preview_idle_timer.cancel()
        timer = threading.Timer(self.PREVIEW_IDLE_SECONDS, self._stop_idle_preview)
        timer.daemon = True
        self.preview_idle_timer = timer
        timer.start()

    def _touch_preview_locked(self) -> None:
        self.preview_last_request = time.monotonic()
        self._schedule_preview_idle_locked()

    def _stop_idle_preview(self) -> None:
        process: subprocess.Popen[bytes] | None = None
        with self.lock:
            remaining = self.PREVIEW_IDLE_SECONDS - (time.monotonic() - self.preview_last_request)
            if remaining > 0:
                timer = threading.Timer(remaining, self._stop_idle_preview)
                timer.daemon = True
                self.preview_idle_timer = timer
                timer.start()
                return
            process, self.preview_process = self.preview_process, None
            self.preview_signature = None
            self.preview_frame = b""
            self.preview_error = ""
            self.preview_generation += 1
            self.preview_idle_timer = None
            self.preview_updated.notify_all()
        if process:
            self._terminate_process(process, privileged=True)

    def source(self) -> dict[str, Any]:
        state = self.library.read_json(self.library.player_state_path, {})
        if not isinstance(state, dict) or state.get("standby"):
            return {"available": False, "reason": "The TV is off"}
        try:
            number = int(state.get("current_channel"))
            timeline = state.get("channel_timelines", {}).get(str(number), {})
            file_name = str(timeline.get("episode_name", ""))
            channel = self.library.channel(number)
            source = self.library.safe_media_path(channel, file_name)
            position = max(0.0, float(timeline.get("position_seconds", 0)))
            paused = state.get("playback_paused") is True
            if not paused:
                saved_at = float(state.get("saved_at_utc_ms", 0))
                if saved_at > 0:
                    position += max(0.0, (time.time() * 1000.0 - saved_at) / 1000.0)
        except (TypeError, ValueError):
            return {"available": False, "reason": "Waiting for the TV programme"}
        if not source.is_file():
            return {"available": False, "reason": "Waiting for the TV programme"}
        return {"available": True, "channel_number": number,
                "channel_name": str(channel.get("name", "Channel")),
                "file_name": file_name,
                "programme": self.library.channel_programme_title(number, file_name),
                "source": source, "position": position,
                "paused": paused,
                "volume": int(state.get("volume", 0)),
                "muted": state.get("muted") is True}

    def stop(self) -> None:
        with self.lock:
            process, self.process = self.process, None
            preview_process, self.preview_process = self.preview_process, None
            if self.preview_idle_timer:
                self.preview_idle_timer.cancel()
                self.preview_idle_timer = None
            self.preview_last_request = 0.0
            self.signature = None
            self.preview_signature = None
            self.preview_frame = b""
            self.preview_error = ""
            self.preview_generation += 1
            self.preview_updated.notify_all()
        if process:
            self._terminate_process(process)
        if preview_process:
            self._terminate_process(preview_process, privileged=True)

    @staticmethod
    def playable_position(source: Path, position: float) -> float:
        """Keep a stale player timeline from seeking beyond the media file."""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(source)],
                check=False, capture_output=True, text=True, timeout=3,
            )
            duration = float(result.stdout.strip()) if result.returncode == 0 else 0.0
        except (OSError, subprocess.TimeoutExpired, ValueError):
            duration = 0.0
        if duration > 1.0:
            return position % duration
        return position

    def ensure(self) -> dict[str, Any]:
        info = self.source()
        if not info["available"]:
            self.stop()
            return info
        # The encoder follows the programme in real time. Its source changes
        # only when the programme changes; restarting it as the saved player
        # position ticks over causes a visible interruption every few seconds.
        signature = (str(info["source"]),)
        manifest = self.root / "live.m3u8"
        with self.lock:
            if self.process and self.process.poll() is None \
                    and self.signature == signature and manifest.is_file():
                return info
            # A browser may request the playlist more than once while it is
            # opening. Keep stopping, clearing and launching in this one lock
            # so those requests share one encoder and one coherent playlist.
            self.stop()
            self.root.mkdir(parents=True, exist_ok=True)
            for path in self.root.glob("*"):
                if path.is_file():
                    path.unlink(missing_ok=True)
            command = [
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", f"{self.playable_position(info['source'], info['position']):.3f}",
                "-re", "-i", str(info["source"]),
                "-map", "0:v:0", "-map", "0:a:0?",
                "-vf", "scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
                # The Pi's V4L2 H.264 encoder can hang while the TV player is
                # active. This bounded software profile is reliable, broadly
                # compatible with iPhone playback, and leaves room for TV.
                "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
                "-profile:v", "baseline", "-level:v", "3.1", "-b:v", "1200k",
                "-maxrate", "1400k", "-bufsize", "700k", "-g", "30",
                "-keyint_min", "30", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "96k", "-ac", "2",
                "-f", "hls", "-hls_time", "1", "-hls_list_size", "4",
                "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
                "-hls_flags", "delete_segments+append_list+independent_segments",
                "-hls_segment_filename", str(self.root / "segment-%05d.m4s"), str(manifest),
            ]
            try:
                process = subprocess.Popen(command, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, start_new_session=True)
            except OSError as error:
                raise ValueError("The Pi could not start the live TV stream") from error
            self.process = process
            self.signature = signature
        return info

    def manifest(self) -> Path:
        info = self.ensure()
        if not info["available"]:
            raise ValueError(str(info["reason"]))
        path = self.root / "live.m3u8"
        deadline = time.monotonic() + 8
        while not path.is_file() and time.monotonic() < deadline:
            with self.lock:
                failed = self.process is None or self.process.poll() is not None
            if failed:
                raise ValueError("The Pi could not prepare the live TV stream")
            time.sleep(0.1)
        if not path.is_file():
            raise ValueError("The live TV stream is taking longer than expected")
        return path

    def segment(self, name: str) -> Path:
        if name == "init.mp4":
            path = self.root / name
        elif re.fullmatch(r"segment-\d{5}\.m4s", name):
            path = self.root / name
        else:
            raise ValueError("Invalid live TV segment")
        if not path.is_file():
            raise ValueError("That part of the live stream has expired")
        return path

    def _collect_preview_frames(self, process: subprocess.Popen[bytes]) -> None:
        assert process.stdout is not None
        buffered = bytearray()
        while chunk := process.stdout.read1(8192):
            buffered.extend(chunk)
            while True:
                start = buffered.find(b"\xff\xd8")
                end = buffered.find(b"\xff\xd9", start + 2)
                if start < 0 or end < 0:
                    if len(buffered) > 2 * 1024 * 1024:
                        buffered.clear()
                    break
                frame = bytes(buffered[start:end + 2])
                del buffered[:end + 2]
                with self.lock:
                    if process is not self.preview_process:
                        return
                    self.preview_frame = frame
                    self.preview_generation += 1
                    self.preview_updated.notify_all()
        details = ""
        if process.stderr:
            details = process.stderr.read(1024).decode("utf-8", "replace").strip()
        with self.lock:
            if process is self.preview_process:
                self.preview_error = details
                self.preview_updated.notify_all()

    def preview(self) -> bytes:
        """Return the current frame from one shared Pi-owned preview encoder."""
        # The frame encoder mirrors the DRM/KMS output itself, so it can show
        # Adult TV and overlays that have no children's-channel timeline.  A
        # channel lookup here used to reject that perfectly valid picture and
        # made the portal report the active television as offline.
        state = self.library.read_json(self.library.player_state_path, {})
        if not isinstance(state, dict) or state.get("standby"):
            raise ValueError("The TV is off")
        signature = ("tv-screen", False)
        with self.lock:
            if self.preview_signature == signature and self.preview_frame \
                    and self.preview_process and self.preview_process.poll() is None:
                self._touch_preview_locked()
                return self.preview_frame
            generation = self.preview_generation
            if not self.preview_process or self.preview_process.poll() is not None \
                    or self.preview_signature != signature:
                previous, self.preview_process = self.preview_process, None
                if previous:
                    self._terminate_process(previous, privileged=True)
                self.preview_frame = b""
                self.preview_error = ""
                command = ["sudo", "-n", "/usr/local/libexec/mabeltv-screen-capture"]
                try:
                    process = subprocess.Popen(command, stdout=subprocess.PIPE,
                                               stderr=subprocess.PIPE, start_new_session=True)
                except OSError as error:
                    raise ValueError("The Pi could not start the live TV picture") from error
                self.preview_process = process
                self.preview_signature = signature
                threading.Thread(target=self._collect_preview_frames, args=(process,),
                                 name="mabeltv-live-preview", daemon=True).start()
            self._touch_preview_locked()
            deadline = time.monotonic() + 20
            while self.preview_generation <= generation and time.monotonic() < deadline:
                self.preview_updated.wait(timeout=deadline - time.monotonic())
            if self.preview_generation > generation and self.preview_frame:
                return self.preview_frame
        raise ValueError(self.preview_error or "The live TV picture is taking longer than expected")

    def status(self, allow_screen_without_programme: bool = False) -> dict[str, Any]:
        info = self.source()
        if not info["available"] and not allow_screen_without_programme:
            self.stop()
        with self.lock:
            running = ((self.process is not None and self.process.poll() is None)
                       or (self.preview_process is not None
                           and self.preview_process.poll() is None))
        return {key: value for key, value in info.items() if key != "source"} | {"streaming": running}


class RemoteTvActiveError(ValueError):
    """Raised when the conservative one-player rule needs an explicit choice."""


class LgWebOsError(ValueError):
    """A bounded, user-safe failure while controlling the connected LG TV."""


def lg_webos_log(event: str) -> None:
    """Keep narrow, redacted SSAP diagnostics in the service journal."""
    print(f"LG SSAP: {event}", file=sys.stderr, flush=True)


LG_WEBOS_PERMISSIONS = [
    "LAUNCH", "READ_INSTALLED_APPS", "READ_RUNNING_APPS",
    "READ_INPUT_DEVICE_LIST", "READ_POWER_STATE", "CONTROL_AUDIO",
    "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_PLAYBACK",
    "CONTROL_INPUT_TV", "CONTROL_MOUSE_AND_KEYBOARD", "CONTROL_POWER",
]
LG_TV_APP_SHORTCUTS = {
    "netflix": {
        "label": "Netflix", "ids": ("netflix",), "titles": ("netflix",),
    },
    "iplayer": {
        "label": "BBC iPlayer", "ids": ("bbc.iplayer", "com.bbc.iplayer"),
        "titles": ("bbc iplayer", "iplayer"),
    },
    "disney": {
        "label": "Disney+", "ids": ("com.disney.disneyplus",),
        "titles": ("disney plus", "disney+"),
    },
    "prime": {
        "label": "Prime Video", "ids": ("com.amazon.amazonvideo.lg",),
        "titles": ("prime video", "amazon prime video"),
    },
    "itvx": {
        "label": "ITVX", "ids": ("itv.hub", "com.itv.itvhub"),
        "titles": ("itvx", "itv hub"),
    },
    "channel4": {
        "label": "Channel 4", "ids": ("com.channel4.ondemand",),
        "titles": ("channel 4", "all 4"),
    },
    "appletv": {
        "label": "Apple TV", "ids": ("com.apple.appletv",),
        "titles": ("apple tv", "apple tv+"),
    },
    "paramount": {
        "label": "Paramount+", "ids": ("com.paramountplus.app",),
        "titles": ("paramount plus", "paramount+"),
    },
}
LG_TV_BUTTONS = {
    "up": "UP", "down": "DOWN", "left": "LEFT", "right": "RIGHT",
    "ok": "ENTER", "back": "BACK", "home": "HOME", "settings": "MENU",
    "guide": "GUIDE", "info": "INFO", "apps": "MYAPPS",
}
LG_TV_MEDIA_ACTIONS = {
    "play": "ssap://media.controls/play",
    "pause": "ssap://media.controls/pause",
    "rewind": "ssap://media.controls/rewind",
    "fast-forward": "ssap://media.controls/fastForward",
    "channel-up": "ssap://tv/channelUp",
    "channel-down": "ssap://tv/channelDown",
}
LG_TV_CATALOG_SECONDS = 5 * 60
LG_WEBOS_REGISTRATION = {
    # Keep the established MabelTV app identity so the TV can reuse its saved
    # client key, while requesting the permissions needed by the full remote.
    "type": "register",
    "payload": {
        "pairingType": "PROMPT",
        "manifest": {
            "manifestVersion": 1, "appVersion": "0.1.0",
            "signed": {"appId": "com.mabeltv.control", "created": "2026-09-03",
                       "localizedAppNames": {"": "MabelTV"},
                       "localizedVendorNames": {"": "MabelTV"},
                       "permissions": LG_WEBOS_PERMISSIONS},
            "permissions": LG_WEBOS_PERMISSIONS,
        },
    },
}


class LgWebOsSocket:
    """Small standards-only WebSocket client for LG SSAP and pointer control.

    Keeping this here avoids a new service dependency and keeps the paired key on
    the Pi. It implements the masked text frames used by local webOS control.
    """
    def __init__(self, host: str, client_key: str = "") -> None:
        self.host = host
        self.client_key = client_key
        self.connection: socket.socket | None = None

    def connect(self, path: str = "/", port: int = LG_WEBOS_DEFAULT_PORT, secure: bool = True) -> None:
        try:
            lg_webos_log("TCP connect started")
            raw = socket.create_connection((self.host, port), timeout=5)
            connection = raw
            if secure:
                context = ssl._create_unverified_context()
                connection = context.wrap_socket(raw, server_hostname=self.host)
                lg_webos_log("TLS established")
            websocket_key = base64.b64encode(os.urandom(16)).decode("ascii")
            handshake = (
                f"GET {path or '/'} HTTP/1.1\r\n"
                f"Host: {self.host}:{port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {websocket_key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            ).encode("ascii")
            connection.sendall(handshake)
            response = self._read_headers(connection)
            if not response.startswith("HTTP/1.1 101"):
                lg_webos_log(f"WebSocket upgrade rejected: {response.splitlines()[0] if response else 'empty response'}")
                raise LgWebOsError("The connected TV rejected MabelTV's secure control connection")
            lg_webos_log("WebSocket upgrade complete")
            # Allow a person time to read and accept the television prompt.
            connection.settimeout(90)
            self.connection = connection
        except (OSError, ssl.SSLError) as error:
            lg_webos_log(f"connection exception: {type(error).__name__}: {error}")
            raise LgWebOsError("MabelTV could not reach the connected LG TV") from error

    @staticmethod
    def _read_headers(connection: socket.socket) -> str:
        data = bytearray()
        while b"\r\n\r\n" not in data and len(data) < 16 * 1024:
            chunk = connection.recv(1024)
            if not chunk:
                break
            data.extend(chunk)
        return data.decode("iso-8859-1", "replace")

    def send(self, payload: dict[str, Any]) -> None:
        self._send_frame(0x1, json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    def send_text(self, value: str) -> None:
        self._send_frame(0x1, value.encode("utf-8"))

    def _send_frame(self, opcode: int, data: bytes = b"") -> None:
        if self.connection is None:
            raise LgWebOsError("The connected LG TV control session is not available")
        header = bytearray([0x80 | opcode])
        length = len(data)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126); header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127); header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        encoded = bytes(value ^ mask[index % 4] for index, value in enumerate(data))
        self.connection.sendall(bytes(header) + mask + encoded)

    def receive(self) -> dict[str, Any]:
        if self.connection is None:
            raise LgWebOsError("The connected LG TV control session is not available")
        first = self._read_exact(2)
        opcode, length = first[0] & 0x0F, first[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(8))[0]
        if length > 1024 * 1024:
            raise LgWebOsError("The connected LG TV sent an unexpectedly large control response")
        body = self._read_exact(length)
        if opcode == 0x8:
            code = struct.unpack("!H", body[:2])[0] if len(body) >= 2 else None
            reason = body[2:].decode("utf-8", "replace") if len(body) > 2 else ""
            lg_webos_log(f"CLOSE received: code={code!r} reason={reason!r}")
            try:
                self._send_frame(0x8, body)
            except OSError:
                pass
            raise LgWebOsError("The connected LG TV closed its control session")
        if opcode == 0x9:
            # LG sends WebSocket pings while a first-time pairing prompt is
            # visible. Replying is required before it will send `registered`.
            self._send_frame(0xA, body)
            lg_webos_log("PING received; PONG sent")
            return self.receive()
        if opcode == 0xA:
            lg_webos_log("PONG received")
            return self.receive()
        if opcode != 0x1:
            lg_webos_log(f"non-text WebSocket opcode received: {opcode}")
            return self.receive()
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LgWebOsError("The connected LG TV returned an invalid control response") from error
        if not isinstance(value, dict):
            raise LgWebOsError("The connected LG TV returned an invalid control response")
        lg_webos_log(f"LG JSON received: type={value.get('type')!r} id={value.get('id')!r}")
        return value

    def _read_exact(self, amount: int) -> bytes:
        assert self.connection is not None
        data = bytearray()
        while len(data) < amount:
            chunk = self.connection.recv(amount - len(data))
            if not chunk:
                lg_webos_log("socket EOF")
                raise LgWebOsError("The connected LG TV closed its control session")
            data.extend(chunk)
        return bytes(data)

    def close(self) -> None:
        if self.connection is not None:
            try:
                self.connection.close()
            finally:
                self.connection = None


class Library:
    def __init__(self, args: argparse.Namespace) -> None:
        self.media_root = Path(args.media_root).resolve()
        self.channels_path = Path(args.channels).resolve()
        self.settings_path = Path(args.settings).resolve()
        self.owner_path = Path(args.owner).resolve()
        self.owner_recovery_path = self.owner_path.with_name("owner-recovery-pending")
        self.config_path = Path(args.config).resolve()
        self.player_state_path = Path("/var/lib/mabeltv/state.json")
        self.viewing_history_path = self.settings_path.with_name("viewing-history.json")
        self.incoming = self.media_root / ".incoming"
        self.adult_root = self.media_root / ".adult"
        self.adult_metadata_path = self.adult_root / ".mabeltv-adult.json"
        self.adult_artwork_root = self.adult_root / ".metadata"
        self.adult_series_root = self.adult_root / ".series"
        self.adult_series_state_path = self.adult_root / ".mabeltv-series.json"
        self.adult_series_artwork_root = self.adult_root / ".series-metadata"
        self.adult_viewing_path = self.adult_root / ".mabeltv-viewing.json"
        self.channel_metadata_path = self.media_root / ".mabeltv-channels.json"
        self.channel_artwork_root = self.media_root / ".channel-metadata"
        configured_usb_root = os.environ.get("MABELTV_USB_ROOT")
        self.usb_root = Path(configured_usb_root or "/media/mabeltv-usb").resolve()
        # A real installation must only browse an actual mount. Tests and the
        # local portal preview deliberately use a private directory fixture.
        self.usb_requires_mount = configured_usb_root is None
        self.tmdb_key_path = Path(os.environ.get(
            "MABELTV_TMDB_API_KEY_FILE", "/var/lib/mabeltv/secrets/tmdb-api-key"))
        self.watchmode_key_path = Path(os.environ.get(
            "MABELTV_WATCHMODE_API_KEY_FILE",
            "/var/lib/mabeltv/secrets/watchmode-api-key"))
        self.opensubtitles_key_path = Path(os.environ.get(
            "MABELTV_OPENSUBTITLES_API_KEY_FILE",
            "/var/lib/mabeltv/secrets/opensubtitles-api-key"))
        self.lg_tv_host = os.environ.get("MABELTV_LG_TV_HOST", "").strip()
        self.lg_tv_client_key_path = Path(os.environ.get(
            "MABELTV_LG_TV_CLIENT_KEY_FILE", LG_WEBOS_CLIENT_KEY_PATH))
        self.lg_tv_lock = threading.Lock()
        self.lg_tv_pointer_socket: LgWebOsSocket | None = None
        self.lg_tv_catalog_cache: dict[str, Any] = {}
        self.lg_tv_catalog_updated = 0.0
        self.bin = self.media_root / ".recycle-bin"
        self.sessions: dict[str, float] = {}
        self.login_failures: dict[str, list[float]] = {}
        self.config_lock = threading.RLock()
        self.channel_programme_duration_cache: dict[tuple[str, int, int], float] = {}
        self.channel_programme_duration_lock = threading.RLock()
        self.upload_locks: dict[str, threading.Lock] = {}
        self.conversion_queue: queue.Queue[str | None] = queue.Queue()
        self.queued_conversions: set[str] = set()
        self.deferred_retries: set[str] = set()
        self.cancelled_conversions: set[str] = set()
        self.adult_optimisation_active: set[str] = set()
        self.adult_optimisation_lock = threading.Lock()
        self.adult_optimisation_serial = threading.Lock()
        self.adult_optimisation_progress_callback: Any = None
        self.remote_stream_lock = threading.RLock()
        self.remote_stream: dict[str, Any] | None = None
        self.viewing_lock = threading.RLock()
        self.viewing_closed = threading.Event()
        self.viewing_worker: threading.Thread | None = None
        self.viewing_last_tv_sample: tuple[dict[str, Any], float] | None = None
        self.viewing_remote_samples: dict[str, tuple[float, float]] = {}
        self.viewing_pending: dict[tuple[str, str], dict[str, Any]] = {}
        self.viewing_dirty = False
        self.viewing_last_flush = 0.0
        self.viewing_store = self.load_viewing_store()
        self.external_stream_lock = threading.RLock()
        self.external_streams: dict[str, dict[str, Any]] = {}
        self.offline_cache = self.media_root / ".offline-prepared"
        self.offline_preparation_lock = threading.RLock()
        self.offline_preparations: dict[str, dict[str, Any]] = {}
        self.usb_imports: dict[str, dict[str, Any]] = {}
        self.usb_import_lock = threading.RLock()
        self.usb_action_lock = threading.RLock()
        self.usb_power_lock = threading.RLock()
        self.usb_last_activity: dict[str, float] = {}
        self.usb_sleeping: set[str] = set()
        self.usb_idle_seconds = max(5.0, float(os.environ.get(
            "MABELTV_USB_IDLE_SECONDS", USB_IDLE_SECONDS)))
        self.usb_power_closed = threading.Event()
        self.usb_power_worker: threading.Thread | None = None
        self.conversion_closed = threading.Event()
        self.media_root.mkdir(parents=True, exist_ok=True)
        self.incoming.mkdir(mode=0o750, exist_ok=True)
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        self.adult_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.adult_series_root.mkdir(mode=0o750, exist_ok=True)
        self.adult_series_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.channel_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.offline_cache.mkdir(mode=0o750, exist_ok=True)
        self.bin.mkdir(mode=0o750, exist_ok=True)
        self.reconcile_recycle_items()
        self.cleanup_stale_temporary_files()
        self.cleanup_offline_prepared_cache()
        self.recover_adult_optimisations()
        self.migrate_legacy_owner()
        self.recover_final_results()
        self.resume_conversion_jobs()
        self.conversion_worker = threading.Thread(
            target=self.run_conversion_worker,
            name="mabeltv-conversion",
            daemon=True,
        )
        self.conversion_worker.start()
        self.live_stream = LiveStream(self)
        if os.name == "posix" and self.usb_requires_mount:
            self.usb_power_worker = threading.Thread(
                target=self.run_usb_power_worker,
                name="mabeltv-usb-power",
                daemon=True,
            )
            self.usb_power_worker.start()

    def close(self, timeout: float = 10.0) -> None:
        """Drain and stop the single media worker (primarily for clean tests)."""
        if self.conversion_closed.is_set():
            return
        with self.lg_tv_lock:
            self.close_lg_tv_pointer()
        self.conversion_closed.set()
        self.usb_power_closed.set()
        self.viewing_closed.set()
        self.conversion_queue.put(None)
        self.conversion_worker.join(timeout=timeout)
        if self.usb_power_worker:
            self.usb_power_worker.join(timeout=min(timeout, USB_POWER_POLL_SECONDS + 1))
        if self.viewing_worker:
            self.viewing_worker.join(timeout=min(timeout, VIEWING_SAMPLE_SECONDS + 1))
        self.flush_viewing_store(force=True)
        if self.conversion_worker.is_alive():
            raise RuntimeError("The media worker did not stop cleanly")
        self.live_stream.stop()

    def load_viewing_store(self) -> dict[str, Any]:
        """Load the compact, private session history kept on this appliance."""
        value = self.read_json(self.viewing_history_path, {})
        sessions = value.get("sessions", []) if isinstance(value, dict) else []
        if not isinstance(sessions, list):
            sessions = []
        clean: list[dict[str, Any]] = []
        for stored in sessions:
            if not isinstance(stored, dict):
                continue
            item = dict(stored)
            try:
                watched = float(item.get("seconds", 0) or 0)
                channel_number = int(item.get("channel_number"))
            except (TypeError, ValueError):
                continue
            kind = str(item.get("kind") or "")
            if watched < VIEWING_MIN_SESSION_SECONDS or kind not in {"film", "episode", "channel"}:
                continue
            channel_name = str(item.get("channel_name") or f"Channel {channel_number}")
            if kind in {"episode", "channel"}:
                item.update({
                    "item_key": f"channel:{channel_number}",
                    "title": channel_name,
                    "kind": "channel",
                })
            item["id"] = str(item.get("id") or uuid.uuid4().hex)
            item["seconds"] = round(watched, 2)
            clean.append(item)
        try:
            started = float(value.get("tracking_started", time.time()))
        except (AttributeError, TypeError, ValueError):
            started = time.time()
        store = {
            "schema_version": 2,
            "tracking_started": max(0.0, started),
            "sessions": clean[-VIEWING_MAX_SESSIONS:],
        }
        if (not isinstance(value, dict) or value.get("schema_version") != 2
                or len(clean) != len(sessions)
                or any(not str(item.get("id") or "") for item in sessions
                       if isinstance(item, dict))):
            try:
                self.write_json(self.viewing_history_path, store)
            except OSError as error:
                print(f"Could not migrate viewing history: {error}",
                      file=sys.stderr, flush=True)
        return store

    def start_viewing_tracker(self) -> None:
        """Start low-frequency on-TV sampling once the HTTP service is ready."""
        with self.viewing_lock:
            if self.viewing_worker and self.viewing_worker.is_alive():
                return
            self.viewing_closed.clear()
            self.viewing_worker = threading.Thread(
                target=self.run_viewing_tracker,
                name="mabeltv-viewing-history",
                daemon=True,
            )
            self.viewing_worker.start()

    def run_viewing_tracker(self) -> None:
        while not self.viewing_closed.is_set():
            try:
                self.sample_tv_viewing()
                self.flush_viewing_store()
            except Exception as error:
                print(f"Viewing tracker skipped a sample: {error}",
                      file=sys.stderr, flush=True)
            if self.viewing_closed.wait(VIEWING_SAMPLE_SECONDS):
                break

    def current_tv_viewing(self, mode: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """Return one coarse active programme identity, never a frame timeline."""
        mode = self.player_mode_status() if mode is None else mode
        if mode.get("standby") is True:
            return None
        if mode.get("mode") == "adult":
            return None

        state = self.read_json(self.player_state_path, {})
        if (not isinstance(state, dict) or state.get("standby") is True
                or state.get("playback_paused") is True):
            return None
        try:
            number = int(state.get("current_channel"))
            channel = self.channel(number)
            timelines = state.get("channel_timelines", {})
            timeline = timelines.get(str(number), {}) if isinstance(timelines, dict) else {}
            file_name = str(timeline.get("episode_name", "")).strip()
        except (AttributeError, TypeError, ValueError):
            return None
        if not file_name:
            return None
        is_film = self.channel_content_type(channel) == "films"
        channel_name = str(channel.get("name") or f"Channel {number}")
        activity = {
            "item_key": f"channel:{number}:{file_name.casefold()}" if is_film
            else f"channel:{number}",
            "title": self.channel_programme_title(number, file_name)
            if is_film else channel_name,
            "kind": "film" if is_film else "channel",
            "surface": "tv",
            "channel_number": number,
            "channel_name": channel_name,
        }
        # Series channels have the same player timeline as film channels.
        if file_name:
            try:
                position = max(0.0, float(timeline.get("position_seconds", 0) or 0))
                if state.get("playback_paused") is not True:
                    saved_at = float(state.get("saved_at_utc_ms", 0) or 0)
                    if saved_at > 0:
                        position += max(0.0, (time.time() * 1000 - saved_at) / 1000)
                key = self.channel_programme_key(number, file_name)
                durations = state.get("channel_film_durations", {})
                duration = max(0.0, float(durations.get(key, 0) or 0)) \
                    if isinstance(durations, dict) else 0.0
            except (AttributeError, TypeError, ValueError):
                position, duration = 0.0, 0.0
            if duration <= 0:
                duration = self.channel_programme_duration(channel, file_name)
            activity.update({"position": position, "media_duration": duration})
        return activity

    def sample_tv_viewing(self) -> None:
        now_monotonic = time.monotonic()
        activity = self.current_tv_viewing()
        previous = self.viewing_last_tv_sample
        self.viewing_last_tv_sample = (activity, now_monotonic) if activity else None
        if not activity or not previous:
            return
        previous_activity, previous_monotonic = previous
        if previous_activity.get("item_key") != activity.get("item_key"):
            return
        watched = min(30.0, max(0.0, now_monotonic - previous_monotonic))
        if watched >= 1.0:
            self.record_viewing(activity, watched, time.time())

    def record_remote_viewing(self, session: dict[str, Any], token: str,
                              position: float, duration: float = 0.0) -> None:
        """Count browser playback deltas while rejecting seeks and stale posts."""
        now_monotonic = time.monotonic()
        with self.viewing_lock:
            previous = self.viewing_remote_samples.get(token)
            self.viewing_remote_samples[token] = (position, now_monotonic)
        if not previous:
            return
        previous_position, previous_monotonic = previous
        elapsed = max(0.0, now_monotonic - previous_monotonic)
        advanced = position - previous_position
        if elapsed <= 0 or elapsed > 75 or advanced < 1 or advanced > elapsed + 6:
            return
        kind = str(session.get("kind", ""))
        if kind != "channel":
            return
        channel_number = session.get("channel")
        try:
            channel_number = int(channel_number)
            channel_name = str(self.channel(channel_number).get("name") or "MabelTV")
        except (TypeError, ValueError):
            return
        is_film = str(session.get("content_kind") or "") == "film"
        activity = {
            "item_key": f"channel:{channel_number}:{str(session.get('file') or '').casefold()}"
            if is_film else f"channel:{channel_number}",
            "title": str(session.get("title") or self.display_name(
                Path(str(session.get("source", "Video"))).name)) if is_film else channel_name,
            "kind": "film" if is_film else "channel",
            "surface": "device",
            "channel_number": channel_number,
            "channel_name": channel_name,
        }
        if is_film:
            activity.update({"position": max(0.0, position),
                             "media_duration": max(0.0, duration)})
        self.record_viewing(activity, min(advanced, elapsed), time.time())

    def record_viewing(self, activity: dict[str, Any], watched: float,
                       ended: float) -> None:
        watched = max(0.0, min(float(watched), 60.0))
        if watched < 1.0:
            return
        with self.viewing_lock:
            sessions = self.viewing_store["sessions"]
            matching = [item for item in sessions
                        if isinstance(item, dict)
                        and item.get("item_key") == activity.get("item_key")
                        and item.get("surface") == activity.get("surface")]
            previous = max(matching, key=lambda item: float(
                item.get("ended", 0) or 0), default=None)
            gap = ended - float(previous.get("ended", 0) or 0) if previous else None
            can_merge = previous is not None and gap is not None and (
                0 <= gap <= VIEWING_SESSION_GAP_SECONDS)
            if can_merge:
                previous["ended"] = ended
                previous["seconds"] = round(
                    float(previous.get("seconds", 0) or 0) + watched, 2)
                for field in ("position", "media_duration"):
                    if field in activity:
                        previous[field] = activity[field]
            else:
                pending_key = (str(activity.get("item_key") or ""),
                               str(activity.get("surface") or ""))
                pending = self.viewing_pending.get(pending_key)
                pending_gap = ended - float(pending.get("ended", 0) or 0) \
                    if pending else None
                if pending is None or pending_gap is None or not (
                        0 <= pending_gap <= VIEWING_SESSION_GAP_SECONDS):
                    pending = {
                        "id": uuid.uuid4().hex,
                        "started": ended - watched,
                        "ended": ended,
                        "seconds": round(watched, 2),
                        **activity,
                    }
                    self.viewing_pending[pending_key] = pending
                else:
                    pending["ended"] = ended
                    pending["seconds"] = round(
                        float(pending.get("seconds", 0) or 0) + watched, 2)
                    for field in ("position", "media_duration"):
                        if field in activity:
                            pending[field] = activity[field]
                if float(pending.get("seconds", 0) or 0) >= VIEWING_MIN_SESSION_SECONDS:
                    sessions.append(pending)
                    self.viewing_pending.pop(pending_key, None)
                else:
                    return
            cutoff = ended - VIEWING_RETENTION_DAYS * 86400
            self.viewing_store["sessions"] = [
                item for item in sessions
                if float(item.get("ended", 0) or 0) >= cutoff
            ][-VIEWING_MAX_SESSIONS:]
            self.viewing_dirty = True

    def flush_viewing_store(self, *, force: bool = False) -> None:
        with self.viewing_lock:
            now = time.monotonic()
            if not self.viewing_dirty or (not force and now - self.viewing_last_flush < 60):
                return
            self.write_json(self.viewing_history_path, self.viewing_store)
            self.viewing_dirty = False
            self.viewing_last_flush = now

    @staticmethod
    def viewing_duration_label(seconds: float) -> str:
        minutes = max(0, int(round(seconds / 60)))
        hours, remainder = divmod(minutes, 60)
        return f"{hours}h {remainder}m" if hours else f"{minutes}m"

    def viewing_insights(self, days: int = 30,
                         timezone_offset_minutes: int = 0) -> dict[str, Any]:
        days = days if days in {1, 7, 30, 365} else 1
        offset = max(-840, min(840, int(timezone_offset_minutes)))
        local_zone = timezone(-timedelta(minutes=offset))
        now = time.time()
        now_local = datetime.fromtimestamp(now, local_zone)
        today = now_local.date()
        with self.viewing_lock:
            sessions = [dict(item) for item in self.viewing_store["sessions"]
                        if str(item.get("kind") or "") in {"film", "channel"}
                        and float(item.get("seconds", 0) or 0)
                        >= VIEWING_MIN_SESSION_SECONDS]
            tracking_started = float(self.viewing_store["tracking_started"])

        # Insights should follow the library's current metadata and channel
        # names rather than preserving an old upload filename forever.
        film_names: dict[int, dict[str, str]] = {}
        for item in sessions:
            try:
                channel_number = int(item.get("channel_number"))
                channel = self.channel(channel_number)
            except (TypeError, ValueError):
                continue
            channel_name = str(channel.get("name") or f"Channel {channel_number}")
            item["channel_name"] = channel_name
            if str(item.get("kind") or "") == "channel":
                item["title"] = channel_name
                continue
            key_prefix = f"channel:{channel_number}:"
            item_key = str(item.get("item_key") or "")
            stored_name = item_key[len(key_prefix):] if item_key.startswith(key_prefix) else ""
            if channel_number not in film_names:
                folder = self.media_root / str(channel.get("folder") or "")
                film_names[channel_number] = {
                    path.name.casefold(): path.name for path in folder.iterdir()
                    if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
                } if folder.is_dir() else {}
            file_name = film_names[channel_number].get(stored_name.casefold())
            if file_name:
                item["title"] = self.channel_programme_title(channel_number, file_name)

        def total_since(seconds: float) -> float:
            cutoff = now - seconds
            return sum(float(item.get("seconds", 0) or 0) for item in sessions
                       if float(item.get("ended", 0) or 0) >= cutoff)

        today_start = datetime.combine(today, datetime.min.time(), local_zone).timestamp()
        if days == 1:
            selected = [item for item in sessions if datetime.fromtimestamp(
                float(item.get("ended", 0) or 0), local_zone).date() == today]
            previous = [item for item in sessions if datetime.fromtimestamp(
                float(item.get("ended", 0) or 0), local_zone).date()
                == today - timedelta(days=1)]
        else:
            selected_cutoff = now - days * 86400
            selected = [item for item in sessions
                        if float(item.get("ended", 0) or 0) >= selected_cutoff]
            previous_cutoff = now - days * 2 * 86400
            previous = [item for item in sessions
                        if previous_cutoff <= float(item.get("ended", 0) or 0)
                        < selected_cutoff]

        daily: list[dict[str, Any]] = []
        daily_span = 7 if days <= 7 else 30
        for ago in range(daily_span - 1, -1, -1):
            date = today - timedelta(days=ago)
            total = sum(float(item.get("seconds", 0) or 0) for item in sessions
                        if datetime.fromtimestamp(float(item.get("ended", 0) or 0),
                                                  local_zone).date() == date)
            daily.append({"key": date.isoformat(), "label": date.strftime("%a"),
                          "seconds": round(total)})

        weekly: list[dict[str, Any]] = []
        this_monday = today - timedelta(days=today.weekday())
        for ago in range(7, -1, -1):
            start = this_monday - timedelta(days=ago * 7)
            end = start + timedelta(days=7)
            total = sum(float(item.get("seconds", 0) or 0) for item in sessions
                        if start <= datetime.fromtimestamp(
                            float(item.get("ended", 0) or 0), local_zone).date() < end)
            weekly.append({"key": start.isoformat(),
                           "label": start.strftime("%-d %b") if os.name != "nt"
                           else start.strftime("%d %b").lstrip("0"),
                           "seconds": round(total)})

        monthly: list[dict[str, Any]] = []
        for ago in range(11, -1, -1):
            month_index = now_local.year * 12 + now_local.month - 1 - ago
            year, month_zero = divmod(month_index, 12)
            month = month_zero + 1
            total = sum(float(item.get("seconds", 0) or 0) for item in sessions
                        if (lambda value: value.year == year and value.month == month)(
                            datetime.fromtimestamp(float(item.get("ended", 0) or 0),
                                                   local_zone)))
            monthly.append({"key": f"{year:04d}-{month:02d}",
                            "label": datetime(year, month, 1).strftime("%b"),
                            "seconds": round(total)})

        time_periods = (("Overnight", 0, 6), ("Morning", 6, 12),
                        ("Afternoon", 12, 18), ("Evening", 18, 24))

        def time_breakdown(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            result = []
            for label, first_hour, last_hour in time_periods:
                matching = [item for item in values
                            if first_hour <= datetime.fromtimestamp(float(
                                item.get("started", item.get("ended", 0)) or 0),
                                local_zone).hour < last_hour]
                result.append({
                    "name": label,
                    "label": label,
                    "seconds": round(sum(float(item.get("seconds", 0) or 0)
                                         for item in matching)),
                    "sessions": len(matching),
                })
            return result

        def hourly_breakdown(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            result = []
            for hour in range(24):
                matching = [item for item in values if datetime.fromtimestamp(
                    float(item.get("started", item.get("ended", 0)) or 0),
                    local_zone).hour == hour]
                label = datetime(2000, 1, 1, hour).strftime("%I%p").lstrip("0").lower()
                result.append({"name": str(hour), "label": label,
                               "seconds": round(sum(float(item.get("seconds", 0) or 0)
                                                    for item in matching)),
                               "sessions": len(matching)})
            return result

        def weekday_breakdown(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            result = []
            for weekday in range(7):
                matching = [item for item in values if datetime.fromtimestamp(
                    float(item.get("ended", 0) or 0), local_zone).weekday() == weekday]
                label = (today - timedelta(
                    days=today.weekday() - weekday)).strftime("%a")
                result.append({"name": label, "label": label,
                               "seconds": round(sum(float(item.get("seconds", 0) or 0)
                                                    for item in matching)),
                               "sessions": len(matching)})
            return result

        def item_timeline(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            if days == 1:
                return hourly_breakdown(values)
            if days in {7, 30}:
                span = days
                result = []
                for ago in range(span - 1, -1, -1):
                    date = today - timedelta(days=ago)
                    total = sum(float(item.get("seconds", 0) or 0) for item in values
                                if datetime.fromtimestamp(float(
                                    item.get("ended", 0) or 0), local_zone).date() == date)
                    result.append({"key": date.isoformat(),
                                   "label": date.strftime("%a") if days == 7
                                   else str(date.day), "seconds": round(total)})
                return result
            result = []
            for ago in range(11, -1, -1):
                month_index = now_local.year * 12 + now_local.month - 1 - ago
                year, month_zero = divmod(month_index, 12)
                month = month_zero + 1
                total = sum(float(item.get("seconds", 0) or 0) for item in values
                            if (lambda value: value.year == year and value.month == month)(
                                datetime.fromtimestamp(float(item.get("ended", 0) or 0),
                                                       local_zone)))
                result.append({"key": f"{year:04d}-{month:02d}",
                               "label": datetime(year, month, 1).strftime("%b"),
                               "seconds": round(total)})
            return result

        time_of_day = time_breakdown(selected)
        hourly = hourly_breakdown(selected)
        weekdays = weekday_breakdown(selected)

        def grouped(field: str) -> list[dict[str, Any]]:
            totals: dict[str, float] = {}
            for item in selected:
                key = str(item.get(field) or "Other")
                totals[key] = totals.get(key, 0.0) + float(item.get("seconds", 0) or 0)
            return [{"name": key, "seconds": round(value)}
                    for key, value in sorted(totals.items(), key=lambda pair: -pair[1])]

        title_totals: dict[tuple[str, str], float] = {}
        for item in selected:
            key = (str(item.get("title") or "Untitled"),
                   str(item.get("channel_name") or "MabelTV"))
            title_totals[key] = title_totals.get(key, 0.0) + float(
                item.get("seconds", 0) or 0)
        top_titles = [{"title": key[0], "source": key[1], "seconds": round(value),
                       "duration": self.viewing_duration_label(value)}
                      for key, value in sorted(title_totals.items(), key=lambda pair: -pair[1])[:8]]

        def session_detail(item: dict[str, Any]) -> dict[str, Any]:
            ended = datetime.fromtimestamp(float(item.get("ended", 0) or 0), local_zone)
            started = datetime.fromtimestamp(float(item.get("started", 0) or 0), local_zone)
            result = {
                "id": str(item.get("id") or ""),
                "item_key": str(item.get("item_key") or
                                f"{item.get('kind')}:{item.get('title')}"),
                "title": str(item.get("title") or "Untitled"),
                "source": str(item.get("channel_name") or "MabelTV"),
                "surface": str(item.get("surface") or "tv"),
                "kind": str(item.get("kind") or "channel"),
                "channel_number": item.get("channel_number"),
                "seconds": round(float(item.get("seconds", 0) or 0)),
                "duration": self.viewing_duration_label(float(item.get("seconds", 0) or 0)),
                "started": started.isoformat(),
                "when": ended.isoformat(),
            }
            if result["kind"] == "film":
                position = max(0.0, float(item.get("position", 0) or 0))
                media_duration = max(0.0, float(item.get("media_duration", 0) or 0))
                result.update({
                    "position": round(position),
                    "media_duration": round(media_duration),
                    "progress": round(min(1.0, position / media_duration), 4)
                    if media_duration > 0 else 0,
                })
            return result

        ordered_sessions = sorted(selected, key=lambda value: float(
            value.get("ended", 0) or 0), reverse=True)
        # The viewing diary needs the complete selected-period sequence rather
        # than an arbitrary recent slice. The API's longest range is one year,
        # and the store itself remains bounded separately.
        session_details = [session_detail(item) for item in ordered_sessions[:5000]]
        recent = session_details[:8]

        active_days = len({datetime.fromtimestamp(
            float(item.get("ended", 0) or 0), local_zone).date() for item in selected})
        range_seconds = sum(float(item.get("seconds", 0) or 0) for item in selected)
        previous_seconds = sum(float(item.get("seconds", 0) or 0) for item in previous)
        unique_items = len({str(item.get("item_key") or
                                f"{item.get('kind')}:{item.get('title')}")
                            for item in selected})
        timeline = item_timeline(selected)

        grouped_items: dict[str, list[dict[str, Any]]] = {}
        for item in selected:
            key = str(item.get("item_key") or
                      f"{item.get('kind')}:{item.get('title')}")
            grouped_items.setdefault(key, []).append(item)

        def detailed_item(key: str, values: list[dict[str, Any]]) -> dict[str, Any]:
            ordered = sorted(values, key=lambda value: float(
                value.get("ended", 0) or 0))
            total = sum(float(item.get("seconds", 0) or 0) for item in values)
            active_dates = {datetime.fromtimestamp(float(
                item.get("ended", 0) or 0), local_zone).date() for item in values}
            periods = time_breakdown(values)
            item_weekdays = weekday_breakdown(values)
            film_progress = [min(1.0, max(0.0, float(
                item.get("position", 0) or 0) / float(
                    item.get("media_duration", 0) or 0))) for item in values
                if float(item.get("media_duration", 0) or 0) > 0]
            first = datetime.fromtimestamp(float(
                ordered[0].get("started", ordered[0].get("ended", 0)) or 0),
                local_zone)
            last = datetime.fromtimestamp(float(
                ordered[-1].get("ended", 0) or 0), local_zone)
            busiest_period = max(periods, key=lambda value: value["seconds"],
                                 default={"name": "Not enough data"})
            busiest_weekday = max(item_weekdays, key=lambda value: value["seconds"],
                                  default={"name": "Not enough data"})
            result = {
                "item_key": key,
                "kind": str(ordered[-1].get("kind") or "channel"),
                "title": str(ordered[-1].get("title") or "Untitled"),
                "source": str(ordered[-1].get("channel_name") or "MabelTV"),
                "channel_number": ordered[-1].get("channel_number"),
                "seconds": round(total),
                "duration": self.viewing_duration_label(total),
                "sessions": len(values),
                "active_days": len(active_dates),
                "average_session_seconds": round(total / len(values)) if values else 0,
                "average_active_day_seconds": round(total / len(active_dates))
                if active_dates else 0,
                "longest_session_seconds": round(max((float(
                    item.get("seconds", 0) or 0) for item in values), default=0)),
                "share": round(total / range_seconds, 4) if range_seconds > 0 else 0,
                "first_watched": first.isoformat(),
                "last_watched": last.isoformat(),
                "busiest_period": busiest_period["name"],
                "busiest_weekday": busiest_weekday["name"],
                "time_of_day": periods,
                "hourly": hourly_breakdown(values),
                "weekdays": item_weekdays,
                "by_surface": (lambda totals: [{"name": name, "seconds": round(value)}
                    for name, value in sorted(totals.items(), key=lambda pair: -pair[1])])(
                        {surface: sum(float(item.get("seconds", 0) or 0)
                                      for item in values
                                      if str(item.get("surface") or "tv") == surface)
                         for surface in {str(item.get("surface") or "tv")
                                         for item in values}}),
                "timeline": item_timeline(values),
            }
            if result["kind"] == "film":
                result.update({
                    "average_progress": round(sum(film_progress) / len(film_progress), 4)
                    if film_progress else 0,
                    "furthest_progress": round(max(film_progress), 4)
                    if film_progress else 0,
                    "completion_sessions": sum(1 for value in film_progress if value >= .9),
                    "progress_samples": len(film_progress),
                })
            return result

        items = sorted((detailed_item(key, values)
                        for key, values in grouped_items.items()),
                       key=lambda value: -value["seconds"])
        top_channels = [item for item in items if item["kind"] == "channel"][:8]
        top_films = [item for item in items if item["kind"] == "film"][:8]
        busiest_period = max(time_of_day, key=lambda value: value["seconds"],
                             default={"name": "—"})["name"]
        busiest_weekday = max(weekdays, key=lambda value: value["seconds"],
                              default={"name": "—"})["name"]
        return {
            "tracking_started": tracking_started,
            "range_days": days,
            "summary": {
                "today_seconds": total_since(max(1.0, now - today_start)),
                "week_seconds": total_since(7 * 86400),
                "month_seconds": total_since(30 * 86400),
                "range_seconds": range_seconds,
                "previous_range_seconds": previous_seconds,
                "average_active_day_seconds": range_seconds / active_days
                if active_days else 0,
                "longest_session_seconds": max((float(item.get("seconds", 0) or 0)
                                                for item in selected), default=0),
                "active_days": active_days,
                "sessions": len(selected),
                "unique_items": unique_items,
                "busiest_period": busiest_period,
                "busiest_weekday": busiest_weekday,
            },
            "daily": daily,
            "weekly": weekly,
            "monthly": monthly,
            "timeline": timeline,
            "time_of_day": time_of_day,
            "hourly": hourly,
            "weekdays": weekdays,
            "by_surface": grouped("surface"),
            "by_kind": grouped("kind"),
            "top_titles": top_titles,
            "top_channels": top_channels,
            "top_films": top_films,
            "items": items,
            "recent": recent,
            "sessions": session_details,
        }

    def delete_viewing_sessions(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw_ids = payload.get("ids", [])
        if not isinstance(raw_ids, list):
            raise ValueError("Choose the viewing sessions to delete")
        selected = {str(value).strip() for value in raw_ids if str(value).strip()}
        if not selected:
            raise ValueError("Choose at least one viewing session")
        if len(selected) > VIEWING_MAX_SESSIONS:
            raise ValueError("Too many viewing sessions were selected")
        with self.viewing_lock:
            sessions = self.viewing_store["sessions"]
            kept = [item for item in sessions if str(item.get("id") or "") not in selected]
            deleted = len(sessions) - len(kept)
            if deleted:
                self.viewing_store["sessions"] = kept
                self.viewing_dirty = True
        self.flush_viewing_store(force=True)
        return {"ok": True, "deleted": deleted}

    def cleanup_stale_temporary_files(self) -> None:
        """Remove abandoned encoder outputs, never active or recent work."""
        result_cutoff = time.time() - 7 * 24 * 60 * 60
        upload_cutoff = result_cutoff
        # No encoder exists yet while Library is starting. Every temporary
        # encoder output in .incoming is therefore an orphan from a crash and
        # can be removed immediately before a resumed job reserves space again.
        # Restrict this to .incoming so a customer video with a similar name is
        # never mistaken for our private temporary file.
        for candidate in self.incoming.glob("*.optimising.mp4"):
            try:
                if candidate.is_file():
                    candidate.unlink()
                    print(f"Removed interrupted conversion file: {candidate}",
                          file=sys.stderr, flush=True)
            except OSError as error:
                print(f"Could not remove interrupted conversion file {candidate}: {error}",
                      file=sys.stderr, flush=True)
        for candidate in self.incoming.glob("*.ffmpeg.log"):
            try:
                candidate.unlink()
            except OSError:
                pass
        for candidate in self.incoming.glob("usb-*.part"):
            try:
                candidate.unlink()
            except OSError:
                pass
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                try:
                    if manifest.stat().st_mtime < result_cutoff:
                        manifest.unlink()
                except OSError:
                    pass
                continue
            metadata = self.read_json(manifest, {})
            try:
                status = str(metadata.get("status", "uploading"))
                part = self.incoming / f"{manifest.stem}.part"
                activity = max(
                    float(metadata.get("created", 0)),
                    float(metadata.get("updated", 0)),
                    manifest.stat().st_mtime,
                    part.stat().st_mtime if part.is_file() else 0,
                )
            except (OSError, TypeError, ValueError):
                activity = time.time()
                status = "uploading"
            # Once all source bytes have entered validation/preparation, never
            # discard the owner's only copy based on its original creation
            # date. It remains visible for explicit retry/cancel and recovery.
            if status != "uploading" or activity >= upload_cutoff:
                continue
            upload_id = manifest.stem
            (self.incoming / f"{upload_id}.part").unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)
            print(f"Removed abandoned upload: {upload_id}", file=sys.stderr, flush=True)

    def resume_conversion_jobs(self) -> None:
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            metadata = self.read_json(manifest, {})
            upload_id = manifest.stem
            part = self.incoming / f"{upload_id}.part"
            result = self.read_json(self.incoming / f"{upload_id}.result.json", None)
            if isinstance(result, dict) and result.get("complete"):
                part.unlink(missing_ok=True)
                manifest.unlink(missing_ok=True)
                continue
            try:
                ready = part.is_file() and part.stat().st_size == int(metadata.get("size", -1))
            except (OSError, TypeError, ValueError):
                ready = False
            destination_ready = False
            try:
                destination = self.upload_destination(metadata)
                if metadata.get("conversion_required"):
                    destination = destination.with_suffix(".mp4")
                destination_ready = destination.is_file()
            except (TypeError, ValueError):
                pass
            resumable_statuses = {
                "uploading", "validating", "queued", "processing", "publishing",
                "finalising", "error"
            }
            if (ready or destination_ready) and metadata.get("status") in resumable_statuses:
                metadata["resume_from_status"] = metadata.get("status")
                metadata["status"] = "queued"
                metadata.pop("error", None)
                self.write_json(manifest, metadata)
                self.queue_conversion(upload_id)

    def cleanup_offline_prepared_cache(self) -> None:
        """Discard old phone-only conversions without touching customer media."""
        cutoff = time.time() - OFFLINE_PREPARED_CACHE_SECONDS
        for candidate in self.offline_cache.iterdir():
            try:
                if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                    candidate.unlink()
            except OSError as error:
                print(f"Could not remove offline cache file {candidate}: {error}",
                      file=sys.stderr, flush=True)

    def recover_final_results(self) -> None:
        """Promote a publication interrupted only during final bookkeeping."""
        for result_path in self.incoming.glob("*.result.json"):
            result = self.read_json(result_path, {})
            if not isinstance(result, dict) or result.get("complete") \
                or result.get("status") != "finalising":
                continue
            try:
                destination = self.upload_destination(result)
                if result.get("optimised"):
                    destination = destination.with_suffix(".mp4")
            except (TypeError, ValueError):
                continue
            if destination.is_file():
                result["complete"] = True
                result["refreshed"] = self.refresh_tv()
                result["status"] = "complete" if result["refreshed"] else "refresh-error"
                self.write_json(result_path, result)

    def queue_conversion(self, upload_id: str) -> None:
        with self.config_lock:
            if self.conversion_closed.is_set():
                raise RuntimeError("The media worker is stopping")
            if upload_id in self.queued_conversions:
                return
            self.queued_conversions.add(upload_id)
            self.conversion_queue.put(upload_id)

    def run_conversion_worker(self) -> None:
        while True:
            upload_id = self.conversion_queue.get()
            if upload_id is None:
                self.conversion_queue.task_done()
                return
            try:
                self.process_conversion(upload_id)
            except Exception as error:
                with self.config_lock:
                    was_cancelled = upload_id in self.cancelled_conversions
                if not was_cancelled:
                    try:
                        self.unexpected_conversion_error(upload_id, error)
                    except Exception as report_error:
                        # ENOSPC/read-only media can make both the job and its
                        # status write fail. Never let that kill the only worker.
                        print(f"Could not persist conversion failure {upload_id}: {report_error}",
                              file=sys.stderr, flush=True)
            finally:
                self.finish_conversion_job(upload_id)
                self.conversion_queue.task_done()

    def finish_conversion_job(self, upload_id: str) -> None:
        """Release the queue slot and honour a retry requested during teardown."""
        with self.config_lock:
            self.queued_conversions.discard(upload_id)
            retry = upload_id in self.deferred_retries
            self.deferred_retries.discard(upload_id)
            self.cancelled_conversions.discard(upload_id)
        if retry and not self.conversion_closed.is_set():
            self.queue_conversion(upload_id)

    def unexpected_conversion_error(self, upload_id: str, error: Exception) -> None:
        print(f"Conversion {upload_id} failed: {error}", file=sys.stderr, flush=True)
        manifest = self.incoming / f"{upload_id}.json"
        metadata = self.read_json(manifest, {})
        if isinstance(metadata, dict) and metadata:
            if metadata.get("status") == "validating":
                # A fully received but unreadable file cannot become valid by
                # retrying the same bytes. Free its reserved space but retain a
                # result record so the waiting browser sees the real error.
                (self.incoming / f"{upload_id}.part").unlink(missing_ok=True)
                result = {
                    "id": upload_id,
                    "file_name": str(metadata.get("file_name", "Video")),
                    "channel": metadata.get("channel"),
                    "kind": metadata.get("kind", "channel"),
                    "series_id": metadata.get("series_id"),
                    "season": metadata.get("season"),
                    "offset": int(metadata.get("size", 0)),
                    "complete": False,
                    "processing": False,
                    "status": "error",
                    "error": str(error) if isinstance(error, ValueError)
                    else "Mabel TV could not check this video",
                    "finished": time.time(),
                }
                self.write_json(self.incoming / f"{upload_id}.result.json", result)
                manifest.unlink(missing_ok=True)
                return
            metadata["status"] = "error"
            metadata["error"] = str(error) if isinstance(error, ValueError) \
                else "Mabel TV could not prepare this video"
            metadata["updated"] = time.time()
            self.write_json(manifest, metadata)

    def process_conversion(self, upload_id: str) -> None:
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
        with lock:
            metadata = self.upload_meta(upload_id)
            part = self.incoming / f"{upload_id}.part"
            adult_film_upload = metadata.get("kind") == "adult"
            adult_series_upload = metadata.get("kind") == "adult-series"
            adult_upload = adult_film_upload or adult_series_upload
            source_name = str(metadata["file_name"])
            original_destination = self.upload_destination(metadata)
            previous_status = str(metadata.pop(
                "resume_from_status", metadata.get("status", "queued")))

            part_ready = part.is_file() and part.stat().st_size == int(metadata["size"])
            conversion_required = metadata.get("conversion_required")
            if conversion_required is None:
                if not part_ready:
                    raise ValueError("The uploaded file is incomplete")
                metadata["status"] = "validating"
                metadata["updated"] = time.time()
                metadata.pop("error", None)
                self.write_json(self.incoming / f"{upload_id}.json", metadata)
                self.video_info(part)
                # Channel uploads are published exactly as supplied. Automatic
                # optimisation made successful uploads look stuck and delayed
                # films and episodes appearing in their chosen channel.
                conversion_required = False
                metadata["conversion_required"] = False
                previous_status = "validated"

            if conversion_required and not adult_upload:
                legacy_destination = original_destination.with_suffix(".mp4")
                legacy_published = (legacy_destination.is_file()
                                    and previous_status in {
                                        "processing", "publishing", "finalising", "error"
                                    })
                if not legacy_published:
                    # Resume old queued uploads under the new direct-publish
                    # policy instead of sending them back through the encoder.
                    conversion_required = False
                    metadata["conversion_required"] = False
                    metadata["updated"] = time.time()
                    self.write_json(self.incoming / f"{upload_id}.json", metadata)

            destination = original_destination.with_suffix(".mp4") \
                if conversion_required else original_destination
            published_recovery = (destination.is_file()
                                  and previous_status in {
                                      "processing", "publishing", "finalising", "error"
                                  })
            if destination.exists() and not published_recovery:
                raise ValueError("A file with that name already exists in this library")

            if published_recovery:
                # The process may have died after the atomic media rename but
                # before recording completion. Validate and finish, rather
                # than rejecting a file this very job already published.
                self.video_info(destination)
            elif conversion_required:
                metadata["status"] = "processing"
                metadata["updated"] = time.time()
                self.write_json(self.incoming / f"{upload_id}.json", metadata)
                if adult_film_upload:
                    self.optimise_adult_for_playback(part, destination)
                else:
                    self.optimise_for_playback(part, destination)
            else:
                metadata["status"] = "publishing"
                metadata["updated"] = time.time()
                self.write_json(self.incoming / f"{upload_id}.json", metadata)
                os.replace(part, destination)

            metadata["status"] = "finalising"
            metadata["updated"] = time.time()
            self.write_json(self.incoming / f"{upload_id}.json", metadata)
            if adult_film_upload:
                with self.config_lock:
                    states = self.adult_media_states()
                    relative = self.adult_relative_path(destination)
                    current = states.get(relative, {})
                    if not isinstance(current, dict):
                        current = {}
                    current.setdefault("library_id", uuid.uuid4().hex)
                    current.setdefault("state", "original")
                    current.setdefault("message", "")
                    states[relative] = current
                    self.write_adult_media_states(states)
            elif adult_series_upload:
                with self.config_lock:
                    states = self.adult_series_states()
                    series_id = str(metadata.get("series_id", ""))
                    relative = destination.relative_to(
                        self.adult_series_root / series_id).as_posix()
                    key = f"{series_id}/{relative}"
                    current = states["episodes"].get(key, {})
                    if not isinstance(current, dict):
                        current = {}
                    current.setdefault("library_id", uuid.uuid4().hex)
                    states["episodes"][key] = current
                    self.write_adult_series_states(states)
            refreshed = True if adult_series_upload else self.refresh_tv()
            result = {
                "id": upload_id,
                "offset": int(metadata["size"]),
                "complete": False,
                "optimised": bool(conversion_required),
                "refreshed": refreshed,
                "status": "finalising",
                "file_name": source_name,
                "channel": metadata.get("channel"),
                "kind": "adult-series" if adult_series_upload
                else "adult" if adult_film_upload else "channel",
                "series_id": metadata.get("series_id"),
                "season": metadata.get("season"),
                "finished": time.time(),
            }
            result_path = self.incoming / f"{upload_id}.result.json"
            self.write_json(result_path, result)
            self.unlink_with_retry(part)
            result["complete"] = True
            result["status"] = "complete" if refreshed else "refresh-error"
            self.write_json(result_path, result)
            # Keep the manifest until the complete result is durably visible.
            # A status request can otherwise land between the manifest unlink
            # and result replacement and incorrectly report "Upload not found".
            self.unlink_with_retry(self.incoming / f"{upload_id}.json")
            with self.config_lock:
                self.upload_locks.pop(upload_id, None)

    @staticmethod
    def read_config(path: Path) -> dict[str, str]:
        values: dict[str, str] = {}
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if separator and key.strip():
                    values[key.strip()] = value.strip()
        except OSError:
            pass
        return values

    @staticmethod
    def pin_record(pin: str) -> dict[str, Any]:
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, PBKDF2_ITERATIONS)
        return {
            "pin_salt": salt.hex(),
            "pin_hash": digest.hex(),
            "pin_iterations": PBKDF2_ITERATIONS,
        }

    def owner(self) -> dict[str, Any]:
        value = self.read_json(self.owner_path, {})
        return value if isinstance(value, dict) else {}

    @staticmethod
    def normalise_tv_identity(value: Any) -> tuple[str, str]:
        """Return the child's plain name and the friendly TV name.

        The setup form asks for "Mabel", rather than asking a grown-up to
        decide whether a space belongs before TV. Be forgiving if they type
        "Mabel TV" or "MabelTV" anyway, but never accept an empty/control
        character name into the owner record or QML display.
        """
        child_name = " ".join(str(value or "").split())
        if child_name.casefold().endswith("tv"):
            child_name = child_name[:-2].rstrip()
        if not 1 <= len(child_name) <= 40 or any(ord(char) < 32 for char in child_name):
            raise ValueError("Enter the child's name, up to 40 characters")
        return child_name, f"{child_name}TV"

    def tv_identity(self) -> tuple[str, str]:
        owner = self.owner()
        try:
            return self.normalise_tv_identity(owner.get("child_name", ""))
        except ValueError:
            # Existing MabelTV installations have no child-name field. Their
            # internal service/update identity stays untouched, while their
            # owner-facing display starts from the generic product name.
            return "", PRODUCT_NAME

    def configured(self) -> bool:
        owner = self.owner()
        return bool(owner.get("setup_complete") and owner.get("pin_hash")
                    and owner.get("pin_salt"))

    def portal_pin_required(self) -> bool:
        """Keep existing installations private unless their owner opts out."""
        return bool(self.owner().get("portal_pin_required", True))

    def migrate_legacy_owner(self) -> None:
        if self.owner_path.exists():
            return
        legacy_pin = self.read_config(self.config_path).get("MABELTV_LIBRARY_PIN", "")
        if not PIN_PATTERN.fullmatch(legacy_pin):
            return
        owner = {
            "schema_version": 1,
            "setup_complete": True,
            "owner_name": "Owner",
            "tv_name": PRODUCT_NAME,
            "legacy_default_pin": legacy_pin == "0973",
            "portal_pin_required": True,
            **self.pin_record(legacy_pin),
        }
        self.write_json(self.owner_path, owner)

    def verify_pin(self, pin: str) -> bool:
        owner = self.owner()
        try:
            salt = bytes.fromhex(str(owner["pin_salt"]))
            expected = bytes.fromhex(str(owner["pin_hash"]))
            iterations = int(owner.get("pin_iterations", PBKDF2_ITERATIONS))
        except (KeyError, TypeError, ValueError):
            return False
        actual = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, iterations)
        return hmac.compare_digest(actual, expected)

    def public_setup(self) -> dict[str, Any]:
        existing_channels = self.channels()
        try:
            setup_channels = self.normalise_channels(existing_channels) \
                if existing_channels else DEFAULT_CHANNELS
        except ValueError:
            setup_channels = DEFAULT_CHANNELS
        return {
            "configured": self.configured(),
            "device_name": socket.gethostname(),
            "product_name": PRODUCT_NAME,
            "tv_name": self.tv_identity()[1],
            "portal_pin_required": self.portal_pin_required(),
            "setup_code_required": True,
            # Recovery is an explicit state written by the physical boot-marker
            # service. A fresh install also seeds channels.json, so the mere
            # presence of channels cannot distinguish setup from recovery.
            "default_channels": setup_channels,
            "recovering_owner": self.owner_recovery_path.is_file(),
        }

    def verify_setup_code(self, supplied_code: str) -> bool:
        expected_code = self.read_config(self.config_path).get("MABELTV_SETUP_CODE", "")
        return bool(expected_code and hmac.compare_digest(supplied_code.strip(), expected_code))

    @staticmethod
    def channel_content_type(value: dict[str, Any]) -> str:
        content_type = str(value.get("content_type", "")).strip().lower()
        if content_type:
            return content_type
        name = str(value.get("name", "")).strip().lower()
        folder = str(value.get("folder", "")).strip().lower()
        return "films" if name in {"films", "movies"} \
            or folder in {"films", "movies"} else "shows"

    @staticmethod
    def normalise_channels(values: Any) -> list[dict[str, Any]]:
        if not isinstance(values, list) or not values or len(values) > 20:
            raise ValueError("Create between 1 and 20 channels")
        channels: list[dict[str, Any]] = []
        numbers: set[int] = set()
        folders: set[str] = set()
        for raw in values:
            if not isinstance(raw, dict):
                raise ValueError("A channel entry is invalid")
            try:
                number = int(raw.get("number"))
            except (TypeError, ValueError):
                raise ValueError("Every channel needs a number") from None
            name = str(raw.get("name", "")).strip()
            folder = SAFE_NAME.sub("", str(raw.get("folder", "")).strip()).strip(". ")
            aspect = str(raw.get("aspect", "crop"))
            content_type = Library.channel_content_type(raw)
            if not 1 <= number <= 999 or number in numbers:
                raise ValueError("Channel numbers must be unique and between 1 and 999")
            if not name or len(name) > 60 or not folder or folder in folders:
                raise ValueError("Every channel needs a unique name and folder")
            if aspect not in {"crop", "fit", "stretch"}:
                raise ValueError("Channel picture mode must be crop, fit, or stretch")
            if content_type not in {"shows", "films"}:
                raise ValueError("Channel content must be shows or films")
            numbers.add(number)
            folders.add(folder)
            channels.append({"number": number, "name": name, "folder": folder,
                             "aspect": aspect, "content_type": content_type})
        return sorted(channels, key=lambda channel: channel["number"])

    def complete_setup(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.config_lock:
            if self.configured():
                raise ValueError("Mabel TV has already been set up")
            supplied_code = str(payload.get("setup_code", "")).strip()
            if not self.verify_setup_code(supplied_code):
                raise ValueError("That setup code is not correct")
            pin = str(payload.get("pin", "")).strip()
            if not PIN_PATTERN.fullmatch(pin):
                raise ValueError("Choose a PIN containing 4 to 8 numbers")
            existing_channels = self.channels()
            recovering_owner = self.owner_recovery_path.is_file()
            # Physical PIN recovery must never reinterpret editable browser
            # channel fields and accidentally orphan existing media folders.
            channels = self.normalise_channels(existing_channels) \
                if recovering_owner else self.normalise_channels(payload.get(
                    "channels", existing_channels or DEFAULT_CHANNELS))
            for channel in channels:
                (self.media_root / channel["folder"]).mkdir(mode=0o750, exist_ok=True)
            self.write_json(self.channels_path, {"schema_version": 1, "channels": channels})
            owner_name = str(payload.get("owner_name", "Owner")).strip()[:60] or "Owner"
            if recovering_owner:
                child_name, tv_name = self.tv_identity()
            else:
                child_name, tv_name = self.normalise_tv_identity(
                    payload.get("child_name", "Kids"))
            self.write_json(self.owner_path, {
                "schema_version": 1,
                "setup_complete": True,
                "owner_name": owner_name,
                "child_name": child_name,
                "tv_name": tv_name,
                "legacy_default_pin": False,
                "portal_pin_required": True,
                "created_at": int(time.time()),
                **self.pin_record(pin),
            })
            self.unlink_with_retry(self.owner_recovery_path)
            self.sessions.clear()
        try:
            self.admin_action("restart-player")
            restarted = True
        except ValueError as error:
            # Setup itself is safely committed. A stopped player can be fixed
            # from the dashboard or by the next boot without making the user
            # repeat the ownership step.
            print(f"Setup completed, but the TV player was not restarted: {error}",
                  file=sys.stderr, flush=True)
            restarted = False
        return {"ok": True, "login_required": True, "player_restarted": restarted}

    def change_pin(self, payload: dict[str, Any]) -> None:
        current = str(payload.get("current_pin", ""))
        new_pin = str(payload.get("new_pin", ""))
        if not self.verify_pin(current):
            raise ValueError("The current PIN is not correct")
        if not PIN_PATTERN.fullmatch(new_pin):
            raise ValueError("Choose a PIN containing 4 to 8 numbers")
        with self.config_lock:
            owner = self.owner()
            owner.update(self.pin_record(new_pin))
            owner["legacy_default_pin"] = False
            owner["pin_changed_at"] = int(time.time())
            self.write_json(self.owner_path, owner)
            self.sessions.clear()

    def set_portal_pin_required(self, payload: dict[str, Any]) -> bool:
        """Change the sign-in gate without ever exposing or replacing the PIN."""
        current = str(payload.get("current_pin", ""))
        required = payload.get("required")
        if not self.verify_pin(current):
            raise ValueError("The current PIN is not correct")
        if not isinstance(required, bool):
            raise ValueError("Choose whether the portal should require a PIN")
        with self.config_lock:
            owner = self.owner()
            owner["portal_pin_required"] = required
            owner["portal_pin_changed_at"] = int(time.time())
            self.write_json(self.owner_path, owner)
            self.sessions.clear()
        return required

    def change_tv_name(self, payload: dict[str, Any]) -> dict[str, str | bool]:
        child_name, tv_name = self.normalise_tv_identity(payload.get("child_name"))
        with self.config_lock:
            owner = self.owner()
            if not self.configured():
                raise ValueError("Finish first-time setup before naming this TV")
            owner["child_name"] = child_name
            owner["tv_name"] = tv_name
            owner["tv_name_changed_at"] = int(time.time())
            self.write_json(self.owner_path, owner)
        try:
            self.admin_action("restart-player")
            restarted = True
        except ValueError:
            restarted = False
        return {"child_name": child_name, "tv_name": tv_name,
                "player_restarted": restarted}

    @staticmethod
    def read_json(path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return fallback

    @staticmethod
    def write_json(path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".new")
        with temporary.open("w", encoding="utf-8") as output:
            output.write(json.dumps(value, indent=2, sort_keys=True) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o640)
        for attempt in range(10):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.02 * (attempt + 1))
        try:
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except OSError:
            # Directory fsync is unavailable on some development platforms;
            # the file itself has still been atomically and durably replaced.
            pass

    @staticmethod
    def unlink_with_retry(path: Path) -> None:
        for attempt in range(10):
            try:
                path.unlink(missing_ok=True)
                return
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.02 * (attempt + 1))

    def clear_superseded_upload_errors(self, channel: int, file_name: str) -> None:
        """Dismiss old errors once the owner deliberately retries that file."""
        for result_path in self.incoming.glob("*.result.json"):
            value = self.read_json(result_path, {})
            try:
                same_channel = int(value.get("channel", -1)) == channel
            except (TypeError, ValueError):
                same_channel = False
            if value.get("status") == "error" and same_channel \
                and value.get("file_name") == file_name:
                self.unlink_with_retry(result_path)

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

    @staticmethod
    def normalise_adult_folder(folder_name: str) -> str:
        requested = str(folder_name or "").strip()
        name = SAFE_NAME.sub("", requested).strip(". ")
        if (not name or name in {".", ".."} or "/" in requested
                or "\\" in requested or len(name) > 80):
            raise ValueError("Enter a simple folder name")
        return name

    def adult_folder_path(self, folder_name: str, *, create: bool = False) -> Path:
        name = self.normalise_adult_folder(folder_name)
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        path = self.adult_root / name
        if path.exists() and not path.is_dir():
            raise ValueError("That folder name is already in use")
        if create:
            path.mkdir(mode=0o750, exist_ok=True)
        return path

    def safe_adult_path(self, file_name: str, *, create_folder: bool = False) -> Path:
        relative = str(file_name or "").strip().replace("\\", "/")
        parts = relative.split("/")
        if len(parts) not in {1, 2} or any(not part or part in {".", ".."}
                                           for part in parts):
            raise ValueError("That is not a supported Adult library path")
        name = parts[-1]
        if Path(name).name != name or Path(name).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That is not a supported video file")
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        parent = self.adult_root
        if len(parts) == 2:
            folder = self.normalise_adult_folder(parts[0])
            if folder != parts[0]:
                raise ValueError("That Adult library folder is not valid")
            parent = self.adult_folder_path(folder, create=create_folder)
        return parent / name

    def adult_relative_path(self, path: Path) -> str:
        try:
            return path.relative_to(self.adult_root).as_posix()
        except ValueError as error:
            raise ValueError("That film is outside the Adult library") from error

    def adult_folders(self) -> list[str]:
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        return sorted(
            (item.name for item in self.adult_root.iterdir()
             if item.is_dir() and not item.name.startswith(".")),
            key=str.casefold,
        )

    def adult_media_states(self) -> dict[str, dict[str, Any]]:
        value = self.read_json(self.adult_metadata_path, {})
        return value if isinstance(value, dict) else {}

    def channel_media_states(self) -> dict[str, Any]:
        """Cached TMDB matches for MabelTV shows and film-channel titles."""
        value = self.read_json(self.channel_metadata_path, {})
        return value if isinstance(value, dict) else {}

    def write_channel_media_states(self, values: dict[str, Any]) -> None:
        self.write_json(self.channel_metadata_path, values)

    def channel_programme_title(self, channel_number: int, file_name: str) -> str:
        """Return the saved metadata title, falling back to the uploaded name."""
        states = self.channel_media_states()
        programmes = states.get("programmes", {}) if isinstance(states, dict) else {}
        metadata = programmes.get(
            self.channel_programme_key(channel_number, file_name), {}) \
            if isinstance(programmes, dict) else {}
        title = str(metadata.get("title") or "").strip() \
            if isinstance(metadata, dict) else ""
        return title or self.display_name(file_name)

    @staticmethod
    def channel_programme_key(channel_number: int, file_name: str) -> str:
        return f"{int(channel_number)}/{file_name}"

    def channel_programme_duration(self, channel: dict[str, Any],
                                   file_name: str) -> float:
        """Read an active channel programme duration once for the home card."""
        source = self.media_root / str(channel.get("folder", "")) / file_name
        try:
            stat = source.stat()
        except OSError:
            return 0.0
        cache_key = (str(source), int(stat.st_mtime_ns), int(stat.st_size))
        with self.channel_programme_duration_lock:
            cached = self.channel_programme_duration_cache.get(cache_key)
        if cached is not None:
            return cached
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(source)],
                check=False, capture_output=True, text=True, timeout=3,
            )
            duration = float(result.stdout.strip()) if result.returncode == 0 else 0.0
        except (OSError, subprocess.TimeoutExpired, ValueError):
            duration = 0.0
        duration = max(0.0, duration)
        with self.channel_programme_duration_lock:
            self.channel_programme_duration_cache[cache_key] = duration
        return duration

    def channel_film_resume_state(self, channel_number: int,
                                  file_name: str) -> dict[str, float]:
        """Return the shared TV/browser bookmark for a film-channel item."""
        key = self.channel_programme_key(channel_number, file_name)
        state = self.read_json(self.player_state_path, {})
        if not isinstance(state, dict):
            state = {}
        positions = state.get("channel_film_positions", {})
        durations = state.get("channel_film_durations", {})
        updates = state.get("channel_film_position_updated_utc_ms", {})
        try:
            position = float(positions.get(key, 0) or 0) \
                if isinstance(positions, dict) else 0.0
        except (TypeError, ValueError):
            position = 0.0
        try:
            duration = float(durations.get(key, 0) or 0) \
                if isinstance(durations, dict) else 0.0
        except (TypeError, ValueError):
            duration = 0.0
        try:
            updated = float(updates.get(key, 0) or 0) / 1000.0 \
                if isinstance(updates, dict) else 0.0
        except (TypeError, ValueError):
            updated = 0.0
        return {
            "position": self.normalise_resume_position(max(0.0, position),
                                                       max(0.0, duration)),
            "duration": max(0.0, duration),
            "updated": max(0.0, updated),
        }

    def channel_series_resume_state(
            self, channel_number: int,
            programmes: list[dict[str, Any]]) -> dict[str, Any]:
        """Return the episode and position currently held by a series channel."""
        available = {
            str(programme.get("name", "")): programme
            for programme in programmes
            if programme.get("name") and programme.get("enabled") is not False
        }
        fallback = next(iter(available), "")
        state = self.read_json(self.player_state_path, {})
        timelines = state.get("channel_timelines", {}) \
            if isinstance(state, dict) else {}
        timeline = timelines.get(str(channel_number), {}) \
            if isinstance(timelines, dict) else {}
        if not isinstance(timeline, dict):
            timeline = {}
        file_name = str(timeline.get("episode_name", ""))
        if file_name not in available:
            file_name = fallback
        try:
            position = max(0.0, float(timeline.get("position_seconds", 0) or 0))
        except (TypeError, ValueError):
            position = 0.0
        if file_name and position <= 0:
            positions = timeline.get("programme_positions", {})
            try:
                position = max(0.0, float(positions.get(file_name, 0) or 0)) \
                    if isinstance(positions, dict) else 0.0
            except (TypeError, ValueError):
                position = 0.0
        programme = available.get(file_name, {})
        metadata = programme.get("metadata", {}) \
            if isinstance(programme, dict) else {}
        title = str(metadata.get("title") or "").strip() \
            if isinstance(metadata, dict) else ""
        return {
            "file": file_name,
            "position": position,
            "browser_ready": programme.get("browser_ready") is not False,
            "title": title or str(programme.get("display_name", "")),
        }

    def write_adult_media_states(self, values: dict[str, dict[str, Any]]) -> None:
        self.write_json(self.adult_metadata_path, values)

    def set_adult_media_state(self, file_name: str, state: str,
                              message: str = "", progress: int | None = None,
                              **details: Any) -> None:
        values = self.adult_media_states()
        current = values.get(file_name, {})
        if not isinstance(current, dict):
            current = {}
        current.update({"state": state, "message": message, "updated": time.time()})
        if progress is None:
            current.pop("progress", None)
        else:
            current["progress"] = max(0, min(100, int(progress)))
        for key, value in details.items():
            if value is None:
                current.pop(key, None)
            else:
                current[key] = value
        values[file_name] = current
        self.write_adult_media_states(values)

    def remove_adult_media_state(self, file_name: str) -> None:
        values = self.adult_media_states()
        if file_name in values:
            values.pop(file_name, None)
            self.write_adult_media_states(values)

    def recover_adult_optimisations(self) -> None:
        values = self.adult_media_states()
        changed = False
        for value in values.values():
            if isinstance(value, dict) and value.get("state") in {"queued", "processing"}:
                value["state"] = "error"
                value["message"] = "Optimisation was interrupted. Test the film or try again."
                value["updated"] = time.time()
                changed = True
        if changed:
            self.write_adult_media_states(values)

    def adult_library(self) -> list[dict[str, Any]]:
        with self.config_lock:
            return self._adult_library()

    def _adult_library(self) -> list[dict[str, Any]]:
        states = self.adult_media_states()
        changed = False
        values = []
        candidates = list(self.adult_root.glob("*"))
        for folder in self.adult_folders():
            candidates.extend((self.adult_root / folder).glob("*"))
        for item in sorted(candidates,
                           key=lambda path: self.adult_relative_path(path).casefold()):
            if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
                relative = self.adult_relative_path(item)
                state = states.get(relative, {})
                if not isinstance(state, dict):
                    state = {}
                if not state.get("library_id"):
                    state["library_id"] = uuid.uuid4().hex
                    states[relative] = state
                    changed = True
                values.append({
                    "name": item.name,
                    "path": relative,
                    "folder": "" if item.parent == self.adult_root else item.parent.name,
                    "library_id": state["library_id"],
                    "display_name": self.display_name(item.name),
                    "size": item.stat().st_size,
                    "playback_state": state.get("state", "original"),
                    "playback_message": state.get("message", ""),
                    "playback_progress": max(0, min(100, int(
                        state.get("progress", 0) or 0))),
                    "metadata": state.get("metadata", {})
                    if isinstance(state.get("metadata"), dict) else {},
                    "favourite": state.get("favourite") is True,
                    "browser_ready": item.suffix.lower() in REMOTE_BROWSER_EXTENSIONS,
                    "remote_position": self.remote_resume_position(state["library_id"], state),
                    "remote_duration": self.remote_resume_duration(
                        state["library_id"], state),
                    "remote_last_watched": self.remote_last_watched(
                        state["library_id"], state),
                })
        if changed:
            self.write_adult_media_states(states)
        return values

    def adult_optimisations(self) -> dict[str, Any]:
        """Return the tiny, frequently polled subset of Adult TV state.

        Keeping this separate from /api/library prevents an optimisation from
        rebuilding every portal view and throwing an iPhone back to the top.
        """
        states = self.adult_media_states()
        items = []
        for path, value in states.items():
            if not isinstance(value, dict):
                continue
            state = str(value.get("state", "original"))
            if state not in {"queued", "processing", "paused", "optimised", "error"}:
                continue
            items.append({
                "path": path,
                "title": self.display_name(Path(path).name),
                "state": state,
                "progress": max(0, min(100, int(value.get("progress", 0) or 0))),
                "message": str(value.get("message", "")),
                "updated": float(value.get("updated", 0) or 0),
                "started": float(value.get("started", 0) or 0),
                "eta_seconds": max(0, int(value.get("eta_seconds", 0) or 0)),
            })
        return {"items": items, "active": any(
            item["state"] in {"queued", "processing", "paused"} for item in items)}

    def adult_series_states(self) -> dict[str, Any]:
        value = self.read_json(self.adult_series_state_path, {})
        if not isinstance(value, dict):
            value = {}
        if not isinstance(value.get("series"), dict):
            value["series"] = {}
        if not isinstance(value.get("episodes"), dict):
            value["episodes"] = {}
        return value

    def write_adult_series_states(self, values: dict[str, Any]) -> None:
        values["updated"] = time.time()
        self.write_json(self.adult_series_state_path, values)

    @staticmethod
    def normalise_series_title(value: str) -> str:
        title = SAFE_NAME.sub("", str(value or "").strip()).strip(". ")
        if not title or len(title) > 80:
            raise ValueError("Enter a series name")
        return title

    def create_adult_series(self, title: str) -> str:
        title = self.normalise_series_title(title)
        with self.config_lock:
            states = self.adult_series_states()
            for series_id, value in states["series"].items():
                if isinstance(value, dict) and str(value.get("title", "")).casefold() == title.casefold():
                    (self.adult_series_root / series_id).mkdir(mode=0o750, exist_ok=True)
                    return series_id
            series_id = uuid.uuid4().hex
            states["series"][series_id] = {
                "title": title, "created": time.time(), "metadata": {},
            }
            (self.adult_series_root / series_id).mkdir(mode=0o750, exist_ok=True)
            self.write_adult_series_states(states)
            return series_id

    def adult_series_path(self, series_id: str, relative: str = "") -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", str(series_id)):
            raise ValueError("That Adult TV series is not valid")
        root = (self.adult_series_root / series_id).resolve()
        if not root.is_dir():
            raise ValueError("That Adult TV series no longer exists")
        relative_path = Path(str(relative or "").replace("\\", "/"))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("That episode path is not valid")
        candidate = root.joinpath(relative_path).resolve()
        if candidate != root and root not in candidate.parents:
            raise ValueError("That episode path is not valid")
        return candidate

    @staticmethod
    def adult_episode_identity(path: Path, ordinal: int = 0) -> dict[str, Any]:
        stem = re.sub(r"[._]+", " ", path.stem).strip()
        match = re.search(r"(?i)\bS(?:eries|eason)?\s*0*(\d{1,2})\s*E(?:pisode)?\s*0*(\d{1,3})\b", stem)
        if not match:
            match = re.search(r"(?i)\b0*(\d{1,2})x0*(\d{1,3})\b", stem)
        season = int(match.group(1)) if match else 0
        episode = int(match.group(2)) if match else max(1, ordinal)
        if not season:
            parent = re.search(r"(?i)\b(?:series|season)\s*0*(\d{1,2})\b", path.parent.name)
            season = int(parent.group(1)) if parent else 1
        title = stem
        if match:
            title = (stem[:match.start()] + " " + stem[match.end():]).strip(" .-_[]()")
        title = re.sub(
            r"(?i)\b(?:480p|720p|1080p|2160p|hdtv|web[- ]?dl|bluray|xvid|x26[45]|hevc)\b.*$",
            "", title).strip(" .-_")
        return {"season": season, "episode": episode,
                "title": title or f"Episode {episode}"}

    def adult_series_library(self) -> list[dict[str, Any]]:
        with self.config_lock:
            states = self.adult_series_states()
            changed = False
            values: list[dict[str, Any]] = []
            for series_id, series_state in sorted(
                    states["series"].items(),
                    key=lambda item: str(item[1].get("title", "")).casefold()
                    if isinstance(item[1], dict) else str(item[0])):
                if not re.fullmatch(r"[a-f0-9]{32}", str(series_id)) \
                        or not isinstance(series_state, dict):
                    continue
                root = self.adult_series_root / series_id
                if not root.is_dir():
                    continue
                files = sorted(
                    (item for item in root.rglob("*") if item.is_file()
                     and item.suffix.lower() in SUPPORTED_EXTENSIONS),
                    key=lambda item: item.relative_to(root).as_posix().casefold())
                episodes = []
                for ordinal, item in enumerate(files, 1):
                    relative = item.relative_to(root).as_posix()
                    key = f"{series_id}/{relative}"
                    episode_state = states["episodes"].get(key, {})
                    if not isinstance(episode_state, dict):
                        episode_state = {}
                    if not episode_state.get("library_id"):
                        episode_state["library_id"] = uuid.uuid4().hex
                        states["episodes"][key] = episode_state
                        changed = True
                    parsed = self.adult_episode_identity(item, ordinal)
                    metadata = episode_state.get("metadata", {})
                    if not isinstance(metadata, dict):
                        metadata = {}
                    position = self.normalise_resume_position(
                        float(episode_state.get("remote_position", 0) or 0),
                        float(episode_state.get("remote_duration", 0) or 0))
                    episodes.append({
                        "path": relative, "name": item.name,
                        "display_name": metadata.get("title") or parsed["title"],
                        "season": int(metadata.get("season_number") or parsed["season"]),
                        "episode": int(metadata.get("episode_number") or parsed["episode"]),
                        "overview": str(metadata.get("overview", "")),
                        "air_date": str(metadata.get("air_date", "")),
                        "still": str(metadata.get("still", "")),
                        "library_id": episode_state["library_id"],
                        "size": item.stat().st_size,
                        "browser_ready": self.remote_browser_ready(item),
                        "watched": episode_state.get("watched") is True,
                        "remote_position": position,
                        "remote_duration": float(episode_state.get("remote_duration", 0) or 0),
                        "remote_last_watched": float(episode_state.get("remote_last_watched", 0) or 0),
                    })
                episodes.sort(key=lambda value: (
                    value["season"], value["episode"], value["display_name"].casefold()))
                metadata = series_state.get("metadata", {})
                values.append({
                    "id": series_id,
                    "title": str(metadata.get("title") or series_state.get("title") or "Series"),
                    "stored_title": str(series_state.get("title") or "Series"),
                    "favourite": series_state.get("favourite") is True,
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "episodes": episodes,
                    "episode_count": len(episodes),
                    "season_count": len({value["season"] for value in episodes}),
                    "watched_count": sum(value["watched"] for value in episodes),
                })
            if changed:
                self.write_adult_series_states(states)
            return values

    def set_adult_episode_watched(self, series_id: str, relative: str,
                                  watched: bool) -> dict[str, Any]:
        source = self.adult_series_path(series_id, relative)
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That episode no longer exists")
        key = f"{series_id}/{source.relative_to(self.adult_series_root / series_id).as_posix()}"
        with self.config_lock:
            states = self.adult_series_states()
            value = states["episodes"].get(key, {})
            if not isinstance(value, dict):
                value = {}
            was_watched = value.get("watched") is True
            if watched and not was_watched:
                duration = max(0.0, float(value.get("remote_duration", 0) or 0))
                position = self.normalise_resume_position(
                    float(value.get("remote_position", 0) or 0), duration)
                if position > 0:
                    value["pre_watched_resume"] = {
                        "position": position,
                        "duration": duration,
                        "last_watched": max(
                            0.0, float(value.get("remote_last_watched", 0) or 0)),
                    }
            elif not watched and was_watched:
                resume = value.pop("pre_watched_resume", {})
                if isinstance(resume, dict):
                    duration = max(0.0, float(resume.get("duration", 0) or 0))
                    position = self.normalise_resume_position(
                        float(resume.get("position", 0) or 0), duration)
                    if position > 0:
                        value["remote_position"] = position
                        value["remote_duration"] = duration
                        value["remote_last_watched"] = max(
                            0.0, float(resume.get("last_watched", 0) or 0))
            value["watched"] = bool(watched)
            value["watched_updated"] = time.time()
            if watched:
                value["remote_position"] = 0.0
                value["remote_last_watched"] = 0.0
            states["episodes"][key] = value
            self.write_adult_series_states(states)
        return {
            "ok": True, "series": series_id, "path": relative,
            "watched": bool(watched),
            "remote_position": float(value.get("remote_position", 0) or 0),
            "remote_duration": float(value.get("remote_duration", 0) or 0),
            "remote_last_watched": float(value.get("remote_last_watched", 0) or 0),
        }

    def set_adult_season_watched(self, series_id: str, season: Any,
                                 watched: bool) -> dict[str, Any]:
        """Set every local episode in one season without discarding resume history."""
        try:
            season_number = int(season)
        except (TypeError, ValueError):
            raise ValueError("Choose a valid series") from None
        if season_number < 1:
            raise ValueError("Choose a valid series")
        series = next((value for value in self.adult_series_library()
                       if value.get("id") == series_id), None)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        targets = [str(episode.get("path") or "")
                   for episode in series.get("episodes", [])
                   if int(episode.get("season", 0) or 0) == season_number]
        if not targets:
            raise ValueError("That series has no episodes")
        updated = [self.set_adult_episode_watched(series_id, relative, watched)
                   for relative in targets]
        return {
            "ok": True, "series": series_id, "season": season_number,
            "watched": bool(watched), "episodes_updated": len(targets),
            "episodes": updated,
        }

    def restart_adult_series_progress(self, series_id: str, scope: str,
                                      season: int | None = None) -> dict[str, Any]:
        """Clear watched and resume history for one season or complete show."""
        root = self.adult_series_path(series_id)
        if not root.is_dir():
            raise ValueError("That TV series no longer exists")
        if scope not in {"season", "series"}:
            raise ValueError("Choose a series or complete show to restart")
        if scope == "season":
            try:
                season_number = int(season)
            except (TypeError, ValueError) as error:
                raise ValueError("Choose a series to restart") from error
            if season_number < 0:
                raise ValueError("Choose a series to restart")
        else:
            season_number = None

        prefix = f"{series_id}/"
        changed = 0
        with self.config_lock:
            states = self.adult_series_states()
            for key, raw_value in list(states["episodes"].items()):
                if not str(key).startswith(prefix):
                    continue
                relative = str(key)[len(prefix):]
                source = root / relative
                if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                value = raw_value if isinstance(raw_value, dict) else {}
                if season_number is not None:
                    metadata = value.get("metadata", {})
                    if not isinstance(metadata, dict):
                        metadata = {}
                    parsed = self.adult_episode_identity(source)
                    episode_season = int(
                        metadata.get("season_number") or parsed["season"])
                    if episode_season != season_number:
                        continue
                value["watched"] = False
                value["watched_updated"] = time.time()
                value["remote_position"] = 0.0
                value["remote_last_watched"] = 0.0
                value.pop("pre_watched_resume", None)
                states["episodes"][key] = value
                changed += 1
            self.write_adult_series_states(states)
        return {
            "ok": True,
            "series": series_id,
            "scope": scope,
            "season": season_number,
            "episodes_reset": changed,
        }

    def trash_adult_series_items(self, payload: dict[str, Any]) -> int:
        """Move an episode, a season, or a complete Adult TV series to the bin."""
        series_id = str(payload.get("series", ""))
        root = self.adult_series_path(series_id)
        scope = str(payload.get("scope", "episode"))
        if scope not in {"episode", "season", "series"}:
            raise ValueError("Choose an episode, series, or complete show to remove")
        with self.config_lock:
            states = self.adult_series_states()
            series_state = states["series"].get(series_id)
            if not isinstance(series_state, dict):
                raise ValueError("That Adult TV series no longer exists")
            title = str(series_state.get("metadata", {}).get("title")
                        if isinstance(series_state.get("metadata"), dict) else "") \
                or str(series_state.get("title") or "Series")
            all_files = [item for item in root.rglob("*") if item.is_file()
                         and item.suffix.lower() in SUPPORTED_EXTENSIONS]
            if scope == "episode":
                source = self.adult_series_path(series_id, str(payload.get("file", "")))
                if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    raise ValueError("That episode no longer exists")
                files = [source]
            elif scope == "season":
                try:
                    season = int(payload.get("season"))
                except (TypeError, ValueError) as error:
                    raise ValueError("Choose a series to remove") from error
                episode_seasons = {
                    item["path"]: int(item["season"])
                    for value in self.adult_series_library() if value["id"] == series_id
                    for item in value["episodes"]
                }
                files = [item for item in all_files
                         if episode_seasons.get(item.relative_to(root).as_posix()) == season]
                if not files:
                    raise ValueError(f"Series {season} has no episodes to remove")
            else:
                files = all_files

            moved = 0
            moved_keys: list[str] = []
            for source in files:
                relative = source.relative_to(root).as_posix()
                key = f"{series_id}/{relative}"
                item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
                destination_dir = self.bin / item_id
                destination_dir.mkdir(mode=0o750)
                self.write_json(destination_dir / "manifest.json", {
                    "id": item_id,
                    "file_name": source.name,
                    "folder": source.parent.relative_to(self.media_root).as_posix(),
                    "channel_name": f"Adult TV · {title}",
                    "adult_series_id": series_id,
                    "adult_series_state": series_state,
                    "adult_series_episode_state": states["episodes"].get(key, {}),
                })
                try:
                    shutil.move(str(source), str(destination_dir / source.name))
                except Exception:
                    shutil.rmtree(destination_dir, ignore_errors=True)
                    raise
                moved += 1
                moved_keys.append(key)

            for key in moved_keys:
                states["episodes"].pop(key, None)
            if scope == "series":
                states["series"].pop(series_id, None)
            self.write_adult_series_states(states)
            for directory in sorted(
                    (item for item in root.rglob("*") if item.is_dir()),
                    key=lambda item: len(item.parts), reverse=True):
                if not any(directory.iterdir()):
                    directory.rmdir()
            if scope == "series" and root.is_dir() and not any(root.iterdir()):
                root.rmdir()
            return moved

    def remote_resume_position(self, library_id: str, media_state: dict[str, Any]) -> float:
        """Use the position from the most recently active film session.

        An already-running TV and browser player never read this value again,
        so neither session can make the other one jump.  This choice is only
        applied the next time the film is opened.
        """
        candidates: list[tuple[float, float]] = []
        try:
            candidates.append((
                float(media_state.get("remote_last_watched", 0) or 0),
                float(media_state.get("remote_position", 0) or 0),
            ))
        except (TypeError, ValueError):
            pass
        player_state = self.read_json(self.player_state_path, {})
        if isinstance(player_state, dict):
            positions = player_state.get("adult_positions", {})
            if isinstance(positions, dict):
                try:
                    player_position = float(positions.get(library_id, 0) or 0)
                    ignored = float(media_state.get("ignored_player_position", -1) or -1)
                    # Starting over in a browser must also suppress the older
                    # on-TV bookmark.  Accept that TV bookmark again as soon
                    # as the television genuinely moves to a different point.
                    if ignored < 0 or abs(player_position - ignored) > 5:
                        updates = player_state.get("adult_position_updated_utc_ms", {})
                        updated = float(updates.get(library_id, 0) or 0) / 1000.0 \
                            if isinstance(updates, dict) else 0.0
                        candidates.append((updated, player_position))
                except (TypeError, ValueError):
                    pass
        valid = [(updated, position) for updated, position in candidates if position >= 0]
        timestamped = [item for item in valid if item[0] > 0]
        # State written by an older player has no per-film timestamp. Preserve
        # the established furthest-position fallback until that player next
        # receives this additive state field.
        position = max(timestamped, key=lambda item: item[0])[1] \
            if timestamped and len(timestamped) == len(valid) \
            else max([item[1] for item in valid] or [0])
        duration = self.remote_resume_duration(library_id, media_state)
        return self.normalise_resume_position(position, duration)

    def remote_last_watched(self, library_id: str,
                            media_state: dict[str, Any]) -> float:
        """Return the newest activity timestamp across TV and browser players."""
        try:
            browser_updated = max(
                0.0, float(media_state.get("remote_last_watched", 0) or 0))
        except (TypeError, ValueError):
            browser_updated = 0.0
        player_state = self.read_json(self.player_state_path, {})
        updates = player_state.get("adult_position_updated_utc_ms", {}) \
            if isinstance(player_state, dict) else {}
        try:
            tv_updated = max(0.0, float(updates.get(library_id, 0) or 0) / 1000.0) \
                if isinstance(updates, dict) else 0.0
        except (TypeError, ValueError):
            tv_updated = 0.0
        return max(browser_updated, tv_updated)

    def remote_resume_duration(self, library_id: str,
                               media_state: dict[str, Any]) -> float:
        """Use duration learned from either the television or the browser."""
        candidates: list[float] = []
        try:
            candidates.append(float(media_state.get("remote_duration", 0) or 0))
        except (TypeError, ValueError):
            pass
        player_state = self.read_json(self.player_state_path, {})
        durations = player_state.get("adult_durations", {}) \
            if isinstance(player_state, dict) else {}
        if isinstance(durations, dict):
            try:
                candidates.append(float(durations.get(library_id, 0) or 0))
            except (TypeError, ValueError):
                pass
        return max([value for value in candidates if value >= 0] or [0])

    @staticmethod
    def normalise_resume_position(position: float, duration: float) -> float:
        """Keep only meaningful in-progress positions.

        The start threshold lets a deliberate restart clear Continue Watching.
        At the other end, the final five percent (at least three minutes) is
        treated as credits/completion because TMDB does not publish a reliable
        per-film credits timestamp.
        """
        if position < REMOTE_RESUME_MIN_SECONDS:
            return 0.0
        if duration > 0:
            completion_window = max(
                REMOTE_COMPLETION_MIN_SECONDS,
                duration * REMOTE_COMPLETION_FRACTION,
            )
            completion_window = min(completion_window, duration * 0.20)
            if position >= max(0.0, duration - completion_window):
                return 0.0
        return position

    @staticmethod
    def remote_browser_ready(source: Path) -> bool:
        return source.suffix.lower() in REMOTE_BROWSER_EXTENSIONS

    def remote_tv_running(self) -> bool:
        state = self.read_json(self.player_state_path, {})
        return isinstance(state, dict) and state.get("standby") is not True

    def remote_settings(self) -> dict[str, Any]:
        settings = self.settings()
        return {"allow_simultaneous": settings.get("remote_allow_simultaneous") is True,
                "tv_running": self.remote_tv_running(),
                "active": self.remote_stream_status()}

    def remote_stream_status(self) -> dict[str, Any] | None:
        with self.remote_stream_lock:
            if not self.remote_stream:
                return None
            if float(self.remote_stream.get("expires", 0)) <= time.time():
                self.remote_stream = None
                return None
            return {"kind": self.remote_stream["kind"],
                    "title": self.remote_stream["title"]}

    def remote_source(self, payload: dict[str, Any]) -> tuple[str, Path, str, str | None, float]:
        kind = str(payload.get("kind", ""))
        if kind == "adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Adult film is no longer in the library")
            relative = self.adult_relative_path(source)
            state = self.adult_media_states().get(relative, {})
            library_id = state.get("library_id") if isinstance(state, dict) else None
            if not isinstance(library_id, str):
                # Give old libraries a stable ID before opening a browser stream.
                self.adult_library()
                state = self.adult_media_states().get(relative, {})
                library_id = state.get("library_id") if isinstance(state, dict) else None
            resume = self.remote_resume_position(str(library_id or ""), state if isinstance(state, dict) else {})
            return kind, source, self.display_name(source.name), str(library_id or ""), resume
        if kind == "adult-series":
            series_id = str(payload.get("series", ""))
            source = self.adult_series_path(series_id, str(payload.get("file", "")))
            if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                raise ValueError("That Adult TV episode is no longer in the library")
            relative = source.relative_to(self.adult_series_root / series_id).as_posix()
            key = f"{series_id}/{relative}"
            state = self.adult_series_states()["episodes"].get(key, {})
            if not isinstance(state, dict):
                state = {}
            library_id = str(state.get("library_id") or "")
            resume = self.normalise_resume_position(
                float(state.get("remote_position", 0) or 0),
                float(state.get("remote_duration", 0) or 0))
            parsed = self.adult_episode_identity(source)
            metadata = state.get("metadata", {})
            title = str(metadata.get("title") or parsed["title"]) \
                if isinstance(metadata, dict) else parsed["title"]
            return kind, source, title, library_id, resume
        if kind == "channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid Mabel TV programme") from None
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Mabel TV programme is no longer in the library")
            if self.channel_content_type(channel) == "films":
                channel_number = int(channel["number"])
                resume = self.channel_film_resume_state(channel_number, source.name)
                return (kind, source,
                        self.channel_programme_title(channel_number, source.name),
                        self.channel_programme_key(channel_number, source.name),
                        resume["position"])
            return (kind, source, self.channel_programme_title(
                int(channel["number"]), source.name), None, 0)
        if kind == "usb":
            source = self.usb_resolve(
                str(payload.get("volume", "")), str(payload.get("file", "")))
            if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                raise ValueError("That USB video is no longer available")
            return kind, source, self.display_name(source.name), None, 0
        raise ValueError("Choose an Adult film, Mabel TV programme or USB video")

    @staticmethod
    def _source_fingerprint(source: Path) -> str:
        stat = source.stat()
        identity = f"{source.resolve()}\0{stat.st_size}\0{stat.st_mtime_ns}"
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()

    def _cleanup_external_streams_locked(self) -> None:
        now = time.time()
        self.external_streams = {
            token: stream for token, stream in self.external_streams.items()
            if float(stream.get("expires", 0)) > now or int(stream.get("active", 0)) > 0
        }

    def _issue_external_stream(self, kind: str, source: Path, title: str,
                               purpose: str, subtitle_source: Path | None = None,
                               content_id: str | None = None) -> dict[str, Any]:
        if not source.is_file():
            raise ValueError("That video is no longer available")
        lifetime = (EXTERNAL_DOWNLOAD_SESSION_SECONDS
                    if purpose == "offline" else EXTERNAL_VLC_SESSION_SECONDS)
        token = secrets.token_urlsafe(32)
        stream = {
            "token": token, "kind": kind, "source": source, "title": title,
            "purpose": purpose, "lifetime": lifetime,
            "expires": time.time() + lifetime, "active": 0,
        }
        with self.external_stream_lock:
            self._cleanup_external_streams_locked()
            self.external_streams[token] = stream
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        display_stem = SAFE_NAME.sub("", Path(title).stem).strip(". ") or "MabelTV video"
        display_file_name = f"{display_stem}{source.suffix.lower()}"
        subtitle_url = None
        subtitles = None
        if kind in {"adult", "adult-series"}:
            try:
                caption_source = subtitle_source or source
                if purpose == "vlc":
                    self.browser_subtitles_for_source(caption_source)
                    subtitle_url = f"/api/external/subtitles?{urlencode({'stream': token})}"
                elif purpose == "offline":
                    subtitles = self.browser_subtitles_for_source(caption_source).decode("utf-8")
            except ValueError:
                pass
        return {
            "ok": True, "status": "ready", "title": title,
            "file_name": display_file_name, "size": source.stat().st_size,
            "mime_type": content_type,
            "content_id": content_id or self._source_fingerprint(source),
            "stream": token,
            "stream_url": f"/api/{'offline' if purpose == 'offline' else 'external'}/media?"
                          + urlencode({"stream": token}),
            "subtitle_url": subtitle_url,
            "subtitles": subtitles,
        }

    def start_external_stream(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind, source, title, _library_id, _resume = self.remote_source(payload)
        return self._issue_external_stream(kind, source, title, "vlc")

    def external_stream_session(self, token: str, begin: bool = False) -> dict[str, Any]:
        with self.external_stream_lock:
            self._cleanup_external_streams_locked()
            stream = self.external_streams.get(token)
            if not stream or not secrets.compare_digest(str(stream.get("token", "")), token):
                raise ValueError("That external playback link has expired")
            source = Path(stream.get("source", ""))
            usb_identity = self._usb_identity_for_source(source)
            if usb_identity:
                self.usb_ensure_awake(usb_identity)
            if not source.is_file():
                self.external_streams.pop(token, None)
                raise ValueError("That video is no longer available")
            stream["expires"] = time.time() + int(stream.get("lifetime", 0))
            if begin:
                stream["active"] = int(stream.get("active", 0)) + 1
            return stream.copy()

    def finish_external_request(self, token: str) -> None:
        with self.external_stream_lock:
            stream = self.external_streams.get(token)
            if stream:
                stream["active"] = max(0, int(stream.get("active", 0)) - 1)
                usb_identity = self._usb_identity_for_source(Path(stream.get("source", "")))
                if usb_identity:
                    self.usb_touch(usb_identity)

    def release_external_stream(self, token: str) -> dict[str, Any]:
        with self.external_stream_lock:
            stream = self.external_streams.pop(token, None)
        if stream:
            usb_identity = self._usb_identity_for_source(Path(stream.get("source", "")))
            if usb_identity:
                self.usb_touch(usb_identity)
        return {"ok": True}

    def external_subtitles(self, token: str) -> bytes:
        stream = self.external_stream_session(token)
        if stream.get("kind") not in {"adult", "adult-series"}:
            raise ValueError("That video has no external subtitle track")
        return self.browser_subtitles_for_source(Path(stream["source"]))

    def offline_media_profile(self, source: Path) -> str:
        """Return direct, repack, audio, or convert for dependable iPhone playback."""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries",
                 "stream=codec_type,codec_name", "-of", "json", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            streams = json.loads(result.stdout).get("streams", [])
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError) as error:
            raise ValueError("MabelTV could not inspect that video for offline playback") from error
        video = next((item for item in streams if item.get("codec_type") == "video"), None)
        audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
        if result.returncode != 0 or not video:
            raise ValueError("MabelTV could not find a playable picture in that file")
        video_codec = str(video.get("codec_name", "")).lower()
        audio_codec = str(audio.get("codec_name", "")).lower() if audio else ""
        suffix = source.suffix.lower()
        apple_container = suffix in {".mp4", ".m4v", ".mov"}
        apple_video = video_codec in {"h264", "hevc"}
        apple_audio = not audio_codec or audio_codec == "aac"
        if apple_container and apple_video and apple_audio:
            return "direct"
        if apple_video and apple_audio:
            return "repack"
        if apple_video:
            return "audio"
        return "convert"

    def _offline_prepared_path(self, job_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{64}", job_id):
            raise ValueError("That offline preparation is not valid")
        return self.offline_cache / f"{job_id}.mp4"

    def _offline_job_response(self, job: dict[str, Any]) -> dict[str, Any]:
        return {key: job[key] for key in
                ("id", "status", "title", "preparation", "message") if key in job}

    def start_offline_download(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind, source, title, _library_id, _resume = self.remote_source(payload)
        preparation = self.offline_media_profile(source)
        if preparation == "direct":
            return self._issue_external_stream(kind, source, title, "offline")
        job_id = self._source_fingerprint(source)
        destination = self._offline_prepared_path(job_id)
        if destination.is_file():
            destination.touch()
            return self._issue_external_stream(
                kind, destination, title, "offline", source, job_id)
        with self.offline_preparation_lock:
            existing = self.offline_preparations.get(job_id)
            if existing and existing.get("status") in {"preparing", "queued"}:
                return self._offline_job_response(existing)
            reserve = min(source.stat().st_size, 8 * 1024 * 1024 * 1024) + 512 * 1024 * 1024
            if shutil.disk_usage(self.media_root).free < reserve:
                raise ValueError("There is not enough Pi storage to prepare this video for offline viewing")
            descriptions = {
                "repack": "Quickly repackaging this video for iPhone",
                "audio": "Preparing iPhone-compatible sound without changing the picture",
                "convert": "Converting this video for dependable offline playback",
            }
            job = {
                "id": job_id, "status": "queued", "kind": kind,
                "source": source, "destination": destination, "title": title,
                "preparation": preparation, "message": descriptions[preparation],
            }
            self.offline_preparations[job_id] = job
        threading.Thread(target=self._run_offline_preparation, args=(job_id,),
                         name=f"mabeltv-offline-{job_id[:8]}", daemon=True).start()
        return self._offline_job_response(job)

    def _run_offline_preparation(self, job_id: str) -> None:
        with self.offline_preparation_lock:
            job = self.offline_preparations[job_id]
            job["status"] = "preparing"
            source = Path(job["source"])
            destination = Path(job["destination"])
            preparation = str(job["preparation"])
        temporary = self.offline_cache / f".{job_id}.part.mp4"
        log_path = self.offline_cache / f".{job_id}.ffmpeg.log"
        try:
            with self.adult_optimisation_serial:
                if not source.is_file():
                    raise ValueError("The original video is no longer available")
                if preparation == "convert":
                    self._convert_for_offline_playback(source, destination, job_id)
                else:
                    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                               "-y", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
                               "-sn", "-c:v", "copy", "-c:a",
                               "copy" if preparation == "repack" else "aac"]
                    if preparation == "audio":
                        command += ["-b:a", "160k"]
                    command += ["-movflags", "+faststart", str(temporary)]
                    with log_path.open("wb") as errors:
                        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=errors,
                                                timeout=45 * 60, check=False)
                    if result.returncode != 0:
                        raise ValueError("MabelTV could not prepare that video for iPhone")
                    if self.offline_media_profile(temporary) != "direct":
                        raise ValueError("The prepared video did not pass its iPhone playback check")
                    os.replace(temporary, destination)
            with self.offline_preparation_lock:
                job["status"] = "ready"
                job["message"] = "Ready to download"
        except Exception as error:
            with self.offline_preparation_lock:
                job["status"] = "error"
                job["message"] = (str(error) if isinstance(error, ValueError)
                                  else "MabelTV could not prepare that video")
        finally:
            temporary.unlink(missing_ok=True)
            log_path.unlink(missing_ok=True)

    def _convert_for_offline_playback(self, source: Path, destination: Path,
                                      job_id: str) -> None:
        """Create an iPhone-safe copy quickly, without upscaling small USB videos."""
        temporary = self.offline_cache / f".{job_id}.part.mp4"
        error_log = self.offline_cache / f".{job_id}.ffmpeg.log"
        try:
            duration_result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            duration = max(0.0, float(duration_result.stdout.strip()))
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            duration = 0.0
        command = [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-threads", "2", "-filter_threads", "2", "-i", str(source),
            "-map", "0:v:0", "-map", "0:a:0?", "-sn",
            "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':"
                   "force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-c:v", "libx264", "-preset", "ultrafast", "-profile:v", "main",
            "-level:v", "3.1", "-crf", "23", "-maxrate", "2500k",
            "-bufsize", "5000k", "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-b:a", "128k", "-movflags", "+faststart", "-progress", "pipe:1",
            "-nostats", str(temporary),
        ]
        process: subprocess.Popen[str] | None = None
        deadline = time.monotonic() + 45 * 60
        last_percent = -1
        try:
            with error_log.open("wb") as errors:
                process = subprocess.Popen(
                    command, stdout=subprocess.PIPE, stderr=errors, text=True,
                    start_new_session=True)
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        os.killpg(process.pid, signal.SIGTERM)
                        raise ValueError("MabelTV stopped this conversion because it took too long")
                    line = process.stdout.readline() if process.stdout else ""
                    if not line.startswith(("out_time_us=", "out_time_ms=")) or duration <= 0:
                        continue
                    try:
                        completed = float(line.split("=", 1)[1].strip()) / 1_000_000
                    except (TypeError, ValueError):
                        continue
                    percent = min(99, max(0, int(completed * 100 / duration)))
                    if percent < last_percent + 2:
                        continue
                    last_percent = percent
                    with self.offline_preparation_lock:
                        job = self.offline_preparations.get(job_id)
                        if job:
                            job["message"] = f"Converting for offline playback · {percent}%"
                if process.returncode != 0:
                    details = error_log.read_text(encoding="utf-8", errors="replace").strip()
                    if details:
                        print(details[-4000:], file=sys.stderr, flush=True)
                    raise ValueError("MabelTV could not convert that video for offline playback")
            if self.offline_media_profile(temporary) != "direct":
                raise ValueError("The converted video did not pass its iPhone playback check")
            os.replace(temporary, destination)
        finally:
            if process is not None and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
            temporary.unlink(missing_ok=True)
            error_log.unlink(missing_ok=True)

    def offline_preparation_status(self, job_id: str) -> dict[str, Any]:
        with self.offline_preparation_lock:
            job = self.offline_preparations.get(job_id)
            if not job:
                destination = self._offline_prepared_path(job_id)
                if destination.is_file():
                    raise ValueError("Open the video again to resume its download")
                raise ValueError("That offline preparation is no longer available")
            snapshot = job.copy()
        if snapshot.get("status") == "ready":
            destination = Path(snapshot["destination"])
            destination.touch()
            return self._issue_external_stream(
                str(snapshot["kind"]), destination, str(snapshot["title"]), "offline",
                Path(snapshot["source"]), job_id)
        return self._offline_job_response(snapshot)

    def start_remote_stream(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind, source, title, library_id, resume = self.remote_source(payload)
        if "position" in payload:
            try:
                resume = max(0.0, float(payload.get("position", 0)))
            except (TypeError, ValueError) as error:
                raise ValueError("That playback position is not valid") from error
        if not self.remote_browser_ready(source):
            raise ValueError("This file is not browser-ready. Use an MP4 or M4V version for remote viewing.")
        settings = self.remote_settings()
        if settings["tv_running"] and not settings["allow_simultaneous"]:
            raise RemoteTvActiveError("Mabel TV is playing. Stop it first, or allow simultaneous playback in Settings.")
        with self.remote_stream_lock:
            # The portal deliberately supports one remote viewer. Selecting a
            # different title in that viewer must replace its previous stream;
            # otherwise a missed pagehide/sendBeacon leaves the entire Watch
            # section locked until the session timeout expires.
            token = secrets.token_urlsafe(24)
            self.remote_stream = {"token": token, "kind": kind, "source": source,
                                  "title": title, "library_id": library_id,
                                  "expires": time.time() + REMOTE_SESSION_SECONDS}
            if kind == "channel":
                channel_number = int(payload.get("channel", 0))
                channel = self.channel(channel_number)
                self.remote_stream.update({
                    "channel": channel_number, "file": source.name,
                    "content_kind": "film" if self.channel_content_type(channel) == "films"
                    else "episode",
                })
        base = urlencode({"stream": token})
        subtitle_url = None
        if kind in {"adult", "adult-series"}:
            browser_sidecars = [path for path in self.subtitle_sidecars(source)
                                if path.suffix.lower() in {".vtt", ".srt"}]
            if browser_sidecars:
                subtitle_url = f"/api/remote/subtitles?{base}"
        return {"ok": True, "title": title, "kind": kind,
                "resume_enabled": bool(library_id) or "position" in payload,
                "resume_position": resume,
                "stream_url": f"/api/remote/media?{base}",
                # The browser attaches this only after the video itself has
                # reached canplay. That keeps iOS source negotiation isolated
                # from the external text track while still exposing native CC.
                "subtitle_url": subtitle_url}

    def remote_session(self, token: str) -> dict[str, Any]:
        with self.remote_stream_lock:
            current = self.remote_stream
            if not current:
                raise ValueError("That remote viewing session has expired")
            if float(current.get("expires", 0)) <= time.time():
                self.remote_stream = None
                raise ValueError("That remote viewing session has expired")
            # A late media/range/heartbeat request from the previous page must
            # never erase the replacement stream that is now active.
            if not secrets.compare_digest(str(current.get("token", "")), token):
                raise ValueError("That remote viewing session has expired")
            current["expires"] = time.time() + REMOTE_SESSION_SECONDS
            return current.copy()

    def remote_stop_tv(self) -> dict[str, Any]:
        if not self.remote_tv_running():
            return {"ok": True, "message": "Mabel TV is already off"}
        self.live_tv_control({"command": "turn-off"})
        return {"ok": True, "message": "Mabel TV has been stopped for remote viewing"}

    def remote_release(self, token: str) -> dict[str, Any]:
        with self.remote_stream_lock:
            if self.remote_stream and secrets.compare_digest(
                    str(self.remote_stream.get("token", "")), token):
                usb_identity = self._usb_identity_for_source(
                    Path(self.remote_stream.get("source", "")))
                self.remote_stream = None
                if usb_identity:
                    self.usb_touch(usb_identity)
        with self.viewing_lock:
            self.viewing_remote_samples.pop(token, None)
        return {"ok": True}

    def remote_save_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        token = str(payload.get("stream", ""))
        session = self.remote_session(token)
        try:
            position = max(0.0, float(payload.get("position", 0)))
            duration = max(0.0, float(payload.get("duration", 0)))
        except (TypeError, ValueError) as error:
            raise ValueError("That playback position is not valid") from error
        self.record_remote_viewing(session, token, position, duration)
        if not session.get("library_id"):
            return {"ok": True}
        if session["kind"] == "channel":
            command = {
                "command": "save-channel-film-position",
                "channel": int(session["channel"]),
                "file": str(session["file"]),
                "position": self.normalise_resume_position(position, duration),
                "duration": duration,
            }
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(2)
                    client.connect("/run/mabeltv/portal-control.sock")
                    client.sendall((json.dumps(command, separators=(",", ":"))
                                    + "\n").encode())
                    reply = client.recv(32).decode(errors="replace").strip()
            except OSError as error:
                raise ValueError("Mabel TV could not save that film position") from error
            if reply != "ok":
                raise ValueError("Mabel TV could not save that film position")
            return {"ok": True}
        if session["kind"] == "adult-series":
            with self.config_lock:
                states = self.adult_series_states()
                source = Path(session["source"])
                relative = source.relative_to(self.adult_series_root).as_posix()
                state = states["episodes"].get(relative, {})
                if not isinstance(state, dict):
                    state = {}
                saved_position = self.normalise_resume_position(position, duration)
                state.update({
                    "remote_position": saved_position,
                    "remote_duration": duration,
                    "remote_last_watched": time.time(),
                })
                if duration > 0 and position >= duration * .92:
                    state["watched"] = True
                states["episodes"][relative] = state
                self.write_adult_series_states(states)
            return {"ok": True}
        if session["kind"] != "adult":
            return {"ok": True}
        with self.config_lock:
            states = self.adult_media_states()
            relative = self.adult_relative_path(session["source"])
            state = states.get(relative, {})
            if not isinstance(state, dict): state = {}
            saved_position = self.normalise_resume_position(position, duration)
            state["remote_position"] = saved_position
            state["remote_duration"] = duration
            state["remote_last_watched"] = time.time()
            if saved_position == 0:
                player_state = self.read_json(self.player_state_path, {})
                positions = player_state.get("adult_positions", {}) \
                    if isinstance(player_state, dict) else {}
                try:
                    state["ignored_player_position"] = float(
                        positions.get(session["library_id"], 0) or 0)
                except (AttributeError, TypeError, ValueError):
                    state["ignored_player_position"] = 0.0
            else:
                state.pop("ignored_player_position", None)
            states[relative] = state
            self.write_adult_media_states(states)
        return {"ok": True}

    def remote_clear_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Explicitly remove a film from Continue Watching.

        This does not depend on a browser player having opened or managed to
        send its final time update.  The current on-TV bookmark is remembered
        as ignored as well, so an older television position cannot immediately
        put the film back into Continue Watching.
        """
        kind, source, _title, library_id, _resume = self.remote_source(payload)
        if kind != "adult" or not library_id:
            raise ValueError("Choose an Adult film to clear")
        with self.config_lock:
            states = self.adult_media_states()
            relative = self.adult_relative_path(source)
            state = states.get(relative, {})
            if not isinstance(state, dict):
                state = {}
            state["remote_position"] = 0.0
            state["remote_last_watched"] = 0.0
            player_state = self.read_json(self.player_state_path, {})
            positions = player_state.get("adult_positions", {}) \
                if isinstance(player_state, dict) else {}
            try:
                state["ignored_player_position"] = float(
                    positions.get(library_id, 0) or 0)
            except (AttributeError, TypeError, ValueError):
                state["ignored_player_position"] = 0.0
            states[relative] = state
            self.write_adult_media_states(states)
        return {"ok": True}

    def set_favourite(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Persist a portal-only film or series-channel favourite."""
        enabled = payload.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError("Choose whether this film is a favourite")
        kind = str(payload.get("kind", ""))
        if kind == "adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Adult film is no longer in the library")
            relative = self.adult_relative_path(source)
            with self.config_lock:
                states = self.adult_media_states()
                state = states.get(relative, {})
                if not isinstance(state, dict):
                    state = {}
                if not state.get("library_id"):
                    state["library_id"] = uuid.uuid4().hex
                state["favourite"] = enabled
                states[relative] = state
                self.write_adult_media_states(states)
            return {"ok": True, "kind": kind, "file": relative,
                    "favourite": enabled}
        if kind == "channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid Mabel TV film") from None
            if self.channel_content_type(channel) != "films":
                raise ValueError("Only Mabel TV films can be favourites")
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Mabel TV film is no longer in the library")
            key = self.channel_programme_key(int(channel["number"]), source.name)
            with self.config_lock:
                states = self.channel_media_states()
                stored_favourites = states.get("favourites", [])
                favourites = set(stored_favourites) \
                    if isinstance(stored_favourites, list) else set()
                if enabled:
                    favourites.add(key)
                else:
                    favourites.discard(key)
                states.update({"favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
            return {"ok": True, "kind": kind,
                    "channel": int(channel["number"]), "file": source.name,
                    "favourite": enabled}
        if kind == "series-channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid Mabel TV channel") from None
            if self.channel_content_type(channel) != "shows":
                raise ValueError("Only Mabel TV episode channels can be favourites")
            number = int(channel["number"])
            with self.config_lock:
                states = self.channel_media_states()
                stored = states.get("favourite_channels", [])
                favourites = {
                    int(value) for value in stored
                    if isinstance(value, int)
                    or (isinstance(value, str) and value.isdigit())
                } if isinstance(stored, list) else set()
                if enabled:
                    favourites.add(number)
                else:
                    favourites.discard(number)
                states.update({"favourite_channels": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
            return {"ok": True, "kind": kind, "channel": number,
                    "favourite": enabled}
        if kind == "adult-series":
            series_id = str(payload.get("series", ""))
            self.adult_series_path(series_id)
            with self.config_lock:
                states = self.adult_series_states()
                series = states["series"].get(series_id)
                if not isinstance(series, dict):
                    raise ValueError("That Adult TV series is no longer available")
                series["favourite"] = enabled
                states["series"][series_id] = series
                self.write_adult_series_states(states)
            return {"ok": True, "kind": kind, "series": series_id,
                    "favourite": enabled}
        raise ValueError(
            "Choose an Adult TV film, Adult TV series, Mabel TV film, or episode channel")

    def remote_subtitles(self, token: str) -> bytes:
        session = self.remote_session(token)
        if session["kind"] not in {"adult", "adult-series"}:
            raise ValueError("This Mabel TV programme has no browser subtitle track")
        return self.browser_subtitles_for_source(session["source"])

    def browser_subtitles_for_source(self, source: Path) -> bytes:
        sidecars = self.subtitle_sidecars(source)
        preferred = next((path for path in sidecars if path.suffix.lower() == ".vtt"), None)
        preferred = preferred or next((path for path in sidecars if path.suffix.lower() == ".srt"), None)
        if not preferred:
            raise ValueError("No browser subtitle track is available for this film")
        text = preferred.read_text(encoding="utf-8-sig", errors="replace")
        if not text.lstrip().startswith("WEBVTT"):
            text = "WEBVTT\n\n" + re.sub(r"(\d\d:\d\d:\d\d),(\d{3})", r"\1.\2", text)
        return text.encode("utf-8")

    @staticmethod
    def usb_identity(value: str) -> str:
        identity = re.sub(r"[^A-Za-z0-9._-]", "", value)
        if not identity or identity != value:
            raise ValueError("That USB drive identity is not valid")
        return identity

    def usb_mount_path(self, identity: str) -> Path:
        path = self.usb_root / self.usb_identity(identity)
        try:
            resolved = path.resolve(strict=True)
        except OSError as error:
            raise ValueError("That USB drive is not mounted") from error
        if (resolved.parent != self.usb_root or not resolved.is_dir()
                or (self.usb_requires_mount and not resolved.is_mount())):
            raise ValueError("That USB drive is not mounted")
        return resolved

    @staticmethod
    def _flatten_lsblk(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
        flattened: list[dict[str, Any]] = []
        for value in values:
            flattened.append(value)
            children = value.get("children", [])
            if isinstance(children, list):
                flattened.extend(Library._flatten_lsblk(children))
        return flattened

    def usb_touch(self, identity: str, when: float | None = None) -> None:
        """Record real USB use so standby starts one minute after it finishes."""
        identity = self.usb_identity(identity)
        with self.usb_power_lock:
            self.usb_last_activity[identity] = time.time() if when is None else when
            self.usb_sleeping.discard(identity)

    def _usb_identity_for_source(self, source: Path) -> str | None:
        try:
            relative = source.resolve(strict=False).relative_to(self.usb_root)
        except (OSError, ValueError):
            return None
        return relative.parts[0] if relative.parts else None

    def _usb_source_matches(self, source: Path, identity: str) -> bool:
        return self._usb_identity_for_source(source) == identity

    def _usb_volume(self, identity: str) -> dict[str, Any]:
        identity = self.usb_identity(identity)
        volume = next((item for item in self.usb_volumes()["volumes"]
                       if item.get("id") == identity), None)
        if not volume:
            raise ValueError("That USB drive is no longer connected")
        return volume

    @staticmethod
    def _run_usb_helper(action: str, device: str, timeout: float = 30.0) -> str:
        result = subprocess.run(
            ["sudo", "-n", "/usr/local/libexec/mabeltv-admin-action", action, device],
            capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            fallback = {
                "usb-mount": "The USB drive could not be opened",
                "usb-sleep": "The USB drive could not enter sleep mode",
                "usb-eject": "The USB drive could not be fully ejected",
            }.get(action, "The USB drive action did not complete")
            raise ValueError(result.stderr.strip() or fallback)
        return result.stdout.strip()

    def usb_busy_reason(self, identity: str, include_processes: bool = True) -> str | None:
        """Return why a drive must stay awake, or None when standby is safe."""
        identity = self.usb_identity(identity)
        with self.usb_import_lock:
            if any(job.get("volume") == identity
                   and job.get("status") not in {"complete", "error"}
                   for job in self.usb_imports.values()):
                return "Wait for the USB import to finish"
        with self.remote_stream_lock:
            stream = self.remote_stream
            if stream and float(stream.get("expires", 0)) > time.time() \
                    and self._usb_source_matches(Path(stream.get("source", "")), identity):
                return "Stop watching the USB video on this device"
        with self.external_stream_lock:
            self._cleanup_external_streams_locked()
            for stream in self.external_streams.values():
                if int(stream.get("active", 0)) > 0 \
                        and self._usb_source_matches(Path(stream.get("source", "")), identity):
                    return "Wait for phone playback or downloading to finish"
        with self.offline_preparation_lock:
            for job in self.offline_preparations.values():
                if job.get("status") in {"queued", "preparing"} \
                        and self._usb_source_matches(Path(job.get("source", "")), identity):
                    return "Wait for offline preparation to finish"
        mount_path = self.usb_root / identity
        if include_processes and self.usb_requires_mount and mount_path.is_mount():
            try:
                in_use = subprocess.run(
                    ["fuser", "-m", str(mount_path)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=3, check=False).returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                # A failed inspection must never make automatic unmounting less safe.
                return "The USB drive activity could not be checked"
            if in_use:
                return "Stop the video currently playing from this USB drive"
        return None

    def usb_sleep(self, identity: str, automatic: bool = False) -> dict[str, Any]:
        identity = self.usb_identity(identity)
        with self.usb_action_lock:
            volume = self._usb_volume(identity)
            reason = self.usb_busy_reason(identity, include_processes=bool(volume.get("mounted")))
            if reason:
                if automatic:
                    self.usb_touch(identity)
                    return {"ok": False, "busy": True, "message": reason}
                raise ValueError(f"{reason} before putting the drive to sleep")
            message = self._run_usb_helper("usb-sleep", str(volume.get("device", "")))
            with self.usb_power_lock:
                self.usb_sleeping.add(identity)
                self.usb_last_activity.pop(identity, None)
        return {"ok": True, "sleeping": True, "message": message}

    def usb_power_tick(self, now: float | None = None) -> None:
        """Put every connected drive into standby after one idle minute."""
        current = time.time() if now is None else now
        volumes = self.usb_volumes()["volumes"]
        present = {str(volume.get("id", "")) for volume in volumes}
        with self.usb_power_lock:
            self.usb_sleeping.intersection_update(present)
            self.usb_last_activity = {
                identity: last for identity, last in self.usb_last_activity.items()
                if identity in present
            }
            for identity in present:
                if identity and identity not in self.usb_sleeping:
                    self.usb_last_activity.setdefault(identity, current)
            due = [volume for volume in volumes
                   if str(volume.get("id", "")) not in self.usb_sleeping
                   and current - self.usb_last_activity.get(
                       str(volume.get("id", "")), current) >= self.usb_idle_seconds]
        for volume in due:
            identity = str(volume.get("id", ""))
            try:
                self.usb_sleep(identity, automatic=True)
            except (OSError, subprocess.TimeoutExpired, ValueError) as error:
                self.usb_touch(identity, current)
                print(f"USB automatic sleep failed for {identity}: {error}", file=sys.stderr)

    def run_usb_power_worker(self) -> None:
        interval = min(USB_POWER_POLL_SECONDS, max(1.0, self.usb_idle_seconds / 4))
        while not self.usb_power_closed.wait(interval):
            try:
                self.usb_power_tick()
            except Exception as error:
                print(f"USB power manager failed: {error}", file=sys.stderr)

    def usb_volumes(self) -> dict[str, Any]:
        volumes: list[dict[str, Any]] = []
        seen: set[str] = set()
        try:
            result = subprocess.run([
                "lsblk", "--json", "--bytes", "-o",
                "NAME,PATH,LABEL,MODEL,UUID,FSTYPE,SIZE,TYPE,RM,TRAN,MOUNTPOINTS,PKNAME",
            ], capture_output=True, text=True, check=True, timeout=5)
            devices = self._flatten_lsblk(json.loads(result.stdout).get("blockdevices", []))
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
            devices = []
        parents = {str(item.get("name", "")): item for item in devices}
        # USB hard disks commonly report RM=0 even though they are genuinely
        # external.  Transport is the useful boundary here.  Exclude an entire
        # parent disk if any of its partitions backs the running system so a
        # USB-booted Pi can never offer its own boot drive in the portal.
        system_parents = {
            str(item.get("pkname", ""))
            for item in devices
            if item.get("type") == "part"
            and any(str(point) == "/" or str(point).startswith("/boot")
                    for point in (item.get("mountpoints") or []) if point)
        }
        for item in devices:
            if item.get("type") != "part":
                continue
            parent = parents.get(str(item.get("pkname", "")), {})
            if (str(parent.get("tran", "")) != "usb"
                    or str(item.get("pkname", "")) in system_parents):
                continue
            device = str(item.get("path", ""))
            raw_identity = str(item.get("uuid") or Path(device).name)
            identity = re.sub(r"[^A-Za-z0-9._-]", "", raw_identity)
            if not identity or identity in seen:
                continue
            seen.add(identity)
            mountpoints = item.get("mountpoints") or []
            if isinstance(mountpoints, str):
                mountpoints = [mountpoints]
            expected = self.usb_root / identity
            mounted = any(Path(str(point)).resolve() == expected
                          for point in mountpoints if point)
            volumes.append({
                "id": identity,
                "device": device,
                "label": str(item.get("label") or parent.get("model") or "USB drive").strip(),
                "filesystem": str(item.get("fstype") or "unknown"),
                "size": int(item.get("size") or 0),
                "mounted": mounted and expected.is_dir(),
            })
        # Test/development mounts can exist without a real lsblk device.
        if not self.usb_requires_mount and self.usb_root.is_dir():
            for path in self.usb_root.iterdir():
                if path.is_dir() and path.name not in seen:
                    volumes.append({"id": path.name, "device": "", "label": path.name,
                                    "filesystem": "directory", "size": 0, "mounted": True})
        with self.usb_power_lock:
            for volume in volumes:
                volume["sleeping"] = volume["id"] in self.usb_sleeping
        volumes.sort(key=lambda value: (not value["mounted"], value["label"].lower()))
        with self.usb_import_lock:
            jobs = [dict(job) for job in self.usb_imports.values()
                    if job.get("status") not in {"complete", "error"}]
        return {"volumes": volumes, "imports": jobs}

    def usb_resolve(self, identity: str, relative: str = "") -> Path:
        root = self.usb_ensure_awake(identity)
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("That USB path is not valid")
        candidate = root.joinpath(relative_path)
        try:
            resolved = candidate.resolve(strict=True)
        except OSError as error:
            raise ValueError("That item is no longer on the USB drive") from error
        if resolved != root and root not in resolved.parents:
            raise ValueError("That USB path is not valid")
        return resolved

    def usb_browse(self, identity: str, relative: str = "") -> dict[str, Any]:
        directory = self.usb_resolve(identity, relative)
        root = self.usb_mount_path(identity)
        if not directory.is_dir():
            raise ValueError("Choose a folder on the USB drive")
        entries: list[dict[str, Any]] = []
        for item in sorted(directory.iterdir(), key=lambda path: (not path.is_dir(), path.name.lower())):
            if (item.is_symlink() or item.name.startswith(".")
                    or item.name.casefold() in {"$recycle.bin", "system volume information", "lost+found"}):
                continue
            is_directory = item.is_dir()
            if not is_directory and (not item.is_file()
                                     or item.suffix.lower() not in SUPPORTED_EXTENSIONS):
                continue
            child_relative = item.relative_to(root).as_posix()
            entries.append({
                "name": item.name,
                "path": child_relative,
                "type": "folder" if is_directory else "video",
                "size": 0 if is_directory else item.stat().st_size,
                "browser_ready": is_directory or self.remote_browser_ready(item),
            })
            if len(entries) >= 500:
                break
        parent = Path(relative).parent.as_posix() if relative else ""
        if parent == ".":
            parent = ""
        return {"volume": identity, "path": Path(relative).as_posix() if relative else "",
                "parent": parent, "entries": entries, "truncated": len(entries) >= 500}

    def usb_mount(self, device: str) -> dict[str, Any]:
        if not re.fullmatch(r"/dev/sd[a-z][0-9]+", device):
            raise ValueError("Choose a removable USB partition")
        with self.usb_action_lock:
            self._run_usb_helper("usb-mount", device)
            result = self.usb_volumes()
            mounted = next((volume for volume in result["volumes"]
                            if volume.get("device") == device and volume.get("mounted")), None)
            if not mounted:
                raise ValueError("The USB drive did not become ready in time")
            self.usb_touch(str(mounted["id"]))
            mounted["sleeping"] = False
            return result

    def usb_ensure_awake(self, identity: str) -> Path:
        identity = self.usb_identity(identity)
        try:
            root = self.usb_mount_path(identity)
            self.usb_touch(identity)
            return root
        except ValueError:
            if not self.usb_requires_mount:
                raise
        volume = self._usb_volume(identity)
        self.usb_mount(str(volume.get("device", "")))
        return self.usb_mount_path(identity)

    def usb_eject(self, identity: str) -> dict[str, Any]:
        identity = self.usb_identity(identity)
        with self.usb_action_lock:
            volume = self._usb_volume(identity)
            reason = self.usb_busy_reason(
                identity, include_processes=bool(volume.get("mounted")))
            if reason:
                raise ValueError(f"{reason} before fully ejecting the drive")
            message = self._run_usb_helper("usb-eject", str(volume.get("device", "")))
            with self.usb_power_lock:
                self.usb_sleeping.discard(identity)
                self.usb_last_activity.pop(identity, None)
        return {"ok": True, "message": message}

    def usb_play(self, identity: str, relative: str) -> dict[str, Any]:
        source = self.usb_resolve(identity, relative)
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("Choose a supported video to play")
        command = json.dumps({"command": "play-external", "path": str(source),
                              "title": self.display_name(source.name)}, separators=(",", ":"))
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall((command + "\n").encode())
                reply = client.recv(32).decode(errors="replace").strip()
        except OSError as error:
            raise ValueError("The TV player is not ready for USB playback") from error
        if reply != "ok":
            raise ValueError("The TV could not start that USB video")
        self.usb_touch(identity)
        return {"ok": True, "message": f"Playing {self.display_name(source.name)} from USB"}

    def _usb_selected_files(self, identity: str, selected: list[Any]) -> list[Path]:
        files: list[Path] = []
        for raw in selected:
            item = self.usb_resolve(identity, str(raw))
            candidates = [item] if item.is_file() else sorted(item.rglob("*"))
            for candidate in candidates:
                if candidate.is_symlink() or not candidate.is_file() \
                        or candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                files.append(candidate)
                if len(files) > USB_MAX_SELECTION_FILES:
                    raise ValueError("Choose fewer than 2,000 videos at a time")
        unique = list(dict.fromkeys(files))
        if not unique:
            raise ValueError("Choose at least one video or folder to import")
        return unique

    def _usb_series_selected_files(
            self, identity: str, selected: list[Any]) -> list[tuple[Path, Path]]:
        values: list[tuple[Path, Path]] = []
        for raw in selected:
            item = self.usb_resolve(identity, str(raw))
            if item.is_file():
                candidates = [(item, Path(item.name))]
            else:
                prefix = Path(item.name) if re.search(
                    r"(?i)\b(?:series|season)\s*\d+\b", item.name) else Path()
                candidates = [
                    (candidate, prefix / candidate.relative_to(item))
                    for candidate in sorted(item.rglob("*"))
                    if candidate.is_file()
                ]
            for candidate, relative in candidates:
                if candidate.is_symlink() or candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                clean_parts = [
                    SAFE_NAME.sub("", part).strip(". ") or "Episode"
                    for part in relative.parts
                ]
                values.append((candidate, Path(*clean_parts)))
                if len(values) > USB_MAX_SELECTION_FILES:
                    raise ValueError("Choose fewer than 2,000 episodes at a time")
        unique: dict[Path, Path] = {}
        for source, relative in values:
            unique.setdefault(source, relative)
        if not unique:
            raise ValueError("Choose at least one episode or series folder")
        return list(unique.items())

    @staticmethod
    def unique_destination(folder: Path, name: str) -> Path:
        clean = SAFE_NAME.sub("", Path(name).stem).strip(". ") or "USB video"
        suffix = Path(name).suffix.lower()
        destination = folder / f"{clean}{suffix}"
        index = 2
        while destination.exists() or destination.with_name(destination.name + ".part").exists():
            destination = folder / f"{clean} ({index}){suffix}"
            index += 1
        return destination

    def start_usb_import(self, payload: dict[str, Any]) -> dict[str, Any]:
        identity = self.usb_identity(str(payload.get("volume", "")))
        selected = payload.get("paths")
        if not isinstance(selected, list):
            raise ValueError("Choose the USB videos to import")
        target = str(payload.get("target", ""))
        channel_number: int | None = None
        relative_destinations: dict[Path, Path] | None = None
        if target == "adult":
            files = self._usb_selected_files(identity, selected)
            destination_root = self.adult_root
        elif target == "series":
            pairs = self._usb_series_selected_files(identity, selected)
            requested_title = str(payload.get("series_name", "")).strip()
            if not requested_title and len(selected) == 1:
                requested_title = self.usb_resolve(identity, str(selected[0])).stem
            series_id = self.create_adult_series(requested_title)
            destination_root = self.adult_series_root / series_id
            files = [source for source, _relative in pairs]
            relative_destinations = dict(pairs)
        elif target == "channel":
            files = self._usb_selected_files(identity, selected)
            channel_number = int(payload.get("channel"))
            channel = self.channel(channel_number)
            destination_root = self.media_root / str(channel["folder"])
        else:
            raise ValueError("Choose Adult mode or a children’s channel")
        destination_root.mkdir(mode=0o750, exist_ok=True)
        total = sum(path.stat().st_size for path in files)
        if shutil.disk_usage(self.media_root).free < total + USB_IMPORT_RESERVE_BYTES:
            raise ValueError("There is not enough free space to import those USB videos")
        job_id = uuid.uuid4().hex
        job = {"id": job_id, "volume": identity, "target": target,
               "channel": channel_number, "status": "queued", "files_total": len(files),
               "files_done": 0, "bytes_total": total, "bytes_done": 0,
               "current": "", "message": "Waiting to copy"}
        with self.usb_import_lock:
            completed = [key for key, value in self.usb_imports.items()
                         if value.get("status") in {"complete", "error"}]
            for key in completed[:-20]:
                self.usb_imports.pop(key, None)
            self.usb_imports[job_id] = job
        if target == "series":
            job["series"] = series_id
        threading.Thread(target=self._run_usb_import,
                         args=(job_id, files, destination_root, relative_destinations),
                         name=f"mabeltv-usb-{job_id[:8]}", daemon=True).start()
        return dict(job)

    def _run_usb_import(self, job_id: str, files: list[Path], destination_root: Path,
                        relative_destinations: dict[Path, Path] | None = None) -> None:
        try:
            with self.usb_import_lock:
                job = self.usb_imports[job_id]
                job.update(status="copying", message="Copying from USB")
            for index, source in enumerate(files):
                if relative_destinations is None:
                    destination = self.unique_destination(destination_root, source.name)
                else:
                    relative = relative_destinations[source]
                    parent = destination_root.joinpath(*relative.parts[:-1])
                    parent.mkdir(parents=True, mode=0o750, exist_ok=True)
                    destination = self.unique_destination(parent, relative.name)
                partial = self.incoming / f"usb-{job_id}-{index}.part"
                with self.usb_import_lock:
                    job["current"] = source.name
                try:
                    with source.open("rb") as reader, partial.open("xb") as writer:
                        while True:
                            chunk = reader.read(CHUNK_LIMIT)
                            if not chunk:
                                break
                            writer.write(chunk)
                            with self.usb_import_lock:
                                job["bytes_done"] += len(chunk)
                        writer.flush()
                        os.fsync(writer.fileno())
                    os.replace(partial, destination)
                finally:
                    partial.unlink(missing_ok=True)
                with self.usb_import_lock:
                    job["files_done"] += 1
            refreshed = True if job.get("target") == "series" else self.refresh_tv()
            with self.usb_import_lock:
                job.update(status="complete", current="",
                           message="Import complete" if refreshed else
                           "Copied successfully; TV refresh is still pending")
            self.usb_touch(str(job.get("volume", "")))
        except Exception as error:
            with self.usb_import_lock:
                job = self.usb_imports[job_id]
                job.update(status="error", message=str(error), current="")
            self.usb_touch(str(job.get("volume", "")))

    def usb_import_status(self, job_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise ValueError("USB import not found")
        with self.usb_import_lock:
            job = self.usb_imports.get(job_id)
            if job is None:
                raise ValueError("USB import not found")
            return dict(job)

    def tmdb_key(self) -> str:
        key = os.environ.get("MABELTV_TMDB_API_KEY", "").strip()
        if not key:
            try:
                key = self.tmdb_key_path.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        return key

    def opensubtitles_key(self) -> str:
        """Return the Pi-local consumer key, never exposing it through the portal."""
        key = os.environ.get("MABELTV_OPENSUBTITLES_API_KEY", "").strip()
        if not key:
            try:
                key = self.opensubtitles_key_path.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        return key

    @staticmethod
    def subtitle_sidecars(source: Path) -> list[Path]:
        """Find MPV-recognised sidecars belonging to one film, not unrelated SRTs."""
        candidates: list[Path] = []
        for extension in SUBTITLE_EXTENSIONS:
            exact = source.with_suffix(extension)
            if exact.is_file():
                candidates.append(exact)
            candidates.extend(candidate for candidate in source.parent.glob(
                f"{source.stem}.*{extension}") if candidate.is_file())
        return list(dict.fromkeys(candidates))

    def subtitle_availability(self, source: Path) -> dict[str, Any]:
        sidecars = self.subtitle_sidecars(source)
        if sidecars:
            return {"status": "external", "file": sidecars[0].name}
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "s",
                 "-show_entries", "stream=index", "-of", "json", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            streams = json.loads(result.stdout).get("streams", [])
            if result.returncode == 0 and streams:
                return {"status": "embedded"}
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            # A malformed file must not prevent its confirmed film metadata
            # from being stored. Playback validation handles that separately.
            pass
        return {"status": "missing"}

    def opensubtitles_request(self, endpoint: str,
                              parameters: dict[str, Any] | None = None,
                              body: dict[str, Any] | None = None) -> Any:
        key = self.opensubtitles_key()
        if not key:
            raise ValueError("OpenSubtitles has not been configured")
        query = urlencode(parameters or {})
        url = f"{OPENSUBTITLES_API_BASE_URL}/{endpoint.lstrip('/')}"
        if query:
            url += f"?{query}"
        headers = {
            "Accept": "application/json",
            "Api-Key": key,
            "User-Agent": OPENSUBTITLES_USER_AGENT,
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        try:
            request = Request(url, data=data, headers=headers)
            with urlopen(request, timeout=15) as response:
                return json.loads(response.read(2 * 1024 * 1024))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ValueError("OpenSubtitles could not be reached") from error

    def opensubtitles_download_bytes(self, link: str) -> bytes:
        parsed = urlsplit(link)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("OpenSubtitles returned an invalid download link")
        try:
            request = Request(link, headers={"User-Agent": OPENSUBTITLES_USER_AGENT})
            with urlopen(request, timeout=20) as response:
                return response.read(4 * 1024 * 1024 + 1)
        except (HTTPError, URLError, TimeoutError) as error:
            raise ValueError("OpenSubtitles could not download the subtitle") from error

    @staticmethod
    def opensubtitles_best_file(response: Any) -> int | None:
        if not isinstance(response, dict):
            return None
        options: list[tuple[tuple[int, int, float, int], int]] = []
        for item in response.get("data", []):
            if not isinstance(item, dict):
                continue
            attributes = item.get("attributes", {})
            if not isinstance(attributes, dict) or attributes.get("language") != "en":
                continue
            for value in attributes.get("files", []):
                if not isinstance(value, dict):
                    continue
                try:
                    file_id = int(value.get("file_id", 0))
                except (TypeError, ValueError):
                    continue
                # The OpenSubtitles search API often omits the extension from
                # an otherwise valid text-subtitle filename.  The download is
                # still checked for real SRT timing cues before it is saved.
                if file_id <= 0:
                    continue
                # Prefer ordinary English SRTs with a proven download history;
                # hearing-impaired captions remain a valid fallback.
                score = (
                    0 if bool(attributes.get("hearing_impaired")) else 1,
                    int(float(attributes.get("ratings") or 0) * 100),
                    float(attributes.get("download_count") or 0),
                    -file_id,
                )
                options.append((score, file_id))
        return max(options)[1] if options else None

    def fetch_automatic_subtitle(self, source: Path, tmdb_id: int) -> dict[str, Any]:
        """Fetch one conservative English SRT after a confirmed TMDB match.

        This never raises into the metadata path: a missing subtitle must not
        make the film, artwork, or its selected TMDB match disappear.
        """
        current = self.subtitle_availability(source)
        if current["status"] != "missing":
            return current
        if not self.opensubtitles_key():
            return {"status": "not_configured"}
        try:
            matches = self.opensubtitles_request(
                "subtitles", {"tmdb_id": tmdb_id, "languages": "en",
                               "order_by": "download_count", "order_direction": "desc"})
            file_id = self.opensubtitles_best_file(matches)
            if file_id is None:
                return {"status": "unavailable", "provider": "OpenSubtitles"}
            ticket = self.opensubtitles_request("download", body={"file_id": file_id})
            link = str(ticket.get("link", "")) if isinstance(ticket, dict) else ""
            data = self.opensubtitles_download_bytes(link)
            if len(data) > 4 * 1024 * 1024 or b"-->" not in data[:64 * 1024]:
                raise ValueError("OpenSubtitles returned an invalid subtitle")
            target = source.with_name(f"{source.stem}.en.srt")
            temporary = target.with_suffix(".srt.new")
            temporary.write_bytes(data)
            os.replace(temporary, target)
            return {"status": "downloaded", "file": target.name,
                    "language": "en", "provider": "OpenSubtitles",
                    "updated": time.time()}
        except (OSError, ValueError):
            return {"status": "unavailable", "provider": "OpenSubtitles"}

    def tmdb_status(self) -> dict[str, Any]:
        return {"configured": bool(self.tmdb_key()),
                "key_file": str(self.tmdb_key_path), "provider": "TMDB"}

    def tmdb_request(self, endpoint: str, parameters: dict[str, Any] | None = None) -> Any:
        key = self.tmdb_key()
        if not key:
            raise ValueError("TMDB is ready, but its API key has not been added yet")
        query = dict(parameters or {})
        # TMDB issues JWT-style Read Access Tokens as well as legacy v3 API
        # keys. The former must be sent as a Bearer token, never as a query
        # parameter (which produces a 401 and risks leaking the credential).
        bearer_token = key.count(".") == 2 and key.startswith("eyJ")
        if not bearer_token:
            query["api_key"] = key
        url = f"{TMDB_BASE_URL}/{endpoint.lstrip('/')}?{urlencode(query)}"
        try:
            headers = {"Accept": "application/json", "User-Agent": "MabelTV/0.2.5"}
            if bearer_token:
                headers["Authorization"] = f"Bearer {key}"
            request = Request(url, headers=headers)
            with urlopen(request, timeout=12) as response:
                return json.loads(response.read(2 * 1024 * 1024))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ValueError("TMDB could not be reached. Try the scan again later") from error

    def watchmode_key(self) -> str:
        """Return the Pi-local Watchmode key without exposing it to clients."""
        key = os.environ.get("MABELTV_WATCHMODE_API_KEY", "").strip()
        if not key:
            try:
                key = self.watchmode_key_path.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        return key

    def watchmode_request(self, endpoint: str,
                          parameters: dict[str, Any] | None = None) -> Any:
        key = self.watchmode_key()
        if not key:
            raise ValueError("Streaming links have not been configured yet")
        query = urlencode(parameters or {})
        url = f"{WATCHMODE_API_BASE_URL}/{endpoint.strip('/')}"
        if query:
            url += f"?{query}"
        try:
            request = Request(url, headers={
                "Accept": "application/json", "X-API-Key": key,
                "User-Agent": "MabelTV/0.2.5",
            })
            with urlopen(request, timeout=12) as response:
                return json.loads(response.read(2 * 1024 * 1024))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ValueError("Streaming services could not be reached. Try again later") from error

    @staticmethod
    def netflix_content_id(destination: Any) -> str:
        """Turn an official Watchmode Netflix URL into LG's proven launch value."""
        candidate = str(destination or "").strip()
        parsed = urlsplit(candidate)
        if parsed.scheme not in {"http", "https", "nflx"}:
            raise ValueError("Netflix did not provide a usable TV destination for this title")
        host = parsed.netloc.lower()
        if parsed.scheme != "nflx" and not (host == "netflix.com" or host.endswith(".netflix.com")):
            raise ValueError("Netflix did not provide a usable TV destination for this title")
        match = re.search(r"/(?:watch|title)/(\d+)(?:/|$)", parsed.path)
        if not match:
            raise ValueError("Netflix did not provide a title ID that this TV can open")
        return f"m=https://www.netflix.com/watch/{match.group(1)}&source_type=4"

    def lg_tv_client_key(self) -> str:
        try:
            return self.lg_tv_client_key_path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def save_lg_tv_client_key(self, key: str) -> None:
        if not key or len(key) > 512:
            raise LgWebOsError("The connected LG TV returned an invalid pairing key")
        self.lg_tv_client_key_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.lg_tv_client_key_path.with_name(
            f".{self.lg_tv_client_key_path.name}.{secrets.token_hex(6)}")
        try:
            temporary.write_text(key + "\n", encoding="utf-8")
            temporary.chmod(0o600)
            os.replace(temporary, self.lg_tv_client_key_path)
        finally:
            temporary.unlink(missing_ok=True)

    def lg_tv_session(self) -> LgWebOsSocket:
        if not self.lg_tv_host:
            raise ValueError("Connected TV control has not been configured for this MabelTV yet")
        session = LgWebOsSocket(self.lg_tv_host, self.lg_tv_client_key())
        session.connect()
        registration = json.loads(json.dumps(LG_WEBOS_REGISTRATION))
        if session.client_key:
            registration["payload"]["client-key"] = session.client_key
        lg_webos_log(f"registration JSON sent; stored_client_key={'YES' if session.client_key else 'NO'}")
        session.send(registration)
        first = session.receive()
        if first.get("type") == "response" and \
                first.get("payload", {}).get("pairingType") == "PROMPT":
            lg_webos_log("pairing prompt response received; waiting for user approval")
            first = session.receive()
        if first.get("type") != "registered":
            lg_webos_log("registration did not reach registered state")
            session.close()
            raise LgWebOsError("Approve MabelTV's control request on the LG TV, then try Netflix again")
        key = str(first.get("payload", {}).get("client-key") or "")
        lg_webos_log(f"registered message received; client_key={'YES' if key else 'NO'}")
        if key and key != session.client_key:
            self.save_lg_tv_client_key(key)
            session.client_key = key
        if not session.client_key:
            session.close()
            raise LgWebOsError("Approve MabelTV's control request on the LG TV, then try Netflix again")
        return session

    @staticmethod
    def lg_response_ok(response: dict[str, Any]) -> bool:
        return response.get("type") == "response" and response.get("payload", {}).get("returnValue") is not False

    def lg_tv_session_request(self, session: LgWebOsSocket, uri: str,
                              payload: dict[str, Any] | None = None,
                              request_id: str = "lg-remote") -> dict[str, Any]:
        request: dict[str, Any] = {"id": request_id, "type": "request", "uri": uri}
        if payload is not None:
            request["payload"] = payload
        session.send(request)
        response = session.receive()
        if not self.lg_response_ok(response):
            raise LgWebOsError("The connected LG TV could not complete that command")
        return response.get("payload", {})

    def lg_tv_request(self, uri: str, payload: dict[str, Any] | None = None, request_id: str = "lg-remote") -> dict[str, Any]:
        """Make one authenticated SSAP request, keeping the pairing secret on the Pi."""
        with self.lg_tv_lock:
            session: LgWebOsSocket | None = None
            try:
                session = self.lg_tv_session()
                return self.lg_tv_session_request(session, uri, payload, request_id)
            except LgWebOsError:
                raise
            except (OSError, ssl.SSLError) as error:
                lg_webos_log(f"command connection failed: {type(error).__name__}")
                raise LgWebOsError("Connected TV unavailable") from error
            finally:
                if session is not None:
                    session.close()

    @staticmethod
    def lg_normalised_name(value: Any) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()

    def lg_tv_catalog(self, session: LgWebOsSocket,
                      force: bool = False) -> dict[str, Any]:
        if self.lg_tv_catalog_cache and not force and \
                time.monotonic() - self.lg_tv_catalog_updated < LG_TV_CATALOG_SECONDS:
            return self.lg_tv_catalog_cache

        cached = self.lg_tv_catalog_cache or {}
        apps = list(cached.get("apps", []))
        inputs = list(cached.get("inputs", []))
        apps_known = bool(cached.get("apps_known", apps))
        inputs_known = bool(cached.get("inputs_known", inputs))
        errors: list[LgWebOsError] = []
        try:
            apps_payload = self.lg_tv_session_request(
                session, "ssap://com.webos.applicationManager/listLaunchPoints",
                request_id="lg-app-catalog")
            apps = [item for item in apps_payload.get("launchPoints", [])
                    if isinstance(item, dict) and item.get("id")]
            apps_known = True
        except LgWebOsError as error:
            errors.append(error)
        try:
            inputs_payload = self.lg_tv_session_request(
                session, "ssap://tv/getExternalInputList", request_id="lg-input-catalog")
            inputs = [item for item in inputs_payload.get("devices", [])
                      if isinstance(item, dict)]
            inputs_known = True
        except LgWebOsError as error:
            errors.append(error)
        if not apps_known and not inputs_known and errors:
            raise errors[0]
        resolved: dict[str, str] = {}
        by_id = {str(item.get("id")): item for item in apps}
        for key, definition in LG_TV_APP_SHORTCUTS.items():
            app_id = next((candidate for candidate in definition["ids"]
                           if candidate in by_id), "")
            if not app_id:
                wanted = {self.lg_normalised_name(title)
                          for title in definition["titles"]}
                for item in apps:
                    title = self.lg_normalised_name(
                        item.get("title") or item.get("name") or item.get("appDescription"))
                    if title in wanted or any(value and value in title for value in wanted):
                        app_id = str(item["id"])
                        break
            if app_id:
                resolved[key] = app_id
        catalog = {
            "apps": apps, "inputs": inputs, "shortcuts": resolved,
            "apps_known": apps_known, "inputs_known": inputs_known,
        }
        self.lg_tv_catalog_cache = catalog
        self.lg_tv_catalog_updated = time.monotonic()
        return catalog

    def lg_tv_app_label(self, app_id: str, catalog: dict[str, Any]) -> tuple[str, str]:
        for item in catalog.get("inputs", []):
            if str(item.get("appId") or "") == app_id:
                label = str(item.get("label") or item.get("inputId") or "HDMI")
                return label, label
        for item in catalog.get("apps", []):
            if str(item.get("id") or "") == app_id:
                return str(item.get("title") or item.get("name") or app_id), ""
        for definition in LG_TV_APP_SHORTCUTS.values():
            if app_id in definition["ids"]:
                return str(definition["label"]), ""
        if app_id == "com.webos.app.livetv":
            return "Live TV", "Live TV"
        return app_id, ""

    def lg_tv_status(self) -> dict[str, Any]:
        status = {
            "configured": bool(self.lg_tv_host), "connected": False,
            "power": "off", "app": "", "app_id": "", "input": "",
            "volume": None, "muted": False, "catalog_known": False,
            "available_apps": [],
        }
        if not self.lg_tv_host:
            return status
        try:
            with self.lg_tv_lock:
                session = self.lg_tv_session()
                try:
                    app = self.lg_tv_session_request(
                        session,
                        "ssap://com.webos.applicationManager/getForegroundAppInfo",
                        request_id="lg-status-app")
                    volume = self.lg_tv_session_request(
                        session, "ssap://audio/getVolume",
                        request_id="lg-status-volume")
                    try:
                        catalog = self.lg_tv_catalog(session)
                        catalog_known = bool(catalog.get(
                            "apps_known", catalog.get("apps")))
                    except LgWebOsError:
                        catalog = self.lg_tv_catalog_cache
                        catalog_known = bool(catalog)
                finally:
                    session.close()
            app_id = str(app.get("appId") or app.get("appName") or "")
            app_label, input_label = self.lg_tv_app_label(app_id, catalog)
            volume_status = volume.get("volumeStatus", volume)
            status.update({
                "connected": True, "power": "on", "app": app_label,
                "app_id": app_id, "input": input_label,
                "volume": volume_status.get("volume"),
                "muted": bool(volume_status.get(
                    "muteStatus", volume_status.get("mute", False))),
                "catalog_known": catalog_known,
                "available_apps": sorted(catalog.get("shortcuts", {})),
            })
        except (LgWebOsError, OSError, ssl.SSLError):
            pass
        return status

    def close_lg_tv_pointer(self) -> None:
        if self.lg_tv_pointer_socket is not None:
            self.lg_tv_pointer_socket.close()
            self.lg_tv_pointer_socket = None

    def open_lg_tv_pointer(self) -> LgWebOsSocket:
        if self.lg_tv_pointer_socket is not None and \
                self.lg_tv_pointer_socket.connection is not None:
            return self.lg_tv_pointer_socket
        control: LgWebOsSocket | None = None
        try:
            control = self.lg_tv_session()
            response = self.lg_tv_session_request(
                control, "ssap://com.webos.service.networkinput/getPointerInputSocket",
                request_id="lg-pointer-socket")
            socket_path = str(response.get("socketPath") or "")
            parsed = urlsplit(socket_path)
            if parsed.scheme not in {"ws", "wss"} or not parsed.hostname:
                raise LgWebOsError("The connected LG TV did not provide pointer control")
            pointer = LgWebOsSocket(parsed.hostname)
            path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            pointer.connect(path, parsed.port or (443 if parsed.scheme == "wss" else 3000),
                            parsed.scheme == "wss")
            self.lg_tv_pointer_socket = pointer
            return pointer
        finally:
            if control is not None:
                control.close()

    def lg_tv_pointer(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send one command through LG's reusable pointer-input socket."""
        if action == "pointer-click":
            message = "type:click\n\n"
        elif action == "pointer-scroll":
            message = (f"type:scroll\ndx:{int(payload.get('dx', 0))}"
                       f"\ndy:{int(payload.get('dy', 0))}\n\n")
        elif action == "pointer-move":
            message = (f"type:move\ndx:{int(payload.get('dx', 0))}"
                       f"\ndy:{int(payload.get('dy', 0))}\ndown:0\n\n")
        elif action == "button":
            name = str(payload.get("name") or "")
            if name not in {*LG_TV_BUTTONS.values(), "CHANNELUP", "CHANNELDOWN",
                            "PLAY", "PAUSE", "REWIND", "FASTFORWARD"}:
                raise ValueError("That connected TV button is not available")
            message = f"type:button\nname:{name}\n\n"
        else:
            raise ValueError("That pointer command is not available")

        with self.lg_tv_lock:
            error: Exception | None = None
            for attempt in range(2):
                try:
                    self.open_lg_tv_pointer().send_text(message)
                    return {"ok": True, "message": "Command sent to connected TV"}
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                    self.close_lg_tv_pointer()
                    if attempt == 0:
                        lg_webos_log("pointer session lost; reconnecting")
            raise LgWebOsError("TV control session lost. Please try again.") from error

    def lg_tv_launch_shortcut(self, shortcut: str) -> dict[str, Any]:
        definition = LG_TV_APP_SHORTCUTS.get(shortcut)
        if not definition:
            raise ValueError("That TV app is not available in MabelTV")
        mode = self.player_mode_status()
        waking = str(mode.get("connected_tv_power") or "").lower() not in {"on", "active"}
        if waking:
            self.wake_connected_tv_only()
        deadline = time.monotonic() + (20 if waking else 5)
        error: Exception | None = None
        with self.lg_tv_lock:
            while time.monotonic() < deadline:
                session: LgWebOsSocket | None = None
                try:
                    session = self.lg_tv_session()
                    catalog = self.lg_tv_catalog(session, force=True)
                    app_id = str(catalog.get("shortcuts", {}).get(shortcut) or "")
                    if not app_id:
                        raise LgWebOsError(f"{definition['label']} is not installed on the connected TV")
                    self.lg_tv_session_request(
                        session, "ssap://system.launcher/launch", {"id": app_id},
                        request_id="lg-launch")
                    return {"ok": True, "message": f"Opening {definition['label']} on TV…",
                            "waking": waking}
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                    if isinstance(caught, LgWebOsError) and "not installed" in str(caught):
                        break
                finally:
                    if session is not None:
                        session.close()
                time.sleep(1)
        raise LgWebOsError(str(error or "Connected TV unavailable"))

    def lg_tv_switch_to_mabeltv(self) -> dict[str, Any]:
        preferred = os.environ.get("MABELTV_LG_TV_INPUT_ID", "HDMI_1").strip() or "HDMI_1"
        with self.lg_tv_lock:
            session: LgWebOsSocket | None = None
            try:
                session = self.lg_tv_session()
                catalog = self.lg_tv_catalog(session, force=True)
                inputs = catalog.get("inputs", [])
                selected = next((item for item in inputs
                                 if "mabeltv" in self.lg_normalised_name(item.get("label"))), None)
                selected = selected or next((item for item in inputs
                                             if str(item.get("inputId") or "").casefold()
                                             == preferred.casefold()), None)
                input_id = str((selected or {}).get("inputId") or preferred)
                self.lg_tv_session_request(
                    session, "ssap://tv/switchInput", {"inputId": input_id},
                    request_id="lg-mabeltv-input")
                return {"ok": True, "message": "Switching to MabelTV…"}
            finally:
                if session is not None:
                    session.close()

    def lg_tv_open_input_picker(self) -> dict[str, Any]:
        error: Exception | None = None
        for app_id in ("com.webos.app.inputpicker", "com.webos.app.inputmgr"):
            try:
                self.lg_tv_request(
                    "ssap://system.launcher/launch", {"id": app_id},
                    request_id="lg-input-picker")
                return {"ok": True, "message": "Opening TV inputs…"}
            except LgWebOsError as caught:
                error = caught
        raise LgWebOsError("The connected TV could not open its input picker") from error

    def lg_tv_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        action = str(payload.get("action") or "").strip().lower()
        if action == "power-on":
            self.wake_connected_tv_only()
            return {"ok": True, "message": "Turning on connected TV…", "waking": True}
        if action == "power-off":
            self.lg_tv_request("ssap://system/turnOff", request_id="lg-power-off")
            self.close_lg_tv_pointer()
            return {"ok": True, "message": "Turning off connected TV…"}
        if action == "launch":
            shortcut = str(payload.get("app") or "").strip().lower()
            if shortcut == "live-tv":
                self.lg_tv_request(
                    "ssap://system.launcher/launch", {"id": "com.webos.app.livetv"},
                    request_id="lg-live-tv")
                return {"ok": True, "message": "Opening Live TV…"}
            if shortcut == "mabeltv":
                return self.lg_tv_switch_to_mabeltv()
            return self.lg_tv_launch_shortcut(shortcut)
        if action == "input":
            return self.lg_tv_open_input_picker()
        if action in {"pointer-move", "pointer-click", "pointer-scroll"}:
            return self.lg_tv_pointer(action, payload)
        if action in LG_TV_BUTTONS:
            return self.lg_tv_pointer("button", {"name": LG_TV_BUTTONS[action]})
        if action in LG_TV_MEDIA_ACTIONS:
            self.lg_tv_request(LG_TV_MEDIA_ACTIONS[action], request_id=f"lg-{action}")
            return {"ok": True, "message": "Command sent to connected TV"}
        if action == "volume-up":
            uri, command = "ssap://audio/volumeUp", None
        elif action == "volume-down":
            uri, command = "ssap://audio/volumeDown", None
        elif action == "mute":
            uri, command = "ssap://audio/setMute", {"mute": bool(payload.get("mute", True))}
        else:
            raise ValueError("That connected TV command is not available")
        self.lg_tv_request(uri, command, f"lg-{action}")
        return {"ok": True, "message": "Command sent to connected TV"}

    def play_netflix_on_tv(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Wake the connected display when necessary, then launch one Netflix title."""
        self.adult_title_key(str(payload.get("media_type", "")), payload.get("tmdb_id"))
        content_id = self.netflix_content_id(payload.get("destination"))
        title = str(payload.get("title") or "this Netflix title").strip()[:180]
        mode = self.player_mode_status()
        waking = str(mode.get("connected_tv_power") or "").lower() not in {"on", "active"}
        lg_webos_log(f"Netflix Play on TV request received; waking={waking}")
        if waking:
            self.wake_connected_tv_only()
        # Queue the wake and immediately begin the bounded SSAP retry loop.
        # This preserves the proven wake-and-launch timing while deliberately
        # avoiding CEC Active Source, which would switch the TV to HDMI 1.
        deadline = time.monotonic() + (20 if waking else 5)
        error: Exception | None = None
        with self.lg_tv_lock:
            while time.monotonic() < deadline:
                session: LgWebOsSocket | None = None
                try:
                    session = self.lg_tv_session()
                    lg_webos_log("Netflix launch request sent")
                    session.send({"id": "netflix-launch", "type": "request",
                                  "uri": "ssap://system.launcher/launch",
                                  "payload": {"id": NETFLIX_TV_APP_ID,
                                              "contentId": content_id}})
                    response = session.receive()
                    lg_webos_log(
                        "Netflix launch response received; "
                        f"returnValue={response.get('payload', {}).get('returnValue')!r}")
                    if response.get("type") == "response" and \
                            response.get("payload", {}).get("returnValue") is True:
                        return {"ok": True, "message": f"Opening {title} on Netflix",
                                "waking": waking}
                    error = LgWebOsError("The LG TV could not open that Netflix title")
                except (LgWebOsError, OSError, ssl.SSLError) as caught:
                    error = caught
                finally:
                    if session is not None:
                        session.close()
                time.sleep(1)
        raise ValueError(str(error or "The connected LG TV could not open Netflix"))

    @staticmethod
    def adult_title_key(media_type: str, tmdb_id: Any) -> str:
        media_type = str(media_type or "").strip().lower()
        if media_type not in {"movie", "tv"}:
            raise ValueError("Choose a film or TV series")
        try:
            identifier = int(tmdb_id)
        except (TypeError, ValueError):
            raise ValueError("Choose a valid title") from None
        if identifier <= 0:
            raise ValueError("Choose a valid title")
        return f"{media_type}:{identifier}"

    def adult_viewing_store(self) -> dict[str, Any]:
        value = self.read_json(self.adult_viewing_path, {})
        if not isinstance(value, dict):
            value = {}
        for field in ("titles", "availability"):
            if not isinstance(value.get(field), dict):
                value[field] = {}
        value["schema_version"] = 1
        # Provider launches used to leave a prompt behind for the next visit.
        # Prompts are no longer part of the viewing model, and watched titles
        # belong in history rather than the unseen Watchlist.
        for item in value["titles"].values():
            if not isinstance(item, dict):
                continue
            item.pop("pending_confirmation", None)
            episode_states = item.get("episodes", {})
            has_watched_episode = isinstance(episode_states, dict) and any(
                isinstance(saved, dict) and saved.get("watched") is True
                for saved in episode_states.values())
            if item.get("manual_state") == "watched" or has_watched_episode:
                item["watchlisted"] = False
        # Watchmode's free-data terms require old cached provider data to be
        # removed, rather than retained forever as ordinary application state.
        cutoff = time.time() - ADULT_PROVIDER_MAX_CACHE_SECONDS
        value["availability"] = {
            key: item for key, item in value["availability"].items()
            if isinstance(item, dict) and float(item.get("checked", 0) or 0) >= cutoff
        }
        return value

    def write_adult_viewing_store(self, value: dict[str, Any]) -> None:
        value["updated"] = time.time()
        self.write_json(self.adult_viewing_path, value)

    @staticmethod
    def adult_title_summary(value: dict[str, Any], media_type: str) -> dict[str, Any]:
        date = str(value.get("release_date" if media_type == "movie" else
                             "first_air_date", ""))
        return {
            "media_type": media_type,
            "tmdb_id": int(value.get("id", 0) or 0),
            "title": str(value.get("title" if media_type == "movie" else "name", "")),
            "original_title": str(value.get("original_title" if media_type == "movie"
                                             else "original_name", "")),
            "year": date[:4],
            "overview": str(value.get("overview", "")),
            "poster_path": str(value.get("poster_path") or ""),
            "backdrop_path": str(value.get("backdrop_path") or ""),
        }

    @staticmethod
    def adult_next_episode_after_progress(
            episodes: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Continue after the furthest watched episode, not from an earlier gap."""
        ordered = sorted(episodes, key=lambda value: (
            int(value.get("season", 0) or 0),
            int(value.get("episode", 0) or 0),
        ))
        last_watched = max(
            (index for index, value in enumerate(ordered) if value.get("watched") is True),
            default=-1,
        )
        next_index = last_watched + 1
        return ordered[next_index] if next_index < len(ordered) else None

    def adult_local_title_index(self) -> dict[str, dict[str, Any]]:
        """Map confirmed Adult TV media to one canonical TMDB title."""
        index: dict[str, dict[str, Any]] = {}
        for film in self.adult_library():
            metadata = film.get("metadata", {})
            try:
                key = self.adult_title_key("movie", metadata.get("tmdb_id"))
            except ValueError:
                continue
            index[key] = {
                "kind": "film", "path": film["path"],
                "title": str(metadata.get("title") or film["display_name"]),
                "poster": str(metadata.get("poster") or ""),
                "position": float(film.get("remote_position", 0) or 0),
                "duration": float(film.get("remote_duration", 0) or 0),
                "last_watched": float(film.get("remote_last_watched", 0) or 0),
                "browser_ready": film.get("browser_ready") is not False,
            }
        for series in self.adult_series_library():
            metadata = series.get("metadata", {})
            try:
                key = self.adult_title_key("tv", metadata.get("tmdb_id"))
            except ValueError:
                continue
            episodes = series.get("episodes", [])
            next_episode = self.adult_next_episode_after_progress(episodes)
            index[key] = {
                "kind": "series", "series": series["id"],
                "title": str(metadata.get("title") or series["title"]),
                "poster": str(metadata.get("poster") or ""),
                "episode_count": len(episodes),
                "watched_count": int(series.get("watched_count", 0) or 0),
                "next_episode": next_episode,
            }
        return index

    def adult_discovery(self, query: str) -> dict[str, Any]:
        query = str(query or "").strip()
        if len(query) < 2:
            return {"query": query, "results": []}
        response = self.tmdb_request("search/multi", {
            "query": query[:120], "include_adult": "false", "language": "en-GB",
            "page": 1,
        })
        local = self.adult_local_title_index()
        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        for value in response.get("results", []) if isinstance(response, dict) else []:
            if not isinstance(value, dict) or value.get("media_type") not in {"movie", "tv"}:
                continue
            item = self.adult_title_summary(value, str(value["media_type"]))
            if not item["tmdb_id"] or not item["title"]:
                continue
            key = self.adult_title_key(item["media_type"], item["tmdb_id"])
            item.update({"key": key, "local": local.get(key),
                         "on_mabeltv": key in local})
            results.append(item)
            seen.add(key)
            if len(results) >= 20:
                break
        # Unmatched local files still remain findable; they simply cannot have
        # provider availability until the parent confirms their metadata.
        lowered = query.casefold()
        for film in self.adult_library():
            if film.get("metadata", {}).get("tmdb_id") or lowered not in str(
                    film.get("display_name", "")).casefold():
                continue
            results.insert(0, {
                "key": f"local:{film['library_id']}", "media_type": "movie",
                "tmdb_id": 0, "title": film["display_name"], "year": "",
                "overview": "This local film needs a metadata match before streaming services can be checked.",
                "poster_path": "", "backdrop_path": "", "on_mabeltv": True,
                "local": {"kind": "film", "path": film["path"]},
            })
        return {"query": query, "results": results,
                "attribution": "Streaming availability data from TMDB and JustWatch"}

    def adult_title_detail(self, media_type: str, tmdb_id: Any) -> dict[str, Any]:
        key = self.adult_title_key(media_type, tmdb_id)
        media_type, raw_id = key.split(":", 1)
        value = self.tmdb_request(f"{media_type}/{raw_id}", {"language": "en-GB"})
        if not isinstance(value, dict):
            raise ValueError("That title could not be loaded")
        summary = self.adult_title_summary(value, media_type)
        providers = self.tmdb_request(f"{media_type}/{raw_id}/watch/providers")
        region = providers.get("results", {}).get("GB", {}) \
            if isinstance(providers, dict) else {}
        groups = []
        for provider_type, label in (("flatrate", "Stream"), ("free", "Free"),
                                     ("ads", "With ads"), ("rent", "Rent"),
                                     ("buy", "Buy")):
            for provider in region.get(provider_type, []) if isinstance(region, dict) else []:
                if not isinstance(provider, dict):
                    continue
                groups.append({
                    "provider_id": int(provider.get("provider_id", 0) or 0),
                    "name": str(provider.get("provider_name", "")),
                    "type": provider_type, "label": label,
                    "logo_path": str(provider.get("logo_path") or ""),
                })
        runtime = value.get("runtime") if media_type == "movie" else (
            value.get("episode_run_time", [None]) or [None])[0]
        detail = summary | {
            "key": key, "runtime": int(runtime or 0),
            "genres": [str(item.get("name", "")) for item in value.get("genres", [])
                       if isinstance(item, dict) and item.get("name")],
            "seasons": [{"number": int(item.get("season_number", 0) or 0),
                         "name": str(item.get("name", "")),
                         "episodes": int(item.get("episode_count", 0) or 0),
                         "poster_path": str(item.get("poster_path") or ""),
                         "overview": str(item.get("overview") or ""),
                         "air_date": str(item.get("air_date") or "")}
                        for item in value.get("seasons", []) if isinstance(item, dict)
                        and int(item.get("season_number", 0) or 0) > 0],
            "providers": groups, "provider_link": str(region.get("link", ""))
            if isinstance(region, dict) else "", "region": "GB",
            "on_mabeltv": key in self.adult_local_title_index(),
            "local": self.adult_local_title_index().get(key),
            "attribution": "Streaming availability data from TMDB and JustWatch",
        }
        with self.config_lock:
            store = self.adult_viewing_store()
            state = store["titles"].get(key, {})
            detail["viewing"] = state if isinstance(state, dict) else {}
        episode_states = detail["viewing"].get("episodes", {}) \
            if isinstance(detail["viewing"], dict) else {}
        if not isinstance(episode_states, dict):
            episode_states = {}
        rewatch_episode_states = detail["viewing"].get("rewatch_episodes", {}) \
            if isinstance(detail["viewing"], dict) else {}
        if not isinstance(rewatch_episode_states, dict):
            rewatch_episode_states = {}
        for season in detail["seasons"]:
            prefix = f"{season['number']}:"
            season["watched_count"] = sum(
                saved.get("watched") is True
                for episode_key, saved in episode_states.items()
                if str(episode_key).startswith(prefix) and isinstance(saved, dict))
        rewatching = bool(detail["viewing"].get("series_watching")) and \
            detail["viewing"].get("series_watching_mode") == "rewatch"
        next_episode = None
        local_next = detail.get("local", {}).get("next_episode") \
            if isinstance(detail.get("local"), dict) else None
        if isinstance(local_next, dict) and not rewatching:
            next_episode = {
                "season": int(local_next.get("season", 0) or 0),
                "episode": int(local_next.get("episode", 0) or 0),
                "title": str(local_next.get("display_name") or ""),
                "source": "local", "rewatch": False,
            }
        if not next_episode:
            states = rewatch_episode_states if rewatching else episode_states
            available = []
            for season in detail["seasons"]:
                for episode in range(1, int(season.get("episodes", 0) or 0) + 1):
                    saved = states.get(f"{season['number']}:{episode}", {})
                    available.append({
                        "season": season["number"], "episode": episode,
                        "watched": isinstance(saved, dict) and saved.get("watched") is True,
                    })
            candidate = self.adult_next_episode_after_progress(available)
            if candidate:
                next_episode = {
                    "season": candidate["season"], "episode": candidate["episode"],
                    "title": "", "source": "streaming", "rewatch": rewatching,
                }
        detail["next_episode"] = next_episode
        return detail

    def adult_title_season(self, tmdb_id: Any, season_number: Any) -> dict[str, Any]:
        key = self.adult_title_key("tv", tmdb_id)
        try:
            number = int(season_number)
        except (TypeError, ValueError):
            raise ValueError("Choose a valid season") from None
        if number < 1:
            raise ValueError("Choose a valid season")
        value = self.tmdb_request(f"tv/{key.split(':', 1)[1]}/season/{number}",
                                  {"language": "en-GB"})
        if not isinstance(value, dict):
            raise ValueError("That season could not be loaded")
        with self.config_lock:
            store = self.adult_viewing_store()
            state = store["titles"].get(key, {})
            episode_states = state.get("episodes", {}) if isinstance(state, dict) else {}
            if not isinstance(episode_states, dict):
                episode_states = {}
            rewatch_episode_states = state.get("rewatch_episodes", {}) \
                if isinstance(state, dict) else {}
            if not isinstance(rewatch_episode_states, dict):
                rewatch_episode_states = {}
        episodes = []
        for item in value.get("episodes", []):
            if not isinstance(item, dict):
                continue
            episode = int(item.get("episode_number", 0) or 0)
            if episode < 1:
                continue
            episode_key = f"{number}:{episode}"
            saved = episode_states.get(episode_key, {})
            episodes.append({
                "number": episode,
                "name": str(item.get("name") or f"Episode {episode}"),
                "air_date": str(item.get("air_date") or ""),
                "runtime": int(item.get("runtime", 0) or 0),
                "overview": str(item.get("overview") or ""),
                "still_path": str(item.get("still_path") or ""),
                "watched": bool(saved.get("watched")) if isinstance(saved, dict) else False,
                "rewatch_watched": bool(rewatch_episode_states.get(
                    episode_key, {}).get("watched"))
                if isinstance(rewatch_episode_states.get(episode_key), dict) else False,
            })
        return {"key": key, "season": number,
                "name": str(value.get("name") or f"Season {number}"),
                "overview": str(value.get("overview") or ""),
                "poster_path": str(value.get("poster_path") or ""),
                "episodes": episodes}

    @staticmethod
    def normalise_watchmode_sources(values: Any) -> list[dict[str, Any]]:
        def safe_destination(raw_value: Any) -> str:
            destination = str(raw_value or "").strip()
            if not destination or len(destination) > 4096:
                return ""
            parsed = urlsplit(destination)
            scheme = parsed.scheme.lower()
            if scheme in {"http", "https"}:
                if not parsed.netloc:
                    return ""
                # A few UK providers still arrive from Watchmode as http links.
                # Upgrade them so the exact title URL is retained safely and can
                # participate in iOS/Android Universal Link hand-off.
                if scheme == "http":
                    destination = parsed._replace(scheme="https").geturl()
                return destination
            # Paid Watchmode plans can return provider app schemes. Preserve
            # those trusted API values, while rejecting browser-executable and
            # local-file schemes.
            if scheme and scheme not in {"javascript", "data", "file", "blob"} and \
                    all(character not in destination for character in "\r\n\t"):
                return destination
            return ""

        sources: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for value in values if isinstance(values, list) else []:
            if not isinstance(value, dict):
                continue
            web_url = safe_destination(value.get("web_url"))
            ios_url = safe_destination(value.get("ios_url"))
            android_url = safe_destination(value.get("android_url"))
            if not any((web_url, ios_url, android_url)):
                continue
            name = str(value.get("name") or "Streaming service")
            source_type = str(value.get("type") or "sub").lower()
            marker = (name.casefold(), source_type)
            if marker in seen:
                continue
            seen.add(marker)
            sources.append({
                "source_id": int(value.get("source_id", 0) or 0),
                "name": name, "type": source_type,
                "region": str(value.get("region") or "GB").upper(),
                "web_url": web_url, "ios_url": ios_url,
                "android_url": android_url,
                "format": str(value.get("format") or ""),
            })
        return sources

    def adult_streaming_links(self, media_type: str, tmdb_id: Any,
                              refresh: bool = False) -> dict[str, Any]:
        key = self.adult_title_key(media_type, tmdb_id)
        now = time.time()
        with self.config_lock:
            store = self.adult_viewing_store()
            cached = store["availability"].get(key, {})
            if not refresh and isinstance(cached, dict) and \
                    cached.get("link_schema") == 2 and \
                    now - float(cached.get("checked", 0) or 0) < ADULT_PROVIDER_CACHE_SECONDS:
                return dict(cached)
        external_id = f"{key.split(':', 1)[0]}-{key.split(':', 1)[1]}"
        values = self.watchmode_request(
            f"title/{external_id}/sources/", {"regions": "GB"})
        result = {"key": key, "region": "GB", "checked": now, "link_schema": 2,
                  "sources": self.normalise_watchmode_sources(values),
                  "provider": "Watchmode"}
        with self.config_lock:
            store = self.adult_viewing_store()
            store["availability"][key] = result
            self.write_adult_viewing_store(store)
        return result

    def adult_viewing_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        key = self.adult_title_key(payload.get("media_type"), payload.get("tmdb_id"))
        action = str(payload.get("action", ""))
        allowed = {"watchlist", "rewatch", "up_next", "move_up", "move_down",
                   "part_watched", "watched", "not_watched", "dropped",
                   "watching", "launched", "remove", "episode_watched",
                   "season_watched"}
        if action not in allowed:
            raise ValueError("Choose a valid viewing action")
        now = time.time()
        with self.config_lock:
            store = self.adult_viewing_store()
            current = store["titles"].get(key, {})
            if not isinstance(current, dict):
                current = {}
            for field in ("title", "year", "poster_path", "overview"):
                if field in payload:
                    current[field] = str(payload.get(field) or "")[:1000]
            try:
                current["runtime"] = max(0, int(payload.get("runtime", current.get("runtime", 0)) or 0))
            except (TypeError, ValueError):
                current["runtime"] = 0
            current.update({"media_type": key.split(":", 1)[0],
                            "tmdb_id": int(key.split(":", 1)[1]), "updated": now})
            episodes = current.get("episodes", {})
            if not isinstance(episodes, dict):
                episodes = {}
            has_completed = current.get("manual_state") == "watched" or \
                bool(current.get("history"))
            has_progress = any(
                    isinstance(saved, dict) and saved.get("watched") is True
                    for saved in episodes.values())
            local_title = self.adult_local_title_index().get(key, {})
            has_progress = has_progress or (
                isinstance(local_title, dict)
                and int(local_title.get("watched_count", 0) or 0) > 0)
            if action == "watchlist":
                enabled = bool(payload.get("enabled", True))
                if enabled and has_completed:
                    raise ValueError("You've already seen this. Add it to Rewatch instead.")
                if enabled and has_progress:
                    raise ValueError(
                        "This series is already in progress. Continue it from Watching or Up Next.")
                current["watchlisted"] = enabled
                current["watchlist_updated"] = now
            elif action == "rewatch":
                enabled = bool(payload.get("enabled", True))
                if enabled and not has_completed:
                    raise ValueError("Mark this watched before adding it to Rewatch")
                current["rewatch"] = enabled
                current["rewatch_updated"] = now
            elif action == "up_next":
                enabled = bool(payload.get("enabled", True))
                current["up_next"] = enabled
                if enabled:
                    ranks = [int(value.get("up_next_rank", 0) or 0)
                             for value in store["titles"].values()
                             if isinstance(value, dict) and value.get("up_next")]
                    current["up_next_rank"] = max(ranks, default=0) + 1
            elif action in {"part_watched", "watched", "not_watched", "dropped"}:
                previous_manual_state = current.get("manual_state")
                current["manual_state"] = action
                current["viewing_updated"] = now
                if action == "watched":
                    current.setdefault("history", []).append(now)
                    current["watchlisted"] = False
                    current["up_next"] = False
                    if current.get("series_watching") and \
                            current.get("series_watching_mode") == "rewatch":
                        current["rewatch_completed"] = now
                    current["series_watching"] = False
                elif action == "not_watched" and previous_manual_state == "watched":
                    history = current.get("history", [])
                    if isinstance(history, list) and history:
                        history.pop()
            elif action in {"move_up", "move_down"}:
                queued = sorted(
                    ((stored_key, stored) for stored_key, stored in store["titles"].items()
                     if isinstance(stored, dict) and stored.get("up_next")),
                    key=lambda pair: int(pair[1].get("up_next_rank", 999999) or 999999))
                position = next((index for index, pair in enumerate(queued)
                                 if pair[0] == key), -1)
                target = position + (-1 if action == "move_up" else 1)
                if position >= 0 and 0 <= target < len(queued):
                    other_key, other = queued[target]
                    current_rank = int(current.get("up_next_rank", position + 1) or position + 1)
                    other_rank = int(other.get("up_next_rank", target + 1) or target + 1)
                    current["up_next_rank"], other["up_next_rank"] = other_rank, current_rank
                    store["titles"][other_key] = other
            elif action == "watching":
                if key.split(":", 1)[0] != "tv":
                    raise ValueError("Watching is available for TV series")
                enabled = bool(payload.get("enabled", True))
                current["series_watching"] = enabled
                current["series_watching_updated"] = now
                if enabled:
                    requested_mode = str(payload.get("mode") or "").strip()
                    if requested_mode not in {"first_watch", "rewatch"}:
                        requested_mode = "rewatch" \
                            if current.get("manual_state") == "watched" else "first_watch"
                    current["series_watching_mode"] = requested_mode
                    if requested_mode == "rewatch" and current.get("rewatch_completed"):
                        current["rewatch_episodes"] = {}
                        current.pop("rewatch_completed", None)
                    if not current.get("up_next"):
                        ranks = [int(value.get("up_next_rank", 0) or 0)
                                 for value in store["titles"].values()
                                 if isinstance(value, dict) and value.get("up_next")]
                        current["up_next_rank"] = max(ranks, default=0) + 1
                    current["up_next"] = True
            elif action == "launched":
                current["last_launched"] = now
                current["last_provider"] = str(
                    payload.get("provider") or "Streaming service")[:100]
            elif action == "episode_watched":
                if key.split(":", 1)[0] != "tv":
                    raise ValueError("Episodes are only available for TV series")
                try:
                    season = int(payload.get("season"))
                    episode = int(payload.get("episode"))
                except (TypeError, ValueError):
                    raise ValueError("Choose a valid episode") from None
                if season < 1 or episode < 1 or not isinstance(payload.get("watched"), bool):
                    raise ValueError("Choose a valid episode status")
                rewatch = payload.get("rewatch") is True
                if rewatch and (not current.get("series_watching") or
                                current.get("series_watching_mode") != "rewatch"):
                    raise ValueError("Start watching this series again before tracking a rewatch")
                state_field = "rewatch_episodes" if rewatch else "episodes"
                episodes = current.setdefault(state_field, {})
                if not isinstance(episodes, dict):
                    episodes = {}
                    current[state_field] = episodes
                episodes[f"{season}:{episode}"] = {"watched": payload["watched"], "updated": now}
                if payload["watched"] and not rewatch:
                    current["watchlisted"] = False
            elif action == "season_watched":
                if key.split(":", 1)[0] != "tv":
                    raise ValueError("Series are only available for TV titles")
                try:
                    season = int(payload.get("season"))
                    episode_count = int(payload.get("episode_count"))
                except (TypeError, ValueError):
                    raise ValueError("Choose a valid series") from None
                watched = payload.get("watched")
                if season < 1 or episode_count < 1 or episode_count > 1000 or \
                        not isinstance(watched, bool):
                    raise ValueError("Choose a valid series status")
                rewatch = payload.get("rewatch") is True
                if rewatch and (not current.get("series_watching") or
                                current.get("series_watching_mode") != "rewatch"):
                    raise ValueError("Start watching this series again before tracking a rewatch")
                state_field = "rewatch_episodes" if rewatch else "episodes"
                episodes = current.setdefault(state_field, {})
                if not isinstance(episodes, dict):
                    episodes = {}
                    current[state_field] = episodes
                for episode in range(1, episode_count + 1):
                    episodes[f"{season}:{episode}"] = {"watched": watched, "updated": now}
                if watched and not rewatch:
                    current["watchlisted"] = False
            elif action == "remove":
                current["watchlisted"] = False
                current["rewatch"] = False
                current["up_next"] = False
                current["series_watching"] = False
                current["manual_state"] = "not_watched"
            current.pop("pending_confirmation", None)
            store["titles"][key] = current
            self.write_adult_viewing_store(store)
        return {"ok": True, "key": key, "viewing": current}

    def adult_viewing(self) -> dict[str, Any]:
        local = self.adult_local_title_index()
        with self.config_lock:
            store = self.adult_viewing_store()
            changed = False
            for key, local_value in local.items():
                has_local_progress = float(local_value.get("position", 0) or 0) > 0 or (
                    local_value.get("kind") == "series"
                    and int(local_value.get("watched_count", 0) or 0) > 0)
                if not has_local_progress:
                    stored = store["titles"].get(key)
                    if isinstance(stored, dict) and "local_progress" in stored:
                        stored.pop("local_progress", None)
                        changed = True
                    continue
                item = store["titles"].setdefault(key, {})
                if not isinstance(item, dict):
                    item = {}
                    store["titles"][key] = item
                item.update({"media_type": key.split(":", 1)[0],
                             "tmdb_id": int(key.split(":", 1)[1]),
                             "title": local_value.get("title", ""),
                             "local_progress": local_value})
                changed = True
            if changed:
                self.write_adult_viewing_store(store)
            items = []
            for key, item in store["titles"].items():
                if not isinstance(item, dict):
                    continue
                value = dict(item)
                value.update({"key": key, "on_mabeltv": key in local,
                              "local": local.get(key)})
                items.append(value)
        return {"items": items, "watchmode_configured": bool(self.watchmode_key()),
                "region": "GB"}

    @staticmethod
    def tmdb_title_query(value: str) -> tuple[str, int | None]:
        title = re.sub(r"[._]+", " ", str(value or "")).strip()
        # get_iplayer output names can end in a BBC PID plus a quality label.
        # Neither is part of the film title and both make an otherwise exact
        # TMDB search much less reliable.
        title = re.sub(
            r"\s*-\s*[a-z][a-z0-9]{7}\s+(?:original|technical)\s*$",
            "", title, flags=re.IGNORECASE).strip()
        title = re.sub(
            r"\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$",
            "", title, flags=re.IGNORECASE).strip()
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", title)
        year = int(year_match.group(1)) if year_match else None
        if year:
            title = title.replace(str(year), "").strip(" .-()[]")
        return title, year

    def channel_film_search(self, item: Path) -> tuple[str, list[dict[str, Any]]]:
        """Return selectable TMDB matches for one MabelTV film."""
        title, year = self.tmdb_title_query(self.display_name(item.name))
        parameters: dict[str, Any] = {
            "query": title, "include_adult": "false", "language": "en-GB",
        }
        if year:
            parameters["year"] = year
        response = self.tmdb_request("search/movie", parameters)
        matches = response.get("results", []) if isinstance(response, dict) else []
        results = []
        for value in matches[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]),
                "title": str(value.get("title", "")),
                "original_title": str(value.get("original_title", "")),
                "year": str(value.get("release_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return title, results

    def channel_film_metadata_for_id(
            self, channel: dict[str, Any], item: Path, tmdb_id: int) -> dict[str, Any]:
        """Cache one explicitly selected TMDB match for a MabelTV film."""
        number = int(channel["number"])
        details = self.tmdb_request(f"movie/{tmdb_id}", {"language": "en-GB"})
        poster_name = self.cache_channel_artwork(
            str(details.get("poster_path") or ""),
            f"mabel-film-{number}-{tmdb_id}.jpg")
        return {
            "tmdb_id": tmdb_id,
            "title": str(details.get("title") or self.display_name(item.name)),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("release_date") or "")[:4],
            "poster": poster_name,
            "updated": time.time(), "provider": "TMDB",
        }

    def channel_film_metadata(self, channel: dict[str, Any], item: Path) -> dict[str, Any] | None:
        """Find and cache the best automatic TMDB match for a bulk refresh."""
        _, matches = self.channel_film_search(item)
        match = next((value for value in matches if value.get("id")), None)
        if not isinstance(match, dict):
            return None
        tmdb_id = int(match["id"])
        return self.channel_film_metadata_for_id(channel, item, tmdb_id)

    def cache_channel_artwork(self, remote_path: str, file_name: str,
                              *, backdrop: bool = False) -> str:
        if (not remote_path or not re.fullmatch(
                r"mabel-(?:show|film)-[0-9]+-[0-9]+\.jpg", file_name)):
            return ""
        destination = self.channel_artwork_root / file_name
        try:
            base = TMDB_BACKDROP_IMAGE_BASE_URL if backdrop else TMDB_IMAGE_BASE_URL
            request = Request(base + remote_path,
                              headers={"User-Agent": "MabelTV/0.2.5"})
            with urlopen(request, timeout=15) as response:
                data = response.read(10 * 1024 * 1024)
            temporary = destination.with_suffix(".jpg.new")
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            return file_name
        except (HTTPError, URLError, TimeoutError, OSError):
            return ""

    def channel_show_search(self, channel: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Return parent-selectable TMDB matches for one series channel."""
        query = str(channel.get("name", "")).strip()
        response = self.tmdb_request("search/tv", {
            "query": query, "include_adult": "false", "language": "en-GB",
        })
        matches = response.get("results", []) if isinstance(response, dict) else []
        results = []
        for value in matches[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]),
                "title": str(value.get("name", "")),
                "original_title": str(value.get("original_name", "")),
                "year": str(value.get("first_air_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return query, results

    def channel_show_metadata_for_id(
            self, channel: dict[str, Any], tmdb_id: int) -> dict[str, Any]:
        """Cache one explicitly selected TMDB match for a series channel."""
        number = int(channel["number"])
        details = self.tmdb_request(f"tv/{tmdb_id}", {"language": "en-GB"})
        remote_art = str(details.get("backdrop_path") or details.get("poster_path") or "")
        art_name = self.cache_channel_artwork(
            remote_art, f"mabel-show-{number}-{tmdb_id}.jpg",
            backdrop=bool(details.get("backdrop_path")))
        return {
            "tmdb_id": tmdb_id,
            "title": str(details.get("name") or channel.get("name", "")),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("first_air_date") or "")[:4],
            "artwork": art_name,
            "updated": time.time(), "provider": "TMDB",
        }

    def cache_adult_series_artwork(self, remote_path: str, file_name: str,
                                   *, backdrop: bool = False) -> str:
        if not remote_path or not re.fullmatch(
                r"adult-(?:series-[a-f0-9]{32}-[0-9]+|episode-[a-f0-9]{32}-[0-9]+-[0-9]+)\.jpg",
                file_name):
            return ""
        try:
            base = TMDB_BACKDROP_IMAGE_BASE_URL if backdrop else TMDB_IMAGE_BASE_URL
            request = Request(base + remote_path,
                              headers={"User-Agent": "MabelTV/0.2.5"})
            with urlopen(request, timeout=15) as response:
                data = response.read(10 * 1024 * 1024)
            destination = self.adult_series_artwork_root / file_name
            temporary = destination.with_suffix(".jpg.new")
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            return file_name
        except (HTTPError, URLError, TimeoutError, OSError):
            return ""

    def adult_series_search(self, payload: dict[str, Any]) -> dict[str, Any]:
        series_id = str(payload.get("series", ""))
        states = self.adult_series_states()
        series = states["series"].get(series_id)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        query = str(payload.get("title") or series.get("title") or "").strip()
        response = self.tmdb_request("search/tv", {
            "query": query, "include_adult": "false", "language": "en-GB",
        })
        results = []
        for value in response.get("results", [])[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]), "title": str(value.get("name", "")),
                "original_title": str(value.get("original_name", "")),
                "year": str(value.get("first_air_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return {"ok": True, "series": series_id, "query": query,
                "results": results}

    def adult_series_apply(self, payload: dict[str, Any]) -> dict[str, Any]:
        series_id = str(payload.get("series", ""))
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            tmdb_id = 0
        if tmdb_id <= 0:
            raise ValueError("Choose a TMDB series match")
        states = self.adult_series_states()
        series = states["series"].get(series_id)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        details = self.tmdb_request(f"tv/{tmdb_id}", {"language": "en-GB"})
        poster = self.cache_adult_series_artwork(
            str(details.get("poster_path") or ""),
            f"adult-series-{series_id}-{tmdb_id}.jpg")
        backdrop = self.cache_adult_series_artwork(
            str(details.get("backdrop_path") or ""),
            f"adult-series-{series_id}-{tmdb_id}.jpg", backdrop=True) \
            if not poster else ""
        series["metadata"] = {
            "tmdb_id": tmdb_id,
            "title": str(details.get("name") or series.get("title") or "Series"),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("first_air_date") or "")[:4],
            "poster": poster or backdrop,
            "updated": time.time(), "provider": "TMDB",
        }
        root = self.adult_series_root / series_id
        files = [item for item in root.rglob("*") if item.is_file()
                 and item.suffix.lower() in SUPPORTED_EXTENSIONS]
        seasons = sorted({self.adult_episode_identity(item)["season"] for item in files})
        episode_details: dict[tuple[int, int], dict[str, Any]] = {}
        for season_number in seasons:
            response = self.tmdb_request(
                f"tv/{tmdb_id}/season/{season_number}", {"language": "en-GB"})
            for episode in response.get("episodes", []):
                if not isinstance(episode, dict):
                    continue
                number = int(episode.get("episode_number") or 0)
                if number <= 0:
                    continue
                still = self.cache_adult_series_artwork(
                    str(episode.get("still_path") or ""),
                    f"adult-episode-{series_id}-{season_number}-{number}.jpg",
                    backdrop=True)
                episode_details[(season_number, number)] = {
                    "title": str(episode.get("name") or f"Episode {number}"),
                    "overview": str(episode.get("overview") or ""),
                    "air_date": str(episode.get("air_date") or ""),
                    "season_number": season_number,
                    "episode_number": number,
                    "still": still,
                }
        for ordinal, source in enumerate(sorted(files), 1):
            parsed = self.adult_episode_identity(source, ordinal)
            metadata = episode_details.get((parsed["season"], parsed["episode"]))
            if metadata:
                relative = source.relative_to(root).as_posix()
                key = f"{series_id}/{relative}"
                episode_state = states["episodes"].get(key, {})
                if not isinstance(episode_state, dict):
                    episode_state = {}
                episode_state["metadata"] = metadata
                states["episodes"][key] = episode_state
        states["series"][series_id] = series
        self.write_adult_series_states(states)
        return {"ok": True, "series": series_id,
                "metadata": series["metadata"],
                "episodes_matched": len(episode_details)}

    def adult_series_artwork(self, name: str) -> Path:
        if not re.fullmatch(
                r"adult-(?:series-[a-f0-9]{32}-[0-9]+|episode-[a-f0-9]{32}-[0-9]+-[0-9]+)\.jpg",
                name):
            raise ValueError("Series artwork not found")
        path = self.adult_series_artwork_root / name
        if not path.is_file():
            raise ValueError("Series artwork not found")
        return path

    def refresh_channel_show_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Search or apply a parent-selected match for one series channel."""
        try:
            channel = self.channel(int(payload.get("channel", 0)))
        except (TypeError, ValueError):
            raise ValueError("Choose a valid show channel") from None
        if self.channel_content_type(channel) != "shows":
            raise ValueError("Channel metadata is only available for show channels")
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            raise ValueError("Choose a TMDB match") from None
        if tmdb_id <= 0:
            query, results = self.channel_show_search(channel)
            return {"ok": True, "channel": int(channel["number"]),
                    "query": query, "results": results}

        metadata = self.channel_show_metadata_for_id(channel, tmdb_id)
        with self.config_lock:
            states = self.channel_media_states()
            channels = states.get("channels", {})
            if not isinstance(channels, dict):
                channels = {}
            channels[str(channel["number"])] = metadata
            states.update({"channels": channels, "updated": time.time()})
            self.write_channel_media_states(states)
        return {"ok": True, "channel": int(channel["number"]),
                "metadata": metadata}

    def refresh_channel_metadata(self) -> dict[str, Any]:
        """Cache one show image per series channel and posters for film channels."""
        states = self.channel_media_states()
        channels_state = states.get("channels", {})
        programmes_state = states.get("programmes", {})
        if not isinstance(channels_state, dict):
            channels_state = {}
        if not isinstance(programmes_state, dict):
            programmes_state = {}
        updated = 0
        skipped = 0
        for channel in self.channels():
            number = int(channel["number"])
            content_type = self.channel_content_type(channel)
            if content_type != "films":
                _, matches = self.channel_show_search(channel)
                match = next((value for value in matches if value.get("id")), None)
                if not isinstance(match, dict):
                    skipped += 1
                    continue
                tmdb_id = int(match["id"])
                channels_state[str(number)] = self.channel_show_metadata_for_id(
                    channel, tmdb_id)
                updated += 1
                continue

            folder = self.media_root / str(channel["folder"])
            candidates = sorted(
                (item for item in folder.glob("*") if item.is_file()
                 and item.suffix.lower() in SUPPORTED_EXTENSIONS),
                key=lambda path: path.name.casefold()) if folder.is_dir() else []
            for item in candidates:
                metadata = self.channel_film_metadata(channel, item)
                if metadata is None:
                    skipped += 1
                    continue
                programmes_state[self.channel_programme_key(number, item.name)] = metadata
                updated += 1
        states.update({"channels": channels_state, "programmes": programmes_state,
                       "updated": time.time()})
        self.write_channel_media_states(states)
        return {"ok": True, "updated": updated, "skipped": skipped}

    def refresh_channel_programme_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Search or apply a parent-selected match for one MabelTV film."""
        try:
            channel = self.channel(int(payload.get("channel", 0)))
        except (TypeError, ValueError):
            raise ValueError("Choose a valid film channel") from None
        if self.channel_content_type(channel) != "films":
            raise ValueError("Metadata refresh is only available for film channels")
        source = self.safe_media_path(channel, str(payload.get("file", "")))
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That film is no longer in this channel")
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            raise ValueError("Choose a TMDB match") from None
        if tmdb_id <= 0:
            query, results = self.channel_film_search(source)
            return {"ok": True, "channel": int(channel["number"]),
                    "file": source.name, "query": query, "results": results}

        metadata = self.channel_film_metadata_for_id(channel, source, tmdb_id)
        with self.config_lock:
            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            if not isinstance(programmes, dict):
                programmes = {}
            programmes[self.channel_programme_key(int(channel["number"]), source.name)] = metadata
            states.update({"programmes": programmes, "updated": time.time()})
            self.write_channel_media_states(states)
        return {"ok": True, "channel": int(channel["number"]),
                "file": source.name, "metadata": metadata}

    def channel_artwork(self, name: str) -> Path:
        if not re.fullmatch(r"mabel-(?:show|film)-[0-9]+-[0-9]+\.jpg", name):
            raise ValueError("Artwork not found")
        path = self.channel_artwork_root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path

    def tmdb_search(self, payload: dict[str, Any]) -> dict[str, Any]:
        file_name = str(payload.get("file", ""))
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        title = str(payload.get("title", "")).strip()
        if not title:
            title = self.display_name(source.name)
            title = re.sub(r"[._]+", " ", title)
            title = re.sub(r"\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$",
                           "", title, flags=re.IGNORECASE).strip()
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", title)
        year = int(year_match.group(1)) if year_match else None
        if year:
            title = title.replace(str(year), "").strip(" .-()[]")
        parameters: dict[str, Any] = {"query": title, "include_adult": "false", "language": "en-GB"}
        if year:
            parameters["year"] = year
        response = self.tmdb_request("search/movie", parameters)
        results = []
        for value in response.get("results", [])[:12]:
            results.append({
                "id": int(value.get("id", 0)), "title": str(value.get("title", "")),
                "original_title": str(value.get("original_title", "")),
                "year": str(value.get("release_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return {"file": file_name, "query": title, "results": results}

    def tmdb_apply(self, payload: dict[str, Any]) -> dict[str, Any]:
        file_name = str(payload.get("file", ""))
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        tmdb_id = int(payload.get("tmdb_id", 0))
        if tmdb_id <= 0:
            raise ValueError("Choose a TMDB match")
        value = self.tmdb_request(f"movie/{tmdb_id}", {"language": "en-GB"})
        poster_path = str(value.get("poster_path") or "")
        poster_name = ""
        if poster_path:
            poster_name = f"tmdb-{tmdb_id}.jpg"
            destination = self.adult_artwork_root / poster_name
            try:
                request = Request(TMDB_IMAGE_BASE_URL + poster_path,
                                  headers={"User-Agent": "MabelTV/0.2.5"})
                with urlopen(request, timeout=15) as response:
                    data = response.read(8 * 1024 * 1024)
                temporary = destination.with_suffix(".jpg.new")
                temporary.write_bytes(data)
                os.replace(temporary, destination)
            except (HTTPError, URLError, TimeoutError, OSError):
                poster_name = ""
        metadata = {
            "tmdb_id": tmdb_id, "title": str(value.get("title", "")),
            "original_title": str(value.get("original_title", "")),
            "year": str(value.get("release_date", ""))[:4],
            "overview": str(value.get("overview", "")),
            "runtime": int(value.get("runtime") or 0), "poster": poster_name,
            "updated": time.time(), "provider": "TMDB",
        }
        metadata["subtitles"] = self.fetch_automatic_subtitle(source, tmdb_id)
        states = self.adult_media_states()
        current = states.get(file_name, {})
        if not isinstance(current, dict):
            current = {}
        current["metadata"] = metadata
        states[file_name] = current
        self.write_adult_media_states(states)
        refreshed = self.refresh_tv()
        return {"ok": True, "file": file_name, "metadata": metadata,
                "refreshed": refreshed}

    def adult_artwork(self, name: str) -> Path:
        if not re.fullmatch(r"(?:tmdb-[1-9][0-9]*|adult-series-[a-f0-9]{32}-[1-9][0-9]*)\.jpg", name):
            raise ValueError("Artwork not found")
        root = self.adult_series_artwork_root if name.startswith("adult-series-") else self.adult_artwork_root
        path = root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path

    def upload_destination(self, metadata: dict[str, Any]) -> Path:
        if metadata.get("kind") == "adult":
            folder = str(metadata.get("folder", ""))
            relative = f"{folder}/{metadata.get('file_name', '')}" if folder \
                else str(metadata.get("file_name", ""))
            return self.safe_adult_path(relative, create_folder=bool(folder))
        if metadata.get("kind") == "adult-series":
            series_id = str(metadata.get("series_id", ""))
            season = int(metadata.get("season", 0) or 0)
            if season < 1 or season > 99:
                raise ValueError("That series upload has no valid series number")
            return self.adult_series_path(
                series_id, f"Season {season}/{metadata.get('file_name', '')}")
        channel = self.channel(int(metadata.get("channel")))
        return self.safe_media_path(channel, str(metadata.get("file_name", "")))

    def settings(self) -> dict[str, Any]:
        return self.read_json(self.settings_path, {"schema_version": 1})

    @staticmethod
    def parent_overlay_style(settings: dict[str, Any]) -> str:
        return "modern" if settings.get("parent_overlay_style") == "modern" else "classic"

    @staticmethod
    def tv_guide_enabled(settings: dict[str, Any]) -> bool:
        return settings.get("tv_guide_enabled") is True

    @staticmethod
    def tv_settings(settings: dict[str, Any]) -> dict[str, Any]:
        """Return the same safe, supported values offered by the TV menu."""
        volume = settings.get("volume")
        if not isinstance(volume, dict):
            volume = {}

        def choice(name: str, allowed: set[str], fallback: str) -> str:
            value = settings.get(name)
            return value if isinstance(value, str) and value in allowed else fallback

        def bounded(value: Any, fallback: int, minimum: int = 0) -> int:
            if isinstance(value, bool):
                return fallback
            try:
                return max(minimum, min(100, int(value)))
            except (TypeError, ValueError):
                return fallback

        episode_reset = settings.get("episode_reset_minutes")
        if (isinstance(episode_reset, bool) or not isinstance(episode_reset, int)
                or episode_reset not in {0, 5, 20, 60, 180}):
            episode_reset = 0

        return {
            "playback_mode": choice("playback_mode", {"continuous", "resume"}, "continuous"),
            "episode_reset_minutes": episode_reset,
            "picture_mode": choice("picture_mode", {"channel", "crop", "fit", "stretch"}, "channel"),
            "tv_border": choice("tv_border", {"slim-black", "silver-90s", "charcoal-90s", "vintage-black"}, "slim-black"),
            "crt_glass": bounded(settings.get("crt_glass"), 35),
            "video_distortion": bounded(settings.get("video_distortion"), 20),
            "display_resolution": choice("display_resolution", {"720p", "1080p", "native"}, "720p"),
            "volume_limit_enabled": volume.get("limit_enabled") is True,
            "maximum_volume": bounded(volume.get("maximum"), 60, 5),
            "sound_effects_enabled": settings.get("sound_effects_enabled") is not False,
            "scrubbing_enabled": settings.get("scrubbing_enabled") is True,
        }

    def library(self) -> dict[str, Any]:
        settings = self.settings()
        rules = settings.get("library", {})
        disabled_channels = set(rules.get("disabled_channels", []))
        disabled_programmes = rules.get("disabled_programmes", {})
        channel_media = self.channel_media_states()
        channel_metadata = channel_media.get("channels", {})
        programme_metadata = channel_media.get("programmes", {})
        stored_channel_favourites = channel_media.get("favourites", [])
        channel_favourites = set(stored_channel_favourites) \
            if isinstance(stored_channel_favourites, list) else set()
        stored_favourite_channels = channel_media.get("favourite_channels", [])
        favourite_channels = {
            int(value) for value in stored_favourite_channels
            if isinstance(value, int)
            or (isinstance(value, str) and value.isdigit())
        } if isinstance(stored_favourite_channels, list) else set()
        if not isinstance(channel_metadata, dict):
            channel_metadata = {}
        if not isinstance(programme_metadata, dict):
            programme_metadata = {}
        response = []
        for channel in self.channels():
            folder = self.media_root / str(channel["folder"])
            programmes = []
            is_film_channel = self.channel_content_type(channel) == "films"
            for item in sorted(
                    folder.glob("*") if folder.is_dir() else [],
                    key=lambda path: (
                        re.sub(r"^the\s+", "", self.display_name(path.name), flags=re.IGNORECASE).casefold(),
                        self.display_name(path.name).casefold(),
                    ) if is_film_channel else (path.name.casefold(), "")):
                if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
                    disabled = set(disabled_programmes.get(str(channel["number"]), []))
                    programme = {
                        "name": item.name,
                        "display_name": self.display_name(item.name),
                        "enabled": item.name not in disabled,
                        "browser_ready": self.remote_browser_ready(item),
                        "metadata": programme_metadata.get(
                            self.channel_programme_key(channel["number"], item.name), {}),
                        "favourite": self.channel_programme_key(
                            channel["number"], item.name) in channel_favourites,
                    }
                    if is_film_channel:
                        resume = self.channel_film_resume_state(
                            int(channel["number"]), item.name)
                        programme.update({
                            "remote_position": resume["position"],
                            "remote_duration": resume["duration"],
                            "remote_last_watched": resume["updated"],
                        })
                    programmes.append(programme)
            series_resume = self.channel_series_resume_state(
                int(channel["number"]), programmes) if not is_film_channel else {}
            response.append({"number": channel["number"], "name": channel["name"],
                             "folder": channel["folder"],
                             "aspect": channel.get("aspect", "crop"),
                             "content_type": self.channel_content_type(channel),
                             "enabled": channel["number"] not in disabled_channels,
                             "favourite": (not is_film_channel
                                           and int(channel["number"])
                                           in favourite_channels),
                             "resume_file": series_resume.get("file", ""),
                             "resume_position": series_resume.get("position", 0),
                             "resume_browser_ready": series_resume.get(
                                 "browser_ready", True),
                             "resume_title": series_resume.get("title", ""),
                             "programmes": programmes,
                             "enabled_programmes": sum(p["enabled"] for p in programmes),
                             "metadata": channel_metadata.get(
                                 str(channel["number"]), {})})
        disk = shutil.disk_usage(self.media_root)
        owner = self.owner()
        return {
            "channels": response,
            "appearance": {
                "parent_overlay_style": self.parent_overlay_style(settings),
                "tv_guide_enabled": self.tv_guide_enabled(settings),
                "portal_theme": settings.get("portal_theme")
                if settings.get("portal_theme") in {"dark", "light"} else "dark",
                "portal_design": settings.get("portal_design")
                if settings.get("portal_design") in {"current", "signal", "aperture"} else "current",
                "portal_palette": settings.get("portal_palette")
                if settings.get("portal_palette") in {
                    "ember", "tide", "grove", "plum", "ochre", "mono"
                } else "ember",
            },
            "tv_settings": self.tv_settings(settings),
            "remote_viewing": self.remote_settings(),
            "adult_library": self.adult_library(),
            "adult_folders": self.adult_folders(),
            "adult_series": self.adult_series_library(),
            "recycle": self.recycle_items(),
            "uploads": self.upload_jobs(),
            "storage": {"free_gb": disk.free / 1024**3,
                        "used_gb": disk.used / 1024**3,
                        "total_gb": disk.total / 1024**3},
            "system": self.system_status(),
            "owner": {"name": owner.get("owner_name", "Owner"),
                      "child_name": self.tv_identity()[0],
                      "tv_name": self.tv_identity()[1],
                      "portal_pin_required": self.portal_pin_required(),
                      "pin_change_recommended": bool(owner.get("legacy_default_pin"))},
        }

    def upload_jobs(self) -> list[dict[str, Any]]:
        """Return durable, non-complete work for the owner dashboard."""
        jobs: list[dict[str, Any]] = []
        channel_names = {int(value.get("number", -1)): str(value.get("name", "Channel"))
                         for value in self.channels()}
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            value = self.read_json(manifest, {})
            if not isinstance(value, dict) or not value.get("id"):
                continue
            part = self.incoming / f"{value['id']}.part"
            try:
                size = int(value.get("size", 0))
                status = str(value.get("status", "uploading"))
                # A create request is durable before its first chunk arrives.
                # No .part therefore means 0% while uploading, not 100%.
                # In publishing/finalising the source may already have been
                # atomically moved, so those later states legitimately count
                # the upload bytes as fully received.
                offset = part.stat().st_size if part.exists() \
                    else (0 if status == "uploading" else size)
                upload_kind = str(value.get("kind") or "channel")
                adult = upload_kind == "adult"
                adult_series = upload_kind == "adult-series"
                number = -1 if adult or adult_series else int(value.get("channel", -1))
            except (OSError, TypeError, ValueError):
                continue
            transfer_state = str(value.get("transfer_state", "active" if status == "uploading" else "complete"))
            source_seen = float(value.get("source_seen", 0) or 0)
            jobs.append({
                "id": value["id"],
                "file_name": str(value.get("file_name", "Video")),
                "channel": number,
                "channel_name": "Adult TV series" if adult_series else
                "Adult mode" if adult else channel_names.get(number, f"CH {number}"),
                "kind": "adult-series" if adult_series else "adult" if adult else "channel",
                "size": size,
                "offset": offset,
                "status": status,
                "error": value.get("error"),
                "created": float(value.get("created", 0)),
                "queue_order": int(value.get("queue_order", 0) or 0),
                "transfer_state": transfer_state,
                "source_available": bool(source_seen and time.time() - source_seen <= UPLOAD_SOURCE_GRACE_SECONDS),
                "cancelable": status in {
                    "uploading", "queued", "error"
                },
                "retryable": (status == "error"
                              and part.is_file() and offset == size),
            })
        for result_path in self.incoming.glob("*.result.json"):
            value = self.read_json(result_path, {})
            if not isinstance(value, dict) or value.get("status") not in {
                    "error", "refresh-error"}:
                continue
            upload_kind = str(value.get("kind") or "channel")
            adult = upload_kind == "adult"
            adult_series = upload_kind == "adult-series"
            number = -1 if adult or adult_series else int(value.get("channel", -1))
            jobs.append({
                "id": value.get("id", result_path.name.removesuffix(".result.json")),
                "file_name": str(value.get("file_name", "Video")),
                "channel": number,
                "channel_name": "Adult TV series" if adult_series else
                "Adult mode" if adult else channel_names.get(number, f"CH {number}"),
                "kind": "adult-series" if adult_series else "adult" if adult else "channel",
                "size": int(value.get("offset", 0)),
                "offset": int(value.get("offset", 0)),
                "status": str(value.get("status")),
                "error": value.get("error"),
                "created": float(value.get("finished", 0)),
                "cancelable": value.get("status") == "error",
                "retryable": False,
                "refreshable": value.get("status") == "refresh-error",
            })
        return sorted(jobs, key=lambda value: (value.get("queue_order", 0), value["created"]))

    def next_upload_queue_order(self) -> int:
        orders = []
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            value = self.read_json(manifest, {})
            if isinstance(value, dict):
                try: orders.append(int(value.get("queue_order", 0)))
                except (TypeError, ValueError): pass
        return max(orders, default=0) + 1

    def initialise_upload_queue(self, metadata: dict[str, Any], source_id: str) -> None:
        """Give every browser-selected file a durable, Pi-owned place in line."""
        if not re.fullmatch(r"[a-f0-9]{32}", source_id):
            source_id = ""
        has_active = any(item.get("status") == "uploading" and
                         item.get("transfer_state") == "active"
                         for item in self.upload_jobs())
        metadata["queue_order"] = self.next_upload_queue_order()
        metadata["transfer_state"] = "waiting" if has_active else "active"
        if source_id:
            metadata["source_id"] = source_id
            metadata["source_seen"] = time.time()

    def reconnect_upload_source(self, manifest: Path, metadata: dict[str, Any],
                                source_id: str) -> None:
        """Reconnect a reselected local file to its durable upload reservation."""
        if re.fullmatch(r"[a-f0-9]{32}", source_id):
            metadata["source_id"] = source_id
            metadata["source_seen"] = time.time()
        if metadata.get("status") == "paused":
            active_exists = any(
                item.get("id") != metadata.get("id")
                and item.get("status") == "uploading"
                and item.get("transfer_state") == "active"
                for item in self.upload_jobs()
            )
            metadata["status"] = "uploading"
            metadata["transfer_state"] = "waiting" if active_exists else "active"
        metadata["updated"] = time.time()
        self.write_json(manifest, metadata)

    def promote_next_upload(self) -> None:
        """Hand the one transfer slot to the earliest waiting, incomplete job."""
        candidates: list[tuple[int, Path, dict[str, Any]]] = []
        for manifest in self.incoming.glob("*.json"):
            if manifest.name.endswith(".result.json"):
                continue
            value = self.read_json(manifest, {})
            if not isinstance(value, dict) or value.get("status", "uploading") != "uploading":
                continue
            if value.get("transfer_state") != "waiting":
                continue
            try: order = int(value.get("queue_order", 0) or 0)
            except (TypeError, ValueError): order = 0
            candidates.append((order, manifest, value))
        if candidates:
            _, manifest, value = min(candidates, key=lambda item: item[0])
            value["transfer_state"] = "active"
            value["updated"] = time.time()
            self.write_json(manifest, value)

    def live_status(self) -> dict[str, Any]:
        """Small polling payload that cannot overwrite an in-progress form."""
        disk = shutil.disk_usage(self.media_root)
        return {
            "uploads": self.upload_jobs(),
            "storage": {"free_gb": disk.free / 1024**3,
                        "used_gb": disk.used / 1024**3,
                        "total_gb": disk.total / 1024**3},
            "system": self.system_status(),
        }

    def activity_status(self) -> dict[str, Any]:
        """Small, durable owner-facing queue for background media work."""
        uploads = self.upload_jobs()
        optimisations = self.adult_optimisations()["items"]
        active_uploads = [item for item in uploads if item.get("status") not in {"error", "refresh-error"}]
        active_optimisations = [item for item in optimisations
                                if item.get("state") in {"queued", "processing", "paused"}]
        temperature = self.cpu_temperature_c()
        return {
            "uploads": uploads,
            "optimisations": optimisations,
            "temperature_c": round(temperature, 1),
            "temperature_warning": temperature >= 65,
            "active": bool(active_uploads or active_optimisations),
        }

    @staticmethod
    def command_output(command: list[str], timeout: int = 4) -> str:
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True,
                                    timeout=timeout)
            return result.stdout.strip() if result.returncode == 0 else ""
        except (OSError, subprocess.TimeoutExpired):
            return ""

    def wake_connected_tv_only(self) -> None:
        """Queue CEC Image View On without selecting MabelTV's HDMI input."""
        configured = os.environ.get("MABELTV_CEC_DEVICE", "").strip()
        # /dev/cec0 is the verified adapter on this Pi.  Starting cec-client
        # asynchronously matches the original native turn-on flow: the TV is
        # allowed to wake while SSAP keeps retrying the Netflix launch.
        device = configured or "/dev/cec0"
        if not Path(device).exists():
            raise ValueError("MabelTV could not find the connected television's CEC adapter")
        try:
            process = subprocess.Popen(
                ["cec-client", "-s", "-d", "1", "-t", "p", "-o", "MabelTV", device],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                start_new_session=True,
            )
            if process.stdin is None:
                raise OSError("CEC wake process did not provide standard input")
            process.stdin.write("on 0\n")
            process.stdin.close()
        except OSError as exc:
            raise ValueError("MabelTV could not wake the connected television") from exc
        lg_webos_log("CEC wake queued without Active Source")

    def system_status(self) -> dict[str, Any]:
        disk = shutil.disk_usage(self.media_root)
        temperature = self.cpu_temperature_c()
        player_active = self.command_output(
            ["systemctl", "is-active", "mabeltv.service"]) == "active"
        library_active = self.command_output(
            ["systemctl", "is-active", "mabeltv-library.service"]) in {"active", ""}
        throttled_text = self.command_output(["vcgencmd", "get_throttled"])
        try:
            throttled_value = int(throttled_text.partition("=")[2], 16)
        except ValueError:
            throttled_value = 0
        current_throttle = throttled_value & 0xFFFF
        version_path = Path(__file__).with_name("VERSION")
        try:
            version = version_path.read_text(encoding="utf-8").strip()
        except OSError:
            version = "development"
        try:
            uptime_seconds = int(float(Path("/proc/uptime").read_text().split()[0]))
        except (OSError, ValueError, IndexError):
            uptime_seconds = 0
        warnings: list[str] = []
        if not player_active:
            warnings.append("The TV player is not running")
        if temperature >= 75:
            warnings.append("The Raspberry Pi is running hot")
        if current_throttle:
            warnings.append("The Pi is currently reducing performance because of heat or power")
        if disk.free < 2 * 1024**3:
            warnings.append("Less than 2 GB of storage remains")
        if self.owner().get("legacy_default_pin"):
            warnings.append("Change the original default parent PIN")
        worker_running = self.conversion_worker.is_alive()
        if not worker_running:
            warnings.append("The video preparation worker is not running")
        return {
            "healthy": player_active and library_active and temperature < 75
                       and current_throttle == 0 and disk.free >= 2 * 1024**3
                       and worker_running,
            "player": "running" if player_active else "stopped",
            "temperature_c": round(temperature, 1),
            "currently_throttled": current_throttle != 0,
            "historical_throttle": throttled_value != 0,
            "uptime_seconds": uptime_seconds,
            "version": version,
            "device_name": socket.gethostname(),
            "media_worker": "running" if worker_running else "stopped",
            "warnings": warnings,
        }

    def admin_action(self, action: str) -> str:
        if action not in {"restart-player", "reboot", "poweroff", "diagnostics"}:
            raise ValueError("Unknown system action")
        timeout = 330 if action == "diagnostics" else 15
        try:
            result = subprocess.run(
                ["sudo", "-n", "/usr/local/libexec/mabeltv-admin-action", action],
                check=False, capture_output=True, text=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Mabel TV could not complete that system action") from error
        if result.returncode != 0:
            details = result.stderr.strip()
            raise ValueError(details or "Mabel TV could not complete that system action")
        return result.stdout.strip()

    def live_tv_status(self) -> dict[str, Any]:
        mode = self.player_mode_status()
        adult_mode = mode.get("mode") == "adult"
        status = self.live_stream.status(allow_screen_without_programme=adult_mode)
        for field in ("volume", "muted", "remote_locked", "standby", "subtitles_available",
                      "subtitles_visible", "widescreen_available", "widescreen_enabled",
                      "connected_tv_available", "connected_tv_power"):
            if field in mode:
                status[field] = mode[field]
        if adult_mode:
            playing = mode.get("playing") is True
            status.update({
                "available": mode.get("standby") is not True,
                "adult_mode": True,
                "adult_playing": playing,
                "programme": str(mode.get("programme") or "Film library")
                             if playing else "Film library",
                "paused": mode.get("paused") is True,
            })
            try:
                status["playback_position"] = round(max(
                    0.0, float(mode.get("playback_position", 0) or 0)))
                status["playback_duration"] = round(max(
                    0.0, float(mode.get("playback_duration", 0) or 0)))
            except (TypeError, ValueError):
                status["playback_position"] = 0
                status["playback_duration"] = 0
            status.pop("reason", None)
        else:
            activity = self.current_tv_viewing(mode)
            if activity:
                status["playback_position"] = round(max(
                    0.0, float(activity.get("position", 0) or 0)))
                status["playback_duration"] = round(max(
                    0.0, float(activity.get("media_duration", 0) or 0)))
        return status

    def player_mode_status(self) -> dict[str, Any]:
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(1)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall(b"status\n")
                response = json.loads(client.recv(4096).decode())
        except (AttributeError, OSError, TimeoutError, UnicodeDecodeError,
                json.JSONDecodeError):
            return {}
        return response if isinstance(response, dict) else {}

    def live_tv_manifest(self) -> Path:
        return self.live_stream.manifest()

    def live_tv_segment(self, name: str) -> Path:
        return self.live_stream.segment(name)

    def live_tv_frame(self) -> bytes:
        return self.live_stream.preview()

    def stop_live_tv(self) -> dict[str, Any]:
        # Older portal pages still send this when their view closes. The
        # current live preview is shared, so one stale page must not be able
        # to tear down the picture another portal is watching.
        return {"ok": True}

    def live_tv_control(self, payload: dict[str, Any]) -> dict[str, Any]:
        command = str(payload.get("command", ""))
        allowed = {"channel-up", "channel-down", "previous-programme", "next-programme",
                   "toggle-pause", "toggle-subtitles", "toggle-widescreen-mode",
                   "volume-up", "volume-down", "toggle-mute",
                   "turn-on", "turn-off", "turn-on-mabel-only", "turn-off-mabel-only",
                   "toggle-power",
                   "open-parent-menu", "open-tv-guide", "open-channel-menu", "close-overlay", "restart-programme",
                   "enter-adult-mode", "navigate-up", "navigate-down", "navigate-left",
                   "navigate-right", "select", "return-to-mabeltv", "toggle-remote-lock",
                   "tune-channel"}
        if command not in allowed:
            raise ValueError("Unknown live TV control")
        wire_command = command
        if command == "tune-channel":
            try:
                channel_number = int(payload.get("channel"))
            except (TypeError, ValueError) as error:
                raise ValueError("Choose a channel") from error
            channel = self.channel(channel_number)
            if not channel.get("enabled", True):
                raise ValueError("That channel is hidden from the television")
            wire_command = json.dumps({"command": command, "channel": channel_number},
                                      separators=(",", ":"))
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall((wire_command + "\n").encode())
                reply = client.recv(32).decode(errors="replace").strip()
        except OSError as error:
            raise ValueError("The TV player is not ready for portal controls") from error
        if reply != "ok":
            raise ValueError("The TV could not accept that control")
        return {"ok": True, "message": "Command sent"}

    def play_on_tv(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Start a known library item through the private player socket."""
        kind = str(payload.get("kind", ""))
        if kind == "channel":
            _kind, source, title, library_id, resume = self.remote_source(payload)
            if "position" in payload:
                try:
                    resume = max(0.0, float(payload.get("position", 0)))
                except (TypeError, ValueError) as error:
                    raise ValueError("That playback position is not valid") from error
            channel = self.channel(int(payload.get("channel", 0)))
            command = {"command": "play-programme", "channel": int(channel["number"]),
                       "file": source.name}
            if library_id or "position" in payload:
                command["position"] = resume
            skip_film_countdown = self.channel_content_type(channel) == "films"
        elif kind == "adult":
            _kind, source, title, _library_id, resume = self.remote_source(payload)
            if "position" in payload:
                try:
                    resume = max(0.0, float(payload.get("position", 0)))
                except (TypeError, ValueError) as error:
                    raise ValueError("That playback position is not valid") from error
            command = {"command": "play-adult-film",
                       "file": self.adult_relative_path(source),
                       "position": resume}
            skip_film_countdown = False
        elif kind == "adult-series":
            _kind, source, title, _library_id, _resume = self.remote_source(payload)
            command = {"command": "play-external", "path": str(source),
                       "title": title}
            skip_film_countdown = False
        else:
            raise ValueError("Choose a programme, Adult film, or episode to play")
        if not source.is_file():
            raise ValueError("That video is no longer in the Mabel TV library")
        state = self.read_json(self.player_state_path, {})
        woke_tv = False
        if isinstance(state, dict) and state.get("standby"):
            self.live_tv_control({"command": "turn-on"})
            woke_tv = True
        sent_to_player = False
        accepted_without_reply = False
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall((json.dumps(command, separators=(",", ":")) + "\n").encode())
                sent_to_player = True
                reply = client.recv(32).decode(errors="replace").strip()
        except socket.timeout as error:
            # A busy renderer transition can delay the socket acknowledgement
            # even though the complete command is already queued in the local
            # player.  Do not turn that accepted request into the false failure
            # the portal previously showed while the film started on screen.
            if not sent_to_player:
                raise ValueError("The TV player is not ready to start that video") from error
            accepted_without_reply = True
            reply = "ok"
        except OSError as error:
            raise ValueError("The TV player is not ready to start that video") from error
        if reply != "ok":
            raise ValueError("The TV could not start that video")
        if skip_film_countdown:
            # Film channels normally show the child-friendly 10-second leader.
            # A parent has already confirmed this explicit portal replacement,
            # so use the existing Select action once tuning has opened the
            # leader. This makes Play on TV immediate without adding a second
            # playback path or weakening the player's validation.
            time.sleep(0.8)
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(2)
                    client.connect("/run/mabeltv/portal-control.sock")
                    client.sendall(b"select\n")
                    skip_reply = client.recv(32).decode(errors="replace").strip()
            except OSError as error:
                raise ValueError("The film was selected, but Mabel TV could not start it immediately") from error
            if skip_reply != "ok":
                raise ValueError("The film was selected, but Mabel TV could not start it immediately")
        verb = "Starting" if accepted_without_reply else "Playing"
        return {"ok": True,
                "message": (f"Turned on Mabel TV and {verb.lower()} "
                            f"{title}"
                            if woke_tv else
                            f"{verb} {title} on Mabel TV")}

    def support_bundle(self) -> Path:
        self.admin_action("diagnostics")
        bundle = Path("/var/lib/mabeltv/support/mabeltv-support.tar.gz")
        if not bundle.is_file():
            raise ValueError("The support bundle could not be created")
        return bundle

    def login_allowed(self, address: str) -> bool:
        with self.config_lock:
            now = time.time()
            attempts = [value for value in self.login_failures.get(address, [])
                        if value > now - 5 * 60]
            self.login_failures[address] = attempts
            return len(attempts) < 5

    def record_login_failure(self, address: str) -> None:
        with self.config_lock:
            self.login_failures.setdefault(address, []).append(time.time())

    def clear_login_failures(self, address: str) -> None:
        with self.config_lock:
            self.login_failures.pop(address, None)

    def create_session(self) -> str:
        with self.config_lock:
            now = time.time()
            self.sessions = {token: expiry for token, expiry in self.sessions.items()
                             if expiry > now}
            token = secrets.token_urlsafe(32)
            self.sessions[token] = now + SESSION_SECONDS
            return token

    def valid_session(self, token: str | None) -> bool:
        if not token:
            return False
        with self.config_lock:
            # A parent actively using the portal should not be sent back to
            # the PIN screen halfway through an evening.  Sessions remain
            # memory-only (so a real service restart still signs out safely),
            # but each authenticated request renews the eight-hour window.
            if self.sessions.get(token, 0) <= time.time():
                return False
            self.sessions[token] = time.time() + SESSION_SECONDS
            return True

    def revoke_session(self, token: str | None) -> None:
        if token:
            with self.config_lock:
                self.sessions.pop(token, None)

    @staticmethod
    def display_name(name: str) -> str:
        stem = Path(name).stem.replace("_", " ").strip()
        match = EPISODE_NAME.match(stem)
        if match:
            return f"S{int(match.group(1)):02} E{int(match.group(2)):02} · {match.group(3).strip()}"
        return stem

    def reconcile_recycle_items(self) -> None:
        """Resolve a power loss on either side of a recycle-bin move."""
        for manifest_path in self.bin.glob("*/manifest.json"):
            item = self.read_json(manifest_path, {})
            file_name = Path(str(item.get("file_name", ""))).name
            folder = str(item.get("folder", ""))
            if not file_name or not folder:
                continue
            recycled = manifest_path.parent / file_name
            original = self.media_root / folder / file_name
            if recycled.is_file():
                # The intent record was durable before the atomic move, so a
                # crash after the move still leaves a visible restorable item.
                continue
            if original.is_file():
                # Crash/failure occurred before the move. The programme never
                # left its channel, so discard only the empty intent record.
                try:
                    shutil.rmtree(manifest_path.parent)
                except OSError as error:
                    print(f"Could not clear incomplete recycle item {manifest_path.parent}: {error}",
                          file=sys.stderr, flush=True)

    def recycle_items(self) -> list[dict[str, str]]:
        values = []
        for manifest in self.bin.glob("*/manifest.json"):
            item = self.read_json(manifest, {})
            file_name = Path(str(item.get("file_name", ""))).name
            if item.get("id") and file_name \
                and (manifest.parent / file_name).is_file():
                values.append({"id": item["id"], "display_name": self.display_name(item["file_name"]), "channel_name": item.get("channel_name", "Unknown channel")})
        return sorted(values, key=lambda value: value["id"], reverse=True)

    def update_settings(self, mutator: Any) -> None:
        with self.config_lock:
            settings = self.settings()
            library = settings.setdefault("library", {})
            library.setdefault("disabled_channels", [])
            library.setdefault("disabled_programmes", {})
            mutator(library)
            self.write_json(self.settings_path, settings)

    def update_channels(self, mutator: Any) -> None:
        with self.config_lock:
            root = self.read_json(self.channels_path, {"schema_version": 1, "channels": []})
            values = root.get("channels", [])
            mutator(values)
            root["schema_version"] = 1
            root["channels"] = self.normalise_channels(values)
            self.write_json(self.channels_path, root)

    def refresh_tv(self) -> bool:
        for attempt in range(3):
            try:
                if subprocess.run(
                        ["sudo", "-n", "/usr/local/libexec/mabeltv-library-refresh"],
                        check=False, capture_output=True, timeout=15).returncode == 0:
                    return True
            except (OSError, subprocess.TimeoutExpired):
                pass
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        return False

    def video_info(self, path: Path) -> dict[str, Any]:
        try:
            result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate", "-of", "json", str(path)], check=False, capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Mabel TV could not finish checking that video") from error
        try:
            streams = json.loads(result.stdout).get("streams", [])
        except (TypeError, ValueError):
            streams = []
        if result.returncode != 0 or not streams or streams[0].get("codec_type") != "video":
            raise ValueError("Mabel TV could not find a video stream in that file")
        return streams[0]

    @staticmethod
    def frame_rate(stream: dict[str, Any]) -> float:
        try:
            numerator, denominator = str(stream.get("avg_frame_rate", "0/1")).split("/", 1)
            return float(numerator) / float(denominator)
        except (TypeError, ValueError, ZeroDivisionError):
            return 0.0

    def needs_playback_optimisation(self, source: Path, stream: dict[str, Any]) -> bool:
        # Preserve ordinary prepared programmes. High-frame-rate footage is an
        # exception irrespective of container: this Pi software-decodes it and
        # cannot sustain 50/60fps playback safely. MOV uploads are also
        # normalised when they exceed the supported playback dimensions.
        frame_rate = self.frame_rate(stream)
        return (frame_rate > PLAYBACK_FPS + 0.1
                or (source.suffix.lower() == ".mov"
                    and (int(stream.get("width", 0)) > PLAYBACK_WIDTH
                         or int(stream.get("height", 0)) > PLAYBACK_HEIGHT)))

    def optimise_for_playback(self, source: Path, destination: Path) -> None:
        self._optimise_for_playback(
            source, destination,
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
            "2500k", "3000k", "5000k")

    def optimise_adult_for_playback(self, source: Path, destination: Path,
                                    progress_callback: Any = None) -> None:
        # Films are normally 23.976/24/25 fps. Preserve that cadence instead
        # of manufacturing duplicate 30 fps frames, while capping the stream
        # at a level the Pi can decode smoothly in hardware.
        self._optimise_for_playback(
            source, destination,
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "1800k", "2000k", "4000k", progress_callback
            or self.adult_optimisation_progress_callback)

    def request_adult_optimisation(self, file_name: str) -> None:
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        relative = self.adult_relative_path(source)
        state = self.adult_media_states().get(relative, {})
        if isinstance(state, dict) and state.get("state") in {"queued", "processing"}:
            raise ValueError("This film is already being optimised")
        # Keep the original until the new copy has passed validation and has
        # been atomically published. Only then is the original removed.
        reserve = source.stat().st_size + 512 * 1024 * 1024
        if shutil.disk_usage(self.media_root).free < reserve:
            raise ValueError("There is not enough free space to safely optimise this film")
        with self.adult_optimisation_lock:
            if relative in self.adult_optimisation_active:
                raise ValueError("This film is already being optimised")
            self.adult_optimisation_active.add(relative)
        with self.config_lock:
            self.set_adult_media_state(relative, "queued", progress=0)
        threading.Thread(target=self.optimise_adult_file, args=(relative,),
                         name="mabeltv-adult-optimise", daemon=True).start()

    def adult_optimisation_action(self, file_name: str, action: str) -> None:
        if action not in {"pause", "resume", "cancel"}:
            raise ValueError("Unknown optimisation action")
        source = self.safe_adult_path(file_name)
        relative = self.adult_relative_path(source)
        with self.config_lock:
            state = self.adult_media_states().get(relative, {})
            current = str(state.get("state", "")) if isinstance(state, dict) else ""
            if action == "pause":
                if current not in {"queued", "processing"}:
                    raise ValueError("This optimisation cannot be paused now")
                self.set_adult_media_state(relative, "paused", "Paused by you",
                                           progress=int(state.get("progress", 0) or 0))
            elif action == "resume":
                if current != "paused":
                    raise ValueError("This optimisation is not paused")
                self.set_adult_media_state(relative, "processing", "",
                                           progress=int(state.get("progress", 0) or 0))
            else:
                if current not in {"queued", "processing", "paused"}:
                    raise ValueError("This optimisation cannot be cancelled now")
                self.set_adult_media_state(relative, "error", "Optimisation cancelled",
                                           progress=int(state.get("progress", 0) or 0))

    def optimise_adult_file(self, file_name: str) -> None:
        source = self.safe_adult_path(file_name)
        try:
            # One encoder at a time keeps temperature and memory use inside a
            # predictable envelope even if two portal buttons are pressed.
            with self.adult_optimisation_serial:
                if not source.is_file():
                    raise ValueError("Film not found")
                destination = source.with_suffix(".mp4")
                if destination != source and destination.exists():
                    raise ValueError("An MP4 with this film name already exists")
                with self.config_lock:
                    started = time.time()
                    self.set_adult_media_state(file_name, "processing", progress=0,
                                               started=started, eta_seconds=None)

                def save_progress(percent: int, message: str = "") -> None:
                    elapsed = max(0.0, time.time() - started)
                    eta = int(elapsed * (100 - percent) / percent) if percent > 0 else 0
                    with self.config_lock:
                        current = self.adult_media_states().get(file_name, {})
                        saved_state = "paused" if isinstance(current, dict) \
                            and current.get("state") == "paused" else "processing"
                        self.set_adult_media_state(
                            file_name, saved_state, message, progress=percent,
                            started=started, eta_seconds=eta or None)

                self.adult_optimisation_progress_callback = save_progress
                self.optimise_adult_for_playback(source, destination)
                if destination != source:
                    source.unlink()
                destination_relative = self.adult_relative_path(destination)
                with self.config_lock:
                    states = self.adult_media_states()
                    current = states.pop(file_name, {})
                    if not isinstance(current, dict):
                        current = {}
                    current.update({"state": "optimised", "message": "",
                                    "progress": 100, "updated": time.time()})
                    states[destination_relative] = current
                    self.write_adult_media_states(states)
                self.refresh_tv()
        except Exception as error:
            with self.config_lock:
                self.set_adult_media_state(
                    file_name, "error",
                    str(error) if isinstance(error, ValueError)
                    else "MabelTV could not optimise this film")
        finally:
            self.adult_optimisation_progress_callback = None
            with self.adult_optimisation_lock:
                self.adult_optimisation_active.discard(file_name)

    def _optimise_for_playback(self, source: Path, destination: Path,
                               video_filter: str, bitrate: str,
                               maximum_bitrate: str, buffer_size: str,
                               progress_callback: Any = None) -> None:
        token = uuid.uuid4().hex
        temporary = self.incoming / f"{token}.optimising.mp4"
        error_log = self.incoming / f"{token}.ffmpeg.log"
        try:
            duration_result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
                check=False, capture_output=True, text=True, timeout=30)
            duration = max(0.0, float(duration_result.stdout.strip()))
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            duration = 0.0
        command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                   "-threads", "2", "-filter_threads", "2", "-i", str(source),
                   "-map", "0:v:0", "-map", "0:a:0?", "-vf", video_filter,
                   # Debian 13 exposes Pi hardware decode but no usable V4L2
                   # H.264 encoder node. A bounded two-thread software encode
                   # is slower, but reliable; the resulting file is then
                   # hardware-decoded during every actual TV playback.
                   "-c:v", "libx264", "-preset", "veryfast", "-threads:v", "2",
                   "-profile:v", "main", "-level:v", "3.1", "-b:v", bitrate,
                   "-maxrate", maximum_bitrate, "-bufsize", buffer_size,
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                   "-progress", "pipe:1", "-nostats", str(temporary)]
        process: subprocess.Popen[str] | None = None
        paused = False
        deadline = time.monotonic() + 45 * 60
        last_percent = -1
        try:
            with error_log.open("wb") as errors:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors,
                                           text=True, start_new_session=True)
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        os.killpg(process.pid, signal.SIGTERM)
                        raise ValueError("Mabel TV stopped this optimisation because it took too long")
                    saved = self.adult_media_states().get(self.adult_relative_path(source), {})
                    requested_state = str(saved.get("state", "")) if isinstance(saved, dict) else ""
                    if requested_state == "error" and str(saved.get("message", "")) == "Optimisation cancelled":
                        os.killpg(process.pid, signal.SIGTERM)
                        raise ValueError("Optimisation cancelled")
                    user_paused = requested_state == "paused"
                    temperature = self.cpu_temperature_c()
                    if not paused and (user_paused or temperature >= MAX_CONVERSION_TEMP_C):
                        os.killpg(process.pid, signal.SIGSTOP)
                        paused = True
                        if progress_callback:
                            progress_callback(max(0, last_percent),
                                              "Paused by you" if user_paused else f"Paused to cool at {temperature:.0f}°C")
                        print(f"Paused video optimisation at {temperature:.1f}C", file=sys.stderr,
                              flush=True)
                    elif paused and not user_paused and temperature <= RESUME_CONVERSION_TEMP_C:
                        os.killpg(process.pid, signal.SIGCONT)
                        paused = False
                        if progress_callback:
                            progress_callback(max(0, last_percent), "")
                        print(f"Resumed video optimisation at {temperature:.1f}C", file=sys.stderr,
                              flush=True)
                    if paused:
                        time.sleep(2)
                        continue
                    line = process.stdout.readline() if process.stdout else ""
                    if duration <= 0 or not line.startswith(
                            ("out_time_us=", "out_time_ms=")):
                        continue
                    try:
                        completed = float(line.split("=", 1)[1].strip()) / 1_000_000
                    except (TypeError, ValueError):
                        continue
                    percent = min(99, max(0, int(completed * 100 / duration)))
                    if percent <= last_percent:
                        continue
                    last_percent = percent
                    if progress_callback:
                        progress_callback(percent, "")
                if process.returncode != 0:
                    details = error_log.read_text(encoding="utf-8", errors="replace").strip()
                    if details:
                        print(details[-4000:], file=sys.stderr, flush=True)
                    raise ValueError("Mabel TV could not optimise this video for smooth playback")
            self.video_info(temporary)
            os.replace(temporary, destination)
        finally:
            if process is not None and process.poll() is None:
                if paused:
                    os.killpg(process.pid, signal.SIGCONT)
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
            temporary.unlink(missing_ok=True)
            error_log.unlink(missing_ok=True)

    @staticmethod
    def cpu_temperature_c() -> float:
        try:
            return int(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()) / 1000
        except (OSError, ValueError):
            return 0.0

    def upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        # The HTTP server is threaded. Serialising lookup and creation prevents
        # two simultaneous requests from reserving duplicate jobs for one file.
        with self.config_lock:
            return self._upload_create(payload)

    def adult_upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Reserve a resumable upload prepared for reliable Pi playback."""
        with self.config_lock:
            file_name = str(payload.get("file_name", ""))
            requested_folder = str(payload.get("folder", "")).strip()
            folder = self.normalise_adult_folder(requested_folder) if requested_folder else ""
            size = int(payload.get("size", 0))
            relative = f"{folder}/{file_name}" if folder else file_name
            destination = self.safe_adult_path(relative, create_folder=bool(folder))
            if size <= 0 or size > MAX_UPLOAD_BYTES:
                raise ValueError("That file size is not supported")

            for manifest in self.incoming.glob("*.json"):
                if manifest.name.endswith(".result.json"):
                    continue
                value = self.read_json(manifest, {})
                if (value.get("kind") != "adult" or value.get("file_name") != file_name
                        or str(value.get("folder", "")) != folder):
                    continue
                if value.get("size") != size:
                    raise ValueError(
                        "A film with that name is already uploading. Resume it with the same file")
                part = self.incoming / f"{value['id']}.part"
                result = self.read_json(self.incoming / f"{value['id']}.result.json", None)
                if isinstance(result, dict) and result.get("complete"):
                    return result
                self.reconnect_upload_source(
                    manifest, value, str(payload.get("source_id", "")))
                offset = part.stat().st_size if part.is_file() else 0
                if offset == size and value.get("status", "uploading") == "uploading":
                    value["status"] = "validating"
                    value["updated"] = time.time()
                    self.write_json(manifest, value)
                    self.queue_conversion(str(value["id"]))
                return {"id": value["id"], "offset": offset,
                        "transfer_state": value.get("transfer_state", "active"),
                        "processing": value.get("status") in {
                            "validating", "queued", "processing", "publishing", "finalising"
                        }, "status": value.get("status", "uploading")}

            if destination.exists() or destination.with_suffix(".mp4").exists():
                raise ValueError("A film with that name already exists in Adult mode")
            # Adult films arrive untouched. A later owner-approved conversion
            # reserves source-and-output space only if it is actually needed.
            reserve = size + 512 * 1024 * 1024
            if shutil.disk_usage(self.media_root).free < reserve:
                raise ValueError("There is not enough free space to upload that film")
            upload_id = uuid.uuid4().hex
            metadata = {
                "id": upload_id,
                "kind": "adult",
                "file_name": file_name,
                "folder": folder,
                "size": size,
                "created": time.time(),
            }
            self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
            self.write_json(self.incoming / f"{upload_id}.json", metadata)
            return {"id": upload_id, "offset": 0, "transfer_state": metadata["transfer_state"]}

    def adult_series_upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Reserve a resumable episode upload into one explicit series season."""
        with self.config_lock:
            series_id = str(payload.get("series", ""))
            series_root = self.adult_series_path(series_id)
            try:
                season = int(payload.get("season"))
            except (TypeError, ValueError) as error:
                raise ValueError("Choose a series number") from error
            if season < 1 or season > 99:
                raise ValueError("Choose a series number from 1 to 99")
            file_name = str(payload.get("file_name", ""))
            if Path(file_name).name != file_name or Path(file_name).suffix.lower() \
                    not in SUPPORTED_EXTENSIONS:
                raise ValueError("Choose a supported episode video")
            size = int(payload.get("size", 0))
            if size <= 0 or size > MAX_UPLOAD_BYTES:
                raise ValueError("That file size is not supported")
            season_name = f"Season {season}"
            destination = self.adult_series_path(series_id, f"{season_name}/{file_name}")

            for manifest in self.incoming.glob("*.json"):
                if manifest.name.endswith(".result.json"):
                    continue
                value = self.read_json(manifest, {})
                if (value.get("kind") != "adult-series"
                        or value.get("series_id") != series_id
                        or int(value.get("season", 0) or 0) != season
                        or value.get("file_name") != file_name):
                    continue
                if value.get("size") != size:
                    raise ValueError(
                        "An episode with that name is already uploading. "
                        "Resume it with the same file")
                part = self.incoming / f"{value['id']}.part"
                result = self.read_json(
                    self.incoming / f"{value['id']}.result.json", None)
                if isinstance(result, dict) and result.get("complete"):
                    return result
                self.reconnect_upload_source(
                    manifest, value, str(payload.get("source_id", "")))
                offset = part.stat().st_size if part.is_file() else 0
                if offset == size and value.get("status", "uploading") == "uploading":
                    value["status"] = "validating"
                    value["updated"] = time.time()
                    self.write_json(manifest, value)
                    self.queue_conversion(str(value["id"]))
                return {"id": value["id"], "offset": offset,
                        "transfer_state": value.get("transfer_state", "active"),
                        "processing": value.get("status") in {
                            "validating", "queued", "processing", "publishing", "finalising"
                        }, "status": value.get("status", "uploading")}

            if destination.exists():
                raise ValueError("That series already contains an episode with this file name")
            reserve = size + 512 * 1024 * 1024
            if shutil.disk_usage(self.media_root).free < reserve:
                raise ValueError("There is not enough free space to upload that episode")
            (series_root / season_name).mkdir(mode=0o750, exist_ok=True)
            upload_id = uuid.uuid4().hex
            metadata = {
                "id": upload_id,
                "kind": "adult-series",
                "series_id": series_id,
                "season": season,
                "file_name": file_name,
                "size": size,
                "created": time.time(),
            }
            self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
            self.write_json(self.incoming / f"{upload_id}.json", metadata)
            return {"id": upload_id, "offset": 0, "transfer_state": metadata["transfer_state"]}

    def _upload_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        number, file_name, size = int(payload.get("channel")), str(payload.get("file_name", "")), int(payload.get("size", 0))
        channel = self.channel(number)
        destination = self.safe_media_path(channel, file_name)
        if size <= 0 or size > MAX_UPLOAD_BYTES:
            raise ValueError("That file size is not supported")

        # Find resumable work before applying the fresh-upload reservation. The
        # existing .part has already consumed disk space, so reserving the full
        # source twice again would reject a perfectly safe interrupted upload.
        requested_targets = {destination, destination.with_suffix(".mp4")}
        for meta in self.incoming.glob("*.json"):
            if meta.name.endswith(".result.json"):
                continue
            value = self.read_json(meta, {})
            try:
                existing_channel = self.channel(int(value.get("channel")))
                existing_destination = self.safe_media_path(
                    existing_channel, str(value.get("file_name", "")))
                existing_targets = {
                    existing_destination, existing_destination.with_suffix(".mp4")
                }
            except (TypeError, ValueError):
                continue
            if not requested_targets.isdisjoint(existing_targets):
                if value.get("channel") != number or value.get("file_name") != file_name \
                    or value.get("size") != size:
                    raise ValueError(
                        "A video with that name is already uploading. "
                        "Resume it with the same original file or cancel it first")
                part = self.incoming / (value["id"] + ".part")
                saved_result = self.read_json(
                    self.incoming / f"{value['id']}.result.json", None)
                if isinstance(saved_result, dict) and saved_result.get("complete"):
                    return saved_result
                self.reconnect_upload_source(
                    meta, value, str(payload.get("source_id", "")))
                offset = part.stat().st_size if part.exists() else 0
                reserve = max(0, size - offset) + 512 * 1024 * 1024
                if shutil.disk_usage(self.media_root).free < reserve:
                    raise ValueError("There is not enough free space to safely resume that video")
                if value.get("status") == "error" and offset == size \
                    and value.get("conversion_required") is not None:
                    value["resume_from_status"] = "error"
                    value["status"] = "queued"
                    value.pop("error", None)
                    value["updated"] = time.time()
                    self.write_json(meta, value)
                    self.queue_conversion(str(value["id"]))
                elif offset == size and value.get("status", "uploading") == "uploading":
                    value["status"] = "validating"
                    value["updated"] = time.time()
                    self.write_json(meta, value)
                    self.queue_conversion(str(value["id"]))
                else:
                    value["updated"] = time.time()
                    self.write_json(meta, value)
                return {"id": value["id"], "offset": offset,
                        "transfer_state": value.get("transfer_state", "active"),
                        "processing": value.get("status") in {
                            "validating", "queued", "processing", "publishing", "finalising"
                        },
                        "status": value.get("status", "uploading")}

        if destination.exists() or destination.with_suffix(".mp4").exists():
            raise ValueError("A file with that name already exists in this channel")
        reserve = size + 512 * 1024 * 1024
        if shutil.disk_usage(self.media_root).free < reserve:
            raise ValueError("There is not enough free space to upload that video")
        self.clear_superseded_upload_errors(number, file_name)
        upload_id = uuid.uuid4().hex
        metadata = {"id": upload_id, "channel": number, "file_name": file_name,
                    "size": size, "created": time.time()}
        self.initialise_upload_queue(metadata, str(payload.get("source_id", "")))
        self.write_json(self.incoming / (upload_id + ".json"), metadata)
        return {"id": upload_id, "offset": 0, "transfer_state": metadata["transfer_state"]}

    def upload_action(self, upload_id: str, action: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        if action not in {"cancel", "retry", "refresh", "pause", "resume", "start", "heartbeat"}:
            raise ValueError("Unknown upload action")
        if action == "refresh":
            result_path = self.incoming / f"{upload_id}.result.json"
            result = self.read_json(result_path, None)
            if not isinstance(result, dict) or result.get("status") != "refresh-error":
                raise ValueError("This video is not waiting for a TV refresh")
            if not self.refresh_tv():
                raise ValueError(
                    "The video is safe, but the TV still could not refresh. Restart the TV player or try again")
            with self.config_lock:
                result = self.read_json(result_path, result)
                result["refreshed"] = True
                result["status"] = "complete"
                result["complete"] = True
                self.write_json(result_path, result)
            return {"ok": True, "message": "The TV library was refreshed."}
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
            if not lock.acquire(blocking=False):
                raise ValueError(
                    "This video is already being prepared. Let it finish, then remove it from its channel if needed")
            try:
                manifest = self.incoming / f"{upload_id}.json"
                result_path = self.incoming / f"{upload_id}.result.json"
                metadata = self.read_json(manifest, None)
                result = self.read_json(result_path, None)
                if action == "heartbeat":
                    if not isinstance(metadata, dict):
                        raise ValueError("Upload not found")
                    metadata["source_seen"] = time.time()
                    self.write_json(manifest, metadata)
                    return {"ok": True, "transfer_state": metadata.get("transfer_state", "active")}
                if action == "start":
                    if not isinstance(metadata, dict) or metadata.get("status", "uploading") not in {"uploading", "paused"}:
                        raise ValueError("This upload cannot be started now")
                    for other_path in self.incoming.glob("*.json"):
                        if other_path == manifest or other_path.name.endswith(".result.json"):
                            continue
                        other = self.read_json(other_path, {})
                        if isinstance(other, dict) and other.get("status", "uploading") == "uploading" and other.get("transfer_state") == "active":
                            other["status"] = "paused"
                            other["transfer_state"] = "paused"
                            other["updated"] = time.time()
                            self.write_json(other_path, other)
                    metadata["status"] = "uploading"
                    metadata["transfer_state"] = "active"
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    return {"ok": True, "message": "This upload will start next on its source laptop."}
                if action == "retry":
                    if not isinstance(metadata, dict) or metadata.get("status") != "error":
                        raise ValueError("This upload is not waiting to be retried")
                    part = self.incoming / f"{upload_id}.part"
                    try:
                        ready = part.is_file() and part.stat().st_size == int(metadata["size"])
                    except (OSError, KeyError, TypeError, ValueError):
                        ready = False
                    if not ready:
                        raise ValueError("Choose the original file above to retry this upload")
                    metadata["resume_from_status"] = "error"
                    metadata["status"] = "queued"
                    metadata.pop("error", None)
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    # An error becomes visible just before the worker removes
                    # this ID from its dedupe set. Remember an owner retry in
                    # that narrow window so the worker requeues it on teardown.
                    if upload_id in self.queued_conversions:
                        self.deferred_retries.add(upload_id)
                    else:
                        self.queue_conversion(upload_id)
                    return {"ok": True, "message": "The video is back in the preparation queue."}

                if action == "pause":
                    if not isinstance(metadata, dict) or metadata.get("status", "uploading") not in {"uploading", "queued"}:
                        raise ValueError("This upload cannot be paused now")
                    metadata["status"] = "paused"
                    metadata["transfer_state"] = "paused"
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    return {"ok": True, "message": "Upload paused. It will keep its received files."}

                if action == "resume":
                    if not isinstance(metadata, dict) or metadata.get("status") != "paused":
                        raise ValueError("This upload is not paused")
                    part = self.incoming / f"{upload_id}.part"
                    complete = part.is_file() and part.stat().st_size == int(metadata.get("size", 0))
                    metadata["status"] = "queued" if complete else "uploading"
                    if not complete:
                        active_exists = any(item.get("status") == "uploading" and
                                            item.get("transfer_state") == "active"
                                            for item in self.upload_jobs())
                        metadata["transfer_state"] = "waiting" if active_exists else "active"
                    metadata["updated"] = time.time()
                    self.write_json(manifest, metadata)
                    if complete:
                        self.queue_conversion(upload_id)
                    return {"ok": True, "message": "Upload resumed."}

                status = str(metadata.get("status", "uploading")) \
                    if isinstance(metadata, dict) else str(
                        result.get("status", "") if isinstance(result, dict) else "")
                if status not in {"uploading", "queued", "paused", "error"}:
                    raise ValueError("This upload is already being prepared and can no longer be cancelled")
                self.unlink_with_retry(self.incoming / f"{upload_id}.part")
                self.unlink_with_retry(manifest)
                self.unlink_with_retry(result_path)
                self.deferred_retries.discard(upload_id)
                if upload_id in self.queued_conversions:
                    self.cancelled_conversions.add(upload_id)
                self.upload_locks.pop(upload_id, None)
                if metadata and metadata.get("transfer_state") == "active":
                    self.promote_next_upload()
                return {"ok": True, "message": "The upload was removed and its space was freed."}
            finally:
                lock.release()

    def upload_meta(self, upload_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        meta = self.read_json(self.incoming / (upload_id + ".json"), None)
        if not isinstance(meta, dict):
            raise ValueError("Upload not found")
        return meta

    def upload_status(self, upload_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        result_path = self.incoming / f"{upload_id}.result.json"
        manifest = self.incoming / f"{upload_id}.json"
        metadata = None
        # Atomic replacement can briefly make a file unreadable on Windows,
        # and the worker may remove the manifest during that same request.
        # Re-check both durable records together to close that reader TOCTOU.
        for attempt in range(10):
            result = self.read_json(result_path, None)
            if isinstance(result, dict):
                return result
            metadata = self.read_json(manifest, None)
            if isinstance(metadata, dict):
                break
            if attempt < 9:
                time.sleep(0.01 * (attempt + 1))
        if not isinstance(metadata, dict):
            raise ValueError("Upload not found")
        part = self.incoming / f"{upload_id}.part"
        status = str(metadata.get("status", "uploading"))
        processing_statuses = {
            "validating", "queued", "processing", "publishing", "finalising"
        }
        try:
            offset = part.stat().st_size if part.is_file() \
                else (int(metadata.get("size", 0)) if status in processing_statuses else 0)
        except (OSError, TypeError, ValueError):
            offset = 0
        return {
            "id": upload_id,
            "offset": offset,
            "complete": False,
            "processing": status in processing_statuses,
            "status": status,
            "transfer_state": str(metadata.get("transfer_state", "active")),
            "error": metadata.get("error"),
        }

    def append_upload(self, upload_id: str, offset: int, content: bytes) -> dict[str, Any]:
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
        with lock:
            return self._append_upload(upload_id, offset, content)

    def _append_upload(self, upload_id: str, offset: int, content: bytes) -> dict[str, Any]:
        meta = self.upload_meta(upload_id)
        if meta.get("status") == "paused":
            raise ValueError("This upload is paused")
        if meta.get("transfer_state", "active") != "active":
            raise ValueError("This upload is waiting in the queue")
        part = self.incoming / (upload_id + ".part")
        current = part.stat().st_size if part.exists() else 0
        if offset != current:
            return {"offset": current, "resumable": True}
        if len(content) == 0 or len(content) > CHUNK_LIMIT or current + len(content) > int(meta["size"]):
            raise ValueError("Invalid upload chunk")
        with part.open("ab") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        current += len(content)
        result = {"offset": current, "complete": current == int(meta["size"])}
        meta["updated"] = time.time()
        meta["source_seen"] = time.time()
        if result["complete"]:
            # Persist receipt before any potentially slow probe. The one media
            # worker validates, converts if necessary, publishes, then refreshes
            # the TV. A lost final PATCH response can therefore be polled safely.
            meta["status"] = "validating"
            meta["transfer_state"] = "complete"
            meta["updated"] = time.time()
            self.write_json(self.incoming / (upload_id + ".json"), meta)
            self.queue_conversion(upload_id)
            self.promote_next_upload()
            result["complete"] = False
            result["processing"] = True
            result["status"] = "validating"
            result["id"] = upload_id
        else:
            # One small atomic manifest update per 8 MiB chunk makes recent
            # activity survive a watchdog/service restart and resets the
            # seven-day abandonment clock.
            self.write_json(self.incoming / (upload_id + ".json"), meta)
        return result

    def manage(self, payload: dict[str, Any]) -> bool:
        # Channel changes and upload admission share the same lock so a channel
        # cannot be renumbered or deleted between an upload check and creation.
        if payload.get("action") == "refresh":
            return self.refresh_tv()
        with self.config_lock:
            self._manage(payload)
        if payload.get("action") in {
                "optimise-adult", "set-portal-design", "set-portal-palette",
                "set-portal-theme", "set-remote-simultaneous",
                "create-adult-series", "trash-adult-series", "optimisation-action"}:
            # These settings belong to the portal/library service.  In
            # particular, allowing a browser stream alongside the television
            # must never refresh or otherwise disturb the TV player.
            return True
        return self.refresh_tv()

    def _manage(self, payload: dict[str, Any]) -> None:
        action = payload.get("action")
        if action == "optimisation-action":
            self.adult_optimisation_action(str(payload.get("file", "")),
                                           str(payload.get("operation", "")))
            return
        if action == "create-adult-series":
            self.create_adult_series(str(payload.get("name", "")))
            return
        if action == "trash-adult-series":
            self.trash_adult_series_items(payload)
            return
        if action == "set-parent-overlay-style":
            style = str(payload.get("style", ""))
            if style not in {"classic", "modern"}:
                raise ValueError("Choose the classic or modern parent-control design")
            settings = self.settings()
            settings["parent_overlay_style"] = style
            self.write_json(self.settings_path, settings)
            return
        if action == "set-portal-theme":
            theme = str(payload.get("theme", ""))
            if theme not in {"dark", "light"}:
                raise ValueError("Choose the light or dark portal theme")
            settings = self.settings()
            settings["portal_theme"] = theme
            self.write_json(self.settings_path, settings)
            return
        if action == "set-portal-design":
            design = str(payload.get("design", ""))
            if design not in {"current", "signal", "aperture"}:
                raise ValueError("Choose the current, Signal, or Aperture portal design")
            settings = self.settings()
            settings["portal_design"] = design
            self.write_json(self.settings_path, settings)
            return
        if action == "set-portal-palette":
            palette = str(payload.get("palette", ""))
            if palette not in {
                    "ember", "tide", "grove", "plum", "ochre", "mono"}:
                raise ValueError("Choose one of the available portal palettes")
            settings = self.settings()
            settings["portal_palette"] = palette
            self.write_json(self.settings_path, settings)
            return
        if action == "set-tv-guide-enabled":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError("Choose whether the TV guide is on or off")
            settings = self.settings()
            settings["tv_guide_enabled"] = enabled
            self.write_json(self.settings_path, settings)
            return
        if action == "set-remote-simultaneous":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError("Choose whether simultaneous viewing is allowed")
            settings = self.settings()
            settings["remote_allow_simultaneous"] = enabled
            self.write_json(self.settings_path, settings)
            return
        if action == "set-tv-settings":
            requested = payload.get("settings")
            if not isinstance(requested, dict):
                raise ValueError("Choose the TV settings to save")

            settings = self.settings()
            playback_mode = requested.get("playback_mode")
            picture_mode = requested.get("picture_mode")
            tv_border = requested.get("tv_border")
            display_resolution = requested.get("display_resolution")
            episode_reset_minutes = requested.get("episode_reset_minutes")
            crt_glass = requested.get("crt_glass")
            video_distortion = requested.get("video_distortion")
            maximum_volume = requested.get("maximum_volume")
            volume_limit_enabled = requested.get("volume_limit_enabled")
            sound_effects_enabled = requested.get("sound_effects_enabled")
            # An already-open, older portal page can submit the rest of the
            # form without this newer field. Retain its current value instead
            # of rejecting an otherwise valid TV-settings save.
            scrubbing_enabled = requested.get(
                "scrubbing_enabled", settings.get("scrubbing_enabled") is True)

            if playback_mode not in {"continuous", "resume"}:
                raise ValueError("Choose a playback behaviour")
            if picture_mode not in {"channel", "crop", "fit", "stretch"}:
                raise ValueError("Choose a picture mode")
            if tv_border not in {"slim-black", "silver-90s", "charcoal-90s", "vintage-black"}:
                raise ValueError("Choose a TV cabinet")
            if display_resolution not in {"720p", "1080p", "native"}:
                raise ValueError("Choose a display resolution")
            if episode_reset_minutes not in {0, 5, 20, 60, 180}:
                raise ValueError("Choose a valid episode reset time")
            if any(isinstance(value, bool) or not isinstance(value, int)
                   for value in (crt_glass, video_distortion, maximum_volume)):
                raise ValueError("TV setting values must be whole numbers")
            if not 0 <= crt_glass <= 100 or not 0 <= video_distortion <= 100:
                raise ValueError("CRT glass and distortion must be between 0 and 100")
            if not 5 <= maximum_volume <= 100:
                raise ValueError("Maximum volume must be between 5 and 100")
            if (not isinstance(volume_limit_enabled, bool)
                    or not isinstance(sound_effects_enabled, bool)
                    or not isinstance(scrubbing_enabled, bool)):
                raise ValueError("Choose whether volume limits, sound effects, and scrubbing are on")

            volume = settings.get("volume")
            if not isinstance(volume, dict):
                volume = {}
            volume["maximum"] = maximum_volume
            volume["limit_enabled"] = volume_limit_enabled
            settings.update({
                "playback_mode": playback_mode,
                "episode_reset_minutes": episode_reset_minutes,
                "picture_mode": picture_mode,
                "tv_border": tv_border,
                "crt_glass": crt_glass,
                "video_distortion": video_distortion,
                "display_resolution": display_resolution,
                "sound_effects_enabled": sound_effects_enabled,
                "scrubbing_enabled": scrubbing_enabled,
                "volume": volume,
            })
            self.write_json(self.settings_path, settings)
            return
        if action == "add-channel":
            new_channel = {
                "number": payload.get("number"),
                "name": payload.get("name"),
                "folder": payload.get("folder"),
                "aspect": payload.get("aspect", "crop"),
                "content_type": payload.get("content_type", "shows"),
            }
            def add(values: list[dict[str, Any]]) -> None:
                values.append(new_channel)
            self.update_channels(add)
            channel = self.channel(int(payload.get("number")))
            (self.media_root / str(channel["folder"])).mkdir(mode=0o750, exist_ok=True)
            return
        if action == "update-channel":
            original_number = int(payload.get("original_number"))
            new_number = int(payload.get("number", original_number))
            if new_number != original_number and any(
                    job.get("channel") == original_number
                    and job.get("status") != "refresh-error"
                    for job in self.upload_jobs()):
                raise ValueError(
                    "Finish or cancel this channel's uploads before changing its number")
            def update(values: list[dict[str, Any]]) -> None:
                for value in values:
                    if int(value.get("number", -1)) == original_number:
                        value["number"] = new_number
                        value["name"] = payload.get("name", value.get("name"))
                        value["aspect"] = payload.get("aspect", value.get("aspect", "crop"))
                        value["content_type"] = payload.get(
                            "content_type", value.get("content_type", "shows"))
                        return
                raise ValueError("Channel not found")
            with self.config_lock:
                self.update_channels(update)
                states = self.channel_media_states()
                stored_favourites = states.get("favourite_channels", [])
                favourite_channels = {
                    int(value) for value in stored_favourites
                    if isinstance(value, int)
                    or (isinstance(value, str) and value.isdigit())
                } if isinstance(stored_favourites, list) else set()
                if original_number in favourite_channels:
                    favourite_channels.discard(original_number)
                    if payload.get("content_type", "shows") == "shows":
                        favourite_channels.add(new_number)
                    states["favourite_channels"] = sorted(favourite_channels)
                    states["updated"] = time.time()
                    self.write_channel_media_states(states)
                if new_number != original_number:
                    def move_visibility(library: dict[str, Any]) -> None:
                        disabled_channels = set(library.get("disabled_channels", []))
                        if original_number in disabled_channels:
                            disabled_channels.discard(original_number)
                            disabled_channels.add(new_number)
                        library["disabled_channels"] = sorted(disabled_channels)
                        disabled = library.setdefault("disabled_programmes", {})
                        old_values = set(disabled.pop(str(original_number), []))
                        if old_values:
                            old_values.update(disabled.get(str(new_number), []))
                            disabled[str(new_number)] = sorted(old_values)
                    self.update_settings(move_visibility)
            return
        if action == "delete-channel":
            number = int(payload.get("channel"))
            channel = self.channel(number)
            if any(job.get("channel") == number and job.get("status") != "refresh-error"
                   for job in self.upload_jobs()):
                raise ValueError(
                    "Finish or cancel this channel's uploads before deleting it")
            folder = self.media_root / str(channel["folder"])
            if folder.is_dir() and any(item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS
                                       for item in folder.iterdir()):
                raise ValueError("Move this channel's programmes to the recycle bin before deleting it")
            for manifest_path in self.bin.glob("*/manifest.json"):
                recycled = self.read_json(manifest_path, {})
                if recycled.get("folder") == channel.get("folder"):
                    raise ValueError(
                        "Restore or permanently delete this channel's recycled programmes first")
            def delete(values: list[dict[str, Any]]) -> None:
                values[:] = [value for value in values
                             if int(value.get("number", -1)) != number]
                if not values:
                    raise ValueError("Mabel TV must keep at least one channel")
            self.update_channels(delete)
            def remove_visibility(library: dict[str, Any]) -> None:
                disabled_channels = set(library.get("disabled_channels", []))
                disabled_channels.discard(number)
                library["disabled_channels"] = sorted(disabled_channels)
                library.setdefault("disabled_programmes", {}).pop(str(number), None)
            self.update_settings(remove_visibility)
            states = self.channel_media_states()
            stored_favourites = states.get("favourite_channels", [])
            favourite_channels = {
                int(value) for value in stored_favourites
                if isinstance(value, int)
                or (isinstance(value, str) and value.isdigit())
            } if isinstance(stored_favourites, list) else set()
            if number in favourite_channels:
                favourite_channels.discard(number)
                states["favourite_channels"] = sorted(favourite_channels)
                states["updated"] = time.time()
                self.write_channel_media_states(states)
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
            return
        if action == "create-adult-folder":
            name = self.normalise_adult_folder(str(payload.get("name", "")))
            destination = self.adult_root / name
            if destination.exists():
                raise ValueError("That Adult TV folder already exists")
            destination.mkdir(mode=0o750)
            return
        if action == "rename-adult-folder":
            source = self.adult_folder_path(str(payload.get("folder", "")))
            if not source.is_dir():
                raise ValueError("Adult TV folder not found")
            new_name = self.normalise_adult_folder(str(payload.get("name", "")))
            destination = self.adult_root / new_name
            if destination.exists() and destination != source:
                raise ValueError("That Adult TV folder already exists")
            old_name = source.name
            source.rename(destination)
            states = self.adult_media_states()
            prefix = old_name + "/"
            updated = {
                (new_name + "/" + key[len(prefix):]) if key.startswith(prefix) else key: value
                for key, value in states.items()
            }
            if updated != states:
                self.write_adult_media_states(updated)
            return
        if action == "delete-adult-folder":
            folder = self.adult_folder_path(str(payload.get("folder", "")))
            if not folder.is_dir():
                raise ValueError("Adult TV folder not found")
            if any(folder.iterdir()):
                raise ValueError("Move every film out of this folder before deleting it")
            folder.rmdir()
            return
        if action == "move-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            requested_folder = str(payload.get("folder", "")).strip()
            parent = (self.adult_folder_path(requested_folder, create=False)
                      if requested_folder else self.adult_root)
            if not parent.is_dir():
                raise ValueError("Choose an existing Adult TV folder")
            destination = parent / source.name
            if destination.exists() and destination != source:
                raise ValueError("That folder already contains a film with this name")
            if destination == source:
                return
            old_relative = self.adult_relative_path(source)
            new_relative = self.adult_relative_path(destination)
            source.rename(destination)
            states = self.adult_media_states()
            if old_relative in states:
                states[new_relative] = states.pop(old_relative)
                self.write_adult_media_states(states)
            return
        if action == "rename-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            proposed = SAFE_NAME.sub("", str(payload.get("name", "")).strip()).strip(". ")
            if not proposed:
                raise ValueError("Enter a film name")
            destination = source.with_name(proposed + source.suffix)
            if destination.exists() and destination != source:
                raise ValueError("That name is already used in Adult mode")
            source.rename(destination)
            state = self.adult_media_states()
            old_relative = self.adult_relative_path(source)
            new_relative = self.adult_relative_path(destination)
            if old_relative in state:
                state[new_relative] = state.pop(old_relative)
                self.write_adult_media_states(state)
            return
        if action == "optimise-adult":
            self.request_adult_optimisation(str(payload.get("file", "")))
            return
        if action == "trash-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
            destination_dir = self.bin / item_id
            destination_dir.mkdir(mode=0o750)
            relative = self.adult_relative_path(source)
            states = self.adult_media_states()
            adult_state = states.get(relative, {})
            self.write_json(destination_dir / "manifest.json", {
                "id": item_id, "file_name": source.name,
                "folder": ".adult" + ("/" + source.parent.name
                                        if source.parent != self.adult_root else ""),
                "channel_name": "Adult mode", "adult_state": adult_state,
            })
            try:
                shutil.move(str(source), str(destination_dir / source.name))
            except Exception:
                shutil.rmtree(destination_dir, ignore_errors=True)
                raise
            self.remove_adult_media_state(relative)
            return
        if action in {"toggle-channel", "toggle-programme", "move-programme",
                      "rename", "trash"}:
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
        elif action == "move-programme":
            if self.channel_content_type(channel) != "films":
                raise ValueError("Only films can move between film channels")
            try:
                target = self.channel(int(payload.get("target_channel")))
            except (TypeError, ValueError):
                raise ValueError("Choose another film channel") from None
            if self.channel_content_type(target) != "films":
                raise ValueError("Choose another film channel")
            source_number = int(channel["number"])
            target_number = int(target["number"])
            if source_number == target_number:
                raise ValueError("Choose another film channel")
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            target_folder = self.media_root / str(target["folder"])
            target_folder.mkdir(mode=0o750, exist_ok=True)
            destination = self.safe_media_path(target, source.name)
            if destination.exists():
                raise ValueError("That film channel already contains a film with this name")
            source.rename(destination)

            def move_visibility(library: dict[str, Any]) -> None:
                disabled = library.setdefault("disabled_programmes", {})
                source_values = set(disabled.get(str(source_number), []))
                was_disabled = source.name in source_values
                source_values.discard(source.name)
                disabled[str(source_number)] = sorted(source_values)
                target_values = set(disabled.get(str(target_number), []))
                if was_disabled:
                    target_values.add(destination.name)
                disabled[str(target_number)] = sorted(target_values)
            self.update_settings(move_visibility)

            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            if not isinstance(programmes, dict):
                programmes = {}
            source_key = self.channel_programme_key(source_number, source.name)
            target_key = self.channel_programme_key(target_number, destination.name)
            stored_favourites = states.get("favourites", [])
            favourites = set(stored_favourites) \
                if isinstance(stored_favourites, list) else set()
            favourite_moved = source_key in favourites
            metadata_moved = source_key in programmes
            if favourite_moved:
                favourites.discard(source_key)
                favourites.add(target_key)
            if metadata_moved:
                programmes[target_key] = programmes.pop(source_key)
            if metadata_moved or favourite_moved:
                states.update({"programmes": programmes,
                               "favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
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
            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            old_key = self.channel_programme_key(int(channel["number"]), source.name)
            new_key = self.channel_programme_key(int(channel["number"]), destination.name)
            stored_favourites = states.get("favourites", [])
            favourites = set(stored_favourites) \
                if isinstance(stored_favourites, list) else set()
            changed = False
            if isinstance(programmes, dict) and old_key in programmes:
                programmes[new_key] = programmes.pop(old_key)
                changed = True
            if old_key in favourites:
                favourites.discard(old_key)
                favourites.add(new_key)
                changed = True
            if changed:
                states.update({"programmes": programmes,
                               "favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
        elif action == "trash":
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file(): raise ValueError("Programme not found")
            item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"; destination_dir = self.bin / item_id; destination_dir.mkdir(mode=0o750)
            # Persist recovery metadata before moving the only media copy. A
            # power loss after the move can then never make the video invisible.
            self.write_json(destination_dir / "manifest.json", {
                "id": item_id, "file_name": source.name,
                "folder": channel["folder"], "channel_name": channel["name"],
            })
            try:
                shutil.move(str(source), str(destination_dir / source.name))
            except Exception:
                shutil.rmtree(destination_dir, ignore_errors=True)
                raise
        elif action in {"restore", "delete"}:
            item_id = str(payload.get("id", "")); directory = self.bin / item_id
            if not re.fullmatch(r"\d+-[a-f0-9]{8}", item_id) or not directory.is_dir(): raise ValueError("Recycle-bin item not found")
            manifest = self.read_json(directory / "manifest.json", {})
            if action == "restore":
                folder = self.media_root / str(manifest.get("folder", "")); file_name = str(manifest.get("file_name", "")); destination = folder / Path(file_name).name
                if not manifest.get("folder") or destination.exists(): raise ValueError("Cannot restore this item because a file with that name already exists")
                adult_series_id = str(manifest.get("adult_series_id", ""))
                adult_series_state = manifest.get("adult_series_state")
                adult_series_episode_state = manifest.get("adult_series_episode_state")
                if adult_series_id:
                    series_root = self.adult_series_root / adult_series_id
                    if (not re.fullmatch(r"[a-f0-9]{32}", adult_series_id)
                            or not isinstance(adult_series_state, dict)
                            or not isinstance(adult_series_episode_state, dict)
                            or series_root == destination
                            or series_root not in destination.parents):
                        raise ValueError("Cannot restore this episode outside its Adult TV series")
                folder.mkdir(mode=0o750, exist_ok=True); shutil.move(str(directory / file_name), str(destination)); shutil.rmtree(directory)
                if (re.fullmatch(r"[a-f0-9]{32}", adult_series_id)
                        and isinstance(adult_series_state, dict)
                        and isinstance(adult_series_episode_state, dict)):
                    series_root = self.adult_series_root / adult_series_id
                    states = self.adult_series_states()
                    states["series"].setdefault(adult_series_id, adult_series_state)
                    relative = destination.relative_to(series_root).as_posix()
                    states["episodes"][f"{adult_series_id}/{relative}"] = \
                        adult_series_episode_state
                    self.write_adult_series_states(states)
                adult_state = manifest.get("adult_state")
                if str(manifest.get("folder", "")).startswith(".adult") \
                        and isinstance(adult_state, dict):
                    states = self.adult_media_states()
                    states[self.adult_relative_path(destination)] = adult_state
                    self.write_adult_media_states(states)
            else:
                shutil.rmtree(directory)
        else:
            raise ValueError("Unknown library action")


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

    def security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "script-src 'self' 'unsafe-inline'; img-src 'self' data: https://image.tmdb.org; "
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

    def do_GET(self) -> None:
        try:
            if self.path == "/":
                document = CLASSIC_INDEX if self.portal_design() == "classic" else INDEX
                data = document.encode(); self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store"); self.security_headers(); self.end_headers(); self.wfile.write(data); return
            static_assets = {
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
            if self.path in static_assets:
                relative_path, content_type = static_assets[self.path]
                asset_path = Path(__file__).parent / relative_path
                if not asset_path.is_file():
                    self.json(404, {"error": "Static asset not found"}); return
                data = asset_path.read_bytes(); self.send_response(200); self.send_header("Content-Type", content_type); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store"); self.security_headers(); self.end_headers(); self.wfile.write(data); return
            parsed = urlsplit(self.path)
            if parsed.path.startswith("/portal/"):
                relative_path = parsed.path.removeprefix("/portal/")
                portal_root = (Path(__file__).parent / "portal").resolve()
                asset_path = (portal_root / relative_path).resolve()
                content_types = {
                    ".css": "text/css; charset=utf-8",
                    ".js": "text/javascript; charset=utf-8",
                    ".svg": "image/svg+xml",
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                }
                if (portal_root not in asset_path.parents
                        or asset_path.suffix not in content_types
                        or not asset_path.is_file()):
                    self.json(404, {"error": "Portal asset not found"}); return
                self.stream_file(asset_path, content_types[asset_path.suffix]); return
            query = parse_qs(parsed.query)
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
                self.stream_bytes(data, "text/vtt; charset=utf-8"); return
            if self.path == "/api/setup": self.json(200, self.server.library.public_setup()); return
            if not self.require(): return
            if parsed.path == "/watch/player":
                data = WATCH_PAGE.encode(); self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store"); self.security_headers(); self.end_headers(); self.wfile.write(data); return
            if self.path == "/api/live":
                self.json(200, self.server.library.live_tv_status()); return
            if self.path == "/api/lg-tv/status":
                self.json(200, self.server.library.lg_tv_status()); return
            if self.path == "/api/live/stream.m3u8":
                self.json(410, {"error": "The live picture now uses the portal frame feed"}); return
            if urlsplit(self.path).path == "/api/live/frame.jpg":
                self.stream_bytes(self.server.library.live_tv_frame(), "image/jpeg"); return
            if self.path.startswith("/api/live/segment-") or self.path == "/api/live/init.mp4":
                self.json(410, {"error": "The live picture now uses the portal frame feed"}); return
            if self.path == "/api/library": self.json(200, self.server.library.library()); return
            if parsed.path == "/api/viewing-insights":
                try:
                    days = int(query.get("days", ["30"])[0])
                    offset = int(query.get("timezone_offset", ["0"])[0])
                except (TypeError, ValueError):
                    days, offset = 30, 0
                self.json(200, self.server.library.viewing_insights(days, offset)); return
            if parsed.path == "/api/remote/media":
                session = self.server.library.remote_session(str(query.get("stream", [""])[0]))
                self.stream_remote_media(session["source"]); return
            if parsed.path == "/api/remote/subtitles":
                data = self.server.library.remote_subtitles(str(query.get("stream", [""])[0]))
                self.stream_bytes(data, "text/vtt; charset=utf-8"); return
            if parsed.path == "/api/usb":
                self.json(200, self.server.library.usb_volumes()); return
            if parsed.path == "/api/usb/browse":
                self.json(200, self.server.library.usb_browse(
                    str(query.get("volume", [""])[0]), str(query.get("path", [""])[0]))); return
            if parsed.path == "/api/adult/optimisations":
                self.json(200, self.server.library.adult_optimisations()); return
            if parsed.path == "/api/adult/discovery":
                self.json(200, self.server.library.adult_discovery(
                    str(query.get("q", [""])[0]))); return
            if parsed.path == "/api/adult/title":
                self.json(200, self.server.library.adult_title_detail(
                    str(query.get("media_type", [""])[0]),
                    str(query.get("tmdb_id", [""])[0]))); return
            if parsed.path == "/api/adult/season":
                self.json(200, self.server.library.adult_title_season(
                    str(query.get("tmdb_id", [""])[0]),
                    str(query.get("season", [""])[0]))); return
            if parsed.path == "/api/adult/providers":
                self.json(200, self.server.library.adult_streaming_links(
                    str(query.get("media_type", [""])[0]),
                    str(query.get("tmdb_id", [""])[0]),
                    str(query.get("refresh", ["0"])[0]) == "1")); return
            if parsed.path == "/api/adult/viewing":
                self.json(200, self.server.library.adult_viewing()); return
            if parsed.path == "/api/activity":
                self.json(200, self.server.library.activity_status()); return
            if parsed.path.startswith("/api/usb/imports/"):
                self.json(200, self.server.library.usb_import_status(
                    parsed.path.rsplit("/", 1)[1])); return
            if parsed.path.startswith("/api/offline/preparations/"):
                self.json(200, self.server.library.offline_preparation_status(
                    parsed.path.rsplit("/", 1)[1])); return
            if parsed.path == "/api/tmdb/status":
                self.json(200, self.server.library.tmdb_status()); return
            if parsed.path.startswith("/api/adult/artwork/"):
                self.stream_file(self.server.library.adult_artwork(
                    parsed.path.rsplit("/", 1)[1]), "image/jpeg",
                    "public, max-age=31536000, immutable"); return
            if parsed.path.startswith("/api/adult/series/artwork/"):
                self.stream_file(self.server.library.adult_series_artwork(
                    parsed.path.rsplit("/", 1)[1]), "image/jpeg",
                    "public, max-age=31536000, immutable"); return
            if parsed.path.startswith("/api/channel/artwork/"):
                self.stream_file(self.server.library.channel_artwork(
                    parsed.path.rsplit("/", 1)[1]), "image/jpeg",
                    "public, max-age=31536000, immutable"); return
            if self.path == "/api/status": self.json(200, self.server.library.live_status()); return
            if self.path == "/api/support":
                self.file(self.server.library.support_bundle(), "mabeltv-support.tar.gz"); return
            if self.path.startswith("/api/uploads/"):
                self.json(200, self.server.library.upload_status(self.path.rsplit("/", 1)[1])); return
            self.json(404, {"error": "Not found"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
        except ValueError as error: self.json(400, {"error": str(error)})
        except Exception as error:
            self.unexpected("GET", error); self.json(500, {"error": "The library had an unexpected problem"})
    def do_POST(self) -> None:
        try:
            if not self.require_same_origin(): return
            address = self.client_address[0]
            if self.path == "/api/setup/check":
                if not self.server.library.login_allowed(address):
                    self.json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many attempts. Wait five minutes and try again."}); return
                code = str(self.body().get("setup_code", ""))
                if not self.server.library.verify_setup_code(code):
                    self.server.library.record_login_failure(address)
                    self.json(HTTPStatus.FORBIDDEN, {"error": "That setup code is not correct"}); return
                self.server.library.clear_login_failures(address)
                self.json(200, {"ok": True}); return
            if self.path == "/api/setup":
                if not self.server.library.login_allowed(address):
                    self.json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many attempts. Wait five minutes and try again."}); return
                payload = self.body()
                if not self.server.library.verify_setup_code(str(payload.get("setup_code", ""))):
                    self.server.library.record_login_failure(address)
                    self.json(HTTPStatus.FORBIDDEN, {"error": "That setup code is not correct"}); return
                result = self.server.library.complete_setup(payload)
                self.server.library.clear_login_failures(address)
                self.json(200, result); return
            if self.path == "/api/login":
                if not self.server.library.configured():
                    self.json(HTTPStatus.CONFLICT, {"error": "Finish first-time setup before signing in"}); return
                if not self.server.library.portal_pin_required():
                    self.json(200, {"ok": True}); return
                if not self.server.library.login_allowed(address):
                    self.json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many attempts. Wait five minutes and try again."}); return
                pin = str(self.body().get("pin", ""))
                if not self.server.library.verify_pin(pin):
                    self.server.library.record_login_failure(address)
                    self.json(HTTPStatus.FORBIDDEN, {"error": "That PIN is not correct"}); return
                self.server.library.clear_login_failures(address)
                token = self.server.library.create_session(); self.json(200, {"ok": True}, f"mabeltv_library={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}"); return
            if self.path == "/api/logout":
                self.server.library.revoke_session(self.session_token())
                self.json(200, {"ok": True}, "mabeltv_library=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); return
            if self.path == "/api/portal-security":
                required = self.server.library.set_portal_pin_required(self.body())
                self.json(200, {"ok": True, "portal_pin_required": required}, "mabeltv_library=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); return
            if not self.require(): return
            payload = self.body()
            if self.path == "/api/live/stop":
                self.json(200, self.server.library.stop_live_tv()); return
            if self.path == "/api/live/control":
                self.json(200, self.server.library.live_tv_control(payload)); return
            if self.path == "/api/lg-tv/action":
                self.json(200, self.server.library.lg_tv_action(payload)); return
            if self.path == "/api/play-on-tv":
                self.json(200, self.server.library.play_on_tv(payload)); return
            if self.path == "/api/remote/start":
                self.json(200, self.server.library.start_remote_stream(payload)); return
            if self.path == "/api/external/start":
                self.json(200, self.server.library.start_external_stream(payload)); return
            if self.path == "/api/offline/start":
                self.json(200, self.server.library.start_offline_download(payload)); return
            if self.path == "/api/external/release":
                self.json(200, self.server.library.release_external_stream(
                    str(payload.get("stream", "")))); return
            if self.path == "/api/remote/stop-tv":
                self.json(200, self.server.library.remote_stop_tv()); return
            if self.path == "/api/remote/position":
                self.json(200, self.server.library.remote_save_position(payload)); return
            if self.path == "/api/remote/clear-position":
                self.json(200, self.server.library.remote_clear_position(payload)); return
            if self.path == "/api/viewing-insights/delete":
                self.json(200, self.server.library.delete_viewing_sessions(payload)); return
            if self.path == "/api/favourite":
                self.json(200, self.server.library.set_favourite(payload)); return
            if self.path == "/api/remote/heartbeat":
                self.server.library.remote_session(str(payload.get("stream", "")))
                self.json(200, {"ok": True}); return
            if self.path == "/api/remote/release":
                self.json(200, self.server.library.remote_release(str(payload.get("stream", "")))); return
            if self.path == "/api/usb":
                action = str(payload.get("action", ""))
                if action == "mount": result = self.server.library.usb_mount(str(payload.get("device", "")))
                elif action == "eject": result = self.server.library.usb_eject(str(payload.get("volume", "")))
                elif action == "play": result = self.server.library.usb_play(str(payload.get("volume", "")), str(payload.get("path", "")))
                elif action == "import": result = self.server.library.start_usb_import(payload)
                else: raise ValueError("Unknown USB action")
                self.json(200, result); return
            if self.path == "/api/tmdb/search":
                self.json(200, self.server.library.tmdb_search(payload)); return
            if self.path == "/api/tmdb/apply":
                self.json(200, self.server.library.tmdb_apply(payload)); return
            if self.path == "/api/tmdb/adult-series/search":
                self.json(200, self.server.library.adult_series_search(payload)); return
            if self.path == "/api/tmdb/adult-series/apply":
                self.json(200, self.server.library.adult_series_apply(payload)); return
            if self.path == "/api/adult/series/watched":
                watched = payload.get("watched")
                if not isinstance(watched, bool):
                    raise ValueError("Choose whether the episode is watched")
                if payload.get("scope") == "season":
                    self.json(200, self.server.library.set_adult_season_watched(
                        str(payload.get("series", "")), payload.get("season"),
                        watched)); return
                self.json(200, self.server.library.set_adult_episode_watched(
                    str(payload.get("series", "")),
                    str(payload.get("file", "")), watched)); return
            if self.path == "/api/adult/series/restart":
                scope = str(payload.get("scope", ""))
                self.json(200, self.server.library.restart_adult_series_progress(
                    str(payload.get("series", "")), scope,
                    payload.get("season") if scope == "season" else None)); return
            if self.path == "/api/adult/viewing":
                self.json(200, self.server.library.adult_viewing_update(payload)); return
            if self.path == "/api/adult/netflix/play-tv":
                self.json(200, self.server.library.play_netflix_on_tv(payload)); return
            if self.path == "/api/tmdb/channel":
                self.json(200, self.server.library.refresh_channel_show_metadata(payload)); return
            if self.path == "/api/tmdb/channels":
                self.json(200, self.server.library.refresh_channel_metadata()); return
            if self.path == "/api/tmdb/programme":
                self.json(200, self.server.library.refresh_channel_programme_metadata(payload)); return
            if self.path == "/api/adult/uploads":
                self.json(201, self.server.library.adult_upload_create(payload)); return
            if self.path == "/api/adult/series/uploads":
                self.json(201, self.server.library.adult_series_upload_create(payload)); return
            if self.path == "/api/uploads": self.json(201, self.server.library.upload_create(payload)); return
            if self.path.startswith("/api/uploads/"):
                self.json(200, self.server.library.upload_action(
                    self.path.rsplit("/", 1)[1], str(payload.get("action", "")))); return
            if self.path == "/api/manage":
                refreshed = self.server.library.manage(payload)
                action = payload.get("action")
                self.json(200, {
                    "ok": True,
                    "refreshed": refreshed,
                    "message": ("Optimising the original film in the background. You can leave this page and return later."
                                if action == "optimise-adult" else
                                "TV settings applied on MabelTV now."
                                if refreshed and action == "set-tv-settings" else "Done.") if refreshed else
                        "The change was saved, but the TV could not refresh. Use Refresh TV library to try again.",
                }); return
            if self.path == "/api/account":
                self.server.library.change_pin(payload)
                self.json(200, {"ok": True}, "mabeltv_library=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); return
            if self.path == "/api/identity":
                self.json(200, self.server.library.change_tv_name(payload)); return
            if self.path == "/api/system":
                output = self.server.library.admin_action(str(payload.get("action", "")))
                self.json(200, {"ok": True, "message": output}); return
            self.json(404, {"error": "Not found"})
        except RemoteTvActiveError as error:
            self.json(HTTPStatus.CONFLICT, {"error": str(error), "code": "tv-active"})
        except ValueError as error: self.json(400, {"error": str(error)})
        except Exception as error:
            self.unexpected("POST", error); self.json(500, {"error": "The library had an unexpected problem"})
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

    def __init__(self, address: tuple[str, int], library: Library) -> None:
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Mabel TV local media library")
    parser.add_argument("--bind", default="0.0.0.0"); parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--media-root", default="/srv/mabeltv/media"); parser.add_argument("--channels", default="/var/lib/mabeltv/channels.json")
    parser.add_argument("--settings", default="/var/lib/mabeltv/settings.json"); parser.add_argument("--owner", default="/var/lib/mabeltv/owner.json"); parser.add_argument("--config", default="/etc/mabeltv/library.conf")
    args = parser.parse_args(); LibraryServer((args.bind, args.port), Library(args)).serve_forever()


if __name__ == "__main__": main()
