import { defineConfig, devices } from "@playwright/test";

const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../infra/.artifacts/playwright",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  globalTimeout: 600_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: external || "http://127.0.0.1:3100",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : {
        command: "pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3100",
        url: "http://127.0.0.1:3100",
        env: { NEXT_PUBLIC_API_URL: "", NEXT_PUBLIC_IDENTITY_URL: "" },
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
