'use strict'

async function studioLoadVersions(draft) {
  const revision = draft.presenceRevision = (draft.presenceRevision || 0) + 1
  const form = $('#studioDestinationForm')
  let root = $('#studioVersions')
  if (!root) { root = document.createElement('div'); root.id = 'studioVersions'; form.prepend(root) }
  root.replaceChildren(); draft.presenceReady = false
  if (!draft.cloudContext || draft.originalInfo) { draft.presenceReady = true; return }
  const loading = document.createElement('p'); loading.textContent = 'Checking copies on your Pi…'; root.append(loading)
  try {
    const sources = draft.sources
    const result = await api('/api/studio/presence', { method: 'POST', body: JSON.stringify({ ids: sources.map(source => source.id) }) })
    if (studioDraft !== draft || draft.presenceRevision !== revision) return
    root.replaceChildren()
    for (const source of sources) {
      const group = (draft.cloudContext.groups || draft.cloudContext.titles).find(title => (title.versions || [title]).some(file => file.id === source.id))
      const versions = group?.versions || []
      if (versions.length > 1) {
        const label = document.createElement('label'); label.className = 'studio-version-field'
        label.textContent = 'iCloud version'
        const select = document.createElement('select'); select.setAttribute('aria-label', 'iCloud version')
        for (const file of versions) select.add(new Option(`${studioBytes(file.bytes)} · ${file.name || file.path?.split('/').pop()}`, file.id))
        select.value = source.id
        select.onchange = () => {
          const file = versions.find(file => file.id === select.value)
          Object.assign(source, { id: file.id, bytes: file.bytes, modified: file.modified || '', remoteId: file.remoteId || '' })
          delete source.existingCopy
          void studioLoadVersions(draft)
        }
        label.append(select); root.append(label)
      }
      const copies = result.items.find(item => item.id === source.id)?.copies || []
      delete source.existingCopy
      if (!copies.length) continue
      const section = document.createElement('div'); section.className = 'studio-version-field'
      const title = document.createElement('strong'); title.textContent = 'Already on your Pi'; section.append(title)
      const summary = document.createElement('p'); summary.className = 'studio-existing-summary'; section.append(summary)
      const copy = document.createElement('select'); copy.setAttribute('aria-label', 'Existing TV copy')
      for (const item of copies) copy.add(new Option(`${item.location} · ${studioBytes(item.bytes)} · ${item.name}`, item.key))
      copy.hidden = copies.length === 1
      const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Existing TV copy action')
      for (const [value, label] of [['keep', 'Keep existing — no transfer'], ['replace', 'Replace this copy'], ['alongside', 'Keep both copies']]) mode.add(new Option(label, value))
      const sync = () => { const item = copies.find(item => item.key === copy.value); source.existingCopy = { key: item.key, fingerprint: item.fingerprint, mode: mode.value }; summary.textContent = `${item.location} · ${studioBytes(item.bytes)}\n${item.name}` }
      copy.onchange = sync; mode.onchange = sync; sync()
      section.append(copy, mode); root.append(section)
    }
    draft.presenceReady = true
  } catch (error) {
    if (studioDraft !== draft || draft.presenceRevision !== revision) return
    root.replaceChildren()
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'watch-film-play'; retry.textContent = 'Could not check Pi copies — retry'
    retry.onclick = () => void studioLoadVersions(draft); root.append(retry)
  }
}
