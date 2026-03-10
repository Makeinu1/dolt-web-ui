import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-real",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : [["html", { outputFolder: ".tmp/playwright-report-real", open: "never" }]],
  outputDir: ".tmp/test-results-real",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "../scripts/testenv/run-backend.sh",
      url: "http://127.0.0.1:18080/api/v1/targets",
      reuseExistingServer: false,
      timeout: 180 * 1000,
    },
    {
      command: "VITE_API_PROXY_TARGET=http://127.0.0.1:18080 npm run dev -- --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
  ],
});
