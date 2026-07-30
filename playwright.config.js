/**
 * E2E（受入試験 T-01〜T-18）の設定。
 *
 * 仕様書5.1.3 に従い HTTP で静的配信して試験する。`file://` は使わない。
 * 対象ブラウザは Chromium 1種に絞る（実装計画8.3）。
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  // 単一利用者・単一ブラウザプロファイルを前提とするツールであり（仕様書3.1）、
  // 各試験が IndexedDB を初期化して始めるため、並列実行はしない。
  workers: 1,
  fullyParallel: false,
  // 落ちた試験を通ったことにしないため、CI では .only を禁止する。
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node tools/static-server.mjs --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
