'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');

test('prepare locally, send later, recover a lost chunk acknowledgement and retain completed history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-workflow-'));
  const tools = resolveTools(''); const original = path.join(root, 'Studio & sample.mkv');
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-t','2','-c:v','ffv1',original]);
  const originalBytes = fs.readFileSync(original);
  let remoteJob = null;
  const id = 'a'.repeat(32); let offset = 0, total = 0, chunks = 0, statusReads = 0, disconnected = true;
  const server = http.createServer(async (request, response) => {
    const json = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url === '/api/setup') return json({ configured: true, device_name: 'Studio test device', tv_name: 'Mabel TV' });
    if (request.url === '/api/library') return json({ channels: [{ number: 1, name: 'Test channel' }], my_tv_series: [] });
    if (request.url === '/api/studio/desktop') {
      const buffers = []; for await (const buffer of request) buffers.push(buffer);
      const body = JSON.parse(Buffer.concat(buffers)), input = body.inputs[0];
      expect(body.destination.cloudCopies).toBe('optimised');
      remoteJob = { id: 'b'.repeat(32), claim: 'fixture-claim', source: { type: 'import', path: input.path,
        worker: body.worker, bytes: input.bytes, mtime: input.mtime }, title: input.metadata.title,
        destination: { ...body.destination, saveCloud: false, temporaryWork: false, keepOptimised: true } };
      return json({ jobs: [remoteJob] });
    }
    if (request.url === '/api/studio/worker') {
      const buffers = []; for await (const buffer of request) buffers.push(buffer);
      const body = JSON.parse(Buffer.concat(buffers));
      const jobs = remoteJob && !remoteJob.claimed ? [{ ...remoteJob }] : [];
      if (remoteJob) remoteJob.claimed = true;
      return json({ jobs, requests: [], acknowledgedJobs: (body.activeJobs || []).map(value => ({ id: value.id, command: '' })) });
    }
    if (request.url === '/api/studio/backup') return json({ available: false });
    if (request.url === '/api/studio/provenance' || request.url === '/api/studio/backup/profile') return json({ ok: true });
    if (request.url === '/api/studio/action') {
      request.resume(); if (remoteJob) remoteJob.claimed = false; return json({ ok: true });
    }
    if (request.url === '/api/my-tv/uploads') {
      const buffers = []; for await (const buffer of request) buffers.push(buffer);
      const body = JSON.parse(Buffer.concat(buffers)); total = body.size;
      expect(body.file_name).toBe('Studio & sample.mp4'); expect(body.compression).toBeUndefined();
      return json({ id, offset: 0, transfer_state: 'active' });
    }
    if (request.url === '/api/uploads/' + id && request.method === 'PATCH') {
      // Chromium may retry a dropped connection. Simulate the connection
      // remaining down; the server has already retained the original bytes.
      if (disconnected && chunks) { request.resume(); request.socket.destroy(); return; }
      expect(Number(request.headers['upload-offset'])).toBe(offset);
      for await (const buffer of request) offset += buffer.length;
      chunks++; request.socket.destroy(); return; // bytes received, acknowledgement lost
    }
    if (request.url === '/api/uploads/' + id) {
      if (offset === total && total) statusReads++;
      return json({ id, offset, transfer_state: 'active', processing: offset === total && statusReads < 3,
        complete: offset === total && statusReads >= 3, status: offset === total ? statusReads >= 3 ? 'complete' : 'validating' : 'uploading' });
    }
    response.writeHead(404, { 'Content-Type': 'application/json' }); response.end('{"error":"Not found"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new Store(root); store.state.settings.localUrl = 'http://127.0.0.1:' + server.address().port;
  store.state.settings.remoteUrl = ''; store.state.settings.connectionMode = 'local'; store.save();
  const env = { ...process.env, STUDIO_TEST_DATA: root, STUDIO_TEST_COMPANION: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], env }); const page = await app.firstWindow();
    await expect(page.locator('#connection-label')).toContainText('Connected');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, original);
    await page.locator('#dropzone').click();
    await expect(page.locator('.selected-file')).toContainText('Studio & sample.mkv');
    await expect(page.locator('#add-destination [data-field="compression"]')).toHaveValue('compact');
    await expect(page.locator('#add-destination [data-field="compression"] option')).toHaveCount(3);
    await page.locator('#add-destination [data-field="compression"]').selectOption('smallest');
    await expect(page.locator('#add-destination .compression-estimate')).toContainText(
      (originalBytes.length*.25*.98/1e9).toFixed(2) + ' GB');
    await page.locator('#add-destination [data-field="mode"]').selectOption('local');
    await page.locator('#add-destination .submit-destination').click();
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.locator('#completed-list .job-status')).toContainText('Ready locally', { timeout: 30000 });
    expect(fs.readFileSync(original)).toEqual(originalBytes);
    await page.locator('#completed-list [data-job-action="send"]').click();
    await page.locator('#send-destination [data-target="mytv"]').click();
    await page.locator('#send-destination [data-field="compression"]').selectOption('smallest');
    await page.locator('#send-destination .submit-destination').click();
    await page.locator('#title-review .review-skip').click();
    await expect(page.locator('#queue-list .job-status')).toContainText('Waiting for connection', { timeout: 15000 });
    disconnected = false;
    await page.locator('#queue-list [data-job-action="resume"]').click();
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.locator('#completed-list .job-status').filter({ hasText: /^Complete$/ })).toHaveCount(1, { timeout: 20000 });
    expect(chunks).toBe(1); expect(offset).toBe(total); expect(statusReads).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: 'test-results/completed.png' });
    await app.close(); app = await electron.launch({ args: [path.resolve(__dirname, '..')], env });
    const reopened = await app.firstWindow();
    await reopened.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(reopened.locator('#completed-list .job-status').filter({ hasText: /^Complete$/ })).toHaveCount(1);
    expect(fs.readFileSync(original)).toEqual(originalBytes);
  } finally {
    if (app) await app.close(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
