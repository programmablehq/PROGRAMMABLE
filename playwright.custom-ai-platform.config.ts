import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:"./tests/custom-ai-browser",testMatch:"platform-*.spec.ts",timeout:60000,workers:1,use:{headless:true,actionTimeout:10000,launchOptions:process.env.PLAYWRIGHT_CHROME_PATH?{executablePath:process.env.PLAYWRIGHT_CHROME_PATH}:{}}});
