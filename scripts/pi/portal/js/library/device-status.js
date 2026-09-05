'use strict'

    $('#usbRefresh').onclick = () => refreshUsb().catch(error => notice(error.message, true))
    $('#usbUp').onclick = () => browseUsb(usbPath.split('/').slice(0, -1).join('/')).catch(error => notice(error.message, true))
    $('#usbSelectAll').onclick = () => {
      const videos = usbEntries.filter(entry => entry.type === 'video')
      const allSelected = videos.every(entry => usbSelection.has(entry.path))
      videos.forEach(entry => allSelected ? usbSelection.delete(entry.path) : usbSelection.add(entry.path))
      renderUsbFiles()
    }
    $('#usbTarget').onchange = () => {
      const target = $('#usbTarget').value
      $('#usbChannelLabel').classList.toggle('hidden', target !== 'channel')
      $('#usbSeriesLabel').classList.toggle('hidden', target !== 'series')
      if (target === 'series' && !$('#usbSeriesName').value.trim() && usbSelection.size === 1) {
        const selected = [...usbSelection][0]
        const entry = usbEntries.find(value => value.path === selected)
        if (entry?.type === 'folder') $('#usbSeriesName').value = entry.name
      }
    }
    $('#usbEject').onclick = () => openLibrarySheet($('#usbEjectSheet'), $('#cancelUsbEject'))
    const usbEjectSheet = $('#usbEjectSheet')
    const closeUsbEjectSheet = () => closeLibrarySheet(usbEjectSheet)
    $('#cancelUsbEject').onclick = closeUsbEjectSheet
    portalSheets.wire(usbEjectSheet, {
      closeButton: $('#closeUsbEject'),
      close: closeUsbEjectSheet,
    })
    $('#confirmUsbEject').onclick = async () => {
      const button = $('#confirmUsbEject')
      button.disabled = true
      try {
        closeLibrarySheet($('#usbEjectSheet'))
        const result = await api('/api/usb', { method: 'POST', body: JSON.stringify({ action: 'eject', volume: usbVolume }) })
        usbVolume = ''; usbPath = ''; usbEntries = []; usbSelection.clear(); renderUsbFiles(); await refreshUsb(); notice(result.message)
      } catch (error) { notice(error.message, true) }
      finally { button.disabled = false }
    }
    $('#usbImport').onclick = async () => {
      const selectedCount = usbSelection.size
      if (!confirm(`Copy ${selectedCount} selected item${selectedCount === 1 ? '' : 's'} into MabelTV? The USB originals will not be changed.`)) return
      const button = $('#usbImport'); button.disabled = true
      try {
        const payload = { action: 'import', volume: usbVolume, paths: [...usbSelection], target: $('#usbTarget').value }
        if (payload.target === 'channel') payload.channel = Number($('#usbChannel').value)
        if (payload.target === 'series') payload.series_name = $('#usbSeriesName').value.trim()
        const job = await api('/api/usb', { method: 'POST', body: JSON.stringify(payload) })
        usbSelection.clear(); renderUsbFiles(); monitorUsbJob(job.id)
      } catch (error) { notice(error.message, true); updateUsbSelection() }
    }

    async function monitorUsbJob(id) {
      clearTimeout(usbJobTimer)
      $('#usbJob').classList.remove('hidden')
      try {
        const job = await api(`/api/usb/imports/${id}`)
        $('#usbJobTitle').textContent = job.status === 'complete' ? 'Copy complete' : job.status === 'error' ? 'Copy stopped' : `Copying ${job.current || 'videos'}…`
        $('#usbJobText').textContent = `${job.files_done} of ${job.files_total} files · ${formatBytes(job.bytes_done)} of ${formatBytes(job.bytes_total)} — ${job.message}`
        $('#usbJobProgress').max = Math.max(1, job.bytes_total)
        $('#usbJobProgress').value = job.bytes_done
        if (job.status === 'complete') { await load(); notice('USB videos copied into MabelTV.') }
        else if (job.status === 'error') notice(job.message, true)
        else usbJobTimer = setTimeout(() => monitorUsbJob(id), 1000)
      } catch (error) { notice(error.message, true) }
    }


    function renderTvSettings() {
      const settings = library?.tv_settings || {}
      const setValue = (selector, value, fallback) => {
        const control = $(selector)
        const next = String(value ?? fallback)
        if ([...control.options].some(option => option.value === next)) control.value = next
      }
      setValue('#tvPlaybackMode', settings.playback_mode, 'continuous')
      setValue('#tvEpisodeReset', settings.episode_reset_minutes, 0)
      setValue('#tvPictureMode', settings.picture_mode, 'channel')
      setValue('#tvBorder', settings.tv_border, 'slim-black')
      setValue('#tvDisplayResolution', settings.display_resolution, '720p')
      setValue('#tvVolumeLimit', settings.volume_limit_enabled, true)
      setValue('#tvSoundEffects', settings.sound_effects_enabled, true)
      setValue('#tvScrubbing', settings.scrubbing_enabled, false)
      const setRange = (input, output, value, fallback) => {
        const control = $(input)
        control.value = String(value ?? fallback)
        $(output).textContent = `${control.value}%`
      }
      setRange('#tvCrtGlass', '#tvCrtGlassValue', settings.crt_glass, 35)
      setRange('#tvDistortion', '#tvDistortionValue', settings.video_distortion, 20)
      setRange('#tvMaximumVolume', '#tvMaximumVolumeValue', settings.maximum_volume, 60)
    }

    function renderParentOverlayStyle() {
      const current = library?.appearance?.parent_overlay_style || 'classic'
      $$('[data-parent-style]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.parentStyle === current))
      })
    }

    $$('[data-parent-style]').forEach(button => button.onclick = () => {
      const style = button.dataset.parentStyle
      if (style !== (library?.appearance?.parent_overlay_style || 'classic'))
        manage('set-parent-overlay-style', { style })
    })

    function renderTvGuideSetting() {
      const enabled = library?.appearance?.tv_guide_enabled === true
      $('#tvGuideToggle').setAttribute('aria-pressed', String(enabled))
      $('#tvGuideToggle').textContent = enabled ? 'On' : 'Off'
      $('#tvGuideState').textContent = enabled ? 'On · ready on the television' : 'Off'
    }

    function renderPortalPinSetting() {
      const required = library?.owner?.portal_pin_required !== false
      $('#portalPinState').textContent = required
        ? 'A parent PIN is required to open this portal'
        : 'This portal opens without a PIN'
      $('#portalPinToggle').textContent = required ? 'Turn off PIN entry' : 'Turn on PIN entry'
    }

    $('#tvGuideToggle').onclick = () => manage('set-tv-guide-enabled', {
      enabled: !(library?.appearance?.tv_guide_enabled === true)
    })

    ;[['#tvCrtGlass', '#tvCrtGlassValue'], ['#tvDistortion', '#tvDistortionValue'], ['#tvMaximumVolume', '#tvMaximumVolumeValue']]
      .forEach(([input, output]) => $(input).oninput = () => { $(output).textContent = `${$(input).value}%` })

    function renderStatus() {
      const system = library.system || {}, storage = library.storage || {}, warnings = system.warnings || []
      const warningCount = warnings.length || 1
      $('#topHealth').textContent = system.healthy ? 'Everything looks good' : `${warningCount} item${warningCount === 1 ? '' : 's'} need attention`
      $('#topHealth').classList.toggle('bad', !system.healthy)
      $('#homeStatusIcon').textContent = system.healthy ? '✓' : '!'
      $('#homeStatusIcon').classList.toggle('warn', !system.healthy)
      $('#healthTitle').textContent = system.healthy ? 'Everything looks good' : `${tvName()} needs a little attention`
      $('#healthSummary').textContent = system.healthy ? 'The player, temperature, power, and storage checks are all healthy.' : (warnings[0] || 'Check the system details below.')
      $('#temperature').textContent = system.temperature_c ? `${system.temperature_c.toFixed(1)}°C` : 'Unknown'
      $('#storageFree').textContent = `${Number(storage.free_gb || 0).toFixed(1)} GB`
      $('#uptime').textContent = duration(system.uptime_seconds)
      $('#warningsCard').classList.toggle('hidden', warnings.length === 0)
      $('#warnings').innerHTML = warnings.map(warning => `<div class="callout warn">${escapeHtml(warning)}</div>`).join('')
      $$('[data-version]').forEach(element => { element.textContent = system.version || '' })
      $('#systemDetails').innerHTML = `<dt>TV player</dt><dd>${escapeHtml(system.player || 'unknown')}</dd><dt>Video preparation</dt><dd>${escapeHtml(system.media_worker || 'unknown')}</dd><dt>Temperature</dt><dd>${system.temperature_c ? `${system.temperature_c.toFixed(1)}°C` : 'unavailable'}</dd><dt>Power / heat limiting now</dt><dd>${system.currently_throttled ? 'Yes' : 'No'}</dd><dt>Since last boot</dt><dd>${system.historical_throttle ? 'A power or heat event occurred' : 'No limiting recorded'}</dd><dt>Storage</dt><dd>${Number(storage.free_gb || 0).toFixed(1)} GB free of ${Number(storage.total_gb || 0).toFixed(1)} GB</dd><dt>Uptime</dt><dd>${duration(system.uptime_seconds)}</dd><dt>Device</dt><dd>${escapeHtml(system.device_name || tvName())}</dd><dt>Version</dt><dd>${escapeHtml(system.version || 'development')}</dd><dt>Last checked</dt><dd>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</dd>`
      if (library.owner?.pin_change_recommended) {
        $('#warningsCard').classList.remove('hidden')
      }
    }

    function renderUploads() {
      const root = $('#uploadJobs'), jobs = library.uploads || []
      if (!jobs.length) { root.innerHTML = '<p class="muted">No videos are waiting.</p>'; return }
      const labels = {
        uploading: 'Uploading', validating: 'Checking the video', queued: 'Waiting in the preparation queue',
        processing: 'Preparing for smooth playback', publishing: 'Publishing', finalising: 'Refreshing the TV',
        error: 'Needs attention', 'refresh-error': 'TV refresh needed'
      }
      root.innerHTML = jobs.map(job => {
        const percent = job.size ? Math.min(100, Math.round((job.offset || 0) * 100 / job.size)) : 0
        const detail = job.status === 'error'
          ? `${escapeHtml(job.error || 'This video could not be prepared.')} Choose the original file above to try again.`
          : job.status === 'refresh-error'
            ? 'The video is safely stored, but the TV did not refresh. Retry it here.'
            : `${escapeHtml(labels[job.status] || job.status)}${job.status === 'uploading' ? ` · ${percent}%` : ''}`
        const actions = `${job.refreshable ? `<button type="button" class="secondary" data-upload-action="refresh" data-upload-id="${job.id}">Retry TV refresh</button>` : ''}${job.retryable ? `<button type="button" class="secondary" data-upload-action="retry" data-upload-id="${job.id}">Retry now</button>` : ''}${job.cancelable ? `<button type="button" class="secondary" data-upload-action="cancel" data-upload-id="${job.id}">${job.status === 'error' ? 'Dismiss' : 'Cancel upload'}</button>` : ''}`
        return `<div class="callout ${['error', 'refresh-error'].includes(job.status) ? 'warn' : ''}"><strong>${escapeHtml(job.file_name)}</strong><br><span class="small muted">${escapeHtml(job.channel_name)} · ${detail}</span>${actions ? `<div class="row" style="margin-top:10px">${actions}</div>` : ''}</div>`
      }).join('')
      $$('[data-upload-action]').forEach(button => button.onclick = () => uploadQueueAction(
        button.dataset.uploadId, button.dataset.uploadAction))
    }

    async function uploadQueueAction(id, action) {
      if (action === 'cancel' && !confirm('Remove this upload and free the space it is using?')) return
      try {
        const result = await api('/api/uploads/' + id, {
          method: 'POST', body: JSON.stringify({ action })
        })
        await refreshLiveStatus()
        notice(result.message || 'Done.')
      } catch (error) { notice(error.message, true) }
    }

    async function refreshLiveStatus() {
      const fresh = await api('/api/status')
      if (!library) return
      library = { ...library, ...fresh }
      renderStatus()
      renderUploads()
    }

    function activityDuration(seconds) {
      const value = Math.max(0, Number(seconds) || 0)
      if (!value) return 'Estimating time left'
      const minutes = Math.ceil(value / 60)
      return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left`
    }

    function activityJobMarkup(job, kind) {
      const isOptimising = kind === 'optimising'
      const percent = Math.max(0, Math.min(100, Number(job.progress ?? (job.size ? (job.offset || 0) * 100 / job.size : 0)) || 0))
      const transfer = job.transfer_state || 'active'
      const state = isOptimising ? (job.state === 'queued' ? 'Waiting for the encoder' : job.message || 'Optimising for Pi') : (transfer === 'waiting' ? 'Waiting in upload queue' : transfer === 'paused' ? 'Paused' : !job.source_available && job.status === 'uploading' ? 'Waiting for source file — select the same file again on the laptop to resume' : ({ uploading: 'Uploading', validating: 'Checking video', queued: 'Waiting to publish', processing: 'Preparing video', publishing: 'Publishing', finalising: 'Refreshing TV', error: job.error || 'Needs attention', 'refresh-error': 'TV refresh needed' }[job.status] || job.status))
      const detail = isOptimising ? activityDuration(job.eta_seconds) : `${job.channel_name || 'MabelTV'} · ${Math.round(percent)}%`
      const paused = isOptimising ? job.state === 'paused' : (job.status === 'paused' || transfer === 'paused')
      const cancellable = isOptimising ? ['queued', 'processing', 'paused'].includes(job.state) : ['uploading', 'queued', 'paused'].includes(job.status)
      const pausable = isOptimising ? ['queued', 'processing'].includes(job.state) : ['uploading', 'queued'].includes(job.status)
      const startable = !isOptimising && job.status === 'uploading' && transfer !== 'active'
      const controls = cancellable ? `<div class="activity-job-controls">${startable ? `<button type="button" data-activity-action="start" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Start next</button>` : paused ? `<button type="button" data-activity-action="resume" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Resume</button>` : pausable ? `<button type="button" data-activity-action="pause" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Pause</button>` : ''}<button type="button" class="danger" data-activity-action="cancel" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Cancel</button></div>` : ''
      return `<article class="activity-job"><div class="activity-job-top"><div><h2>${escapeHtml(job.title || job.file_name || 'Video')}</h2><p>${escapeHtml(state)}</p></div><strong>${Math.round(percent)}%</strong></div><div class="activity-progress"><i style="width:${percent}%"></i></div><div class="activity-job-meta"><span>${escapeHtml(detail)}</span><span>${isOptimising && job.started ? 'In progress' : ''}</span></div>${controls}</article>`
    }

    function renderActivity(activity) {
      const uploads = activity.uploads || [], optimisations = activity.optimisations || []
      const activeUploads = uploads.filter(job => !['error', 'refresh-error'].includes(job.status))
      const activeOptimisations = optimisations.filter(job => ['queued', 'processing'].includes(job.state))
      const uploadsRoot = $('#activityUploadList'), optimisationRoot = $('#activityOptimisationList')
      if (!uploadsRoot || !optimisationRoot) return
      $('#activityUploadCount').textContent = String(activeUploads.length)
      $('#activityOptimisationCount').textContent = String(activeOptimisations.length)
      $('#activitySummary').textContent = activity.active
        ? `${activeUploads.length + activeOptimisations.length} background job${activeUploads.length + activeOptimisations.length === 1 ? '' : 's'} in progress.`
        : 'Nothing is uploading or being prepared right now.'
      const temperature = $('#activityTemperature')
      temperature.classList.toggle('hidden', !activity.temperature_warning)
      temperature.textContent = activity.temperature_warning ? `${Number(activity.temperature_c).toFixed(0)}°C · watching temperature` : ''
      uploadsRoot.innerHTML = uploads.length ? uploads.map(job => activityJobMarkup(job, 'upload')).join('') : '<div class="activity-empty">No uploads are waiting or in progress.</div>'
      optimisationRoot.innerHTML = optimisations.length ? optimisations.map(job => activityJobMarkup(job, 'optimising')).join('') : '<div class="activity-empty">No films are being optimised right now.</div>'
      $$('[data-activity-action]').forEach(button => button.onclick = () => activityAction(button))
      const header = $('#mobileActivityStatus')
      const headerText = $('#mobileActivityText')
      const warning = activity.temperature_warning
      const firstOptimisation = activeOptimisations[0]
      header.classList.remove('hidden')
      header.classList.toggle('is-warning', warning)
      const firstUpload = activeUploads[0]
      const headerLabel = warning ? `${Number(activity.temperature_c).toFixed(0)}°C · Pi warming up`
        : firstOptimisation ? `Optimising · ${Math.round(firstOptimisation.progress || 0)}%`
          : activeUploads.length ? `${firstUpload.status === 'paused' ? 'Paused' : 'Uploading'} · ${Math.round((firstUpload.size ? firstUpload.offset * 100 / firstUpload.size : 0) || 0)}%` : ''
      headerText.textContent = headerLabel
      header.classList.toggle('is-idle', !headerLabel)
    }

    async function activityAction(button) {
      const action = button.dataset.activityAction
      if (action === 'cancel') {
        const message = button.dataset.activityKind === 'optimising'
          ? 'Cancel this optimisation? The unfinished optimised copy will be deleted. Your original film will be kept.'
          : 'Cancel this upload? All partially uploaded data for it will be deleted and its storage freed.'
        if (!confirm(message)) return
      }
      button.disabled = true
      try {
        if (button.dataset.activityKind === 'optimising') {
          await api('/api/manage', { method: 'POST', body: JSON.stringify({ action: 'optimisation-action', operation: action, file: button.dataset.activityId }) })
        } else {
          await api(`/api/uploads/${button.dataset.activityId}`, { method: 'POST', body: JSON.stringify({ action }) })
        }
        await loadActivity()
      } catch (error) { notice(error.message, true); button.disabled = false }
    }

    async function loadActivity() {
      const activity = await api('/api/activity')
      renderActivity(activity)
      return activity
    }

    $$('[data-activity-tab]').forEach(button => button.onclick = () => {
      const optimisation = button.dataset.activityTab === 'optimising'
      $$('[data-activity-tab]').forEach(item => item.classList.toggle('active', item === button))
      $('#activityUploads').classList.toggle('hidden', optimisation)
      $('#activityOptimising').classList.toggle('hidden', !optimisation)
    })

    window.setInterval(() => loadActivity().catch(() => {}), 5000)

