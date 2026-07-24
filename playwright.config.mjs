import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
      },
    },
  ],
  reporter: process.env.CI ? "github" : "line",
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure",
  },
  workers: 1,
});
