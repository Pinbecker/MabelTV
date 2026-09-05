import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const excludedDirectories = new Set(['node_modules', 'test-results', 'playwright-report'])

function collectScripts(root) {
  const scripts = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) scripts.push(...collectScripts(fullPath))
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) scripts.push(fullPath)
  }
  return scripts
}

test('every first-party JavaScript entry point parses', () => {
  const roots = [
    'scripts/pi/portal/js',
    'integrations/matter',
    'tests/js',
    'tests/browser',
  ].map(relative => path.join(projectRoot, relative))
  const individualScripts = [
    'scripts/pi/mabeltv-offline.js',
    'scripts/pi/service-worker.js',
  ].map(relative => path.join(projectRoot, relative))
  const scripts = [...new Set([
    ...individualScripts,
    ...roots.flatMap(collectScripts),
  ])].sort()

  assert.ok(scripts.length >= 30, 'The syntax gate discovered too few scripts')
  const failures = []
  for (const script of scripts) {
    const result = spawnSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.status !== 0) {
      failures.push(`${path.relative(projectRoot, script)}\n${result.stderr || result.stdout}`)
    }
  }
  assert.deepEqual(failures, [], failures.join('\n\n'))
})
