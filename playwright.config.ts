import { defineConfig, devices } from "@playwright/test";

const port = 3_101;
const baseURL =
  process.env["PLAYWRIGHT_BASE_URL"] ?? `http://127.0.0.1:${port}`;
const dataDirectory =
  process.env["VEDA_MAIL_E2E_DATA_DIR"] ??
  `/tmp/veda-mail-playwright-${process.pid}`;

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env["CI"]
    ? [["line"], ["html", { open: "never" }]]
    : "line",
  retries: process.env["CI"] ? 1 : 0,
  testDir: "./tests/e2e",
  timeout: 45_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      VEDA_MAIL_ATTACHMENT_SCANNER: "test-clean",
      VEDA_MAIL_DATA_DIR: dataDirectory,
      VEDA_MAIL_SETUP_TOKEN: "playwright-setup-token-1234567890",
    },
    reuseExistingServer: false,
    stderr: "pipe",
    timeout: 120_000,
    url: `${baseURL}/api/health`,
  },
  workers: 1,
});
