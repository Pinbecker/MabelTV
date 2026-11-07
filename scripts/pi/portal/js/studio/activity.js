'use strict'

const studioDismissedJobs = new Set()
let studioOpenHistorySwipe = null
function studioActivitySwipe(row, surface, job) {
  const removable = !job.cloudOperation && ['complete', 'failed', 'cancelled'].includes(job.status)
  row.classList.toggle('can-dismiss', removable)
  if (!removable) return
  const remove = document.createElement('button'); remove.type = 'button'
  remove.className = 'viewing-session-delete studio-history-delete'
  remove.setAttribute('aria-label', 'Remove ' + (job.matchedTitle?.title || job.title) + ' from Activity')
  remove.append(librarySignalIcon('signal-trash'), document.createTextNode('Remove'))
  const reveal = open => {
    if (open && studioOpenHistorySwipe && studioOpenHistorySwipe !== row) studioOpenHistorySwipe.classList.remove('history-open')
    row.classList.toggle('history-open', open); row.style.removeProperty('--studio-history-offset')
    row.classList.remove('history-swiping'); studioOpenHistorySwipe = open ? row : null
  }
  remove.onfocus = () => reveal(true)
  remove.onclick = async () => {
    remove.disabled = true
    try {
      await api('/api/studio/action', {method:'POST',body:JSON.stringify({id:job.id,action:'dismiss'})})
      studioDismissedJobs.add(job.id); row.remove(); renderStudioJobs()
    } catch (error) { studioFailure(error); remove.disabled = false }
  }
  let start = null, offset = 0, horizontal = false, suppressUntil = 0
  surface.addEventListener('pointerdown', event => {
    if (event.button > 0 || event.target.closest('button,a,input,select')) return
    start = {id:event.pointerId,x:event.clientX,y:event.clientY,offset:row.classList.contains('history-open') ? -86 : 0}; horizontal = false
  })
  surface.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id) return
    const x = event.clientX-start.x, y = event.clientY-start.y
    if (!horizontal && Math.abs(x)<7) return
    if (!horizontal && Math.abs(y)>Math.abs(x)) { start=null; return }
    horizontal = true; surface.setPointerCapture?.(event.pointerId)
    offset = Math.max(-86,Math.min(0,start.offset+x))
    row.classList.add('history-swiping');row.style.setProperty('--studio-history-offset',offset+'px')
    if (event.cancelable) event.preventDefault()
  })
  const finish = event => {
    if (!start || event.pointerId!==start.id) return
    start=null
    if (horizontal) {suppressUntil=Date.now()+350; reveal(event.type!=='pointercancel' && offset < -36)}
  }
  surface.addEventListener('pointerup',finish);surface.addEventListener('pointercancel',finish)
  surface.addEventListener('click',event=>{
    if (Date.now()<suppressUntil || row.classList.contains('history-open')) {
      event.preventDefault();event.stopPropagation();if(Date.now()>=suppressUntil)reveal(false)
    }
  },true)
  surface.addEventListener('keydown',event=>{
    if(event.key==='Delete'){event.preventDefault();remove.click()}
    if(event.key==='Escape')reveal(false)
  })
  row.append(remove)
}

function renderStudioJobs() {
  const organiser = studioState.status?.organiser
  const cloud = (studioState.status?.cloudOperations || []).map(op => ({ ...op, id: 'cloud:' + op.id, cloudOperation: true, title: 'Delete from iCloud', destination: { label: 'iCloud Drive' }, percent: op.items?.length ? op.completed / op.items.length * 100 : 0, message: op.error || `${op.completed || 0} of ${op.items?.length || 1} items` }))
  if (organiser) cloud.push({ ...organiser, id: 'organiser', cloudOperation: true, destination: { label: 'iCloud' } })
  const all = [...(studioState.status?.jobs || []), ...cloud]
  const recent = new Set(all.filter(job => job.status === 'complete').sort((a,b) => b.updated-a.updated).slice(0, 20).map(job => job.id))
  const jobs = all.filter(job => !job.historyHidden && !studioDismissedJobs.has(job.id) && !(job.id === 'organiser' && job.status === 'complete') && (job.status !== 'complete' || recent.has(job.id) || job.metadataWarning)).sort((a,b) => b.created-a.created), root = $('#studioJobs')
  const rows = new Map([...root.querySelectorAll('[data-studio-job]')].map(row => [row.dataset.studioJob, row]))
  $('#studioJobCount').textContent = `${jobs.length} item${jobs.length === 1 ? '' : 's'}`
  for (const [index, job] of jobs.entries()) {
    let row = rows.get(job.id)
    if (!row) { row = document.createElement('article'); row.className = 'studio-job'; row.dataset.studioJob = job.id }
    const waitingCloud = job.status === 'active' && (job.stage === 'waiting-for-cloud' || job.stage === 'saving-cloud' && /waiting for iCloud|iCloud.*confirm/i.test(job.message || ''))
    const presentation = studioJobPresentation(job, waitingCloud)
    const version = JSON.stringify([job.title, job.matchedTitle, job.match, job.destination, job.status, job.stage, presentation, job.errorCode])
    if (row.dataset.studioVersion !== version) {
      row.dataset.studioVersion = version
      const qualityReview = job.status === 'failed' && job.errorCode === 'QUALITY_REVIEW'
      const { status, message } = presentation
      const title = job.matchedTitle?.title || job.match?.title || (job.source?.type === 'torrent' ? studioVideoLabel(job.title) : job.title)
      const percent = Math.round(Math.max(0, Math.min(100, Number(job.percent) || 0)))
      const measurable = job.status === 'active' && (['downloading', 'preparing', 'uploading'].includes(job.stage) || job.cloudOperation && Number.isFinite(job.percent)) && !waitingCloud
      const retainedArt = row.querySelector('.studio-media-art')
      row.innerHTML = `<div class="studio-job-head"><span class="studio-media-art"></span><div><strong>${escapeHtml(title)}</strong><span class="studio-job-route">${escapeHtml(status)}${measurable ? `<span class="studio-job-speed"></span><span class="studio-job-percent">${percent}%</span>` : ''}${waitingCloud ? '<span class="studio-spinner studio-inline-spinner" aria-label="iCloud upload"></span>' : ''}</span></div></div>
        ${measurable ? `<div class="studio-job-progress"><progress max="100" value="${percent}" aria-label="${escapeHtml(job.title)} progress" aria-valuetext="${percent}%"></progress></div>` : ''}
        ${message ? `<p class="studio-job-wait"><span>${escapeHtml(message)}</span></p>` : ''}<div class="studio-job-actions"></div>`
      const cloudItem = studioState.items.find(item => item.id === job.source?.id)
      if (retainedArt) row.querySelector('.studio-media-art').replaceWith(retainedArt)
      studioJobArtwork(row.querySelector('.studio-media-art'), job, cloudItem ? studioCloudTitle(cloudItem) : job.matchedTitle || job.match)
      if (!job.cloudOperation) {
        const head = row.querySelector('.studio-job-head')
        head.setAttribute('role', 'button'); head.tabIndex = 0
        head.setAttribute('aria-label', 'Open ' + title)
        const open = () => {
          if (head.getAttribute('aria-busy') === 'true') return
          head.setAttribute('aria-busy', 'true')
          const spinner = document.createElement('span'); spinner.className = 'studio-spinner studio-inline-spinner'
          spinner.setAttribute('aria-label', 'Opening title'); head.querySelector('strong').append(' ', spinner)
          void studioOpenJobTitle(job, cloudItem ? studioCloudTitle(cloudItem) : job.matchedTitle || job.match)
            .catch(studioFailure).finally(() => { head.removeAttribute('aria-busy'); spinner.remove() })
        }
        head.onclick = open
        head.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open() } }
      }
      const actions = row.querySelector('.studio-job-actions')
      const add = (label, action) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-button compact'; button.textContent = label
        button.onclick = async () => {
          button.disabled = true
          try { await api('/api/studio/action', { method: 'POST', body: JSON.stringify({ id: job.id, action }) }); await studioTick() }
          catch (error) { studioFailure(error) }
          finally { button.disabled = false }
        }
        actions.append(button)
      }
      if (!job.cloudOperation && !waitingCloud && ['queued', 'active'].includes(job.status)) add('Pause', 'pause')
      if (!job.cloudOperation && !qualityReview && ['paused', 'failed'].includes(job.status)) add(job.status === 'failed' ? 'Retry' : 'Resume', 'resume')
      if (qualityReview && !job.destination.optimiseCloud) add(job.destination.kind === 'mabel' ? 'Continue to Mabel TV' : job.destination.kind === 'icloud' ? 'Continue to iCloud' : 'Continue to My TV', 'resume')
      if (qualityReview && job.destination.optimiseCloud) {
        const proceed = document.createElement('button'); proceed.type = 'button'; proceed.className = 'studio-button compact'; proceed.textContent = 'Compress anyway'
        proceed.onclick = async () => {
          if (!await portalConfirm({ title: 'Compress this copy again?', message: 'This file is already heavily compressed. Further compression may reduce picture quality.', confirmLabel: 'Compress anyway' })) return
          try { await api('/api/studio/action', { method: 'POST', body: JSON.stringify({ id: job.id, action: 'resume', allowRisk: true }) }); await studioTick() }
          catch (error) { studioFailure(error) }
        }
        actions.append(proceed)
      }
      if (!job.cloudOperation && !waitingCloud && !['complete', 'cancelled'].includes(job.status)) add('Cancel', 'cancel')
      if (job.status === 'failed' && job.source?.type === 'iplayer' && /^[bmp][a-z0-9]{7}$/.test(job.source.pid)) {
        const link = document.createElement('a'); link.className = 'studio-text-button'; link.textContent = 'Check BBC iPlayer'
        link.href = 'https://www.bbc.co.uk/iplayer/episode/' + job.source.pid; link.target = '_blank'; link.rel = 'noopener noreferrer'
        actions.append(link)
      }
      if (job.status === 'complete' && job.metadataWarning && ['film', 'series'].includes(job.destination.kind)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-text-button'; button.textContent = job.matchedTitle ? 'Retry details' : 'Match title'
        button.onclick = () => { if (job.matchedTitle) void api('/api/studio/action', { method: 'POST', body: JSON.stringify({ id: job.id, action: 'metadata', match: job.matchedTitle }) }).then(studioTick).catch(studioFailure); else openStudioDestination([], job) }; actions.append(button)
      }
      const surface = document.createElement('div'); surface.className = 'studio-job-surface'
      surface.append(...row.childNodes); row.append(surface)
      studioActivitySwipe(row, surface, job)
    }
    const cloudItem = studioState.items.find(item => item.id === job.source?.id)
    studioJobArtwork(row.querySelector('.studio-media-art'), job, cloudItem ? studioCloudTitle(cloudItem) : job.matchedTitle || job.match)
    const percent = Math.round(Math.max(0, Math.min(100, Number(job.percent) || 0)))
    const meter = row.querySelector('progress'), label = row.querySelector('.studio-job-percent'), speed = row.querySelector('.studio-job-speed')
    if (meter) { meter.value = percent; meter.setAttribute('aria-valuetext', percent + '%') }
    if (label) label.textContent = percent + '%'
    if (speed) speed.textContent = job.stage === 'downloading' ? (String(job.message || '').match(/\b[\d.,]+\s*[KMGT]?i?B\/s\b/i)?.[0] || '') : ''
    if (root.children[index] !== row) root.insertBefore(row, root.children[index] || null)
    rows.delete(job.id)
  }
  for (const row of rows.values()) row.remove()
  if (!jobs.length && !root.querySelector('.studio-jobs-empty')) { const empty = studioEmpty('All caught up', 'Downloads and transfers appear here.', 'signal-check'); empty.classList.add('studio-jobs-empty'); root.append(empty) }
  if (jobs.length) root.querySelector('.studio-jobs-empty')?.remove()
}
