'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');

test('film review can cancel, correct and confirm; metadata retry survives restart without sending the video twice', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-title-ui-'));
  const file = path.join(root, 'Shrek (2001).mp4');
  await run(resolveTools('').ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=size=320x180:rate=25','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',file]);
  let creates = 0, chunks = 0, bytes = 0, total = 0, applies = 0, uploadsConfirmed = false;
  const id = 'a'.repeat(32), queries = [];
  const server = http.createServer(async (request, response) => {
    const json = (value, code = 200) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    const body = async () => { const buffers = []; for await (const buffer of request) buffers.push(buffer); return JSON.parse(Buffer.concat(buffers)); };
    if (request.url === '/api/setup') return json({ configured: true, device_name: 'Test Pi', tv_name: 'Mabel TV' });
    if (request.url === '/api/library') return json({ channels: [], my_tv_series: [] });
    if (request.url.startsWith('/api/my-tv/discovery')) {
      const q = new URL(request.url, 'http://test').searchParams.get('q'); queries.push(q);
      return json({ results: q === 'Wrong title' ? [] : [
        { media_type: 'movie', tmdb_id: 0, title: 'Shrek' },
        { media_type: 'tv', tmdb_id: 999, title: 'Shrek', year: '2001' },
        { media_type: 'movie', tmdb_id: 808, title: 'Shrek', year: '2001', overview: 'An ogre sets off to rescue a princess.' },
        { media_type: 'movie', tmdb_id: 100, title: 'Shrek the Musical', year: '2013', overview: 'A stage performance.' }
      ] });
    }
    if (request.url === '/api/my-tv/uploads') {
      creates++; expect(uploadsConfirmed).toBe(true); const input = await body(); total = input.size;
      return json({ id, offset: 0, transfer_state: 'active' });
    }
    if (request.url === '/api/uploads/' + id && request.method === 'PATCH') {
      chunks++; for await (const buffer of request) bytes += buffer.length; return json({ offset: bytes, complete: bytes === total });
    }
    if (request.url === '/api/uploads/' + id) return json({ id, offset: bytes, status: bytes === total && total ? 'complete' : 'uploading', complete: bytes === total && !!total, file_name: 'Actual Shrek.mp4' });
    if (request.url === '/api/tmdb/apply') {
      applies++; expect(await body()).toEqual({ file: 'Actual Shrek.mp4', tmdb_id: 808 });
      return applies === 1 ? json({ error: 'Metadata service temporarily unavailable' }, 503) : json({ ok: true, metadata: { tmdb_id: 808 } });
    }
    return json({ error: 'Not found' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new Store(root); store.state.settings.localUrl = 'http://127.0.0.1:' + server.address().port;
  store.state.settings.connectionMode = 'local'; store.state.settings.remoteUrl = ''; store.save();
  const env = { ...process.env, STUDIO_TEST_DATA: root }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], env }); const page = await app.firstWindow();
    await expect(page.locator('#connection-label')).toContainText('Connected');
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
    await page.locator('#dropzone').click(); await page.locator('#add-destination [data-target="mytv"]').click();
    await page.locator('#add-destination .submit-destination').click();
    await expect(page.locator('.review-result')).toHaveCount(1);
    await expect(page.locator('.review-confirm')).toBeDisabled();
    await page.locator('.review-close').click();
    expect((await page.evaluate(() => window.studio.snapshot())).jobs).toHaveLength(0);
    expect(creates).toBe(0); await expect(page.locator('.selected-file')).toHaveCount(1);
    await page.locator('#add-destination .submit-destination').click();
    await page.locator('.review-query').fill('Wrong title');
    await page.getByRole('button', { name: 'Find matches', exact: true }).click();
    await expect(page.locator('.review-status')).toContainText('No matches found');
    await page.locator('.review-query').fill('Shrek'); await page.locator('.review-year').fill('');
    await page.getByRole('button', { name: 'Find matches', exact: true }).click();
    await expect(page.locator('.review-result')).toHaveCount(2);
    await page.locator('.review-result').first().click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 720));
    const footerInView = await page.locator('.review-confirm').evaluate(node => {
      const bounds = node.getBoundingClientRect(), dialog = node.closest('dialog').getBoundingClientRect();
      return bounds.bottom <= dialog.bottom && bounds.bottom <= innerHeight;
    });
    expect(footerInView).toBe(true);
    await page.screenshot({ path: 'test-results/title-review-compact.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
    await page.screenshot({ path: 'test-results/title-review.png' });
    uploadsConfirmed = true; await page.getByRole('button', { name: 'Confirm Shrek', exact: true }).click();
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.locator('#completed-list .job-metadata-warning')).toContainText('temporarily unavailable', { timeout: 20000 });
    await expect(page.locator('#completed-list .job-status')).toHaveText('Added to library');
    await page.screenshot({ path: 'test-results/title-metadata-retry.png' });
    await app.close(); fs.unlinkSync(file);
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], env }); const reopened = await app.firstWindow();
    await reopened.getByRole('button', { name: 'Completed', exact: true }).click();
    await reopened.getByRole('button', { name: 'Retry metadata', exact: true }).click();
    await expect(reopened.locator('#completed-list .job-match')).toHaveText('Matched: Shrek · 2001');
    await expect(reopened.locator('#completed-list .job-metadata-warning')).toHaveCount(0);
    expect(creates).toBe(1); expect(chunks).toBe(1); expect(bytes).toBe(total); expect(applies).toBe(2);
    expect(queries).toContain('Wrong title');
  } finally {
    if (app) await app.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('iPlayer show selection gets one show review; skipping and unavailable metadata remain usable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-show-ui-'));
  const store = new Store(root); store.state.settings.localUrl = 'http://127.0.0.1:1'; store.state.settings.remoteUrl = ''; store.save();
  const env = { ...process.env, STUDIO_TEST_DATA: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve(__dirname, '..')], env });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.refreshStudio === 'function');
    await app.evaluate(({ ipcMain }) => {
      for (const name of ['search', 'connect', 'snapshot', 'libraryPresence', 'searchTitles', 'add']) ipcMain.removeHandler('studio:' + name);
      const items = [1, 2].map(n => ({ pid: 'm000000' + n, title: 'Ludwig', episode: 'Episode ' + n, series: 1, episodeNumber: n, synopsis: 'A BBC episode.' }));
      const catalogue = { channels: [], series: [{ id: 'b'.repeat(32), title: 'Ludwig', seasons: [1] }] };
      ipcMain.handle('studio:search', () => ({ items }));
      ipcMain.handle('studio:libraryPresence', () => ({ checkedAt: Date.now() / 1000, items: items.map(item => ({ pid: item.pid, locations: [] })) }));
      ipcMain.handle('studio:connect', () => ({ connected: true, name: 'Test Pi', mode: 'local', catalogue }));
      ipcMain.handle('studio:snapshot', () => ({ jobs: [], settings: {}, tools: {}, catalogue, connection: { connected: true } }));
      ipcMain.handle('studio:searchTitles', (_event, _query, type) => {
        if (type !== 'tv') throw new Error('Must search for a show');
        return { device: 'test', results: [{ media_type: 'tv', tmdb_id: 222, title: 'Ludwig', year: '2024', overview: 'A puzzle maker solves crimes.' }] };
      });
      global.reviewedBatch = null;
      ipcMain.handle('studio:add', (_event, inputs, destination) => { global.reviewedBatch = { inputs, destination }; return inputs; });
    });
    await page.evaluate(() => window.refreshStudio());
    await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click();
    await page.locator('#search-input').fill('Ludwig'); await page.locator('#search-button').click();
    await expect(page.locator('.episode-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await page.locator('#iplayer-destination [data-target="mytv"]').click();
    await page.locator('#iplayer-destination [data-field="type"]').selectOption('series');
    await page.locator('#iplayer-destination .submit-destination').click();
    await expect(page.locator('.review-source')).toContainText('2 episodes');
    await page.locator('.review-result').click(); await page.getByRole('button', { name: 'Confirm Ludwig', exact: true }).click();
    await expect(page.locator('#title-review')).not.toBeVisible();
    const batch = await app.evaluate(() => global.reviewedBatch);
    expect(batch.inputs).toHaveLength(2); expect(batch.inputs[0].match).toEqual(batch.inputs[1].match);
    expect(batch.inputs[0].match.media_type).toBe('tv'); expect(batch.destination.season).toBe(1);
    await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click();
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('studio:searchTitles'); ipcMain.handle('studio:searchTitles', () => { throw new Error('Sign in to your portal'); }); });
    await page.locator('#iplayer-destination .submit-destination').click();
    await expect(page.locator('.review-status')).toContainText('Sign in to your portal');
    await page.locator('.review-skip').click();
    const skipped = await app.evaluate(() => global.reviewedBatch);
    expect(skipped.inputs.every(input => input.match === null)).toBe(true);
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
