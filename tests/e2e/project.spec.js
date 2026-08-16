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

  test('T-01 サンプル対象A・標準の有効な作業項目が生成される（A-01）', async ({ page }) => {
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

  test('サンプルの作業項目は外部項目コードを表示する', async ({ page }) => {
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await expect(page.getByTestId('task-code')).toHaveText([
      'X-100',
      'X-200',
      'X-1000',
      'X-1100',
      'X-1200',
    ]);
  });

  test('外部項目コード順へ並べ替えられる（仕様書8.7.3）', async ({ page }) => {
    // 「対象種別A / 標準」は表示順と自然順が一致するため、この試験には使えない。
    // 並べ替えを外しても通ってしまい、何も確かめていないことになる
    // （レビュー指摘 E-21）。「拡張」は表示順と自然順が食い違う。
    //
    //   表示順: 受入確認(X-100) → 本作業(X-1000) → 追加加工(X-2000) → 検査(X-1100)
    //   自然順: X-100 < X-1000 < X-1100 < X-2000
    await createProject(page, { projectId: 'PJ-SORT', variant: '拡張', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    // 並べ替える前は表示順である。
    expect(await readTaskNames(page)).toEqual(['受入確認', '本作業', '追加加工', '検査']);

    await page.getByTestId('run-sort').selectOption('externalCode');

    // 追加加工（X-2000）が検査（X-1100）より後ろへ動く。辞書順なら X-1100 <
    // X-1200 < X-2000 で同じ並びになるが、自然順でも X-1100 < X-2000 である。
    expect(await readTaskNames(page)).toEqual(['受入確認', '本作業', '検査', '追加加工']);
  });

  test('外部項目コード順でも未設定は末尾へ置く（仕様書8.7.3、8.7.4）', async ({ page }) => {
    // 「標準」には未設定（後片付け）がある。未設定の位置だけをここで見る。
    await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

    await page.getByTestId('run-sort').selectOption('externalCode');

    const names = await readTaskNames(page);
    expect(names.at(-1)).toBe('後片付け');
  });
});

test.describe('数量の集計（仕様書8.2.5、A-02）', () => {
  test('T-02 第1回50・第2回50で総数100・累計100・残数0（A-02）', async ({ page }) => {
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

  test('整数でない値は拒否する（仕様書8.9.2）', async ({ page }) => {
    await page.getByTestId('edit-total-quantity-toggle').click();
    // 先頭だけ読む変換だと 1 として保存されてしまう入力。
    await page.getByTestId('edit-total-quantity').fill('1.5');
    await page.getByTestId('save-total-quantity').click();

    await expect(page.getByTestId('project-errors')).toContainText('整数');
    await expect(page.getByTestId('total-quantity-value')).toHaveText('100');
  });

  test('数量を修正すると左ツリーの残数も同時に更新される', async ({ page }) => {
    await expect(page.getByTestId('tree-remaining')).toHaveText('残40');

    await page.getByTestId('edit-run-quantity-toggle').first().click();
    await page.getByTestId('edit-run-quantity').fill('80');
    await page.getByTestId('save-run-quantity').click();

    // 詳細ペインだけでなくツリーも描き直される（同じデータを見る表示は
    // 1つの経路でまとめて更新する）。
    await expect(page.getByTestId('remaining-value')).toHaveText('20');
    await expect(page.getByTestId('tree-remaining')).toHaveText('残20');
  });
});

test.describe('入力中のフォーカス保持', () => {
  test.beforeEach(async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  });

  /**
   * 現在フォーカスがある要素の `data-testid` を読む。
   *
   * @param {import('@playwright/test').Page} page
   */
  function focusedTestId(page) {
    return page.evaluate(() => document.activeElement?.dataset?.testid ?? null);
  }

  test('今回数量を1文字ずつ打ってもフォーカスと値が保たれる', async ({ page }) => {
    const input = page.getByTestId('run-quantity-input');
    await input.click();
    // `fill()` は input イベントを1回しか出さないため、この不具合を検出しない。
    // 実際の打鍵と同じく1文字ずつ送る。
    await page.keyboard.type('123');

    expect(await focusedTestId(page)).toBe('run-quantity-input');
    await expect(input).toHaveValue('123');
    await expect(page.getByTestId('quantity-preview')).toContainText('123');
  });

  test('対象種別を1文字ずつ打ってもフォーカスと値が保たれる', async ({ page }) => {
    await page.getByTestId('cancel-run').click();
    await page.getByTestId('new-project').click();
    await expect(page.getByTestId('project-form')).toBeVisible();

    const input = page.getByTestId('target-type');
    await input.click();
    await page.keyboard.type('対象種別A');

    expect(await focusedTestId(page)).toBe('target-type');
    await expect(input).toHaveValue('対象種別A');
  });

  test('生成対象のチェックを外してもフォーカスが残り、件数だけ変わる', async ({ page }) => {
    const checkbox = page
      .getByTestId('task-selection')
      .locator('li')
      .filter({ hasText: '前処理' })
      .getByTestId('task-include');
    await checkbox.uncheck();

    expect(await focusedTestId(page)).toBe('task-include');
    await expect(page.getByTestId('task-selection')).toContainText('4 / 5件');
  });

  test('ラベルを押すと対応する入力欄へフォーカスが移る', async ({ page }) => {
    await page.getByTestId('cancel-run').click();
    await page.getByTestId('new-project').click();
    await expect(page.getByTestId('project-form')).toBeVisible();

    await page.getByText('対象種別', { exact: true }).click();

    expect(await focusedTestId(page)).toBe('target-type');
  });
});

test.describe('作業項目の選択（仕様書12.2、12.3）', () => {
  test('実施回詳細で作業項目をクリックすると作業項目詳細が開く', async ({ page }) => {
    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 40 });

    const firstRow = page.getByTestId('task-list').getByTestId('task-row').first();
    const name = await firstRow.getByTestId('task-name').textContent();
    await firstRow.getByTestId('task-name').click();

    // Step 6 で作業項目詳細を足すまでは行の選択表示だけだった。いまは詳細へ移る。
    await expect(page.getByTestId('task-detail-title')).toHaveText(name);
    // 左ツリーでも同じ作業項目が選択として示される。
    await expect(page.getByTestId('tree-task').and(page.locator('[aria-current="true"]'))).toHaveCount(
      1,
    );
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
  test('T-18 一連の操作で外部オリジンへの要求が発生しない（A-15）', async ({ page }) => {
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
