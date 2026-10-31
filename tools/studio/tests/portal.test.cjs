'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Portal, endpoint } = require('../lib/portal.cjs');
test('public HTTP and embedded credentials are rejected; LAN and HTTPS are allowed', () => {
  assert.equal(endpoint('http://mabeltv-512.local:8080/'), 'http://mabeltv-512.local:8080');
  assert.equal(endpoint('https://mabeltv.dancoakes.uk'), 'https://mabeltv.dancoakes.uk');
  assert.throws(() => endpoint('http://public.example'), /HTTPS/);
  assert.throws(() => endpoint('https://user:password@example.com'), /passwords/);
  assert.throws(() => endpoint('https://example.com/settings'), /page path/);
});
test('access gateway redirects are reported as sign-in and never followed with upload bytes', async () => {
  let options;
  const portal = new Portal({}, async (_url, input) => { options = input; return new Response('', { status: 302, headers: { Location: 'https://identity.example' } }); });
  await assert.rejects(portal.at('https://example.com', '/api/uploads/id', { method: 'PATCH', body: Buffer.from('media'), offset: 0 }), error => error.code === 'AUTH');
  assert.equal(options.redirect, 'manual');
});
test('resumed uploads read the server offset and wait for publication after PATCH complete', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-upload-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'file.mp4'); fs.writeFileSync(file, 'abcdefgh');
  const calls = []; let reads = 0;
  const portal = new Portal({ state: { settings: {} } }); portal.current = { device: 'pi', mode: 'local', base: 'http://pi.local' };
  portal.at = async (base, route, options = {}) => {
    assert.equal(base, 'http://pi.local');
    calls.push({ route, ...options });
    if (options.method === 'PATCH') { portal.current = { device: 'other', base: 'https://other.example' }; return { offset: 8, complete: true }; }
    reads++;
    return reads === 1 ? { offset: 3, status: 'uploading', transfer_state: 'active' } : reads === 2 ? { offset: 8, status: 'validating', processing: true } : { offset: 8, status: 'complete', complete: true };
  };
  const job = { preparedPath: file, uploadId: 'id', destination: { kind: 'film' } };
  const result = await portal.upload(job, 'source', new AbortController().signal, fields => Object.assign(job, fields));
  const patch = calls.find(call => call.method === 'PATCH'); assert.equal(patch.offset, 3); assert.equal(patch.body.toString(), 'defgh');
  assert.equal(result.status, 'complete'); assert.equal(reads, 3);
});
test('pending jobs cannot be redirected to another Pi', async () => {
  const portal = new Portal({}); portal.current = { device: 'other-pi' };
  await assert.rejects(portal.upload({ device: 'original-pi' }, '', new AbortController().signal, () => {}), /different MabelTV device/);
});
