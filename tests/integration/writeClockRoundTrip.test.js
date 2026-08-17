/**
 * 往復保証の結合テスト（受入基準 A-11、仕様書9.2・9.3、過去のレビュー指摘）。
 *
 * 「ツール自身が書き出したJSONは、同じ版のツールへ必ず取り込める」を固定する。
 * 時計が巻き戻る条件を実際に作り、通常操作で書いたデータをそのままエクスポートし、
 * 取り込み検証へ通す。取り込み側の不変条件（過去のレビュー指摘）は緩めず、書き込み側で実効
 * 時刻を単調に保つことで成立させる。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { addIntervalManually } from '../../src/app/actions/intervalActions.js';
import { createProjectGroup, createWorkRun, updateRunQuantity } from '../../src/app/actions/projectActions.js';
import { exportData } from '../../src/app/actions/settingsActions.js';
import { createTemplate } from '../../src/app/actions/templateActions.js';
import { archiveRun } from '../../src/app/actions/retentionActions.js';
import { markAggregated, markTransferred } from '../../src/app/actions/transferActions.js';
import { createPersistence } from '../../src/app/persistence.js';
import { INTERVAL_TYPE } from '../../src/domain/effort.js';
import { validateImport } from '../../src/domain/integrity.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';

/** 実施回を作った時刻。ここを基準に時計を戻す。 */
const CREATED = new Date('2026-08-01T01:00:00Z');
/** NTP補正や手動修正で戻った後の時刻。 */
const ROLLED_BACK = new Date('2026-07-25T01:00:00Z');

function idGenerator() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `id-${sequence}`;
  };
}

describe('時計が巻き戻っても自分のエクスポートを取り込める（A-11）', () => {
  /** @type {MemoryAdapter} */
  let adapter;
  /** @type {object} */
  let deps;
  /** @type {Date} */
  let clock;
  /** @type {object} */
  let run;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.initialize();
    clock = CREATED;
    const now = () => clock;
    deps = {
      adapter,
      persistence: createPersistence(adapter, { now }),
      now,
      newId: idGenerator(),
    };

    await createTemplate(deps, {
      targetType: '対象種別A',
      variant: '標準',
      tasks: [{ name: '受入確認', externalCode: 'X-100', order: 1, active: true }],
    });
    const created = await createProjectGroup(deps, {
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
      totalQuantity: 100,
    });
    ({ workRun: run } = await createWorkRun(deps, created.projectGroup.projectGroupId, {
      workDate: '2026-08-01',
      runQuantity: 10,
    }));

    // ここで時計が過去へ戻る。以降の書き込みはすべて createdAt より前の現在時刻で走る。
    clock = ROLLED_BACK;
  });

  /** いま保存されている全データをエクスポート形式で取り出す。 */
  async function exported() {
    const { payload } = await exportData(deps, {
      now: () => clock,
      download: () => ({ filename: 'test.json', text: '' }),
    });
    return payload;
  }

  it('区間を足した後のエクスポートを取り込める', async () => {
    await addIntervalManually(
      deps,
      { runId: run.runId, taskRecordId: run.tasks[0].taskRecordId },
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      },
    );

    expect(validateImport(await exported()).errors).toEqual([]);
  });

  it('今回数量を直した後のエクスポートを取り込める', async () => {
    await updateRunQuantity(deps, run.runId, { runQuantity: 20 });

    expect(validateImport(await exported()).errors).toEqual([]);
  });

  it('集計・転記・アーカイブまで進めたエクスポートを取り込める', async () => {
    await addIntervalManually(
      deps,
      { runId: run.runId, taskRecordId: run.tasks[0].taskRecordId },
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      },
    );
    await markAggregated(deps, run.runId);
    await markTransferred(deps, run.runId);
    const { workRun: archived } = await archiveRun(deps, run.runId);

    // 実効時刻は作成日時で頭打ちになる。現在時刻をそのまま書くと鎖が壊れる。
    expect(archived.archivedAt).toBe(archived.createdAt);
    expect(validateImport(await exported()).errors).toEqual([]);
  });

  it('時計が正常に進んでいるときは現在時刻をそのまま使う', async () => {
    clock = new Date('2026-08-02T01:00:00Z');
    await updateRunQuantity(deps, run.runId, { runQuantity: 20 });

    const payload = await exported();
    expect(payload.workRuns[0].updatedAt.startsWith('2026-08-02')).toBe(true);
  });
});
