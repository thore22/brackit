import { defineConfig } from '@playwright/test'

const remote = process.env.TEST_BASE_URL
const port = process.env.TEST_PORT ?? '4173'
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: true,
  retries: 0,
  workers: 2,
  use: {
    baseURL: remote ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: remote ? undefined : {
    command: `pnpm preview --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 45_000,
  },
})
