import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: { command: 'npm run start:web -- --port 3100', url: 'http://127.0.0.1:3100', reuseExistingServer: false, timeout: 120000, env: { REPOCARE_DB_PATH: 'test-results/e2e.sqlite', REPOCARE_REQUIRE_LOGIN: 'false' } },
});
