'use strict'

// One resumable original package becomes one continuous recording on the Pi.
// Blob parts keep the original Files in place rather than copying the book into RAM.
const storyAudioCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

async function storyAudioChecksum(file) {
  let crc = 0xffffffff
  for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
    const bytes = new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer())
    for (const byte of bytes) crc = storyAudioCrcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function packageStoryAudio(files, title) {
  if (files.length === 1) return files[0]
  if (files.length > 100) throw new Error('Choose up to 100 chapter files for one story.')
  if (files.some(file => !/\.(mp3|m4a|aac|wav|flac|ogg|aiff?|opus)$/i.test(file.name)))
    throw new Error('Choose audio chapter files for this story.')
  const chapters = files.slice().sort((left, right) => left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' })
    || left.name.localeCompare(right.name, 'en'))
  const encoder = new TextEncoder(), parts = [], directory = []
  let offset = 0, directorySize = 0
  for (const [index, file] of chapters.entries()) {
    const name = encoder.encode(`${String(index + 1).padStart(3, '0')}-${file.name.replace(/[/\\]/g, '_')}`)
    if (file.size > 0xffffffff || name.length > 1024 || offset + 30 + name.length + file.size > 0xffffff00)
      throw new Error('These chapters are too large for one story upload.')
    const crc = await storyAudioChecksum(file)
    const local = new Uint8Array(30), header = new DataView(local.buffer)
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true)
    header.setUint16(6, 0x800, true); header.setUint16(12, 33, true)
    header.setUint32(14, crc, true); header.setUint32(18, file.size, true); header.setUint32(22, file.size, true)
    header.setUint16(26, name.length, true)
    const central = new Uint8Array(46), entry = new DataView(central.buffer)
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x800, true); entry.setUint16(14, 33, true)
    entry.setUint32(16, crc, true); entry.setUint32(20, file.size, true); entry.setUint32(24, file.size, true)
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true)
    parts.push(local, name, file); directory.push(central, name)
    offset += local.length + name.length + file.size; directorySize += central.length + name.length
  }
  if (offset + directorySize + 22 > 0xffffffff) throw new Error('These chapters are too large for one story upload.')
  const end = new Uint8Array(22), footer = new DataView(end.buffer)
  footer.setUint32(0, 0x06054b50, true); footer.setUint16(8, chapters.length, true); footer.setUint16(10, chapters.length, true)
  footer.setUint32(12, directorySize, true); footer.setUint32(16, offset, true)
  const name = (title || 'Story').replace(/[/\\:*?"<>|]/g, '').slice(0, 100).trim() || 'Story'
  return new File([...parts, ...directory, end], `${name}.story.zip`, {
    type: 'application/zip', lastModified: Math.max(...chapters.map(file => file.lastModified || 0)),
  })
}
