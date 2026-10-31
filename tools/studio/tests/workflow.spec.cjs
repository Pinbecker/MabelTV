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
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-t','2','-c:v','mpeg4',original]);
  const originalBytes = fs.readFileSync(original);
  const id = 'a'.repeat(32); let offset = 0, total = 0, chunks = 0, statusReads = 0, disconnected = true;
  const server = http.createServer(async (request, response) => {
    const json = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url === '/api/setup') return json({ configured: true, device_name: 'Studio test device', tv_name: 'Mabel TV' });
    if (request.url === '/api/library') return json({ channels: [{ number: 1, name: 'Test channel' }], my_tv_series: [] });
    if (request.url === '/api/my-tv/uploads') {
      const buffers = []; for await (const buffer of request) buffers.push(buffer);
      const body = JSON.parse(Buffer.concat(buffers)); total = body.size;
      expect(body.file_name).toBe('Studio & sample.mp4'); return json({ id, offset: 0, transfer_state: 'active' });
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
  const env = { ...process.env, STUDIO_TEST_DATA: root }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], env }); const page = await app.firstWindow();
    await expect(page.locator('#connection-label')).toContainText('Connected');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, original);
    await page.locator('#dropzone').click();
    await expect(page.locator('.selected-file')).toContainText('Studio & sample.mkv');
    await page.locator('#add-destination [data-field="mode"]').selectOption('local');
    await page.locator('#add-destination .submit-destination').click();
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.locator('#completed-list .job-status')).toContainText('Ready locally', { timeout: 30000 });
    expect(fs.readFileSync(original)).toEqual(originalBytes);
    await page.locator('#completed-list [data-job-action="send"]').click();
    await page.locator('#send-destination [data-target="mytv"]').click();
    await page.locator('#send-destination .submit-destination').click();
    await page.locator('#title-review .review-skip').click();
    await expect(page.locator('#queue-list .job-status')).toContainText('Waiting for connection', { timeout: 15000 });
    disconnected = false;
    await page.locator('#queue-list [data-job-action="resume"]').click();
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.locator('#completed-list .job-status')).toContainText('Added to library', { timeout: 20000 });
    expect(chunks).toBe(1); expect(offset).toBe(total); expect(statusReads).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: 'test-results/completed.png' });
    await app.close(); app = await electron.launch({ args: [path.resolve(__dirname, '..')], env });
    const reopened = await app.firstWindow();
    await reopened.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(reopened.locator('#completed-list .job-status')).toContainText('Added to library');
    expect(fs.readFileSync(original)).toEqual(originalBytes);
  } finally {
    if (app) await app.close(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
