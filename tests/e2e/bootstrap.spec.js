/**
 * Step 3 の完了条件「初回起動でテンプレートが入る」をブラウザ上で確認する。
 *
 * 受入試験 T-01〜T-18（仕様書16章）は Step 12 でこのディレクトリへ追加する。
 * 本ファイルはそれ以前の土台確認であり、試験IDは持たない。
 */

import { expect, test } from '@playwright/test';

test.describe('保存基盤の初期化', () => {
  test('初回起動でサンプルテンプレートが投入される（仕様書8.1.6）', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('bootstrap-message')).toHaveText(
      '保存基盤の初期化が完了しました。',
    );
    await expect(page.getByTestId('schema-version')).toHaveText('1');
    await expect(page.getByTestId('seeded-count')).toHaveText('3');
    await expect(page.getByTestId('template-count')).toHaveText('3');
  });

  test('再読み込みしても件数が増えない', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('seeded-count')).toHaveText('3');

    await page.reload();

    await expect(page.getByTestId('seeded-count')).toHaveText('0');
    await expect(page.getByTestId('template-count')).toHaveText('3');
  });

  test('T-01 が使う対象種別A・標準が一覧に出る', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('template-list').getByRole('listitem')).toHaveCount(3);
    await expect(page.getByTestId('template-list')).toContainText('対象種別A / 標準');
  });

  test('外部オリジンへの要求が発生しない（仕様書5.1.4、13章）', async ({ page }) => {
    const external = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:')) {
        external.push(request.url());
      }
    });

    await page.goto('/');
    await expect(page.getByTestId('bootstrap-message')).toHaveText(
      '保存基盤の初期化が完了しました。',
    );

    expect(external).toEqual([]);
  });
});
