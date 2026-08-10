/**
 * 配布物の確認（仕様書14章、5.1.3、5.1.5、実装計画8.2「手動確認」の自動化）。
 *
 * 配布物として揃えたディレクトリを別ポートで配信し、起動・保存・エクスポートまでを
 * 通す。開発時ツールを取り除いた状態でも動くことを見る。
 *
 * ZIP そのもの（存在・展開・内容・マニフェスト照合）は
 * `tests/integration/distribution.test.js` が確かめる。ここは段取りだけを求め、
 * 圧縮の費用を払わない（レビュー指摘 F12-23）。
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { createStaticServer } from '../../tools/static-server.mjs';
import { createProject } from './helpers.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STAGE_DIR = join(ROOT, 'dist', 'parallel-work-time');
const INTERNAL_DIR = join(STAGE_DIR, 'アプリ内部（変更しないでください）');

let server;
let origin;

test.beforeAll(async () => {
  // 実行順に依存しないよう、この試験の中で揃え直す。
  const built = spawnSync(
    process.execPath,
    [join(ROOT, 'tools', 'build-dist.mjs'), '--stage-only'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  expect(built.status, built.stderr).toBe(0);

  server = createStaticServer(INTERNAL_DIR);
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  // beforeAll が落ちると server は未代入のまま。ここで例外を出すと、本当の
  // 失敗理由がその例外に隠れる。
  if (server === undefined) {
    return;
  }
  await new Promise((resolveClose) => server.close(resolveClose));
});

test('配布物だけで起動・保存・エクスポートができる（仕様書14章）', async ({ page }) => {
  // 外部通信の監視は最初のページ遷移より前に取り付ける。初回ロードや保存時だけ
  // 発火する外部URL参照を見落とさないためである（仕様書5.1.4、13章）。
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(origin)) {
      external.push(request.url());
    }
  });

  await page.goto(`${origin}/`);
  await expect(page.getByTestId('status-bar')).toBeVisible();

  // サンプルテンプレートが読める（data/ が同梱されている）。
  await expect(page.getByTestId('template-row').first()).toBeVisible();
  await expect(page.getByTestId('warning-notice')).toHaveCount(0);

  // 保存できる。
  await createProject(page, { projectId: 'PJ-DIST', totalQuantity: 100 });
  await expect(page.getByTestId('save-status')).toContainText('保存しました');

  // 再読み込みしても残る（仕様書9.1）。
  await page.reload();
  await expect(page.getByTestId('tree-project')).toContainText('PJ-DIST');

  // エクスポートできる（仕様書9.2）。
  await page.getByTestId('nav-settings').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  expect((await download).suggestedFilename()).toMatch(/^parallel-work-time_\d{8}-\d{6}\.json$/);

  await page.reload();
  await expect(page.getByTestId('status-bar')).toBeVisible();
  expect(external).toEqual([]);
});
