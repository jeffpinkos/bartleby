import { loadEnvFile } from 'node:process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. See .env.example.');

export default defineConfig({
  testDir: './e2e',
  outputDir: join(tmpdir(), 'bartleby-playwright'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3101',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm start',
    env: { PORT: '3101' },
    url: 'http://127.0.0.1:3101/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
