/**
 * アーカイブと完全削除の結合テスト（仕様書10章、11章）。
 *
 * 受入条件 A-10（転記済み→アーカイブ→保持期間経過で削除候補）に対応する。
 *
 * 削除は「レコードと履歴の片方だけが残らない」ことを中心に確かめる。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDirectEntry } from '../../src/app/actions/directEntryActions.js';
import { addIntervalManually } from '../../src/app/actions/intervalActions.js';
import { createProjectGroup, createWorkRun } from '../../src/app/actions/projectActions.js';
import {
  archiveRun,
  deleteProjectGroup,
  deleteRun,
  summarizeArchive,
} from '../../src/app/actions/retentionActions.js';
import { createTemplate } from '../../src/app/actions/templateActions.js';
import { markAggregated, markTransferred } from '../../src/app/actions/transferActions.js';
import { ValidationError } from '../../src/app/errors.js';
import { createPersistence } from '../../src/app/persistence.js';
import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';
import { toIsoSecond } from '../../src/domain/datetime.js';
import { INTERVAL_TYPE } from '../../src/domain/effort.js';
import { HISTORY_ENTITY, HISTORY_OP } from '../../src/domain/history.js';
import { validateImport } from '../../src/domain/integrity.js';
import { RUN_STATUS } from '../../src/domain/schema.js';
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

describe('retentionActions', () => {
  /** @type {MemoryAdapter} */
  let adapter;
  /** @type {object} */
  let deps;
  /** @type {object} */
  let group;
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
      tasks: [{ name: '受入確認', externalCode: 'X-100', order: 1, active: true }],
    });
    const created = await createProjectGroup(deps, {
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
      totalQuantity: 100,
    });
    group = created.projectGroup;
    run = (
      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 50,
      })
    ).workRun;
  });

  /** 保存済みの実施回を読み直す。 */
  async function reloadRun(runId = run.runId) {
    const { workRuns } = await adapter.loadAll();
    return workRuns.find((item) => item.runId === runId) ?? null;
  }

  /** 記録を1件入れて転記済みまで進める。 */
  async function toTransferred(target = run) {
    await addIntervalManually(
      deps,
      { runId: target.runId, taskRecordId: target.tasks[0].taskRecordId },
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      },
    );
    await markAggregated(deps, target.runId);
    await markTransferred(deps, target.runId);
  }

  /** アーカイブまで進める。 */
  async function toArchived(target = run) {
    await toTransferred(target);
    await archiveRun(deps, target.runId);
  }

  /**
   * 削除候補まで進める。
   *
   * 完全削除の事前条件は削除候補であることなので（仕様書7.1）、削除の試験は
   * ここから始める。時間を進める代わりにアーカイブ日時を過去へ書き換える。
   * 保持期間30日、現在 2026-08-01 に対して 2026-06-01 は経過済みである。
   */
  async function toDeletable(target = run) {
    await toArchived(target);
    const saved = await reloadRun(target.runId);
    await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, {
      ...saved,
      archivedAt: '2026-06-01T10:00:00+09:00',
    });
  }

  describe('アーカイブへ移す（仕様書10.1）', () => {
    it('転記済みから移せて、アーカイブ日時を記録する', async () => {
      await toTransferred();

      await archiveRun(deps, run.runId);

      const saved = await reloadRun();
      expect(saved.status).toBe(RUN_STATUS.ARCHIVED);
      expect(saved.archivedAt).toBe(NOW_ISO);
    });

    it('転記完了日時は消さない（仕様書10.1）', async () => {
      await toTransferred();
      const transferredAt = (await reloadRun()).transferredAt;

      await archiveRun(deps, run.runId);

      expect((await reloadRun()).transferredAt).toBe(transferredAt);
    });

    it.each([RUN_STATUS.WORKING, RUN_STATUS.AGGREGATED])(
      '%s からは移せない（仕様書7.1）',
      async (status) => {
        if (status === RUN_STATUS.AGGREGATED) {
          await markAggregated(deps, run.runId);
        }

        await expect(archiveRun(deps, run.runId)).rejects.toBeInstanceOf(ValidationError);
        expect((await reloadRun()).status).toBe(status);
      },
    );

    it('変更履歴は残さない（仕様書11章の対象外）', async () => {
      await toArchived();

      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('アーカイブ済みでは記録を書き換えられない（仕様書7.2）', async () => {
      await toArchived();

      await expect(
        createDirectEntry(
          deps,
          { runId: run.runId, taskRecordId: run.tasks[0].taskRecordId },
          { seconds: 60, participants: ['甲'], note: '追加できないはず' },
        ),
      ).rejects.toThrow();
    });

    it('見つからない実施回は拒否する', async () => {
      await expect(archiveRun(deps, 'missing')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('実施回の完全削除（仕様書10.4、11章）', () => {
    it('レコードを消し、履歴を1件残す', async () => {
      await toDeletable();

      const { historyEntry } = await deleteRun(deps, run.runId, {
        reason: '誤って作成した実施回のため',
      });

      expect(await reloadRun()).toBeNull();
      const { changeHistory } = await adapter.loadAll();
      expect(changeHistory).toHaveLength(1);
      expect(changeHistory[0]).toMatchObject({
        historyId: historyEntry.historyId,
        entityType: HISTORY_ENTITY.WORK_RUN,
        operation: HISTORY_OP.WORK_RUN_DELETED,
        targetId: run.runId,
        reason: '誤って作成した実施回のため',
        timestamp: NOW_ISO,
      });
    });

    it('要約に案件IDと消えた規模を残す', async () => {
      await toDeletable();

      const { historyEntry } = await deleteRun(deps, run.runId, { reason: '誤り' });

      expect(historyEntry.summary).toContain('PJ-0001');
      expect(historyEntry.summary).toContain('2026-08-01');
      expect(historyEntry.summary).toContain('区間 1件');
    });

    it('アーカイブ済みでなければ削除できない', async () => {
      await toTransferred();

      await expect(
        deleteRun(deps, run.runId, { reason: '誤り' }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await reloadRun()).not.toBeNull();
    });

    it('理由が無ければレコードも履歴も変えない（仕様書11章）', async () => {
      await toDeletable();

      await expect(
        deleteRun(deps, run.runId, { reason: '  ' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(await reloadRun()).not.toBeNull();
      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    describe('削除候補であることを要求する（仕様書7.1、過去のレビュー指摘）', () => {
      it('保持期間内は削除できない', async () => {
        // 仕様書7.1 の遷移表は アーカイブ → 削除候補 → 完全削除 であり、
        // アーカイブ済みから直接消す辺は無い。
        await toArchived();

        const error = await deleteRun(deps, run.runId, { reason: '誤り' }).catch((caught) => caught);

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain('保持期間');
        expect(await reloadRun()).not.toBeNull();
      });

      it('拒否したときは履歴も残さない', async () => {
        await toArchived();

        await deleteRun(deps, run.runId, { reason: '誤り' }).catch(() => {});

        expect((await adapter.loadAll()).changeHistory).toEqual([]);
      });

      it('保持期間の設定を短くすれば削除できる（仕様書10.2）', async () => {
        // 誤って作った実施回をすぐ消したい場合の逃げ道は、仕様の枠内にある。
        await toArchived();
        await adapter.saveEntity(ENTITY_TYPE.SETTINGS, {
          ...createDefaultSettings(),
          retentionDays: 1,
        });
        const saved = await reloadRun();
        await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, {
          ...saved,
          archivedAt: '2026-07-20T10:00:00+09:00',
        });

        await expect(deleteRun(deps, run.runId, { reason: '誤り' })).resolves.toBeDefined();
      });
    });

    it('案件グループは残る', async () => {
      await toDeletable();

      await deleteRun(deps, run.runId, { reason: '誤り' });

      expect((await adapter.loadAll()).projectGroups).toHaveLength(1);
    });
  });

  describe('案件グループの完全削除（仕様書10.4、11章）', () => {
    it('配下の実施回ごと消し、履歴を1件だけ残す', async () => {
      await toDeletable();

      const { historyEntry, removedRuns } = await deleteProjectGroup(
        deps,
        group.projectGroupId,
        { reason: '案件が中止になったため' },
      );

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups).toEqual([]);
      expect(dataset.workRuns).toEqual([]);
      expect(removedRuns).toHaveLength(1);
      // 実施回1件ずつの履歴は残さない。利用者から見て1つの操作である。
      expect(dataset.changeHistory).toHaveLength(1);
      expect(dataset.changeHistory[0]).toMatchObject({
        historyId: historyEntry.historyId,
        entityType: HISTORY_ENTITY.PROJECT_GROUP,
        operation: HISTORY_OP.PROJECT_GROUP_DELETED,
        targetId: group.projectGroupId,
      });
    });

    it('要約に案件の内容と規模を残す', async () => {
      await toDeletable();

      const { historyEntry } = await deleteProjectGroup(deps, group.projectGroupId, {
        reason: '中止',
      });

      expect(historyEntry.summary).toContain('PJ-0001');
      expect(historyEntry.summary).toContain('対象種別A');
      expect(historyEntry.summary).toContain('実施回 1件');
      expect(historyEntry.summary).toContain('累計数量 50');
    });

    it('アーカイブ済みでない実施回があれば拒否する', async () => {
      await toTransferred();

      const error = await deleteProjectGroup(deps, group.projectGroupId, {
        reason: '中止',
      }).catch((caught) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('1 件');
      expect((await adapter.loadAll()).projectGroups).toHaveLength(1);
    });

    it('実施回が1件も無い案件は削除できる', async () => {
      const empty = (
        await createProjectGroup(deps, {
          projectId: 'PJ-0002',
          targetType: '対象種別A',
          variant: '標準',
          totalQuantity: 10,
        })
      ).projectGroup;

      await deleteProjectGroup(deps, empty.projectGroupId, { reason: '誤登録' });

      const { projectGroups } = await adapter.loadAll();
      expect(projectGroups.map((item) => item.projectId)).toEqual(['PJ-0001']);
    });

    it('保持期間内の実施回があれば拒否する（過去のレビュー指摘）', async () => {
      // 1件ずつ消せない記録を、案件ごとならまとめて消せる抜け道を作らない。
      await toArchived();

      const error = await deleteProjectGroup(deps, group.projectGroupId, {
        reason: '中止',
      }).catch((caught) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('保持期間が残っている実施回が 1 件');
      expect((await adapter.loadAll()).projectGroups).toHaveLength(1);
    });

    it('理由が無ければ何も変えない', async () => {
      await toDeletable();

      await expect(
        deleteProjectGroup(deps, group.projectGroupId, { reason: '' }),
      ).rejects.toBeInstanceOf(ValidationError);

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups).toHaveLength(1);
      expect(dataset.workRuns).toHaveLength(1);
      expect(dataset.changeHistory).toEqual([]);
    });

    it('他の案件には影響しない', async () => {
      await toDeletable();
      const other = (
        await createProjectGroup(deps, {
          projectId: 'PJ-0002',
          targetType: '対象種別A',
          variant: '標準',
          totalQuantity: 10,
        })
      ).projectGroup;
      const otherRun = (
        await createWorkRun(deps, other.projectGroupId, {
          workDate: '2026-08-02',
          runQuantity: 5,
        })
      ).workRun;

      await deleteProjectGroup(deps, group.projectGroupId, { reason: '中止' });

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups.map((item) => item.projectId)).toEqual(['PJ-0002']);
      expect(dataset.workRuns.map((item) => item.runId)).toEqual([otherRun.runId]);
    });

    it('削除後のデータは取り込み検証を通る（親を失った実施回が残らない）', async () => {
      await toDeletable();

      await deleteProjectGroup(deps, group.projectGroupId, { reason: '中止' });

      const { workRuns, projectGroups, taskTemplates, changeHistory } = await adapter.loadAll();
      const result = validateImport({
        schemaVersion: SCHEMA_VERSION,
        exportedAt: NOW_ISO,
        settings: createDefaultSettings(),
        taskTemplates,
        projectGroups,
        workRuns,
        changeHistory,
      });

      expect(result.errors).toEqual([]);
    });
  });

  describe('summarizeArchive()（仕様書10.3、A-10）', () => {
    /** アーカイブ日時を直接書き換える（時間を進める代わり）。 */
    async function setArchivedAt(iso) {
      const saved = await reloadRun();
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, { ...saved, archivedAt: iso });
    }

    it('アーカイブ済みだけを対象にする', async () => {
      await toArchived();
      const dataset = await adapter.loadAll();

      const result = summarizeArchive(dataset, { now: NOW_ISO });

      expect(result.archived).toHaveLength(1);
      expect(result.retentionDays).toBe(30);
    });

    it('保持期間内は保持中に入る', async () => {
      await toArchived();
      const dataset = await adapter.loadAll();

      const result = summarizeArchive(dataset, { now: NOW_ISO });

      expect(result.deletable).toEqual([]);
      expect(result.keeping).toHaveLength(1);
    });

    it('保持期間を過ぎると削除候補に入る（A-10）', async () => {
      await toArchived();
      await setArchivedAt('2026-06-01T10:00:00+09:00');
      const dataset = await adapter.loadAll();

      const result = summarizeArchive(dataset, { now: NOW_ISO });

      expect(result.deletable).toHaveLength(1);
      expect(result.keeping).toEqual([]);
    });

    it('保持期間の設定を短くすると候補が増える（仕様書10.2）', async () => {
      await toArchived();
      const dataset = await adapter.loadAll();
      dataset.settings = { ...dataset.settings, retentionDays: 1 };

      const result = summarizeArchive(dataset, { now: '2026-08-03T01:00:00Z' });

      expect(result.deletable).toHaveLength(1);
      expect(result.retentionDays).toBe(1);
    });

    it('範囲外の保持期間が保存されていても既定値で動く（過去のレビュー指摘）', async () => {
      // 保存の入口は弾くが、読み取りは画面が開けなくなるより既定値で動く方がよい。
      await toArchived();
      const dataset = await adapter.loadAll();
      dataset.settings = { ...dataset.settings, retentionDays: 1e20 };

      const result = summarizeArchive(dataset, { now: NOW_ISO });

      expect(result.retentionDays).toBe(30);
      expect(result.archived).toHaveLength(1);
    });

    it('アーカイブしていなければ何も出ない', async () => {
      await toTransferred();
      const dataset = await adapter.loadAll();

      expect(summarizeArchive(dataset, { now: NOW_ISO }).archived).toEqual([]);
    });

    describe('案件の束ね（過去のレビュー指摘）', () => {
      /** 実施回を持たない案件を作る。 */
      async function createEmptyGroup(projectId = 'PJ-0002') {
        return (
          await createProjectGroup(deps, {
            projectId,
            targetType: '対象種別A',
            variant: '標準',
            totalQuantity: 10,
          })
        ).projectGroup;
      }

      it('アーカイブ済みを持つ案件を出す', async () => {
        await toArchived();
        const dataset = await adapter.loadAll();

        const result = summarizeArchive(dataset, { now: NOW_ISO });

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0].group.projectId).toBe('PJ-0001');
        expect(result.groups[0].runs).toHaveLength(1);
      });

      it('実施回が0件の案件も出す', async () => {
        // ここが案件削除を呼べる唯一の画面なので、出さないと通常操作では
        // 二度と消せなくなる。
        await createEmptyGroup();
        const dataset = await adapter.loadAll();

        const result = summarizeArchive(dataset, { now: NOW_ISO });

        expect(result.groups.map((entry) => entry.group.projectId)).toEqual(['PJ-0002']);
        expect(result.groups[0].runs).toEqual([]);
        expect(result.groups[0].deletion.ok).toBe(true);
      });

      it('最後の実施回を消した案件が残り続けない', async () => {
        await toDeletable();
        await deleteRun(deps, run.runId, { reason: '誤り' });
        const dataset = await adapter.loadAll();

        const result = summarizeArchive(dataset, { now: NOW_ISO });

        expect(result.groups.map((entry) => entry.group.projectId)).toEqual(['PJ-0001']);
        expect(result.groups[0].deletion.ok).toBe(true);
      });

      it('運用中の実施回だけを持つ案件は出さない', async () => {
        await toTransferred();
        const dataset = await adapter.loadAll();

        expect(summarizeArchive(dataset, { now: NOW_ISO }).groups).toEqual([]);
      });

      it('削除できない案件には理由を添える', async () => {
        await toArchived();
        const dataset = await adapter.loadAll();

        const result = summarizeArchive(dataset, { now: NOW_ISO });

        expect(result.groups[0].deletion.ok).toBe(false);
        expect(result.groups[0].deletion.reason).toContain('保持期間');
      });

      it('番号は案件の全実施回を通して振る（過去のレビュー指摘）', async () => {
        const second = (
          await createWorkRun(deps, group.projectGroupId, {
            workDate: '2026-08-02',
            runQuantity: 10,
          })
        ).workRun;
        await toArchived(second);
        const dataset = await adapter.loadAll();

        const result = summarizeArchive(dataset, { now: NOW_ISO });

        // 第1回は作業中のまま。アーカイブ済みだけで数えると「第1回」になる。
        expect(result.groups[0].runs).toHaveLength(1);
        expect(result.groups[0].runs[0].number).toBe(2);
      });
    });
  });
});
