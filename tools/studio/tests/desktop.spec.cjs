'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('desktop navigation, rich search, settings and keyboard layout work in the sandboxed app', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-desktop-'));
  const env = { ...process.env, STUDIO_TEST_DATA: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve(__dirname, '..')], env });
  try {
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Make room for your next watch.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose video files' })).toBeVisible();
    await expect(page.locator('#dropzone')).toBeVisible();
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    expect(await page.evaluate(() => typeof window.studio.snapshot)).toBe('function');
    await expect(page.locator('#connection-label')).toContainText('Connected', { timeout: 20000 });
    await page.screenshot({ path: 'test-results/add-media.png' });
    await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A world of BBC favourites.' })).toBeVisible();
    await page.locator('#search-input').fill('Ludwig');
    await page.locator('#search-button').click();
    await expect(page.locator('#search-summary')).toContainText(/episodes? found/, { timeout: 60000 });
    const cards = page.locator('.episode-card');
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first().locator('.episode-copy p')).not.toBeEmpty();
    await expect.poll(() => cards.first().locator('img').evaluate(image => image.naturalWidth), { timeout: 20000 }).toBeGreaterThan(0);
    await cards.first().locator('input').check();
    await expect(page.locator('#iplayer-destination .submit-destination')).toContainText('1');
    await page.screenshot({ path: 'test-results/iplayer.png' });
    await page.getByRole('button', { name: 'Queue', exact: false }).first().click();
    await expect(page.getByRole('heading', { name: 'Everything is caught up.' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('#remote-url')).toHaveValue('https://mabeltv.dancoakes.uk');
    await page.screenshot({ path: 'test-results/settings.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 720));
    await page.getByRole('button', { name: 'Add media', exact: true }).click();
    expect(await page.evaluate(() => document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/compact.png' });
    expect(errors).toEqual([]);
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
