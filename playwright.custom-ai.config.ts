import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/custom-ai-browser", timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3100", headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {} },
  webServer: { command: "CUSTOM_AI_LOCAL_PREVIEW=true node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/launch/custom-ai", reuseExistingServer: !process.env.CI, timeout: 120000 },
});
