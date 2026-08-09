/**
 * 性能目標の実測（仕様書13章、実装計画8.2「手動確認」の自動化）。
 *
 * 目標は「案件20件、実施回100件、作業区間2,000件程度で通常操作に支障がない」で
 * ある。これを超える規模の保証はせず、実測値をREADMEへ記載すると定めている。
 *
 * ## 生成はIndexedDBへ直接書く
 *
 * 画面操作で2,000区間を作ると試験だけで数十分かかる。ここで測りたいのは
 * 「その規模のデータを抱えたときの描画・集計・出力」であって入力操作ではない
 * ため、保存済みの状態を直接組み立てる。
 *
 * ## 閾値は緩く、値は記録する
 *
 * 実行機の性能に左右されるので、合否は「明らかな破綻」だけを見る。README へ
 * 載せる数字はこの試験の出力から採る。
 */

import { expect, test } from '@playwright/test';

import { openFresh } from './helpers.js';

/** 仕様書13章の性能目標。 */
const SCALE = { groups: 20, runs: 100, intervals: 2000 };

/** 明らかな破綻とみなす上限（ミリ秒）。実行機差を見込んで緩くとる。 */
const BUDGET_MS = 5000;

/**
 * 目標規模のデータをIndexedDBへ直接書き込む。
 *
 * @param {import('@playwright/test').Page} page
 */
async function seed(page) {
  return page.evaluate(async (scale) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('parallel-work-time');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const templates = await new Promise((resolve, reject) => {
      const request = db.transaction(['taskTemplates']).objectStore('taskTemplates').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const template = templates.find((item) => item.active === true);

    const groups = [];
    const runs = [];
    let intervalCount = 0;
    // 区間は実施回へ均等に配る。1実施回あたり 2,000 / 100 = 20 区間。
    const perRun = Math.ceil(scale.intervals / scale.runs);

    for (let g = 0; g < scale.groups; g += 1) {
      groups.push({
        projectGroupId: `perf-group-${g}`,
        projectId: `PJ-${String(g + 1).padStart(4, '0')}`,
        targetType: template.targetType,
        variant: template.variant,
        totalQuantity: 1000,
        createdAt: '2026-08-01T09:00:00+09:00',
        updatedAt: '2026-08-01T09:00:00+09:00',
      });
    }

    for (let r = 0; r < scale.runs; r += 1) {
      const group = groups[r % groups.length];
      const tasks = template.tasks.map((definition, index) => {
        const intervals = [];
        // 先頭の作業項目へ区間をまとめる。項目数ではなく総区間数が目標値である。
        if (index === 0) {
          for (let i = 0; i < perRun && intervalCount < scale.intervals; i += 1) {
            const hour = String(1 + (i % 20)).padStart(2, '0');
            intervals.push({
              intervalId: `perf-interval-${r}-${i}`,
              type: 'work',
              startAt: `2026-08-01T${hour}:00:00+09:00`,
              endAt: `2026-08-01T${hour}:30:00+09:00`,
              participants: ['甲', '乙'],
              createdAt: '2026-08-01T09:00:00+09:00',
              updatedAt: '2026-08-01T09:00:00+09:00',
            });
            intervalCount += 1;
          }
        }
        return {
          taskRecordId: `perf-task-${r}-${index}`,
          taskDefinitionId: definition.taskDefinitionId,
          name: definition.name,
          externalCode: definition.externalCode,
          order: definition.order,
          manuallyAdded: false,
          intervals,
          directEntries: [],
        };
      });

      runs.push({
        runId: `perf-run-${r}`,
        projectGroupId: group.projectGroupId,
        workDate: '2026-08-01',
        runQuantity: 10,
        status: 'working',
        templateId: template.templateId,
        templateVersion: template.version,
        transferredAt: null,
        archivedAt: null,
        createdAt: '2026-08-01T09:00:00+09:00',
        updatedAt: '2026-08-01T09:00:00+09:00',
        tasks,
      });
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction(['projectGroups', 'workRuns'], 'readwrite');
      for (const group of groups) {
        tx.objectStore('projectGroups').put(group);
      }
      for (const run of runs) {
        tx.objectStore('workRuns').put(run);
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    return { groups: groups.length, runs: runs.length, intervals: intervalCount };
  }, SCALE);
}

test('性能目標の規模で通常操作が破綻しない（仕様書13章）', async ({ page }) => {
  await openFresh(page);
  const seeded = await seed(page);
  expect(seeded).toEqual(SCALE);

  // 起動（全件読み込み → 左ツリー描画）。
  const startup = Date.now();
  await page.reload();
  await expect(page.getByTestId('tree-project')).toHaveCount(SCALE.groups);
  const startupMs = Date.now() - startup;

  // 実施回の集計（集計・転記画面）。
  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('run-row').first().getByTestId('open-run').click();
  const aggregate = Date.now();
  await page.getByTestId('nav-summary').click();
  await expect(page.getByTestId('summary-run-status')).toBeVisible();
  const aggregateMs = Date.now() - aggregate;

  // JSONエクスポート。
  await page.getByTestId('nav-settings').click();
  const exportStart = Date.now();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  await download;
  const exportMs = Date.now() - exportStart;

  const measured = { startupMs, aggregateMs, exportMs };
  // README へ載せる数字はここから採る。
  console.log(`[perf] ${JSON.stringify({ ...SCALE, ...measured })}`);

  for (const [label, value] of Object.entries(measured)) {
    expect(value, `${label} が ${BUDGET_MS}ms を超えた`).toBeLessThan(BUDGET_MS);
  }
});
