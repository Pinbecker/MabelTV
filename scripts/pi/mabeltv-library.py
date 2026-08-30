#!/usr/bin/env python3
"""Local, parent-protected media library for a KidsTV appliance.

The service deliberately uses only Python's standard library.  It is bound to
the home network by systemd, runs as the unprivileged mabeltv user, and never
serves a partial upload from the media folders watched by the TV application.
"""

from __future__ import annotations

import argparse
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
import subprocess
import sys
import threading
import time
import uuid
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
TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TMDB_BACKDROP_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w1280"
OPENSUBTITLES_API_BASE_URL = "https://api.opensubtitles.com/api/v1"
OPENSUBTITLES_USER_AGENT = "MabelTV/0.2.5"
SUBTITLE_EXTENSIONS = {".srt", ".vtt", ".ass", ".ssa"}
REMOTE_BROWSER_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm"}
REMOTE_SESSION_SECONDS = 2 * 60
REMOTE_RESUME_MIN_SECONDS = 30.0
REMOTE_COMPLETION_MIN_SECONDS = 180.0
REMOTE_COMPLETION_FRACTION = 0.05
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
<section class="card"><h2>Add something new</h2><p class="muted">Choose its channel and a video. Large phone videos are automatically optimised to 720p for smooth Mabel TV playback; the final step can take a little longer. Uploads resume safely if the connection drops.</p><form id="uploadForm" class="upload-form"><select id="channel" required></select><input id="file" type="file" accept="video/*,.mkv,.m4v,.avi,.mpg,.mpeg" required><button>Upload &amp; publish</button></form><div id="uploadState" class="hidden"><p id="uploadText"></p><progress id="progress" max="1" value="0"></progress></div></section>
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
$('#uploadForm').onsubmit=async e=>{e.preventDefault();let f=$('#file').files[0];if(!f)return;let channel=Number($('#channel').value),finalResult={};$('#uploadState').classList.remove('hidden');$('#progress').max=f.size;$('#progress').value=0;try{notice('Preparing upload…');let created=await api('/api/uploads',{method:'POST',body:JSON.stringify({channel,file_name:f.name,size:f.size})});let offset=created.offset||0;while(offset<f.size){let part=f.slice(offset,Math.min(offset+8388608,f.size)),finalChunk=offset+part.size>=f.size;if(finalChunk)$('#uploadText').textContent='Uploading final chunk, then optimising for smooth Mabel TV playback…';finalResult=await resilientUploadChunk(created.id,offset,part,finalChunk);offset=finalResult.offset;$('#progress').value=offset;if(!finalChunk)$('#uploadText').textContent=`Uploading ${(offset/1048576).toFixed(0)} MB of ${(f.size/1048576).toFixed(0)} MB…`}selectedManageChannel=channel;await load(channel);$('#file').value='';$('#progress').value=0;$('#uploadText').textContent='';$('#uploadState').classList.add('hidden');notice(finalResult.refreshed?`Published${finalResult.optimised?' and optimised':''} to CH ${channel}. Choose another video to upload.`:`Published to CH ${channel}. The TV library refresh is still running.`)}catch(e){notice(e.message,true);$('#uploadText').textContent='Upload paused. Choose the same file and upload again to resume.'}}
</script></body></html>"""


def load_index() -> str:
    """Load the maintainable product UI, retaining the embedded legacy UI as fallback."""
    try:
        return Path(__file__).with_name("mabeltv-library.html").read_text(encoding="utf-8")
    except OSError:
        return INDEX


INDEX = load_index()


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
                "file_name": file_name, "programme": self.library.display_name(file_name),
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


class Library:
    def __init__(self, args: argparse.Namespace) -> None:
        self.media_root = Path(args.media_root).resolve()
        self.channels_path = Path(args.channels).resolve()
        self.settings_path = Path(args.settings).resolve()
        self.owner_path = Path(args.owner).resolve()
        self.owner_recovery_path = self.owner_path.with_name("owner-recovery-pending")
        self.config_path = Path(args.config).resolve()
        self.player_state_path = Path("/var/lib/mabeltv/state.json")
        self.incoming = self.media_root / ".incoming"
        self.adult_root = self.media_root / ".adult"
        self.adult_metadata_path = self.adult_root / ".mabeltv-adult.json"
        self.adult_artwork_root = self.adult_root / ".metadata"
        self.channel_metadata_path = self.media_root / ".mabeltv-channels.json"
        self.channel_artwork_root = self.media_root / ".channel-metadata"
        configured_usb_root = os.environ.get("MABELTV_USB_ROOT")
        self.usb_root = Path(configured_usb_root or "/media/mabeltv-usb").resolve()
        # A real installation must only browse an actual mount. Tests and the
        # local portal preview deliberately use a private directory fixture.
        self.usb_requires_mount = configured_usb_root is None
        self.tmdb_key_path = Path(os.environ.get(
            "MABELTV_TMDB_API_KEY_FILE", "/var/lib/mabeltv/secrets/tmdb-api-key"))
        self.opensubtitles_key_path = Path(os.environ.get(
            "MABELTV_OPENSUBTITLES_API_KEY_FILE",
            "/var/lib/mabeltv/secrets/opensubtitles-api-key"))
        self.bin = self.media_root / ".recycle-bin"
        self.sessions: dict[str, float] = {}
        self.login_failures: dict[str, list[float]] = {}
        self.config_lock = threading.RLock()
        self.upload_locks: dict[str, threading.Lock] = {}
        self.conversion_queue: queue.Queue[str | None] = queue.Queue()
        self.queued_conversions: set[str] = set()
        self.deferred_retries: set[str] = set()
        self.cancelled_conversions: set[str] = set()
        self.adult_optimisation_active: set[str] = set()
        self.adult_optimisation_lock = threading.Lock()
        self.adult_optimisation_serial = threading.Lock()
        self.remote_stream_lock = threading.RLock()
        self.remote_stream: dict[str, Any] | None = None
        self.usb_imports: dict[str, dict[str, Any]] = {}
        self.usb_import_lock = threading.RLock()
        self.conversion_closed = threading.Event()
        self.media_root.mkdir(parents=True, exist_ok=True)
        self.incoming.mkdir(mode=0o750, exist_ok=True)
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        self.adult_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.channel_artwork_root.mkdir(mode=0o750, exist_ok=True)
        self.bin.mkdir(mode=0o750, exist_ok=True)
        self.reconcile_recycle_items()
        self.cleanup_stale_temporary_files()
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

    def close(self, timeout: float = 10.0) -> None:
        """Drain and stop the single media worker (primarily for clean tests)."""
        if self.conversion_closed.is_set():
            return
        self.conversion_closed.set()
        self.conversion_queue.put(None)
        self.conversion_worker.join(timeout=timeout)
        if self.conversion_worker.is_alive():
            raise RuntimeError("The media worker did not stop cleanly")
        self.live_stream.stop()

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
            adult_upload = metadata.get("kind") == "adult"
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
                stream = self.video_info(part)
                conversion_required = False if adult_upload else self.needs_playback_optimisation(
                    Path(source_name), stream)
                metadata["conversion_required"] = bool(conversion_required)
                previous_status = "validated"

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
                if adult_upload:
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
            if adult_upload:
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
            refreshed = self.refresh_tv()
            result = {
                "id": upload_id,
                "offset": int(metadata["size"]),
                "complete": False,
                "optimised": bool(conversion_required),
                "refreshed": refreshed,
                "status": "finalising",
                "file_name": source_name,
                "channel": metadata.get("channel"),
                "kind": "adult" if adult_upload else "channel",
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

    @staticmethod
    def channel_programme_key(channel_number: int, file_name: str) -> str:
        return f"{int(channel_number)}/{file_name}"

    def write_adult_media_states(self, values: dict[str, dict[str, Any]]) -> None:
        self.write_json(self.adult_metadata_path, values)

    def set_adult_media_state(self, file_name: str, state: str,
                              message: str = "") -> None:
        values = self.adult_media_states()
        current = values.get(file_name, {})
        if not isinstance(current, dict):
            current = {}
        current.update({"state": state, "message": message, "updated": time.time()})
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
                    "metadata": state.get("metadata", {})
                    if isinstance(state.get("metadata"), dict) else {},
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
        if kind == "channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid Mabel TV programme") from None
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("That Mabel TV programme is no longer in the library")
            return kind, source, self.display_name(source.name), None, 0
        raise ValueError("Choose an Adult film or a Mabel TV programme")

    def start_remote_stream(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind, source, title, library_id, resume = self.remote_source(payload)
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
        base = urlencode({"stream": token})
        subtitle_url = None
        if kind == "adult":
            browser_sidecars = [path for path in self.subtitle_sidecars(source)
                                if path.suffix.lower() in {".vtt", ".srt"}]
            if browser_sidecars:
                subtitle_url = f"/api/remote/subtitles?{base}"
        return {"ok": True, "title": title, "kind": kind, "resume_position": resume,
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
                self.remote_stream = None
        return {"ok": True}

    def remote_save_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        session = self.remote_session(str(payload.get("stream", "")))
        if session["kind"] != "adult" or not session.get("library_id"):
            return {"ok": True}
        try:
            position = max(0.0, float(payload.get("position", 0)))
            duration = max(0.0, float(payload.get("duration", 0)))
        except (TypeError, ValueError) as error:
            raise ValueError("That playback position is not valid") from error
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

    def remote_subtitles(self, token: str) -> bytes:
        session = self.remote_session(token)
        if session["kind"] != "adult":
            raise ValueError("This Mabel TV programme has no browser subtitle track")
        sidecars = self.subtitle_sidecars(session["source"])
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
        volumes.sort(key=lambda value: (not value["mounted"], value["label"].lower()))
        with self.usb_import_lock:
            jobs = [dict(job) for job in self.usb_imports.values()
                    if job.get("status") not in {"complete", "error"}]
        return {"volumes": volumes, "imports": jobs}

    def usb_resolve(self, identity: str, relative: str = "") -> Path:
        root = self.usb_mount_path(identity)
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
        root = self.usb_mount_path(identity)
        directory = self.usb_resolve(identity, relative)
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
        result = subprocess.run(
            ["sudo", "-n", "/usr/local/libexec/mabeltv-admin-action", "usb-mount", device],
            capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            raise ValueError(result.stderr.strip() or "The USB drive could not be mounted")
        return self.usb_volumes()

    def usb_eject(self, identity: str) -> dict[str, Any]:
        identity = self.usb_identity(identity)
        with self.usb_import_lock:
            busy = any(job.get("volume") == identity
                       and job.get("status") not in {"complete", "error"}
                       for job in self.usb_imports.values())
        if busy:
            raise ValueError("Wait for the USB import to finish before ejecting the drive")
        result = subprocess.run(
            ["sudo", "-n", "/usr/local/libexec/mabeltv-admin-action", "usb-eject", identity],
            capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            raise ValueError(result.stderr.strip() or "The USB drive could not be ejected")
        return {"ok": True, "message": result.stdout.strip()}

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
        files = self._usb_selected_files(identity, selected)
        target = str(payload.get("target", ""))
        channel_number: int | None = None
        if target == "adult":
            destination_root = self.adult_root
        elif target == "channel":
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
        threading.Thread(target=self._run_usb_import,
                         args=(job_id, files, destination_root),
                         name=f"mabeltv-usb-{job_id[:8]}", daemon=True).start()
        return dict(job)

    def _run_usb_import(self, job_id: str, files: list[Path], destination_root: Path) -> None:
        try:
            with self.usb_import_lock:
                job = self.usb_imports[job_id]
                job.update(status="copying", message="Copying from USB")
            for index, source in enumerate(files):
                destination = self.unique_destination(destination_root, source.name)
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
            refreshed = self.refresh_tv()
            with self.usb_import_lock:
                job.update(status="complete", current="",
                           message="Import complete" if refreshed else
                           "Copied successfully; TV refresh is still pending")
        except Exception as error:
            with self.usb_import_lock:
                job = self.usb_imports[job_id]
                job.update(status="error", message=str(error), current="")

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

    @staticmethod
    def tmdb_title_query(value: str) -> tuple[str, int | None]:
        title = re.sub(r"[._]+", " ", str(value or "")).strip()
        title = re.sub(
            r"\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$",
            "", title, flags=re.IGNORECASE).strip()
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", title)
        year = int(year_match.group(1)) if year_match else None
        if year:
            title = title.replace(str(year), "").strip(" .-()[]")
        return title, year

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
                response = self.tmdb_request("search/tv", {
                    "query": str(channel.get("name", "")),
                    "include_adult": "false", "language": "en-GB",
                })
                matches = response.get("results", []) if isinstance(response, dict) else []
                match = next((value for value in matches
                              if isinstance(value, dict) and value.get("id")), None)
                if not isinstance(match, dict):
                    skipped += 1
                    continue
                tmdb_id = int(match["id"])
                details = self.tmdb_request(f"tv/{tmdb_id}", {"language": "en-GB"})
                remote_art = str(details.get("backdrop_path") or details.get("poster_path") or "")
                art_name = self.cache_channel_artwork(
                    remote_art, f"mabel-show-{number}-{tmdb_id}.jpg",
                    backdrop=bool(details.get("backdrop_path")))
                channels_state[str(number)] = {
                    "tmdb_id": tmdb_id,
                    "title": str(details.get("name") or channel.get("name", "")),
                    "overview": str(details.get("overview") or ""),
                    "year": str(details.get("first_air_date") or "")[:4],
                    "artwork": art_name,
                    "updated": time.time(), "provider": "TMDB",
                }
                updated += 1
                continue

            folder = self.media_root / str(channel["folder"])
            candidates = sorted(
                (item for item in folder.glob("*") if item.is_file()
                 and item.suffix.lower() in SUPPORTED_EXTENSIONS),
                key=lambda path: path.name.casefold()) if folder.is_dir() else []
            for item in candidates:
                title, year = self.tmdb_title_query(self.display_name(item.name))
                parameters: dict[str, Any] = {
                    "query": title, "include_adult": "false", "language": "en-GB",
                }
                if year:
                    parameters["year"] = year
                response = self.tmdb_request("search/movie", parameters)
                matches = response.get("results", []) if isinstance(response, dict) else []
                match = next((value for value in matches
                              if isinstance(value, dict) and value.get("id")), None)
                if not isinstance(match, dict):
                    skipped += 1
                    continue
                tmdb_id = int(match["id"])
                details = self.tmdb_request(f"movie/{tmdb_id}", {"language": "en-GB"})
                poster_name = self.cache_channel_artwork(
                    str(details.get("poster_path") or ""),
                    f"mabel-film-{number}-{tmdb_id}.jpg")
                programmes_state[self.channel_programme_key(number, item.name)] = {
                    "tmdb_id": tmdb_id,
                    "title": str(details.get("title") or self.display_name(item.name)),
                    "overview": str(details.get("overview") or ""),
                    "year": str(details.get("release_date") or "")[:4],
                    "poster": poster_name,
                    "updated": time.time(), "provider": "TMDB",
                }
                updated += 1
        states.update({"channels": channels_state, "programmes": programmes_state,
                       "updated": time.time()})
        self.write_channel_media_states(states)
        return {"ok": True, "updated": updated, "skipped": skipped}

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
        if not re.fullmatch(r"tmdb-[1-9][0-9]*\.jpg", name):
            raise ValueError("Artwork not found")
        path = self.adult_artwork_root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path

    def upload_destination(self, metadata: dict[str, Any]) -> Path:
        if metadata.get("kind") == "adult":
            folder = str(metadata.get("folder", ""))
            relative = f"{folder}/{metadata.get('file_name', '')}" if folder \
                else str(metadata.get("file_name", ""))
            return self.safe_adult_path(relative, create_folder=bool(folder))
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
        if not isinstance(channel_metadata, dict):
            channel_metadata = {}
        if not isinstance(programme_metadata, dict):
            programme_metadata = {}
        response = []
        for channel in self.channels():
            folder = self.media_root / str(channel["folder"])
            programmes = []
            for item in sorted(folder.glob("*") if folder.is_dir() else [], key=lambda p: p.name.lower()):
                if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
                    disabled = set(disabled_programmes.get(str(channel["number"]), []))
                    programmes.append({
                        "name": item.name,
                        "display_name": self.display_name(item.name),
                        "enabled": item.name not in disabled,
                        "browser_ready": self.remote_browser_ready(item),
                        "metadata": programme_metadata.get(
                            self.channel_programme_key(channel["number"], item.name), {}),
                    })
            response.append({"number": channel["number"], "name": channel["name"],
                             "aspect": channel.get("aspect", "crop"),
                             "content_type": self.channel_content_type(channel),
                             "enabled": channel["number"] not in disabled_channels,
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
            },
            "tv_settings": self.tv_settings(settings),
            "remote_viewing": self.remote_settings(),
            "adult_library": self.adult_library(),
            "adult_folders": self.adult_folders(),
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
                adult = value.get("kind") == "adult"
                number = -1 if adult else int(value.get("channel", -1))
            except (OSError, TypeError, ValueError):
                continue
            jobs.append({
                "id": value["id"],
                "file_name": str(value.get("file_name", "Video")),
                "channel": number,
                "channel_name": "Adult mode" if adult else channel_names.get(number, f"CH {number}"),
                "kind": "adult" if adult else "channel",
                "size": size,
                "offset": offset,
                "status": status,
                "error": value.get("error"),
                "created": float(value.get("created", 0)),
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
            adult = value.get("kind") == "adult"
            number = -1 if adult else int(value.get("channel", -1))
            jobs.append({
                "id": value.get("id", result_path.name.removesuffix(".result.json")),
                "file_name": str(value.get("file_name", "Video")),
                "channel": number,
                "channel_name": "Adult mode" if adult else channel_names.get(number, f"CH {number}"),
                "kind": "adult" if adult else "channel",
                "size": int(value.get("offset", 0)),
                "offset": int(value.get("offset", 0)),
                "status": str(value.get("status")),
                "error": value.get("error"),
                "created": float(value.get("finished", 0)),
                "cancelable": value.get("status") == "error",
                "retryable": False,
                "refreshable": value.get("status") == "refresh-error",
            })
        return sorted(jobs, key=lambda value: value["created"])

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

    @staticmethod
    def command_output(command: list[str], timeout: int = 4) -> str:
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True,
                                    timeout=timeout)
            return result.stdout.strip() if result.returncode == 0 else ""
        except (OSError, subprocess.TimeoutExpired):
            return ""

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
                      "subtitles_visible"):
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
            status.pop("reason", None)
        return status

    def player_mode_status(self) -> dict[str, Any]:
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(1)
                client.connect("/run/mabeltv/portal-control.sock")
                client.sendall(b"status\n")
                response = json.loads(client.recv(4096).decode())
        except (OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
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
                   "toggle-pause", "toggle-subtitles", "volume-up", "volume-down", "toggle-mute",
                   "turn-on", "turn-off", "toggle-power",
                   "open-parent-menu", "open-tv-guide", "close-overlay", "restart-programme",
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
        state = self.read_json(self.player_state_path, {})
        if isinstance(state, dict) and state.get("standby"):
            raise ValueError("Turn Mabel TV on before choosing Play on TV")
        kind = str(payload.get("kind", ""))
        if kind == "channel":
            try:
                channel = self.channel(int(payload.get("channel", 0)))
            except (TypeError, ValueError):
                raise ValueError("Choose a valid channel programme") from None
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            command = {"command": "play-programme", "channel": int(channel["number"]),
                       "file": source.name}
            skip_film_countdown = self.channel_content_type(channel) == "films"
        elif kind == "adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            command = {"command": "play-adult-film", "file": self.adult_relative_path(source)}
            skip_film_countdown = False
        else:
            raise ValueError("Choose a programme or Adult film to play")
        if not source.is_file():
            raise ValueError("That video is no longer in the Mabel TV library")
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
                "message": f"{verb} {self.display_name(source.name)} on Mabel TV"}

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

    def optimise_adult_for_playback(self, source: Path, destination: Path) -> None:
        # Films are normally 23.976/24/25 fps. Preserve that cadence instead
        # of manufacturing duplicate 30 fps frames, while capping the stream
        # at a level the Pi can decode smoothly in hardware.
        self._optimise_for_playback(
            source, destination,
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "1800k", "2000k", "4000k")

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
            self.set_adult_media_state(relative, "queued")
        threading.Thread(target=self.optimise_adult_file, args=(relative,),
                         name="mabeltv-adult-optimise", daemon=True).start()

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
                    self.set_adult_media_state(source.name, "processing")
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
                                    "updated": time.time()})
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
            with self.adult_optimisation_lock:
                self.adult_optimisation_active.discard(file_name)

    def _optimise_for_playback(self, source: Path, destination: Path,
                               video_filter: str, bitrate: str,
                               maximum_bitrate: str, buffer_size: str) -> None:
        token = uuid.uuid4().hex
        temporary = self.incoming / f"{token}.optimising.mp4"
        error_log = self.incoming / f"{token}.ffmpeg.log"
        command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                   "-threads", "2", "-filter_threads", "2", "-i", str(source),
                   "-map", "0:v:0", "-map", "0:a:0?", "-vf", video_filter,
                   # Debian 13 exposes Pi hardware decode but no usable V4L2
                   # H.264 encoder node. A bounded two-thread software encode
                   # is slower, but reliable; the resulting file is then
                   # hardware-decoded during every actual TV playback.
                   "-c:v", "libx264", "-preset", "veryfast", "-threads:v", "2",
                   "-profile:v", "main", "-level:v", "3.1", "-b:v", bitrate,
                   "-maxrate", maximum_bitrate, "-bufsize", buffer_size,
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(temporary)]
        process: subprocess.Popen[bytes] | None = None
        paused = False
        deadline = time.monotonic() + 45 * 60
        try:
            with error_log.open("wb") as errors:
                process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=errors,
                                           start_new_session=True)
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        os.killpg(process.pid, signal.SIGTERM)
                        raise ValueError("Mabel TV stopped this optimisation because it took too long")
                    temperature = self.cpu_temperature_c()
                    if not paused and temperature >= MAX_CONVERSION_TEMP_C:
                        os.killpg(process.pid, signal.SIGSTOP)
                        paused = True
                        print(f"Paused video optimisation at {temperature:.1f}C", file=sys.stderr,
                              flush=True)
                    elif paused and temperature <= RESUME_CONVERSION_TEMP_C:
                        os.killpg(process.pid, signal.SIGCONT)
                        paused = False
                        print(f"Resumed video optimisation at {temperature:.1f}C", file=sys.stderr,
                              flush=True)
                    time.sleep(2)
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
                offset = part.stat().st_size if part.is_file() else 0
                if offset == size and value.get("status", "uploading") == "uploading":
                    value["status"] = "validating"
                    value["updated"] = time.time()
                    self.write_json(manifest, value)
                    self.queue_conversion(str(value["id"]))
                return {"id": value["id"], "offset": offset,
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
            self.write_json(self.incoming / f"{upload_id}.json", {
                "id": upload_id,
                "kind": "adult",
                "file_name": file_name,
                "folder": folder,
                "size": size,
                "created": time.time(),
            })
            return {"id": upload_id, "offset": 0}

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
                offset = part.stat().st_size if part.exists() else 0
                output_reserve = 0 if (destination.exists()
                                               or destination.with_suffix(".mp4").exists()) \
                    else size
                reserve = max(0, size - offset) + output_reserve + 512 * 1024 * 1024
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
                        "processing": value.get("status") in {
                            "validating", "queued", "processing", "publishing", "finalising"
                        },
                        "status": value.get("status", "uploading")}

        if destination.exists() or destination.with_suffix(".mp4").exists():
            raise ValueError("A file with that name already exists in this channel")
        reserve = size * 2 + 512 * 1024 * 1024
        if shutil.disk_usage(self.media_root).free < reserve:
            raise ValueError("There is not enough free space to upload and safely prepare that video")
        self.clear_superseded_upload_errors(number, file_name)
        upload_id = uuid.uuid4().hex
        self.write_json(self.incoming / (upload_id + ".json"), {"id": upload_id, "channel": number, "file_name": file_name, "size": size, "created": time.time()})
        return {"id": upload_id, "offset": 0}

    def upload_action(self, upload_id: str, action: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
            raise ValueError("Invalid upload")
        if action not in {"cancel", "retry", "refresh"}:
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

                status = str(metadata.get("status", "uploading")) \
                    if isinstance(metadata, dict) else str(
                        result.get("status", "") if isinstance(result, dict) else "")
                if status not in {"uploading", "queued", "error"}:
                    raise ValueError("This upload is already being prepared and can no longer be cancelled")
                self.unlink_with_retry(self.incoming / f"{upload_id}.part")
                self.unlink_with_retry(manifest)
                self.unlink_with_retry(result_path)
                self.deferred_retries.discard(upload_id)
                if upload_id in self.queued_conversions:
                    self.cancelled_conversions.add(upload_id)
                self.upload_locks.pop(upload_id, None)
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
            "error": metadata.get("error"),
        }

    def append_upload(self, upload_id: str, offset: int, content: bytes) -> dict[str, Any]:
        with self.config_lock:
            lock = self.upload_locks.setdefault(upload_id, threading.Lock())
        with lock:
            return self._append_upload(upload_id, offset, content)

    def _append_upload(self, upload_id: str, offset: int, content: bytes) -> dict[str, Any]:
        meta = self.upload_meta(upload_id)
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
        if result["complete"]:
            # Persist receipt before any potentially slow probe. The one media
            # worker validates, converts if necessary, publishes, then refreshes
            # the TV. A lost final PATCH response can therefore be polled safely.
            meta["status"] = "validating"
            meta["updated"] = time.time()
            self.write_json(self.incoming / (upload_id + ".json"), meta)
            self.queue_conversion(upload_id)
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
                "optimise-adult", "set-portal-theme", "set-remote-simultaneous"}:
            # These settings belong to the portal/library service.  In
            # particular, allowing a browser stream alongside the television
            # must never refresh or otherwise disturb the TV player.
            return True
        return self.refresh_tv()

    def _manage(self, payload: dict[str, Any]) -> None:
        action = payload.get("action")
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
                folder.mkdir(mode=0o750, exist_ok=True); shutil.move(str(directory / file_name), str(destination)); shutil.rmtree(directory)
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

    def log_message(self, fmt: str, *args: Any) -> None: return

    def unexpected(self, operation: str, error: Exception) -> None:
        print(f"{operation} failed: {error}", file=sys.stderr, flush=True)

    def security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "script-src 'self' 'unsafe-inline'; img-src 'self' data:; "
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
                data = INDEX.encode(); self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store"); self.security_headers(); self.end_headers(); self.wfile.write(data); return
            static_assets = {
                "/mabeltv-icon.png": ("mabeltv-icon.png", "image/png"),
                "/mabeltv-pwa-icon.png": ("icons/icon-512.png", "image/png"),
                "/apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
                "/apple-touch-icon-180x180.png": ("apple-touch-icon.png", "image/png"),
                "/icons/icon-192.png": ("icons/icon-192.png", "image/png"),
                "/icons/icon-512.png": ("icons/icon-512.png", "image/png"),
                "/hls.min.js": ("hls.min.js", "text/javascript; charset=utf-8"),
                "/manifest.json": ("mabeltv-manifest.json", "application/manifest+json"),
                "/manifest.webmanifest": ("mabeltv-manifest.json", "application/manifest+json"),
            }
            if self.path in static_assets:
                relative_path, content_type = static_assets[self.path]
                asset_path = Path(__file__).parent / relative_path
                if not asset_path.is_file():
                    self.json(404, {"error": "Static asset not found"}); return
                data = asset_path.read_bytes(); self.send_response(200); self.send_header("Content-Type", content_type); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store"); self.security_headers(); self.end_headers(); self.wfile.write(data); return
            if self.path == "/api/setup": self.json(200, self.server.library.public_setup()); return
            if not self.require(): return
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == "/watch/player":
                data = WATCH_PAGE.encode(); self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store"); self.security_headers(); self.end_headers(); self.wfile.write(data); return
            if self.path == "/api/live":
                self.json(200, self.server.library.live_tv_status()); return
            if self.path == "/api/live/stream.m3u8":
                self.json(410, {"error": "The live picture now uses the portal frame feed"}); return
            if urlsplit(self.path).path == "/api/live/frame.jpg":
                self.stream_bytes(self.server.library.live_tv_frame(), "image/jpeg"); return
            if self.path.startswith("/api/live/segment-") or self.path == "/api/live/init.mp4":
                self.json(410, {"error": "The live picture now uses the portal frame feed"}); return
            if self.path == "/api/library": self.json(200, self.server.library.library()); return
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
            if parsed.path.startswith("/api/usb/imports/"):
                self.json(200, self.server.library.usb_import_status(
                    parsed.path.rsplit("/", 1)[1])); return
            if parsed.path == "/api/tmdb/status":
                self.json(200, self.server.library.tmdb_status()); return
            if parsed.path.startswith("/api/adult/artwork/"):
                self.stream_file(self.server.library.adult_artwork(
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
            if self.path == "/api/play-on-tv":
                self.json(200, self.server.library.play_on_tv(payload)); return
            if self.path == "/api/remote/start":
                self.json(200, self.server.library.start_remote_stream(payload)); return
            if self.path == "/api/remote/stop-tv":
                self.json(200, self.server.library.remote_stop_tv()); return
            if self.path == "/api/remote/position":
                self.json(200, self.server.library.remote_save_position(payload)); return
            if self.path == "/api/remote/clear-position":
                self.json(200, self.server.library.remote_clear_position(payload)); return
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
            if self.path == "/api/tmdb/channels":
                self.json(200, self.server.library.refresh_channel_metadata()); return
            if self.path == "/api/adult/uploads":
                self.json(201, self.server.library.adult_upload_create(payload)); return
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
