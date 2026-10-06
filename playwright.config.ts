import { defineConfig } from '@playwright/test';
const hostedURL = process.env.TRADEBRIDGE_E2E_URL;
const localURL = `http://127.0.0.1:${process.env.TRADEBRIDGE_WEB_PORT ?? 5173}`;
export default defineConfig({
  testDir: 'e2e', testMatch: hostedURL ? 'hosted.spec.ts' : 'workspace.spec.ts', fullyParallel: false, workers: 1, timeout: 30_000,
  use: { baseURL: hostedURL ?? localURL, browserName: 'chromium', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  // The sample flow runs with optional integrations off, whatever the local .env configures.
  webServer: hostedURL ? undefined : { command: 'npm run dev', url: localURL, reuseExistingServer: !process.env.CI, timeout: 30_000, env: { WORLD_APP_ID: '', TRADEBRIDGE_DEMO_APPROVERS: '', OPENAI_API_KEY: '', WORLD_IDP_CLIENT_ID: '', SUI_PACKAGE_ID: '' } },
});
