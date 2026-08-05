/**
 * 状態遷移と転記済み管理の結合テスト（仕様書7.1、8.7.6、8.9.6、11章）。
 *
 * 受入条件 A-08（未終了区間があると集計済みにできない）に対応する。
 *
 * 転記済みからの後退は「状態と履歴の片方だけが残らない」ことを中心に確かめる。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { addIntervalManually, recordStart } from '../../src/app/actions/intervalActions.js';
import { createProjectGroup, createWorkRun } from '../../src/app/actions/projectActions.js';
import { createTemplate } from '../../src/app/actions/templateActions.js';
import {
  markAggregated,
  markTransferred,
  previewStatusChange,
  reopenRun,
  revertTransfer,
} from '../../src/app/actions/transferActions.js';
import { ValidationError } from '../../src/app/errors.js';
import { createPersistence } from '../../src/app/persistence.js';
import { toIsoSecond } from '../../src/domain/datetime.js';
import { INTERVAL_TYPE } from '../../src/domain/effort.js';
import { HISTORY_ENTITY, HISTORY_OP } from '../../src/domain/history.js';
import { RUN_STATUS } from '../../src/domain/schema.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { ENTITY_TYPE } from '../../src/storage/StorageAdapter.js';

const FIXED_NOW = new Date('2026-08-01T01:00:00Z');
const NOW_ISO = toIsoSecond(FIXED_NOW);

function idGenerator() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `id-${sequence}`;
  };
}

describe('transferActions', () => {
  /** @type {MemoryAdapter} */
  let adapter;
  /** @type {object} */
  let deps;
  /** @type {object} */
  let run;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.initialize();
    const persistence = createPersistence(adapter, { now: () => FIXED_NOW });
    deps = { adapter, persistence, now: () => FIXED_NOW, newId: idGenerator() };

    await createTemplate(deps, {
      targetType: '対象種別A',
      variant: '標準',
      tasks: [
        { name: '受入確認', externalCode: 'X-100', order: 1, active: true },
        { name: '本作業', externalCode: 'X-200', order: 2, active: true },
      ],
    });
    const { projectGroup } = await createProjectGroup(deps, {
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
      totalQuantity: 100,
    });
    const created = await createWorkRun(deps, projectGroup.projectGroupId, {
      workDate: '2026-08-01',
      runQuantity: 50,
    });
    run = created.workRun;
  });

  /** 実施回の n 番目の作業項目を指す対象。 */
  function target(index = 0) {
    return { runId: run.runId, taskRecordId: run.tasks[index].taskRecordId };
  }

  /** 保存済みの実施回を読み直す。 */
  async function reloadRun() {
    const { workRuns } = await adapter.loadAll();
    return workRuns.find((item) => item.runId === run.runId);
  }

  /** 終了済みの作業区間を1件足す。 */
  function seedClosedInterval(index = 0) {
    return addIntervalManually(deps, target(index), {
      type: INTERVAL_TYPE.WORK,
      startAt: '2026-08-01T09:00:00+09:00',
      endAt: '2026-08-01T10:00:00+09:00',
      participants: ['甲'],
    });
  }

  /** 集計済みまで進める。 */
  async function toAggregated() {
    await seedClosedInterval();
    await markAggregated(deps, run.runId);
  }

  /** 転記済みまで進める。 */
  async function toTransferred() {
    await toAggregated();
    await markTransferred(deps, run.runId);
  }

  describe('集計済みにする（仕様書7.1、8.9.6、A-08）', () => {
    it('未終了区間が無ければ進める', async () => {
      await seedClosedInterval();

      await markAggregated(deps, run.runId);

      expect((await reloadRun()).status).toBe(RUN_STATUS.AGGREGATED);
    });

    it('作業項目が1件も記録されていなくても進める', async () => {
      // 未終了区間が無いことだけが条件である（仕様書8.9.6）。
      await markAggregated(deps, run.runId);

      expect((await reloadRun()).status).toBe(RUN_STATUS.AGGREGATED);
    });

    it('未終了区間があると進めない（A-08）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });

      await expect(markAggregated(deps, run.runId)).rejects.toBeInstanceOf(ValidationError);
      expect((await reloadRun()).status).toBe(RUN_STATUS.WORKING);
    });

    it('拒む理由に未終了の件数を入れる', async () => {
      await recordStart(deps, target(0), { participants: ['甲'] });
      await recordStart(deps, target(1), { participants: ['乙'] });

      const error = await markAggregated(deps, run.runId).catch((caught) => caught);

      expect(error.message).toContain('2 件');
    });

    it('別の作業項目に未終了があっても止める', async () => {
      await seedClosedInterval(0);
      await recordStart(deps, target(1), { participants: ['乙'] });

      await expect(markAggregated(deps, run.runId)).rejects.toBeInstanceOf(ValidationError);
    });

    it('変更履歴は残さない（仕様書11章の対象外）', async () => {
      await toAggregated();

      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('集計済みでは記録を続けられる（閲覧のみではない、仕様書7.2）', async () => {
      await toAggregated();

      await expect(seedClosedInterval(1)).resolves.toBeDefined();
    });
  });

  describe('作業中へ戻す（仕様書7.1）', () => {
    it('集計済みから戻せる', async () => {
      await toAggregated();

      await reopenRun(deps, run.runId);

      expect((await reloadRun()).status).toBe(RUN_STATUS.WORKING);
    });

    it('変更履歴は残さない（外部へ渡す前の状態のため）', async () => {
      await toAggregated();

      await reopenRun(deps, run.runId);

      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('転記済みからは直接戻せない', async () => {
      await toTransferred();

      await expect(reopenRun(deps, run.runId)).rejects.toBeInstanceOf(ValidationError);
      expect((await reloadRun()).status).toBe(RUN_STATUS.TRANSFERRED);
    });
  });

  describe('転記済みにする（仕様書7.1、8.7.6）', () => {
    it('集計済みから進める', async () => {
      await toAggregated();

      await markTransferred(deps, run.runId);

      const saved = await reloadRun();
      expect(saved.status).toBe(RUN_STATUS.TRANSFERRED);
      expect(saved.transferredAt).toBe(NOW_ISO);
    });

    it('作業中からは直接進めない', async () => {
      await seedClosedInterval();

      await expect(markTransferred(deps, run.runId)).rejects.toBeInstanceOf(ValidationError);
      expect((await reloadRun()).status).toBe(RUN_STATUS.WORKING);
    });

    it('転記済みでは記録を書き換えられない（仕様書7.2）', async () => {
      await toTransferred();

      await expect(seedClosedInterval(1)).rejects.toThrow();
    });
  });

  describe('転記済みから戻す（仕様書7.1、11章）', () => {
    it('理由を添えると戻せ、履歴が1件残る', async () => {
      await toTransferred();

      const { historyEntry } = await revertTransfer(deps, run.runId, {
        reason: '転記先の数値を誤っていたため',
      });

      expect((await reloadRun()).status).toBe(RUN_STATUS.AGGREGATED);
      const { changeHistory } = await adapter.loadAll();
      expect(changeHistory).toHaveLength(1);
      expect(changeHistory[0]).toMatchObject({
        historyId: historyEntry.historyId,
        entityType: HISTORY_ENTITY.WORK_RUN,
        operation: HISTORY_OP.STATUS_REVERTED,
        targetId: run.runId,
        reason: '転記先の数値を誤っていたため',
        timestamp: NOW_ISO,
      });
    });

    it('要約に実施回と遷移の向きを入れる', async () => {
      await toTransferred();

      const { historyEntry } = await revertTransfer(deps, run.runId, { reason: '誤り' });

      expect(historyEntry.summary).toContain('2026-08-01');
      expect(historyEntry.summary).toContain('転記済み');
      expect(historyEntry.summary).toContain('集計済み');
    });

    it('転記完了日時を消す', async () => {
      await toTransferred();

      await revertTransfer(deps, run.runId, { reason: '誤り' });

      expect((await reloadRun()).transferredAt).toBeNull();
    });

    it('理由が無ければ状態も履歴も変えない（仕様書11章）', async () => {
      await toTransferred();

      await expect(
        revertTransfer(deps, run.runId, { reason: '  ' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await reloadRun()).status).toBe(RUN_STATUS.TRANSFERRED);
      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('未終了区間があっても戻せる', async () => {
      // 戻した後で記録を直すための操作である。既に集計済みだった記録であり、
      // 戻すこと自体を未終了区間の有無で拒む理由が無い。
      await toTransferred();

      await expect(
        revertTransfer(deps, run.runId, { reason: '誤り' }),
      ).resolves.toBeDefined();
    });

    it('戻した後は再び記録できる（仕様書7.2）', async () => {
      await toTransferred();
      await revertTransfer(deps, run.runId, { reason: '誤り' });

      await expect(seedClosedInterval(1)).resolves.toBeDefined();
    });

    it('履歴はエクスポートJSONの検証を通る形で残る（仕様書9.2）', async () => {
      await toTransferred();
      await revertTransfer(deps, run.runId, { reason: '誤り' });

      const { workRuns, changeHistory, projectGroups, taskTemplates } = await adapter.loadAll();
      const result = validateImportPayload({
        schemaVersion: SCHEMA_VERSION,
        exportedAt: NOW_ISO,
        settings: createDefaultSettings(),
        taskTemplates,
        projectGroups,
        workRuns,
        changeHistory,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('見つからない実施回', () => {
    it.each([
      ['markAggregated', (id) => markAggregated(deps, id)],
      ['reopenRun', (id) => reopenRun(deps, id)],
      ['markTransferred', (id) => markTransferred(deps, id)],
      ['revertTransfer', (id) => revertTransfer(deps, id, { reason: '誤り' })],
    ])('%s は拒否する', async (_name, call) => {
      await expect(call('missing')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('previewStatusChange()（画面のボタン制御）', () => {
    it('進める場合は ok を返す', async () => {
      await seedClosedInterval();
      const saved = await reloadRun();

      expect(previewStatusChange(saved, RUN_STATUS.AGGREGATED)).toEqual({
        ok: true,
        reason: null,
      });
    });

    it('未終了区間があれば理由を返す（仕様書8.9.6）', async () => {
      await recordStart(deps, target(), { participants: ['甲'] });
      const saved = await reloadRun();

      const result = previewStatusChange(saved, RUN_STATUS.AGGREGATED);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('未終了');
    });

    it('遷移そのものが許されない場合は別の理由を返す（仕様書7.1）', async () => {
      const saved = await reloadRun();

      const result = previewStatusChange(saved, RUN_STATUS.TRANSFERRED);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('変更できない');
    });
  });
});
