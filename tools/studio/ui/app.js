import { $, escape, icons, attempt, toast } from './shared.js';
import { Destination } from './destination.js';
import { Search } from './search.js';
import { renderJobs } from './jobs.js';
import { reviewTitles } from './title-review.js';

let snapshot = null, files = [], view = 'add';
let sourceSizeGeneration = 0;
const descriptions = {
  add: ['YOUR MEDIA, READY TO WATCH', 'Make room for your next watch.', 'Find it, prepare it, send it. All from one place.'],
  iplayer: ['FIND SOMETHING GOOD', 'A world of BBC favourites.', 'Choose the episodes you want. Studio takes care of the rest.'],
  queue: ['EVERY STEP, IN ONE PLACE', 'Good things are on their way.', 'Downloads, preparation and transfers. Pick up right where you left off.'],
  completed: ['READY WHEN YOU ARE', 'More watching. Less waiting.', 'Your finished additions, with local files safely kept.'],
  settings: ['MAKE STUDIO YOURS', 'At home. Away. Connected.', 'Your connections, working folder and media tools.']
};
const catalogue = () => ({ ...(snapshot?.catalogue || { channels: [], series: [] }), compressionProfiles: snapshot?.compressionProfiles || [] });
const addDestination = new Destination('#add-destination', { catalogue, submit: async destination => {
  const inputs = await reviewTitles(files.map(path => ({ kind: 'file', path })), destination);
  if (!inputs) return;
  const result = await window.studio.add(inputs, destination);
  files = []; renderFiles(); toast(result.length ? `${result.length} video${result.length === 1 ? '' : 's'} added to your queue.` : 'These files are already in your queue for this destination.'); showView('queue');
} });
let search;
const searchDestination = new Destination('#iplayer-destination', { catalogue, search: true, submit: destination => search.submit(destination) });
search = new Search(searchDestination);
window.showStudioView = showView;
window.refreshStudio = refresh;

function showView(name) {
  view = name; document.querySelectorAll('.view').forEach(node => node.classList.toggle('hidden', node.id !== 'view-' + name));
  document.querySelectorAll('[data-view]').forEach(node => { node.classList.toggle('active', node.dataset.view === name); if (node.dataset.view === name) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  const [eyebrow, title, description] = descriptions[name];
  $('#eyebrow').textContent = eyebrow; $('#page-title').textContent = title; $('#page-description').textContent = description;
  $('main').scrollTo(0, 0);
  if (name === 'settings') renderSettings();
  if (name === 'iplayer') search?.checkPresence();
}
function renderFiles() {
  $('#selected-files').innerHTML = files.map((file, index) => `<div class="selected-file"><span title="${escape(file)}">${escape(file.split(/[\\/]/).pop())}</span><button data-remove="${index}" aria-label="Remove ${escape(file.split(/[\\/]/).pop())}">×</button></div>`).join('');
  $('#selected-files').querySelectorAll('button').forEach(button => button.onclick = () => { files.splice(Number(button.dataset.remove), 1); renderFiles(); });
  addDestination.setCount(files.length);
  const generation = ++sourceSizeGeneration;
  window.studio.sourceSize(files).then(bytes => { if (generation === sourceSizeGeneration) addDestination.setSourceSize(bytes); }).catch(() => {});
}
function addFiles(values) {
  files = Array.from(new Set([...files, ...values.filter(file => /\.(mp4|m4v|mov|mkv|avi|webm|mpg|mpeg|ts)$/i.test(file))]));
  if (files.length > 200) { files = files.slice(0, 200); toast('Add up to 200 videos at a time.'); }
  renderFiles();
}
async function refresh() {
  snapshot = await window.studio.snapshot();
  addDestination.render(); searchDestination.render();
  renderJobs(snapshot.jobs); updateConnection(snapshot.connection);
  return snapshot;
}
function updateConnection(connection) {
  if (snapshot) snapshot.connection = connection;
  $('#status-dot').classList.toggle('connected', Boolean(connection?.connected));
  $('#device-label').textContent = connection?.name || 'Your MabelTV';
  $('#connection-label').textContent = connection?.connected ? connection.mode === 'local' ? 'Connected · local network' : 'Connected · remote portal' : 'Ready to connect in Settings';
}
function renderSettings() {
  const settings = snapshot.settings;
  $('#local-url').value = settings.localUrl; $('#remote-url').value = settings.remoteUrl;
  $('#connection-mode').value = settings.connectionMode; $('#workspace').value = settings.workspace;
  $('#tools-status').textContent = snapshot.tools.ready ? 'READY' : 'CHECK TOOLS';
  $('#tools-detail').innerHTML = [['FFmpeg',snapshot.tools.ffmpeg],['FFprobe',snapshot.tools.ffprobe],['get_iplayer',snapshot.tools.getPlayer && snapshot.tools.perl]].map(([name, found]) => `<div class="tool-row"><strong>${name}</strong><span>${found ? 'Available' : 'Not found'}</span></div>`).join('');
  $('#app-version').textContent = `MabelTV Studio ${snapshot.version}`;
}
async function connect(mode) {
  const output = $('#connection-result'); output.className = 'inline-message'; output.textContent = 'Checking connection…';
  try {
    const result = await window.studio.connect(mode);
    await refresh(); updateConnection(result);
    output.textContent = `${result.name} is connected over ${result.mode === 'local' ? 'your local network' : 'the remote portal'}. ${result.catalogue.channels.length} channels and ${result.catalogue.series.length} shows are available.`;
    return result;
  } catch (error) {
    output.className = 'inline-message error'; output.textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    updateConnection(null); throw error;
  }
}
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));
$('#connection-settings').onclick = () => showView('settings');
$('#dropzone').onclick = () => attempt(async () => addFiles(await window.studio.pickFiles()));
$('#dropzone').ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('#dropzone').classList.add('dragging'); };
$('#dropzone').ondragleave = () => $('#dropzone').classList.remove('dragging');
$('#dropzone').ondrop = event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); addFiles(window.studio.droppedFiles(event.dataTransfer.files)); };
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
document.addEventListener('error', event => {
  if (event.target.tagName !== 'IMG') return;
  const review = event.target.closest('.review-result');
  event.target.replaceWith(Object.assign(document.createElement('span'), {
    className: review ? 'review-no-art' : 'artwork artwork-placeholder', textContent: review ? 'No artwork' : 'BBC'
  }));
}, true);
$('#open-portal').onclick = () => attempt(() => window.studio.openPortal());
$('#open-workspace').onclick = () => attempt(() => window.studio.openWorkspace());
$('#settings-form').onsubmit = event => { event.preventDefault(); attempt(async () => {
  await window.studio.settings({ localUrl: $('#local-url').value, remoteUrl: $('#remote-url').value, connectionMode: $('#connection-mode').value });
  await refresh(); await connect();
}); };
$('#test-local').onclick = () => attempt(() => connect('local'));
$('#test-remote').onclick = () => attempt(() => connect('remote'));
$('#remote-signin').onclick = () => attempt(async () => {
  await window.studio.settings({ remoteUrl: $('#remote-url').value });
  await window.studio.signIn(); toast('Complete the remote-access sign-in in the window that opened.');
});
$('#choose-workspace').onclick = () => attempt(async () => {
  const workspace = await window.studio.pickFolder(); if (!workspace) return;
  await window.studio.settings({ workspace }); await refresh(); renderSettings(); toast('Working folder updated for new jobs.');
});
$('#choose-tools').onclick = () => attempt(async () => {
  const toolFolder = await window.studio.pickFolder(); if (!toolFolder) return;
  await window.studio.settings({ toolFolder }); await refresh(); renderSettings();
});
$('#pin-open').onclick = () => { $('#pin-value').value = ''; $('#pin-error').textContent = ''; $('#pin-dialog').showModal(); $('#pin-value').focus(); };
$('#pin-close').onclick = () => { $('#pin-value').value = ''; $('#pin-dialog').close(); };
$('#pin-form').onsubmit = async event => {
  event.preventDefault();
  try { const pin = $('#pin-value').value; $('#pin-value').value = ''; await window.studio.pin(pin, $('#pin-mode').value); $('#pin-dialog').close(); await refresh(); toast('Portal connected.'); }
  catch (error) { $('#pin-error').textContent = error.message; }
};
let sendId;
const sendDialog = document.createElement('dialog'); sendDialog.id = 'send-dialog';
sendDialog.innerHTML = '<div class="section-heading"><h2>Send your prepared video</h2><button class="icon-button close-send" aria-label="Close">×</button></div><div class="destination-panel" id="send-destination"></div>';
document.body.append(sendDialog); $('.close-send').onclick = () => sendDialog.close();
const sendDestination = new Destination('#send-destination', { catalogue, submit: async destination => {
  if (destination.kind === 'local') throw new Error('Choose a MabelTV destination to send this video.');
  const job = snapshot.jobs.find(job => job.id === sendId);
  sendDialog.close();
  const inputs = await reviewTitles([{ metadata: job.metadata, path: job.sourcePath }], destination);
  if (!inputs) { sendDialog.showModal(); return; }
  await window.studio.action(sendId, 'send', destination, inputs[0].match); showView('queue');
} });
window.openSendDialog = id => { sendId = id; const job = snapshot.jobs.find(j => j.id === id); sendDestination.setSourceSize(job?.sourceFingerprint?.size || job?.analysis?.bytes || 0); sendDestination.setCount(1); sendDialog.showModal(); };
window.studio.onQueue(jobs => {
  if (!snapshot) return;
  snapshot.jobs = jobs;
  search.libraryChanged(jobs);
  const focus = document.activeElement?.dataset;
  const restore = focus?.jobAction ? { id: focus.id, action: focus.jobAction } : null;
  renderJobs(jobs);
  if (restore && ['queue', 'completed'].includes(view)) document.querySelector(`#view-${view} [data-id="${restore.id}"][data-job-action="${restore.action}"]`)?.focus({ preventScroll: true });
});
window.studio.onConnection(async value => { await refresh(); updateConnection(value); toast('Remote access is connected.'); });
window.studio.onConnectionState(updateConnection);
icons();
await attempt(async () => { await refresh(); if (snapshot.warning) toast(snapshot.warning); });
await attempt(async () => { await connect(); });
