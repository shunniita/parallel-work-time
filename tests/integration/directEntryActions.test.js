/**
 * 工数直接入力の追加・編集・削除の結合テスト（仕様書8.5、8.9.8、7.2、11章）。
 *
 * 受入条件 A-06（作業40分＋直接入力20分＝転記値60分）に対応する。
 *
 * 削除と変更履歴（仕様書11章）は「片方だけが残らない」ことを中心に確かめる。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDirectEntry,
  deleteDirectEntry,
  previewDirectEntryDeletion,
  updateDirectEntry,
} from '../../src/app/actions/directEntryActions.js';
import { addIntervalManually } from '../../src/app/actions/intervalActions.js';
import { createProjectGroup, createWorkRun } from '../../src/app/actions/projectActions.js';
import { createTemplate } from '../../src/app/actions/templateActions.js';
import { RunNotEditableError, ValidationError } from '../../src/app/errors.js';
import { createPersistence } from '../../src/app/persistence.js';
import { addSeconds, toIsoSecond } from '../../src/domain/datetime.js';
import { DIRECT_ENTRY_WARNING } from '../../src/domain/directEntryOps.js';
import { INTERVAL_TYPE, summarizeTask } from '../../src/domain/effort.js';
import { HISTORY_ENTITY, HISTORY_OP } from '../../src/domain/history.js';
import { collectParticipants } from '../../src/domain/participants.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import { TASK_STATE, taskState } from '../../src/domain/taskState.js';
import {
  MAX_EFFORT_SECONDS,
  MAX_PARTICIPANTS,
  SCHEMA_VERSION,
  createDefaultSettings,
} from '../../src/config.js';
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

describe('directEntryActions', () => {
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

  /** 保存済みの作業項目実績を読み直す。 */
  async function reloadTask(index = 0) {
    const { workRuns } = await adapter.loadAll();
    const saved = workRuns.find((item) => item.runId === run.runId);
    return saved.tasks[index];
  }

  /** 実施回の状態を直接書き換える（状態遷移の操作は Step 10）。 */
  async function setRunStatus(status) {
    const { workRuns } = await adapter.loadAll();
    const saved = workRuns.find((item) => item.runId === run.runId);
    await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, { ...saved, status });
  }

  /** 検証を通る直接入力を1件足す。 */
  async function seedEntry(overrides = {}) {
    await createDirectEntry(deps, target(), {
      seconds: 1200,
      participants: ['甲'],
      note: '計測漏れ分を追加',
      ...overrides,
    });
    const task = await reloadTask();
    return task.directEntries[task.directEntries.length - 1];
  }

  it('別作業項目との合計で実施回上限を超える追加は保存しない（F12-36）', async () => {
    const { workRuns } = await adapter.loadAll();
    const saved = workRuns.find((item) => item.runId === run.runId);
    const participants = Array.from(
      { length: MAX_PARTICIPANTS },
      (_, index) => `参加者${index}`,
    );
    const startAt = '2000-01-01T00:00:00+00:00';
    const atLimit = {
      intervalId: 'at-run-limit',
      type: INTERVAL_TYPE.WORK,
      startAt,
      endAt: addSeconds(startAt, MAX_EFFORT_SECONDS / MAX_PARTICIPANTS),
      participants,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };
    await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, {
      ...saved,
      tasks: saved.tasks.map((task, index) =>
        index === 0 ? { ...task, intervals: [atLimit] } : task,
      ),
    });
    const save = vi.spyOn(adapter, 'saveEntity');

    await expect(
      createDirectEntry(deps, target(1), {
        seconds: 1,
        participants: [],
        note: '上限超過の反例',
      }),
    ).rejects.toThrow(/実施回.*合計工数が上限/);

    expect(save).not.toHaveBeenCalled();
    expect((await reloadTask(1)).directEntries).toEqual([]);
  });

  describe('追加（仕様書8.5.1〜8.5.4）', () => {
    it('直接入力を1件保存する', async () => {
      await createDirectEntry(deps, target(), {
        seconds: 1200,
        participants: ['甲'],
        note: '移動時間',
      });

      const task = await reloadTask();
      expect(task.directEntries).toHaveLength(1);
      expect(task.directEntries[0]).toMatchObject({
        seconds: 1200,
        participants: ['甲'],
        note: '移動時間',
        createdAt: NOW_ISO,
      });
    });

    it('備考が無ければ保存しない（仕様書8.5.4）', async () => {
      await expect(
        createDirectEntry(deps, target(), { seconds: 1200, participants: ['甲'], note: '' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await reloadTask()).directEntries).toEqual([]);
    });

    it('負の値は保存しない（仕様書8.5.5）', async () => {
      await expect(
        createDirectEntry(deps, target(), { seconds: -1, participants: ['甲'], note: '誤り' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await reloadTask()).directEntries).toEqual([]);
    });

    it('他の作業項目の内容は変えない', async () => {
      const before = run.tasks[1];

      await seedEntry();

      expect(await reloadTask(1)).toEqual(before);
    });

    it('作業項目の状態を問わず足せる（仕様書12.4）', async () => {
      // 未着手のまま直接入力だけを記録できる。計測し損ねた分を後から入れる
      // 操作であり、いま作業中かどうかとは関わりがない。
      expect(taskState(await reloadTask())).toBe(TASK_STATE.NOT_STARTED);

      await seedEntry();

      expect(taskState(await reloadTask())).toBe(TASK_STATE.NOT_STARTED);
      expect((await reloadTask()).directEntries).toHaveLength(1);
    });
  });

  describe('工数計算（仕様書8.5.6、8.6.6、A-06）', () => {
    it('作業40分＋直接入力20分で転記値60分になる', async () => {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T09:40:00+09:00',
        participants: ['甲'],
      });

      await createDirectEntry(deps, target(), {
        seconds: 1200,
        participants: ['甲'],
        note: '計測漏れ分を追加',
      });

      const summary = summarizeTask(await reloadTask());
      expect(summary.timeSeconds).toBe(2400);
      expect(summary.directSeconds).toBe(1200);
      expect(summary.transferMinutes).toBe(60);
    });

    it('参加者数を掛けない（仕様書8.5.6）', async () => {
      // 3人を添えても 1200 秒のまま。`seconds` は既に人数を含んだ総工数である。
      await createDirectEntry(deps, target(), {
        seconds: 1200,
        participants: ['甲', '乙', '丙'],
        note: '3人での計測漏れ分',
      });

      expect(summarizeTask(await reloadTask()).directSeconds).toBe(1200);
    });

    it('未終了区間があっても直接入力は確定分の小計に入る（仕様書8.6.5）', async () => {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T09:40:00+09:00',
        participants: ['甲'],
      });
      await seedEntry();
      // 未終了区間を1つ作る。
      const task = await reloadTask();
      const { workRuns } = await adapter.loadAll();
      const saved = workRuns.find((item) => item.runId === run.runId);
      saved.tasks[0].intervals.push({
        intervalId: 'open-1',
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T10:00:00+09:00',
        endAt: null,
        participants: ['甲'],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      });
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, saved);

      const summary = summarizeTask(await reloadTask());
      expect(summary.confirmed).toBe(false);
      expect(summary.transferMinutes).toBeNull();
      expect(summary.totalSeconds).toBe(2400 + task.directEntries[0].seconds);
    });
  });

  describe('重複候補の警告（仕様書8.9.8）', () => {
    it('同じ参加者・同じ秒数を足すと警告を返すが保存する', async () => {
      await seedEntry();

      const { warnings } = await createDirectEntry(deps, target(), {
        seconds: 1200,
        participants: ['甲'],
        note: '別の理由',
      });

      expect(warnings[0].code).toBe(DIRECT_ENTRY_WARNING.DUPLICATE_CANDIDATE);
      expect((await reloadTask()).directEntries).toHaveLength(2);
    });

    it('別の作業項目の直接入力は重複候補にしない', async () => {
      // 判定は「同一作業項目」の中だけで行う（仕様書8.9.8）。
      await seedEntry();

      const { warnings } = await createDirectEntry(deps, target(1), {
        seconds: 1200,
        participants: ['甲'],
        note: '別項目の計測漏れ',
      });

      expect(warnings).toEqual([]);
    });

    it('重複しなければ警告しない', async () => {
      await seedEntry();

      const { warnings } = await createDirectEntry(deps, target(), {
        seconds: 600,
        participants: ['甲'],
        note: '別の計測漏れ',
      });

      expect(warnings).toEqual([]);
    });
  });

  describe('編集（仕様書8.5）', () => {
    it('渡した項目だけを差し替える', async () => {
      const entry = await seedEntry();

      await updateDirectEntry(deps, target(), entry.entryId, { seconds: 600 });

      const [saved] = (await reloadTask()).directEntries;
      expect(saved).toMatchObject({
        entryId: entry.entryId,
        seconds: 600,
        participants: ['甲'],
        note: '計測漏れ分を追加',
        createdAt: entry.createdAt,
        updatedAt: NOW_ISO,
      });
    });

    it('検証に通らない変更は保存しない', async () => {
      const entry = await seedEntry();

      await expect(
        updateDirectEntry(deps, target(), entry.entryId, { note: '   ' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await reloadTask()).directEntries[0].seconds).toBe(1200);
    });

    it('見つからないIDは拒否する', async () => {
      await expect(
        updateDirectEntry(deps, target(), 'missing', { seconds: 60 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('削除と変更履歴（仕様書11章）', () => {
    it('直接入力を消し、履歴を1件残す', async () => {
      const entry = await seedEntry();

      const { historyEntry } = await deleteDirectEntry(deps, target(), entry.entryId, {
        reason: '二重に記録していたため',
      });

      expect((await reloadTask()).directEntries).toEqual([]);
      const { changeHistory } = await adapter.loadAll();
      expect(changeHistory).toHaveLength(1);
      expect(changeHistory[0]).toMatchObject({
        historyId: historyEntry.historyId,
        entityType: HISTORY_ENTITY.DIRECT_ENTRY,
        operation: HISTORY_OP.DIRECT_ENTRY_DELETED,
        targetId: entry.entryId,
        reason: '二重に記録していたため',
        timestamp: NOW_ISO,
      });
    });

    it('履歴の要約に実施回・作業項目・内容が入る', async () => {
      const entry = await seedEntry();

      const { historyEntry } = await deleteDirectEntry(deps, target(), entry.entryId, {
        reason: '誤入力',
      });

      expect(historyEntry.summary).toContain('2026-08-01');
      expect(historyEntry.summary).toContain('受入確認');
      expect(historyEntry.summary).toContain('20分0秒');
      expect(historyEntry.summary).toContain('計測漏れ分を追加');
    });

    it('理由が無ければ削除も履歴も行わない（仕様書11章）', async () => {
      const entry = await seedEntry();

      await expect(
        deleteDirectEntry(deps, target(), entry.entryId, { reason: '  ' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await reloadTask()).directEntries).toHaveLength(1);
      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('見つからないIDでは履歴も残らない', async () => {
      await expect(
        deleteDirectEntry(deps, target(), 'missing', { reason: '誤入力' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('削除しても工数の合計から確かに減る', async () => {
      const entry = await seedEntry();
      expect(summarizeTask(await reloadTask()).directSeconds).toBe(1200);

      await deleteDirectEntry(deps, target(), entry.entryId, { reason: '誤入力' });

      expect(summarizeTask(await reloadTask()).directSeconds).toBe(0);
    });

    it('履歴はエクスポートJSONの検証を通る形で残る（仕様書9.2）', async () => {
      const entry = await seedEntry();
      await deleteDirectEntry(deps, target(), entry.entryId, { reason: '誤入力' });

      const { workRuns, changeHistory, projectGroups, taskTemplates } =
        await adapter.loadAll();
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

    describe('previewDirectEntryDeletion（削除前の確認）', () => {
      it('対象の内容を確認できる', async () => {
        const entry = await seedEntry();
        const { workRuns } = await adapter.loadAll();

        const preview = previewDirectEntryDeletion(workRuns, target(), entry.entryId);

        expect(preview.ok).toBe(true);
        expect(preview.deletable).toBe(true);
        expect(preview.entry.entryId).toBe(entry.entryId);
        expect(preview.description).toContain('20分0秒');
        expect(preview.description).toContain('甲');
        expect(preview.description).toContain('計測漏れ分を追加');
        expect(preview.taskRecord.name).toBe('受入確認');
      });

      it('確認に出す説明が履歴の要約と一致する', async () => {
        const entry = await seedEntry();
        const { workRuns } = await adapter.loadAll();
        const preview = previewDirectEntryDeletion(workRuns, target(), entry.entryId);

        const { historyEntry } = await deleteDirectEntry(deps, target(), entry.entryId, {
          reason: '誤入力',
        });

        expect(historyEntry.summary).toBe(preview.summary);
      });

      it('転記済みでは削除できない旨を返す（仕様書7.2）', async () => {
        const entry = await seedEntry();
        await setRunStatus('transferred');
        const { workRuns } = await adapter.loadAll();

        const preview = previewDirectEntryDeletion(workRuns, target(), entry.entryId);

        expect(preview.ok).toBe(true);
        expect(preview.deletable).toBe(false);
        expect(preview.blockedReason).toContain('転記済み');
      });

      it('見つからない対象は理由つきで返す', async () => {
        const { workRuns } = await adapter.loadAll();

        expect(previewDirectEntryDeletion(workRuns, target(), 'missing')).toMatchObject({
          ok: false,
        });
        expect(
          previewDirectEntryDeletion(workRuns, { runId: 'missing', taskRecordId: 'x' }, 'y'),
        ).toMatchObject({ ok: false });
      });
    });
  });

  describe('状態ガード（仕様書7.2）', () => {
    /** 直接入力を書き換える操作をひととおり試す。 */
    function attemptAll(entryId) {
      return [
        createDirectEntry(deps, target(), {
          seconds: 60,
          participants: ['甲'],
          note: '追加できないはず',
        }),
        updateDirectEntry(deps, target(), entryId, { seconds: 60 }),
        deleteDirectEntry(deps, target(), entryId, { reason: '誤入力' }),
      ].map((promise) => promise.catch((error) => error));
    }

    it('転記済みではすべての操作を拒否する', async () => {
      const entry = await seedEntry();
      await setRunStatus('transferred');

      const results = await Promise.all(attemptAll(entry.entryId));

      for (const result of results) {
        expect(result).toBeInstanceOf(RunNotEditableError);
      }
      expect((await reloadTask()).directEntries).toHaveLength(1);
    });

    it('アーカイブ済みでも同様に拒否する', async () => {
      const entry = await seedEntry();
      await setRunStatus('archived');

      const results = await Promise.all(attemptAll(entry.entryId));

      for (const result of results) {
        expect(result).toBeInstanceOf(RunNotEditableError);
      }
    });

    it('転記済みの削除では履歴も残らない', async () => {
      const entry = await seedEntry();
      await setRunStatus('transferred');

      await expect(
        deleteDirectEntry(deps, target(), entry.entryId, { reason: '誤入力' }),
      ).rejects.toBeInstanceOf(RunNotEditableError);

      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('集計済みでは記録できる（閲覧のみではない）', async () => {
      const entry = await seedEntry();
      await setRunStatus('aggregated');

      await expect(
        deleteDirectEntry(deps, target(), entry.entryId, { reason: '誤入力' }),
      ).resolves.toBeDefined();
    });
  });

  describe('参加者候補（仕様書8.4.7）', () => {
    it('直接入力で使った参加者も候補に集まる', async () => {
      await createDirectEntry(deps, target(), {
        seconds: 1200,
        participants: ['丁'],
        note: '計測漏れ分',
      });

      const { workRuns } = await adapter.loadAll();
      expect(collectParticipants(workRuns, { runId: run.runId })).toContain('丁');
    });
  });

  describe('返り値', () => {
    it('保存後のデータセットと作業項目実績を返す', async () => {
      const { dataset, workRun, taskRecord, warnings } = await createDirectEntry(
        deps,
        target(),
        { seconds: 1200, participants: ['甲'], note: '計測漏れ分' },
      );

      expect(dataset.workRuns).toHaveLength(1);
      expect(workRun.updatedAt).toBe(NOW_ISO);
      expect(taskRecord.directEntries).toHaveLength(1);
      expect(warnings).toEqual([]);
    });
  });
});
