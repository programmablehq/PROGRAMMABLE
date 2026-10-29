import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["evm-custom-swap.spec.ts","module-signing.spec.ts", "wallet-request-lock.spec.ts", "site-header.spec.ts", "wallet-session.spec.ts", "module-mode-operation.spec.ts", "module-engine-host.spec.ts", "module-engine-fee-controls.spec.ts", "module-engine-discovery.spec.ts", "module-author-profile.spec.ts", "module-native-author-wallet.spec.ts", "disclosure-motion.spec.ts", "trade-panel.spec.ts", "foundation-swap-recovery.spec.ts", "module-launch-selection.spec.ts", "explore-visibility.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    browserName: process.env.PROGRAMMABLE_TEST_BROWSER === "webkit" ? "webkit" : "chromium",
    channel: process.env.CI || process.env.PROGRAMMABLE_TEST_BROWSER === "webkit" ? undefined : "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
});
