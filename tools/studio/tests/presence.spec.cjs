'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store.cjs');

test('rich search badges follow current TV files, removal and loss of connection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-presence-'));
  let present = true, online = true;
  const metadata = ['b09g3jlh', 'b09g45l6', 'b09g59w6', 'b09g63qk'].map((pid, index) => ({ pid,
    title: 'Yakka Dee!: Series 1', episode: ['01. Banana', '02. Dog', '03. Book', '04. Boots'][index],
    series: 1, episodeNumber: index + 1, channel: 'CBeebies', duration: 300, synopsis: 'A word adventure.' }));
  const inventory = metadata.map(item => ({ ...item, file: item.episode + '.mp4',
    location: { kind: 'mabel', channel: 12, label: 'Mabel TV · Yakka Dee' } }));
  const server = http.createServer((request, response) => {
    const json = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url === '/api/setup') return json({ configured: true, device_name: 'test-pi', tv_name: 'Mabel TV' });
    if (request.url === '/api/library') return json({ channels: [{ number: 12, name: 'Yakka Dee' }], my_tv_series: [] });
    if (request.url === '/api/iplayer/library') {
      if (!online) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":"Offline"}'); return; }
      return json({ device: 'test-pi', checkedAt: Date.now() / 1000, items: present ? inventory : [] });
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new Store(root); store.state.settings.localUrl = 'http://127.0.0.1:' + server.address().port;
  store.state.settings.connectionMode = 'local'; store.save();
  const env = { ...process.env, STUDIO_TEST_DATA: root }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], env }); const page = await app.firstWindow();
    await expect(page.locator('#connection-label')).toContainText('Connected');
    await app.evaluate(({ ipcMain }, items) => {
      ipcMain.removeHandler('studio:search');
      ipcMain.handle('studio:search', () => ({ items, truncated: false }));
    }, metadata);
    await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click();
    await page.locator('#search-input').fill('Yakka Dee'); await page.locator('#search-button').click();
    await expect(page.locator('.presence-badge.present')).toHaveCount(4);
    await expect(page.locator('.presence-location').first()).toContainText('Yakka Dee');
    await page.screenshot({ path: 'test-results/presence.png' });
    present = false; await page.locator('#check-library').click();
    await expect(page.locator('.presence-badge.present')).toHaveCount(0);
    await expect(page.locator('.presence-badge').first()).toHaveText('Not on MabelTV');
    online = false; await page.locator('#check-library').click();
    await expect(page.locator('#library-check-status')).toContainText('Presence is unknown');
    await expect(page.locator('.presence-badge').first()).toHaveText('TV presence not checked');
    expect(await page.evaluate(() => document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth)).toBe(true);
  } finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
