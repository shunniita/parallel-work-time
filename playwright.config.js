/**
 * E2E（受入試験 T-01〜T-18）の設定。
 *
 * 仕様書5.1.3 に従い HTTP で静的配信して試験する。`file://` は使わない。
 *
 * 常用の回帰試験は Chromium 1種で走らせる（実装計画8.3）。Chrome と Edge は
 * Chromium を共有するため、これで対応表明の2つを覆える。Firefox は別実装なので
 * 定義だけ用意し、対応表明の裏づけを取るときに `--project=firefox` で明示的に
 * 走らせる。毎回2種を回すほど描画依存の実装ではない。
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
    // 対応業務は日本時間を前提とする。runner のローカルタイムゾーンへ委ねると、
    // 固定時計の現在時刻と datetime-local の壁時計入力がCI（UTC）で9時間ずれる。
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: `node tools/static-server.mjs --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
