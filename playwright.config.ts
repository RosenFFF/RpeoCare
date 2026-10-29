import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  // CI logs need a GitHub login; annotations show failures on the public run page
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined },
  webServer: { command: 'npm run start:web -- --port 3100', url: 'http://127.0.0.1:3100', reuseExistingServer: false, timeout: 120000, env: { REPOCARE_DB_PATH: 'test-results/e2e.sqlite', REPOCARE_REQUIRE_LOGIN: 'false' } },
});
