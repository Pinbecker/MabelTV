import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  outputDir: 'test-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4178',
    colorScheme: 'dark',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python fixture_server.py --port 4178',
    url: 'http://127.0.0.1:4178/api/setup',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'iphone-webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 393, height: 852 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'ipad-webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'iphone-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 393, height: 852 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
})
