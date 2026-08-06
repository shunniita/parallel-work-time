/**
 * 作業テンプレート画面のE2E（仕様書8.1、6.3、12.1）。
 *
 * 受入試験 T-01〜T-18（仕様書16章）は実装計画 Step 12 で追加する。本ファイルは
 * Step 4 の完了条件「テンプレートを登録・改訂でき、旧版レコードが残る」を
 * 実ブラウザで確認するものであり、試験IDは持たない。
 */

import { expect, test } from '@playwright/test';

import { SAMPLE_COUNT, openFresh } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

test.describe('画面の骨格（仕様書12.1）', () => {
  test('ヘッダー・二分割・フッターが揃う', async ({ page }) => {
    await expect(page.getByTestId('tree-pane')).toBeVisible();
    await expect(page.getByTestId('detail-pane')).toBeVisible();
    await expect(page.getByTestId('status-bar')).toBeVisible();
    await expect(page.getByTestId('schema-version')).toHaveText('schemaVersion 1');
  });

  test('テンプレート画面が現在の画面として示される', async ({ page }) => {
    await expect(page.getByTestId('nav-templates')).toHaveAttribute('aria-current', 'page');
  });

  test('未実装の画面は押せない', async ({ page }) => {
    // アーカイブは Step 10、設定は Step 9。集計・転記は Step 8 で実装済み。
    await expect(page.getByTestId('nav-archive')).toBeDisabled();
    await expect(page.getByTestId('nav-settings')).toBeDisabled();
  });

  test('実装済みの画面は押せる', async ({ page }) => {
    await expect(page.getByTestId('nav-projects')).toBeEnabled();
    await expect(page.getByTestId('nav-summary')).toBeEnabled();
    await expect(page.getByTestId('nav-templates')).toBeEnabled();
  });

  test('警告領域は中身が無いあいだ畳まれている', async ({ page }) => {
    await expect(page.getByTestId('warning-bar')).toBeHidden();
  });
});

test.describe('一覧表示（仕様書8.1.1）', () => {
  test('サンプルテンプレートの有効版が並ぶ', async ({ page }) => {
    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
    await expect(page.getByTestId('template-list')).toContainText('対象種別A');
    await expect(page.getByTestId('template-list')).toContainText('標準');
  });

  test('初期状態では編集領域が空である', async ({ page }) => {
    await expect(page.getByTestId('editor-empty')).toBeVisible();
  });
});

test.describe('改訂（仕様書8.1.3、6.3）', () => {
  /**
   * 対象種別A / 標準 の行を選んで編集領域を開く。
   *
   * @param {import('@playwright/test').Page} page
   */
  async function editStandardA(page) {
    const row = page
      .getByTestId('template-row')
      .filter({ hasText: '対象種別A' })
      .filter({ hasText: '標準' });
    await row.getByTestId('select-template').click();
    await expect(page.getByTestId('template-editor')).toBeVisible();
  }

  test('編集領域に版番号と作業項目が出る', async ({ page }) => {
    await editStandardA(page);

    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版1');
    await expect(page.getByTestId('task-row')).toHaveCount(5);
  });

  test('名称を変えて改訂すると版が2になる', async ({ page }) => {
    await editStandardA(page);

    await page.getByTestId('task-name').first().fill('受入確認（改）');
    await page.getByTestId('revise').click();

    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');
    await expect(page.getByTestId('save-status')).toContainText('保存しました');
  });

  test('改訂しても有効版の件数は増えない（旧版は一覧から外れる）', async ({ page }) => {
    await editStandardA(page);
    await page.getByTestId('revise').click();
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');

    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
  });

  test('改訂結果が再読み込み後も残る（仕様書9.1）', async ({ page }) => {
    await editStandardA(page);
    await page.getByTestId('task-name').first().fill('受入確認（改）');
    await page.getByTestId('revise').click();
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');

    await page.reload();
    await editStandardA(page);

    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');
    await expect(page.getByTestId('task-name').first()).toHaveValue('受入確認（改）');
  });

  test('旧版のレコードが保持される（仕様書6.3）', async ({ page }) => {
    await editStandardA(page);
    await page.getByTestId('revise').click();
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');

    // 旧版の閲覧画面は設けないため、保存内容を直接数える。
    const versions = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('parallel-work-time');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const templates = await new Promise((resolve, reject) => {
        const request = db
          .transaction(['taskTemplates'], 'readonly')
          .objectStore('taskTemplates')
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return templates
        .filter((template) => template.targetType === '対象種別A' && template.variant === '標準')
        .map((template) => ({ version: template.version, active: template.active }));
    });

    expect(versions.sort((left, right) => left.version - right.version)).toEqual([
      { version: 1, active: false },
      { version: 2, active: true },
    ]);
  });

  test('作業項目を追加してから改訂できる', async ({ page }) => {
    await editStandardA(page);

    await page.getByTestId('add-task').first().click();
    await expect(page.getByTestId('task-row')).toHaveCount(6);
    await page.getByTestId('task-name').last().fill('追加加工');
    await page.getByTestId('task-code').last().fill('X-3000');
    await page.getByTestId('revise').click();

    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');
    await expect(page.getByTestId('task-row')).toHaveCount(6);
  });

  test('作業項目を無効化できる（仕様書8.1.2）', async ({ page }) => {
    await editStandardA(page);

    await page.getByTestId('task-active').first().uncheck();
    await page.getByTestId('revise').click();
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');

    await expect(page.getByTestId('task-active').first()).not.toBeChecked();
  });

  test('名称を空にすると保存できず、入力内容が残る', async ({ page }) => {
    await editStandardA(page);

    await page.getByTestId('task-code').first().fill('X-999');
    await page.getByTestId('task-name').first().fill('');
    await page.getByTestId('revise').click();

    await expect(page.getByTestId('template-errors')).toContainText('名称');
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版1');
    await expect(page.getByTestId('task-code').first()).toHaveValue('X-999');
  });

  test('編集を破棄すると保存済みの内容へ戻る', async ({ page }) => {
    await editStandardA(page);
    const original = await page.getByTestId('task-name').first().inputValue();

    await page.getByTestId('task-name').first().fill('書き換え');
    await page.getByTestId('discard').click();

    await expect(page.getByTestId('task-name').first()).toHaveValue(original);
  });
});

test.describe('新規登録（仕様書8.1.1）', () => {
  test('対象種別とバリエーションを入力して登録できる', async ({ page }) => {
    await page.getByTestId('new-template-toggle').click();
    await page.getByTestId('new-target-type').fill('対象種別Z');
    await page.getByTestId('new-variant').fill('標準');
    await page.getByTestId('new-tasks').getByTestId('task-name').first().fill('準備');
    await page.getByTestId('new-tasks').getByTestId('task-code').first().fill('Z-10');
    await page.getByTestId('create').click();

    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT + 1);
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別Z / 標準 版1');
  });

  test('対象種別が空だと保存できない', async ({ page }) => {
    await page.getByTestId('new-template-toggle').click();
    await page.getByTestId('new-variant').fill('標準');
    await page.getByTestId('new-tasks').getByTestId('task-name').first().fill('準備');
    await page.getByTestId('create').click();

    await expect(page.getByTestId('template-errors')).toContainText('対象種別');
    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
  });

  test('既存の組み合わせは改訂を促して拒否する', async ({ page }) => {
    await page.getByTestId('new-template-toggle').click();
    await page.getByTestId('new-target-type').fill('対象種別A');
    await page.getByTestId('new-variant').fill('標準');
    await page.getByTestId('new-tasks').getByTestId('task-name').first().fill('準備');
    await page.getByTestId('create').click();

    await expect(page.getByTestId('template-errors')).toContainText('改訂');
    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
  });

  test('キャンセルすると入力が破棄される', async ({ page }) => {
    await page.getByTestId('new-template-toggle').click();
    await page.getByTestId('new-target-type').fill('対象種別Z');
    await page.getByTestId('cancel-create').click();

    await page.getByTestId('new-template-toggle').click();
    await expect(page.getByTestId('new-target-type')).toHaveValue('');
  });
});

test.describe('外部通信（仕様書5.1.4、13章）', () => {
  test('一連の操作で外部オリジンへの要求が発生しない', async ({ page }) => {
    const external = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:')) {
        external.push(request.url());
      }
    });

    const row = page
      .getByTestId('template-row')
      .filter({ hasText: '対象種別A' })
      .filter({ hasText: '標準' });
    await row.getByTestId('select-template').click();
    await page.getByTestId('task-name').first().fill('受入確認（改）');
    await page.getByTestId('revise').click();
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');

    expect(external).toEqual([]);
  });
});
