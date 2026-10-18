import { defineConfig, devices } from "@playwright/test";

// Tests reset a little database state directly, so they read the same root .env as the app.
try {
  process.loadEnvFile("../../.env");
} catch {
  // CI passes DATABASE_URL in the environment.
}

const PORT = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  // One worker: tests share one database and some change roles.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Lets environments with a preinstalled Chromium skip `playwright install`.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    // The dev server, because the demo-user sign-in is switched off in production builds.
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/signin`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { AUTH_DEV_LOGIN: "true", AUTH_URL: `http://localhost:${PORT}` },
  },
});
