/**
 * 配布物の確認（仕様書14章、5.1.3、5.1.5、実装計画8.2「手動確認」の自動化）。
 *
 * `npm run dist` が組み立てたディレクトリを別ポートで配信し、起動・保存・
 * エクスポートまでを通す。開発時ツールを取り除いた状態でも動くことを見る。
 *
 * ZIP そのものの展開は確かめない。`build-dist.mjs` は写したディレクトリを
 * そのまま固めるだけであり、展開結果はこのディレクトリと同一である。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { createStaticServer } from '../../tools/static-server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STAGE_DIR = join(ROOT, 'dist', 'parallel-work-time');

/** 開発時ツールは配布物へ含めない（仕様書5.1.4）。 */
const EXCLUDED = ['tools', 'tests', 'docs', 'node_modules', 'package.json', 'playwright.config.js'];

let server;
let origin;

test.beforeAll(async () => {
  // 実行順に依存しないよう、この試験の中で組み立て直す。
  const built = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-dist.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  expect(built.status, built.stderr).toBe(0);

  server = createStaticServer(STAGE_DIR);
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose) => server.close(resolveClose));
});

test('配布物だけで起動・保存・エクスポートができる（仕様書14章）', async ({ page }) => {
  for (const entry of EXCLUDED) {
    expect(existsSync(join(STAGE_DIR, entry)), `${entry} は配布物へ含めない`).toBe(false);
  }

  await page.goto(`${origin}/`);
  await expect(page.getByTestId('status-bar')).toBeVisible();

  // サンプルテンプレートが読める（data/ が同梱されている）。
  await expect(page.getByTestId('template-row').first()).toBeVisible();
  await expect(page.getByTestId('warning-notice')).toHaveCount(0);

  // 保存できる。
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-id').fill('PJ-DIST');
  await page.getByTestId('target-type').fill('対象種別A');
  await page.getByTestId('variant').fill('標準');
  await page.getByTestId('total-quantity').fill('100');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('save-status')).toContainText('保存しました');

  // 再読み込みしても残る（仕様書9.1）。
  await page.reload();
  await expect(page.getByTestId('tree-project')).toContainText('PJ-DIST');

  // エクスポートできる（仕様書9.2）。
  await page.getByTestId('nav-settings').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  expect((await download).suggestedFilename()).toMatch(/^parallel-work-time_\d{8}-\d{6}\.json$/);

  // 外部通信を行わない（仕様書5.1.4）。
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(origin)) {
      external.push(request.url());
    }
  });
  await page.reload();
  await expect(page.getByTestId('status-bar')).toBeVisible();
  expect(external).toEqual([]);
});
