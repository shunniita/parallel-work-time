import { defineConfig } from 'vitest/config';

// E2E（Playwright）は tests/e2e/ で扱うため、Vitest の対象から外す。
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    // 既定は node。domain / storage / app 層は DOM に触らない（過去の実装計画）ので、
    // わざわざ DOM 実装を噛ませない。
    //
    // DOM が要るのは UI 層の試験だけである。対象ファイルの先頭へ
    // `// @vitest-environment happy-dom` を書いて個別に切り替える（`tests/unit/ui/`）。
    // 設定側のglob指定（`environmentMatchGlobs`）は Vitest 4 で廃止された。
    //
    // DOM 実装は happy-dom を使う。本アプリが触るのは要素生成・属性・イベント・
    // `textContent` だけで（`innerHTML` を使わない）、CSS カスケードや
    // レイアウトの再現は要らない。その範囲なら jsdom より軽く、起動も速い。
    environment: 'node',
    coverage: {
      provider: 'v8',
      // 出力先は `.gitignore` 済みの生成物置き場へ寄せる。
      reportsDirectory: 'test-results/coverage',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      // 全項目100%のファイルも表から省かない。省くと「一覧に出ない」が
      // 「完全に覆えている」と「そもそも計測できていない」のどちらなのか
      // 読み取れない。
      skipFull: false,
      // `main.js` は結線だけで、実行には実ブラウザと IndexedDB が要る。到達性は
      // E2E が受け持つため、カバレッジの分母から外す。
      exclude: ['src/main.js'],
    },
  },
});
