"""Server-side portal assembly and emergency fallback documents."""

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent

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
        return load_portal_document(SERVICE_ROOT / "mabeltv-library.html")
    except OSError:
        return INDEX


INDEX = load_index()


def load_classic_index() -> str:
    """Load the preserved previous portal as an optional presentation shell."""
    try:
        return load_portal_document(SERVICE_ROOT / "mabeltv-library-classic.html")
    except OSError:
        return INDEX


CLASSIC_INDEX = load_classic_index()


def load_watch_page() -> str:
    try:
        return (SERVICE_ROOT / "mabeltv-watch.html").read_text(encoding="utf-8")
    except OSError:
        return "<!doctype html><title>MabelTV</title><p>The remote player is unavailable.</p>"


WATCH_PAGE = load_watch_page()
