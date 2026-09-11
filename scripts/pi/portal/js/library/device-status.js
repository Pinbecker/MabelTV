'use strict'

    $('#usbRefresh').onclick = () => refreshUsb().catch(error => notice(error.message, true))
    $('#usbUp').onclick = () => browseUsb(usbPath.split('/').slice(0, -1).join('/')).catch(error => notice(error.message, true))
    function usbTransferPayload(action) {
      const payload = {
        action, volume: usbVolume, paths: [...usbSelection], target: $('#usbTarget').value,
      }
      if (payload.target === 'adult') payload.folder = $('#usbAdultFolder').value
      if (payload.target === 'channel') payload.channel = Number($('#usbChannel').value)
      if (payload.target === 'series') {
        payload.series = $('#usbSeries').value
        payload.season = Number($('#usbSeason').value)
      }
      return payload
    }

    async function refreshUsbImportPlan() {
      const button = $('#confirmUsbImport')
      button.disabled = true
      usbImportPlan = null
      $('#usbPlanStatus').textContent = 'Checking videos, names and available space…'
      try {
        const plan = await api('/api/usb', {
          method: 'POST', body: JSON.stringify(usbTransferPayload('plan')),
        })
        usbImportPlan = plan
        $('#usbPlanFiles').textContent = String(plan.files_total)
        $('#usbPlanSize').textContent = formatBytes(plan.bytes_total)
        $('#usbPlanSpace').textContent = plan.enough_space
          ? formatBytes(Math.max(0, plan.free_bytes - plan.bytes_total)) : 'Not enough space'
        $('#usbPlanStatus').textContent = `${plan.files_total} video${plan.files_total === 1 ? '' : 's'} will be copied to ${plan.destination_label}.`
        const rename = $('#usbRenameSummary')
        rename.classList.toggle('hidden', !plan.rename_count)
        rename.innerHTML = plan.rename_count ? `<strong>${plan.rename_count} name${plan.rename_count === 1 ? '' : 's'} will be adjusted safely</strong><p>${plan.renames.map(value => `${escapeHtml(value.from)} → ${escapeHtml(value.to)}`).join('<br>')}${plan.truncated_renames ? '<br>…and more' : ''}</p>` : ''
        button.disabled = !plan.enough_space || plan.files_total < 1
      } catch (error) {
        $('#usbPlanStatus').textContent = error.message
        $('#usbPlanFiles').textContent = '—'
        $('#usbPlanSize').textContent = '—'
        $('#usbPlanSpace').textContent = '—'
        $('#usbRenameSummary').classList.add('hidden')
      }
    }

    $('#usbTarget').onchange = () => {
      const target = $('#usbTarget').value
      $('#usbAdultFolderLabel').classList.toggle('hidden', target !== 'adult')
      $('#usbChannelLabel').classList.toggle('hidden', target !== 'channel')
      $('#usbSeriesLabel').classList.toggle('hidden', target !== 'series')
      $('#usbSeasonLabel').classList.toggle('hidden', target !== 'series')
      if ($('#usbImportSheet').open) refreshUsbImportPlan()
    }
    $('#usbAdultFolder').onchange = () => {
      if ($('#usbImportSheet').open) refreshUsbImportPlan()
    }
    $('#usbChannel').onchange = () => {
      if ($('#usbImportSheet').open) refreshUsbImportPlan()
    }
    $('#usbSeries').onchange = () => {
      renderUsbSeriesDestinations($('#usbSeries').value)
      if ($('#usbImportSheet').open) refreshUsbImportPlan()
    }
    $('#usbSeason').onchange = () => {
      if ($('#usbImportSheet').open) refreshUsbImportPlan()
    }

    const usbImportSheet = $('#usbImportSheet')
    const closeUsbImportSheet = () => closeLibrarySheet(usbImportSheet)
    $('#cancelUsbImport').onclick = closeUsbImportSheet
    portalSheets.wire(usbImportSheet, {
      closeButton: $('#closeUsbImport'), close: closeUsbImportSheet,
      onClose: () => { usbImportPlan = null },
    })

    const usbFileActionsSheet = $('#usbFileActionsSheet')
    const closeUsbFileActionsSheet = () => closeLibrarySheet(usbFileActionsSheet)
    portalSheets.wire(usbFileActionsSheet, {
      closeButton: $('#closeUsbFileActions'), close: closeUsbFileActionsSheet,
      onClose: () => { selectedUsbEntry = null },
    })

    $('#usbWatchHere').onclick = () => {
      const entry = selectedUsbEntry
      if (!entry) return
      closeUsbFileActionsSheet()
      if (entry.browser_ready) openRemotePlayer({ kind: 'usb', volume: usbVolume, file: entry.path })
      else openInVlc({ kind: 'usb', volume: usbVolume, file: entry.path }, entry.name)
    }
    $('#usbDownload').onclick = () => {
      const entry = selectedUsbEntry
      if (!entry) return
      closeUsbFileActionsSheet()
      downloadToDevice({ kind: 'usb', volume: usbVolume, file: entry.path }, entry.name)
    }
    $('#usbPlayTv').onclick = async () => {
      const entry = selectedUsbEntry
      if (!entry || !confirm(`Play “${entry.name}” directly from the USB drive on the TV?`)) return
      const button = $('#usbPlayTv')
      button.disabled = true
      try {
        await api('/api/usb', {
          method: 'POST', body: JSON.stringify({ action: 'play', volume: usbVolume, path: entry.path }),
        })
        closeUsbFileActionsSheet()
      } catch (error) { notice(error.message, true) }
      finally { button.disabled = false }
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
        await api('/api/usb', { method: 'POST', body: JSON.stringify({ action: 'eject', volume: usbVolume }) })
        usbVolume = ''; usbPath = ''; usbEntries = []; usbSelection.clear(); renderUsbFiles(); await refreshUsb()
      } catch (error) { notice(error.message, true) }
      finally { button.disabled = false }
    }
    $('#usbImport').onclick = async () => {
      $('#usbTarget').onchange()
      openLibrarySheet(usbImportSheet, $('#usbTarget'))
      await refreshUsbImportPlan()
    }
    $('#confirmUsbImport').onclick = async () => {
      const button = $('#confirmUsbImport')
      button.disabled = true
      try {
        await api('/api/usb', { method: 'POST', body: JSON.stringify(usbTransferPayload('import')) })
        closeUsbImportSheet()
        usbSelection.clear()
        renderUsbFiles()
        await refreshUsb()
        openView('activity')
        await loadActivity()
        notice('USB transfer added to Activity. You can leave this page while it copies.')
      } catch (error) { notice(error.message, true); button.disabled = false }
    }
    $('#usbViewActivity').onclick = () => { openView('activity'); loadActivity().catch(() => {}) }


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

    function renderWatchmodeAvailabilitySetting() {
      const enabled = library?.adult_settings?.watchmode_availability_enabled !== false
      $('#watchmodeAvailabilityToggle').setAttribute('aria-pressed', String(enabled))
      $('#watchmodeAvailabilityToggle').textContent = enabled ? 'On' : 'Off'
      $('#watchmodeAvailabilityState').textContent = enabled
        ? 'On · direct links and rental prices' : 'Off · TMDB details still available'
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
    $('#watchmodeAvailabilityToggle').onclick = () => manage('set-watchmode-availability', {
      enabled: !adultAvailabilityEnabled(),
    })

    ;[['#tvCrtGlass', '#tvCrtGlassValue'], ['#tvDistortion', '#tvDistortionValue'], ['#tvMaximumVolume', '#tvMaximumVolumeValue']]
      .forEach(([input, output]) => $(input).oninput = () => { $(output).textContent = `${$(input).value}%` })

    function renderStatus() {
      const system = library.system || {}, storage = library.storage || {}, warnings = system.warnings || []
      const warningCount = warnings.length || 1
      $('#topHealth').textContent = system.healthy ? 'Everything looks good' : `${warningCount} item${warningCount === 1 ? '' : 's'} need attention`
      $('#topHealth').classList.toggle('bad', !system.healthy)
      if (document.body.classList.contains('portal-experience')) {
        $('#homeStatusIcon').replaceChildren(portalIcon(system.healthy ? 'signal-check' : 'signal-triangle-alert'))
      } else $('#homeStatusIcon').textContent = system.healthy ? '✓' : '!'
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
        await api('/api/uploads/' + id, {
          method: 'POST', body: JSON.stringify({ action })
        })
        await refreshLiveStatus()
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
      const isUsb = !isOptimising && job.source_kind === 'usb'
      const percent = Math.max(0, Math.min(100, Number(job.progress ?? (job.size ? (job.offset || 0) * 100 / job.size : 0)) || 0))
      const transfer = job.transfer_state || 'active'
      const uploadStates = {
        uploading: isUsb ? `Copying from ${job.source_label || 'USB drive'}` : 'Uploading',
        validating: 'Checking video', queued: 'Waiting to publish', processing: 'Preparing video',
        publishing: 'Publishing', finalising: 'Refreshing TV', error: job.error || 'Needs attention',
        'refresh-error': 'TV refresh needed', paused: 'Paused',
      }
      const state = isOptimising
        ? (job.state === 'queued' ? 'Waiting for the encoder' : job.message || 'Optimising for Pi')
        : transfer === 'waiting' ? (isUsb ? 'Waiting in transfer queue' : 'Waiting in upload queue')
          : transfer === 'source-missing' ? (job.error || 'USB drive disconnected — reconnect it, then resume')
            : transfer === 'paused' ? 'Paused' : !job.source_available && job.status === 'uploading'
              ? 'Waiting for source file — select the same file again on the laptop to resume'
              : (uploadStates[job.status] || job.status)
      const source = isUsb ? `${job.source_label || 'USB drive'} → ` : ''
      const detail = isOptimising ? activityDuration(job.eta_seconds)
        : `${source}${job.channel_name || 'MabelTV'} · ${Math.round(percent)}%`
      const paused = isOptimising ? job.state === 'paused' : (job.status === 'paused' || transfer === 'paused')
      const cancellable = isOptimising ? ['queued', 'processing', 'paused'].includes(job.state)
        : job.cancelable === true
      const pausable = isOptimising ? ['queued', 'processing'].includes(job.state)
        : ['uploading', 'queued'].includes(job.status) && transfer === 'active'
      const startable = !isOptimising && job.status === 'uploading' && transfer !== 'active'
      const retry = !isOptimising && job.retryable
        ? `<button type="button" data-activity-action="retry" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.id)}">Retry now</button>` : ''
      const refresh = !isOptimising && job.refreshable
        ? `<button type="button" data-activity-action="refresh" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.id)}">Retry TV refresh</button>` : ''
      const primary = startable ? `<button type="button" data-activity-action="start" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Start next</button>`
        : paused || transfer === 'source-missing' ? `<button type="button" data-activity-action="resume" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Resume</button>`
          : pausable ? `<button type="button" data-activity-action="pause" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Pause</button>` : ''
      const cancel = cancellable ? `<button type="button" class="danger" data-activity-action="cancel" data-activity-kind="${kind}" data-activity-source="${isUsb ? 'usb' : 'browser'}" data-activity-id="${escapeHtml(job.path || job.id)}">${isUsb ? 'Cancel transfer' : 'Cancel'}</button>` : ''
      const controls = primary || retry || refresh || cancel
        ? `<div class="activity-job-controls">${primary}${retry}${refresh}${cancel}</div>` : ''
      return `<article class="activity-job"><div class="activity-job-top"><div><h2>${escapeHtml(job.title || job.file_name || 'Video')}</h2><p>${escapeHtml(state)}</p></div><strong>${Math.round(percent)}%</strong></div><div class="activity-progress"><i style="width:${percent}%"></i></div><div class="activity-job-meta"><span>${escapeHtml(detail)}</span><span>${isOptimising && job.started ? 'In progress' : ''}</span></div>${controls}</article>`
    }

    function renderActivity(activity) {
      return preservePortalPosition(() => renderActivityLists(activity))
    }

    function renderActivityLists(activity) {
      const uploads = activity.uploads || [], optimisations = activity.optimisations || []
      const activeUploads = uploads.filter(job => !['error', 'refresh-error'].includes(job.status))
      const activeOptimisations = optimisations.filter(job => ['queued', 'processing'].includes(job.state))
      const uploadsRoot = $('#activityUploadList'), optimisationRoot = $('#activityOptimisationList')
      if (!uploadsRoot || !optimisationRoot) return
      $('#activityUploadCount').textContent = String(activeUploads.length)
      $('#activityOptimisationCount').textContent = String(activeOptimisations.length)
      $('#activitySummary').textContent = activity.active
        ? `${activeUploads.length + activeOptimisations.length} background job${activeUploads.length + activeOptimisations.length === 1 ? '' : 's'} in progress.`
        : 'Nothing is transferring or being prepared right now.'
      const temperature = $('#activityTemperature')
      temperature.classList.toggle('hidden', !activity.temperature_warning)
      temperature.textContent = activity.temperature_warning ? `${Number(activity.temperature_c).toFixed(0)}°C · watching temperature` : ''
      uploadsRoot.innerHTML = uploads.length ? uploads.map(job => activityJobMarkup(job, 'upload')).join('') : '<div class="activity-empty">No uploads or USB transfers are waiting or in progress.</div>'
      optimisationRoot.innerHTML = optimisations.length ? optimisations.map(job => activityJobMarkup(job, 'optimising')).join('') : '<div class="activity-empty">No films are being optimised right now.</div>'
      $$('[data-activity-action]').forEach(button => button.onclick = () => activityAction(button))
    }

    async function activityAction(button) {
      const action = button.dataset.activityAction
      if (action === 'cancel') {
        const message = button.dataset.activityKind === 'optimising'
          ? 'Cancel this optimisation? The unfinished optimised copy will be deleted. Your original film will be kept.'
          : button.dataset.activitySource === 'usb'
            ? 'Cancel this USB transfer? The unfinished copy on the Pi will be deleted. The original on the USB drive will stay untouched.'
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

    const activityTabPositions = new Map()
    $$('[data-activity-tab]').forEach(button => button.onclick = () => {
      const previous = $('[data-activity-tab].active')?.dataset.activityTab
      const position = capturePortalPosition({ anchor: false })
      if (previous) activityTabPositions.set(previous, position)
      const optimisation = button.dataset.activityTab === 'optimising'
      $$('[data-activity-tab]').forEach(item => item.classList.toggle('active', item === button))
      $('#activityUploads').classList.toggle('hidden', optimisation)
      $('#activityOptimising').classList.toggle('hidden', !optimisation)
      restorePortalPosition(activityTabPositions.get(button.dataset.activityTab) || position)
    })

    window.setInterval(() => loadActivity().catch(() => {}), 5000)
