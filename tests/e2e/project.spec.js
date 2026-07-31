/**
 * 案件・実施回のE2E（仕様書8.2、8.3、8.9.2、8.9.7）。
 *
 * 受入試験 T-01〜T-18（仕様書16章）は実装計画 Step 12 でまとめて追加する。
 * ここでは Step 5 の完了条件（A-01、A-02）に相当する範囲を確認する。
 */

import { expect, test } from '@playwright/test';

import {
  SAMPLE_COUNT,
  createProject,
  createRun,
  openFresh,
  openProject,
  openRun,
  readTaskNames,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

test.describe('案件登録（仕様書8.2.1）', () => {
  test('案件が無い状態では案内を出す', async ({ page }) => {
    await page.getByTestId('nav-projects').click();

    await expect(page.getByTestId('tree-empty')).toBeVisible();
  });

  test('案件を登録するとツリーへ現れる', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });

    await expect(page.getByTestId('tree-project')).toHaveCount(1);
    await expect(page.getByTestId('project-title')).toHaveText('PJ-0001');
    await expect(page.getByTestId('project-subtitle')).toHaveText('対象種別A / 標準');
  });

  test('登録後は実施回追加フォームが開く', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });

    await expect(page.getByTestId('run-form')).toBeVisible();
  });

  test('案件IDが空だと登録できない（仕様書8.9.1）', async ({ page }) => {
    await page.getByTestId('new-project').click();
    await page.getByTestId('target-type').fill('対象種別A');
    await page.getByTestId('variant').fill('標準');
    await page.getByTestId('total-quantity').fill('100');
    await page.getByTestId('create-project').click();

    await expect(page.getByTestId('project-errors')).toContainText('案件ID');
  });

  test('総予定数が0だと登録できない（仕様書8.9.2）', async ({ page }) => {
    await page.getByTestId('new-project').click();
    await page.getByTestId('project-id').fill('PJ-0001');
    await page.getByTestId('target-type').fill('対象種別A');
    await page.getByTestId('variant').fill('標準');
    await page.getByTestId('total-quantity').fill('0');
    await page.getByTestId('create-project').click();

    await expect(page.getByTestId('project-errors')).toContainText('総予定数');
  });

  test('有効なテンプレートが無い組み合わせは登録できない（仕様書8.3.1）', async ({ page }) => {
    await page.getByTestId('new-project').click();
    await page.getByTestId('project-id').fill('PJ-0001');
    await page.getByTestId('target-type').fill('対象種別Z');
    await page.getByTestId('variant').fill('標準');
    await page.getByTestId('total-quantity').fill('100');
    await page.getByTestId('create-project').click();

    await expect(page.getByTestId('project-errors')).toContainText('テンプレート');
  });
});

test.describe('案件IDの一意性（仕様書8.2.6）', () => {
  test.beforeEach(async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 40 });
  });

  test('既存の案件IDでは登録できない', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 500 });

    await expect(page.getByTestId('project-errors')).toContainText('既に登録されている');
    await expect(page.getByTestId('tree-project')).toHaveCount(1);
  });

  test('既存案件の対象種別とバリエーションを表示する', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 500 });

    await expect(page.getByTestId('project-conflict')).toBeVisible();
    await expect(page.getByTestId('conflict-target-type')).toHaveText('対象種別A');
    await expect(page.getByTestId('conflict-variant')).toHaveText('標準');
  });

  test('既存案件の数量の状況も示す', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 500 });

    const conflict = page.getByTestId('project-conflict');
    await expect(conflict).toContainText('100');
    await expect(conflict).toContainText('40');
    await expect(conflict).toContainText('60');
  });

  test('既存案件へ実施回を追加する導線が出る', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 500 });

    await page.getByTestId('open-existing-project').click();

    await expect(page.getByTestId('project-title')).toHaveText('PJ-0001');
    await expect(page.getByTestId('run-form')).toBeVisible();
  });

  test('導線から実施回を追加できる', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 500 });
    await page.getByTestId('open-existing-project').click();

    await createRun(page, { workDate: '2026-08-02', runQuantity: 20 });

    await openProject(page, 'PJ-0001');
    await expect(page.getByTestId('run-row')).toHaveCount(2);
    await expect(page.getByTestId('accumulated-value')).toHaveText('60');
  });

  test('異なる対象種別で登録しても既存の対象種別を上書きしない', async ({ page }) => {
    await createProject(page, {
      projectId: 'PJ-0001',
      targetType: '対象種別B',
      variant: '標準',
      totalQuantity: 999,
    });

    await expect(page.getByTestId('project-conflict')).toBeVisible();
    // 既存案件の内容は元のまま。
    await expect(page.getByTestId('conflict-target-type')).toHaveText('対象種別A');

    await openProject(page, 'PJ-0001');
    await expect(page.getByTestId('project-subtitle')).toHaveText('対象種別A / 標準');
    await expect(page.getByTestId('total-quantity-value')).toHaveText('100');
  });

  test('前後空白だけ違う案件IDも重複として扱う', async ({ page }) => {
    await createProject(page, { projectId: '  PJ-0001  ', totalQuantity: 500 });

    await expect(page.getByTestId('project-conflict')).toBeVisible();
  });

  test('別の案件IDなら登録できる', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0002', totalQuantity: 200 });

    await expect(page.getByTestId('tree-project')).toHaveCount(2);
  });
});

test.describe('作業項目の生成（仕様書8.3、A-01）', () => {
  test.beforeEach(async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  });

  test('サンプル対象A・標準の有効な作業項目が生成される（T-01相当）', async ({ page }) => {
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    expect(await readTaskNames(page)).toEqual([
      '受入確認',
      '前処理',
      '本作業',
      '検査',
      '後片付け',
    ]);
  });

  test('生成対象から外した作業項目は生成されない（仕様書8.3.2）', async ({ page }) => {
    await createRun(page, {
      workDate: '2026-08-01',
      runQuantity: 50,
      excludeNames: ['前処理', '後片付け'],
    });

    expect(await readTaskNames(page)).toEqual(['受入確認', '本作業', '検査']);
  });

  test('選択中の件数が表示される', async ({ page }) => {
    // 案件登録の直後は実施回追加フォームが開いている。
    await expect(page.getByTestId('task-selection')).toContainText('5 / 5件');

    await page
      .getByTestId('task-selection')
      .locator('li')
      .filter({ hasText: '前処理' })
      .getByTestId('task-include')
      .uncheck();

    await expect(page.getByTestId('task-selection')).toContainText('4 / 5件');
  });

  test('生成元のテンプレート版を表示する', async ({ page }) => {
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await expect(page.getByTestId('run-template-version')).toContainText('版1');
  });

  test('作業項目は未着手で始まる（仕様書7.2）', async ({ page }) => {
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await expect(page.getByTestId('task-state').first()).toHaveText('未着手');
  });

  test('外部項目コード未設定は注記して表示する（仕様書8.7.4）', async ({ page }) => {
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    // サンプルの「後片付け」は外部項目コードが未設定。
    await expect(page.getByTestId('task-list')).toContainText('（未設定）');
  });

  test('外部項目コード順へ並べ替えられる（仕様書8.7.3）', async ({ page }) => {
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await page.getByTestId('run-sort').selectOption('externalCode');

    // 自然順で X-100 < X-200 < X-1000 < X-1100、未設定は末尾。
    expect(await readTaskNames(page)).toEqual([
      '受入確認',
      '前処理',
      '本作業',
      '検査',
      '後片付け',
    ]);
  });
});

test.describe('数量の集計（仕様書8.2.5、A-02）', () => {
  test('第1回50・第2回50で総数100・累計100・残数0（T-02相当）', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });
    await openProject(page, 'PJ-0001');
    await createRun(page, { workDate: '2026-08-02', runQuantity: 50 });
    await openProject(page, 'PJ-0001');

    await expect(page.getByTestId('total-quantity-value')).toHaveText('100');
    await expect(page.getByTestId('accumulated-value')).toHaveText('100');
    await expect(page.getByTestId('remaining-value')).toHaveText('0');
    await expect(page.getByTestId('run-count')).toHaveText('2件');
  });

  test('実施回が無ければ累計0・残数は総予定数', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await page.getByTestId('cancel-run').click();

    await expect(page.getByTestId('accumulated-value')).toHaveText('0');
    await expect(page.getByTestId('remaining-value')).toHaveText('100');
  });

  test('同じ日付に複数の実施回を作れる（仕様書8.2.3）', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 30 });
    await openProject(page, 'PJ-0001');
    await createRun(page, { workDate: '2026-08-01', runQuantity: 30 });
    await openProject(page, 'PJ-0001');

    await expect(page.getByTestId('run-row')).toHaveCount(2);
    await expect(page.getByTestId('run-date').first()).toHaveText('2026-08-01');
    await expect(page.getByTestId('run-date').last()).toHaveText('2026-08-01');
  });

  test('累計はアーカイブ済みの実施回も含む旨を明示する', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await page.getByTestId('cancel-run').click();

    await expect(page.getByTestId('quantity-summary')).toContainText('アーカイブ済み');
  });

  test('入力中に追加後の累計を先読みして示す', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await page.getByTestId('run-quantity-input').fill('30');

    await expect(page.getByTestId('quantity-preview')).toContainText('30');
    await expect(page.getByTestId('quantity-preview')).toContainText('70');
  });

  test('残数はツリーにも出る', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 40 });

    await expect(page.getByTestId('tree-remaining')).toHaveText('残60');
  });
});

test.describe('累計超過（仕様書8.9.7）', () => {
  test.beforeEach(async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  });

  test('超過する実施回は確認を求める', async ({ page }) => {
    await page.getByTestId('run-quantity-input').fill('150');
    await page.getByTestId('work-date').fill('2026-08-01');
    await page.getByTestId('create-run').click();

    await expect(page.getByTestId('overflow-confirm')).toBeVisible();
    await expect(page.getByTestId('overflow-confirm')).toContainText('50');
  });

  test('確認して続行すると保存される', async ({ page }) => {
    await createRun(page, {
      workDate: '2026-08-01',
      runQuantity: 150,
      confirmOverflow: true,
    });
    await openProject(page, 'PJ-0001');

    await expect(page.getByTestId('accumulated-value')).toHaveText('150');
    await expect(page.getByTestId('remaining-value')).toHaveText('-50');
    await expect(page.getByTestId('exceeded-note')).toContainText('50');
  });

  test('やめると保存されない', async ({ page }) => {
    await page.getByTestId('run-quantity-input').fill('150');
    await page.getByTestId('work-date').fill('2026-08-01');
    await page.getByTestId('create-run').click();
    await expect(page.getByTestId('overflow-confirm')).toBeVisible();

    await page.getByTestId('reject-overflow').click();

    await expect(page.getByTestId('overflow-confirm')).toBeHidden();
    await expect(page.getByTestId('accumulated-value')).toHaveText('0');
  });

  test('入力中の先読みでも超過を知らせる', async ({ page }) => {
    await page.getByTestId('run-quantity-input').fill('150');

    await expect(page.getByTestId('quantity-preview')).toContainText('超えます');
  });
});

test.describe('数量の修正（仕様書8.2.7）', () => {
  test.beforeEach(async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 60 });
    await openProject(page, 'PJ-0001');
  });

  test('総予定数を修正すると累計・残数が再計算される', async ({ page }) => {
    await page.getByTestId('edit-total-quantity-toggle').click();
    await page.getByTestId('edit-total-quantity').fill('200');
    await page.getByTestId('save-total-quantity').click();

    await expect(page.getByTestId('total-quantity-value')).toHaveText('200');
    await expect(page.getByTestId('accumulated-value')).toHaveText('60');
    await expect(page.getByTestId('remaining-value')).toHaveText('140');
  });

  test('今回数量を修正すると累計・残数が再計算される', async ({ page }) => {
    await page.getByTestId('edit-run-quantity-toggle').first().click();
    await page.getByTestId('edit-run-quantity').fill('80');
    await page.getByTestId('save-run-quantity').click();

    await expect(page.getByTestId('accumulated-value')).toHaveText('80');
    await expect(page.getByTestId('remaining-value')).toHaveText('20');
  });

  test('修正結果が再読み込み後も残る', async ({ page }) => {
    await page.getByTestId('edit-total-quantity-toggle').click();
    await page.getByTestId('edit-total-quantity').fill('300');
    await page.getByTestId('save-total-quantity').click();
    await expect(page.getByTestId('total-quantity-value')).toHaveText('300');

    await page.reload();
    await openProject(page, 'PJ-0001');

    await expect(page.getByTestId('total-quantity-value')).toHaveText('300');
    await expect(page.getByTestId('remaining-value')).toHaveText('240');
  });

  test('総予定数を累計より小さくすると確認を求める', async ({ page }) => {
    await page.getByTestId('edit-total-quantity-toggle').click();
    await page.getByTestId('edit-total-quantity').fill('40');
    await page.getByTestId('save-total-quantity').click();

    await expect(page.getByTestId('overflow-confirm')).toBeVisible();
    await expect(page.getByTestId('total-quantity-value')).toHaveText('100');
  });

  test('確認後は累計より小さい総予定数へ修正できる', async ({ page }) => {
    await page.getByTestId('edit-total-quantity-toggle').click();
    await page.getByTestId('edit-total-quantity').fill('40');
    await page.getByTestId('save-total-quantity').click();
    await page.getByTestId('confirm-overflow').click();

    await expect(page.getByTestId('total-quantity-value')).toHaveText('40');
    await expect(page.getByTestId('remaining-value')).toHaveText('-20');
  });

  test('今回数量を修正しても作業項目は変わらない', async ({ page }) => {
    await openRun(page, 0);
    const before = await readTaskNames(page);

    await openProject(page, 'PJ-0001');
    await page.getByTestId('edit-run-quantity-toggle').first().click();
    await page.getByTestId('edit-run-quantity').fill('70');
    await page.getByTestId('save-run-quantity').click();
    await openRun(page, 0);

    expect(await readTaskNames(page)).toEqual(before);
  });

  test('0以下へは修正できない（仕様書8.9.2）', async ({ page }) => {
    await page.getByTestId('edit-total-quantity-toggle').click();
    await page.getByTestId('edit-total-quantity').fill('0');
    await page.getByTestId('save-total-quantity').click();

    await expect(page.getByTestId('project-errors')).toContainText('総予定数');
    await expect(page.getByTestId('total-quantity-value')).toHaveText('100');
  });
});

test.describe('階層ツリー（仕様書12.1）', () => {
  test('案件 → 実施回 → 作業項目の3階層を辿れる', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await expect(page.getByTestId('tree-project')).toHaveCount(1);
    await expect(page.getByTestId('tree-run')).toHaveCount(1);
    await expect(page.getByTestId('tree-task')).toHaveCount(5);
  });

  test('作業項目ノードに現在状態が出る（仕様書7.2）', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await expect(page.getByTestId('tree-task').first()).toHaveAttribute(
      'data-state',
      'notStarted',
    );
  });

  test('実施回ノードに状態バッジが出る（仕様書7章）', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await expect(page.getByTestId('tree-run')).toContainText('作業中');
  });

  test('ツリーから実施回を開ける', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await openProject(page, 'PJ-0001');
    await page.getByTestId('tree-run').click();

    await expect(page.getByTestId('task-list')).toBeVisible();
  });

  test('複数案件を並べて表示する', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0002', totalQuantity: 100 });
    await page.getByTestId('cancel-run').click();
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await page.getByTestId('cancel-run').click();

    // 案件IDの昇順で並ぶ。
    await expect(page.getByTestId('tree-project').first()).toContainText('PJ-0001');
    await expect(page.getByTestId('tree-project').last()).toContainText('PJ-0002');
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

    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });
    await openProject(page, 'PJ-0001');
    await page.getByTestId('edit-total-quantity-toggle').click();
    await page.getByTestId('edit-total-quantity').fill('200');
    await page.getByTestId('save-total-quantity').click();
    await expect(page.getByTestId('total-quantity-value')).toHaveText('200');

    expect(external).toEqual([]);
  });
});

test('テンプレート画面の一覧は変わらず表示できる', async ({ page }) => {
  await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  await page.getByTestId('nav-templates').click();

  await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
});
