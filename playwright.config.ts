import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config. Tests run against the real production build via `vite preview`,
 * so code-splitting and routing rewrites are exercised exactly as deployed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5313',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5313 --strictPort',
    url: 'http://127.0.0.1:5313',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})