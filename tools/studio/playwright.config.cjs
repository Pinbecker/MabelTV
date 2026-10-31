const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './tests', testMatch: '*.spec.cjs', timeout: 90000,
  workers: 1, reporter: 'list', outputDir: 'test-results', use: { trace: 'retain-on-failure' } });
