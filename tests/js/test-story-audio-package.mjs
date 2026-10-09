import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import test from 'node:test'

const owner = new URL('../../scripts/pi/portal/js/family/story-audio.js', import.meta.url)
const context = vm.createContext({ Blob, File, TextEncoder, DataView, Uint8Array, Uint32Array })
vm.runInContext(readFileSync(owner, 'utf8'), context)

test('chapter checksum matches ZIP CRC32 and single recordings are unchanged', async () => {
  const file = new File(['123456789'], 'Chapter 1.mp3', { lastModified: 12345 })
  assert.equal(await context.storyAudioChecksum(file), 0xcbf43926)
  assert.equal(await context.packageStoryAudio([file], 'Zog'), file)
})

test('chapter package is byte-exact, naturally ordered and deterministic for upload resume', async () => {
  const files = [10, 2, 1].map(index => new File([`Chapter ${index}`], `Zog - ${index} - Chapter ${index}.mp3`, { lastModified: index }))
  const file = await context.packageStoryAudio(files, 'Zog')
  const same = await context.packageStoryAudio([...files].reverse(), 'Zog')
  assert.equal(file.name, 'Zog.story.zip'); assert.equal(file.lastModified, 10)
  const bytes = Buffer.from(await file.arrayBuffer())
  assert.deepEqual(Buffer.from(await same.arrayBuffer()), bytes)
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const contents = JSON.parse(execFileSync(python, ['-c',
    'import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps([(n,z.read(n).decode()) for n in z.namelist()]))'], { input: bytes }))
  assert.deepEqual(contents, [
    ['001-Zog - 1 - Chapter 1.mp3', 'Chapter 1'],
    ['002-Zog - 2 - Chapter 2.mp3', 'Chapter 2'],
    ['003-Zog - 10 - Chapter 10.mp3', 'Chapter 10'],
  ])
})
