import { defineConfig } from '@playwright/test';
const PORT = 5188;
const BAD_PORT = 5189;
const common = { browserName: 'chromium' as const };
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    { name: 'desktop', use: { ...common, viewport: { width: 1280, height: 800 } } },
    { name: 'iphone-390', use: { ...common, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  ],
  webServer: [
    { command: `PORT=${PORT} ONTOLOGY_CACHE_DIR=.cache/e2e node scripts/start.mjs --no-build`, url: `http://127.0.0.1:${PORT}/api/health`, timeout: 120000, reuseExistingServer: false },
    { command: `ARTICLES_PATH=fixtures/articles.empty.json PORT=5190 ONTOLOGY_CACHE_DIR=.cache/e2e-empty node scripts/start.mjs --no-build`, url: `http://127.0.0.1:5190/api/health`, timeout: 120000, reuseExistingServer: false },
    { command: `ARTICLES_PATH=fixtures/no-such-file.json PORT=${BAD_PORT} ONTOLOGY_CACHE_DIR=.cache/e2e-bad node scripts/start.mjs --no-build`, url: `http://127.0.0.1:${BAD_PORT}/`, timeout: 120000, reuseExistingServer: false },
  ],
});
