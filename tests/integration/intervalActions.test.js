/**
 * 作業区間の記録・修正・削除の結合テスト（仕様書8.4、8.9、7.2、11章）。
 *
 * 受入条件のうち A-03（開始・休憩・再開・終了）、A-04（参加者変更）、
 * A-16（複数項目の同時作業）、A-17（未終了区間は項目ごとに1つ）に対応する。
 *
 * 削除と変更履歴（仕様書11章）は「片方だけが残らない」ことを中心に確かめる。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addIntervalManually,
  deleteInterval,
  previewIntervalDeletion,
  recordBreak,
  recordFinish,
  recordParticipantChange,
  recordResume,
  recordStart,
  updateInterval,
} from '../../src/app/actions/intervalActions.js';
import { createProjectGroup, createWorkRun } from '../../src/app/actions/projectActions.js';
import { createTemplate } from '../../src/app/actions/templateActions.js';
import { markAggregated } from '../../src/app/actions/transferActions.js';
import {
  ResumeConfirmationRequiredError,
  RunNotEditableError,
  ValidationError,
} from '../../src/app/errors.js';
import { createPersistence } from '../../src/app/persistence.js';
import {
  MAX_EFFORT_SECONDS,
  MAX_PARTICIPANTS,
  SCHEMA_VERSION,
  createDefaultSettings,
} from '../../src/config.js';
import { addSeconds, toIsoSecond } from '../../src/domain/datetime.js';
import { INTERVAL_TYPE, summarizeTask } from '../../src/domain/effort.js';
import { INTERVAL_WARNING } from '../../src/domain/intervalOps.js';
import { collectParticipants } from '../../src/domain/participants.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import { TASK_STATE, taskState } from '../../src/domain/taskState.js';
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

describe('intervalActions', () => {
  /** @type {MemoryAdapter} */
  let adapter;
  /** @type {ReturnType<typeof createPersistence>} */
  let persistence;
  /** @type {object} */
  let deps;
  /** @type {object} */
  let run;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.initialize();
    persistence = createPersistence(adapter, { now: () => FIXED_NOW });
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

  it('別作業項目との合計で実施回上限を超える区間は保存しない（F12-36）', async () => {
    const { workRuns } = await adapter.loadAll();
    const saved = workRuns.find((item) => item.runId === run.runId);
    const participants = Array.from(
      { length: MAX_PARTICIPANTS },
      (_, index) => `参加者${index}`,
    );
    const startAt = '2000-01-01T00:00:00+00:00';
    await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, {
      ...saved,
      tasks: saved.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              intervals: [{
                intervalId: 'at-run-limit',
                type: INTERVAL_TYPE.WORK,
                startAt,
                endAt: addSeconds(startAt, MAX_EFFORT_SECONDS / MAX_PARTICIPANTS),
                participants,
                createdAt: NOW_ISO,
                updatedAt: NOW_ISO,
              }],
            }
          : task,
      ),
    });
    const save = vi.spyOn(adapter, 'saveEntity');

    await expect(
      addIntervalManually(deps, target(1), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T09:00:01+09:00',
        participants: ['甲'],
      }),
    ).rejects.toThrow(/実施回.*合計工数が上限/);

    expect(save).not.toHaveBeenCalled();
    expect((await reloadTask(1)).intervals).toEqual([]);
  });

  describe('開始・休憩・再開・終了（仕様書8.4.1、8.4.2、A-03）', () => {
    it('4操作を通すと作業・休憩・作業の3区間が残る', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲', '乙'],
      });
      await recordBreak(deps, target(), { at: '2026-08-01T12:00:00+09:00' });
      await recordResume(deps, target(), { at: '2026-08-01T13:00:00+09:00' });
      await recordFinish(deps, target(), { at: '2026-08-01T18:00:00+09:00' });

      const task = await reloadTask();
      expect(
        task.intervals.map((interval) => [interval.type, interval.startAt, interval.endAt]),
      ).toEqual([
        [INTERVAL_TYPE.WORK, '2026-08-01T09:00:00+09:00', '2026-08-01T12:00:00+09:00'],
        [INTERVAL_TYPE.BREAK, '2026-08-01T12:00:00+09:00', '2026-08-01T13:00:00+09:00'],
        [INTERVAL_TYPE.WORK, '2026-08-01T13:00:00+09:00', '2026-08-01T18:00:00+09:00'],
      ]);
      expect(taskState(task)).toBe(TASK_STATE.DONE);
    });

    it('工数は休憩を除いて人数を掛けた秒になる（仕様書8.6）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲', '乙'],
      });
      await recordBreak(deps, target(), { at: '2026-08-01T12:00:00+09:00' });
      await recordResume(deps, target(), { at: '2026-08-01T13:00:00+09:00' });
      await recordFinish(deps, target(), { at: '2026-08-01T18:00:00+09:00' });

      // (3時間 + 5時間) × 2人 = 16時間。
      expect(summarizeTask(await reloadTask())).toMatchObject({
        timeSeconds: 8 * 3600 * 2,
        confirmed: true,
        transferMinutes: 8 * 60 * 2,
      });
    });

    it('日時を省略すると現在日時を使う（仕様書8.4.3）', async () => {
      await recordStart(deps, target(), { participants: ['甲'] });

      const task = await reloadTask();
      expect(task.intervals[0].startAt).toBe(NOW_ISO);
    });

    it('休憩は直前の作業から参加者を引き継ぐ（仕様書8.9 補足）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲', '乙'],
      });
      await recordBreak(deps, target(), { at: '2026-08-01T12:00:00+09:00' });

      const task = await reloadTask();
      expect(task.intervals[1].participants).toEqual(['甲', '乙']);
    });

    it('作業中に開始を重ねられない（仕様書8.4 補足1、A-17）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });

      await expect(
        recordStart(deps, target(), {
          at: '2026-08-01T10:00:00+09:00',
          participants: ['乙'],
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await reloadTask()).intervals).toHaveLength(1);
    });

    it('参加者0人では開始できない（仕様書8.9.4）', async () => {
      await expect(
        recordStart(deps, target(), { at: '2026-08-01T09:00:00+09:00', participants: [] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('検証で拒否したときは保存を呼ばない', async () => {
      const spy = vi.spyOn(adapter, 'saveEntity');

      await expect(
        recordFinish(deps, target(), { at: '2026-08-01T18:00:00+09:00' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(spy).not.toHaveBeenCalled();
    });

    it('実施回・作業項目が見つからなければ拒否する', async () => {
      await expect(
        recordStart(deps, { runId: 'missing', taskRecordId: 'x' }, { participants: ['甲'] }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        recordStart(
          deps,
          { runId: run.runId, taskRecordId: 'missing' },
          { participants: ['甲'] },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('保存できる形になっている（インポート検証を通る）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });
      const { workRuns } = await adapter.loadAll();

      const result = validateImportPayload({
        schemaVersion: SCHEMA_VERSION,
        settings: createDefaultSettings(),
        taskTemplates: [],
        projectGroups: [],
        workRuns,
        changeHistory: [],
      });

      expect(result.errors).toEqual([]);
    });
  });

  describe('参加者変更（仕様書8.4.10、A-04）', () => {
    it('変更時刻で区間を分割する', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲', '乙', '丙'],
      });

      await recordParticipantChange(deps, target(), {
        at: '2026-08-01T09:20:00+09:00',
        participants: ['甲', '乙'],
      });

      const task = await reloadTask();
      expect(
        task.intervals.map((interval) => [
          interval.startAt,
          interval.endAt,
          interval.participants,
        ]),
      ).toEqual([
        ['2026-08-01T09:00:00+09:00', '2026-08-01T09:20:00+09:00', ['甲', '乙', '丙']],
        ['2026-08-01T09:20:00+09:00', null, ['甲', '乙']],
      ]);
    });

    it('休憩中の変更は休憩区間を継ぐ（仕様書8.4 補足2）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲', '乙'],
      });
      await recordBreak(deps, target(), { at: '2026-08-01T12:00:00+09:00' });

      await recordParticipantChange(deps, target(), {
        at: '2026-08-01T12:10:00+09:00',
        participants: ['甲'],
      });

      const task = await reloadTask();
      expect(task.intervals[2].type).toBe(INTERVAL_TYPE.BREAK);
      expect(taskState(task)).toBe(TASK_STATE.ON_BREAK);
    });

    it('分割しても未終了区間は1つのままである（A-17）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });
      await recordParticipantChange(deps, target(), {
        at: '2026-08-01T09:20:00+09:00',
        participants: ['甲', '乙'],
      });

      expect(summarizeTask(await reloadTask()).openCount).toBe(1);
    });
  });

  describe('複数の作業項目を同時に作業中にできる（仕様書8.4.9、A-16）', () => {
    it('2項目を同時に作業中にできる', async () => {
      await recordStart(deps, target(0), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });
      await recordStart(deps, target(1), {
        at: '2026-08-01T09:05:00+09:00',
        participants: ['乙'],
      });

      expect(taskState(await reloadTask(0))).toBe(TASK_STATE.WORKING);
      expect(taskState(await reloadTask(1))).toBe(TASK_STATE.WORKING);
    });

    it('同時に開始しても後勝ちで消えない（保存経路の直列化）', async () => {
      // どちらも同じ WorkRun を読み込んで書き戻す。直列化していないと、
      // 後に書いた方の内容だけが残り、もう一方の記録が消える。
      await Promise.all([
        recordStart(deps, target(0), {
          at: '2026-08-01T09:00:00+09:00',
          participants: ['甲'],
        }),
        recordStart(deps, target(1), {
          at: '2026-08-01T09:00:00+09:00',
          participants: ['乙'],
        }),
      ]);

      expect((await reloadTask(0)).intervals).toHaveLength(1);
      expect((await reloadTask(1)).intervals).toHaveLength(1);
    });

    it('片方を終了しても他方は作業中のままである', async () => {
      await recordStart(deps, target(0), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });
      await recordStart(deps, target(1), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['乙'],
      });

      await recordFinish(deps, target(0), { at: '2026-08-01T10:00:00+09:00' });

      expect(taskState(await reloadTask(0))).toBe(TASK_STATE.DONE);
      expect(taskState(await reloadTask(1))).toBe(TASK_STATE.WORKING);
    });
  });

  describe('区間の手動追加と編集（仕様書8.4.11、8.4.5）', () => {
    it('後から実績を足せる', async () => {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-31T09:00:00+09:00',
        endAt: '2026-07-31T10:00:00+09:00',
        participants: ['甲'],
      });

      const task = await reloadTask();
      expect(task.intervals).toHaveLength(1);
      expect(summarizeTask(task).timeSeconds).toBe(3600);
    });

    it('重複しても保存し、警告を返す（仕様書8.9.5）', async () => {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T11:00:00+09:00',
        participants: ['甲'],
      });

      const { warnings } = await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T10:00:00+09:00',
        endAt: '2026-08-01T12:00:00+09:00',
        participants: ['乙'],
      });

      expect(warnings).toEqual([
        expect.objectContaining({ code: INTERVAL_WARNING.OVERLAP }),
      ]);
      expect((await reloadTask()).intervals).toHaveLength(2);
    });

    it('終了日時を欠く手動追加は拒否する（設計メモ §2.2）', async () => {
      await expect(
        addIntervalManually(deps, target(), {
          type: INTERVAL_TYPE.WORK,
          startAt: '2026-08-01T09:00:00+09:00',
          endAt: null,
          participants: ['甲'],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('未終了区間へ終了時刻を補える（仕様書8.8.4）', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });
      const { intervalId } = (await reloadTask()).intervals[0];

      await updateInterval(deps, target(), intervalId, {
        endAt: '2026-08-01T10:00:00+09:00',
      });

      const task = await reloadTask();
      expect(taskState(task)).toBe(TASK_STATE.DONE);
      expect(task.intervals[0].updatedAt).toBe(NOW_ISO);
    });

    it('参加者を後から直せる', async () => {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      });
      const { intervalId } = (await reloadTask()).intervals[0];

      await updateInterval(deps, target(), intervalId, { participants: ['甲', '乙'] });

      expect((await reloadTask()).intervals[0].participants).toEqual(['甲', '乙']);
    });

    it('終了が開始より前になる編集は拒否する（仕様書8.9.3）', async () => {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      });
      const { intervalId } = (await reloadTask()).intervals[0];

      await expect(
        updateInterval(deps, target(), intervalId, {
          endAt: '2026-08-01T08:00:00+09:00',
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await reloadTask()).intervals[0].endAt).toBe('2026-08-01T10:00:00+09:00');
    });
  });

  describe('区間削除と変更履歴（仕様書11章、設計メモ §6.1 案B）', () => {
    /** 削除対象の区間を1件用意する。 */
    async function seedInterval() {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T09:20:00+09:00',
        participants: ['甲', '乙'],
      });
      return (await reloadTask()).intervals[0];
    }

    it('区間を削除し、履歴を1件残す', async () => {
      const interval = await seedInterval();

      const { historyEntry } = await deleteInterval(deps, target(), interval.intervalId, {
        reason: '二重に記録していたため',
      });

      const { workRuns, changeHistory } = await adapter.loadAll();
      const saved = workRuns.find((item) => item.runId === run.runId);
      expect(saved.tasks[0].intervals).toEqual([]);
      expect(changeHistory).toHaveLength(1);
      expect(changeHistory[0]).toEqual(historyEntry);
    });

    it('履歴は仕様書11章の項目を持つ', async () => {
      const interval = await seedInterval();

      const { historyEntry } = await deleteInterval(deps, target(), interval.intervalId, {
        reason: '二重に記録していたため',
      });

      expect(historyEntry).toMatchObject({
        entityType: 'interval',
        targetId: interval.intervalId,
        operation: 'intervalDeleted',
        timestamp: NOW_ISO,
        reason: '二重に記録していたため',
      });
      expect(historyEntry.historyId).toEqual(expect.any(String));
      // 要約から「どの実施回のどの作業項目の、いつの区間か」を追える。
      expect(historyEntry.summary).toContain('2026-08-01');
      expect(historyEntry.summary).toContain('受入確認');
      expect(historyEntry.summary).toContain('09:00:00');
      expect(historyEntry.summary).toContain('甲、乙');
    });

    it('履歴はエクスポート検証を通る形である（仕様書9.2）', async () => {
      const interval = await seedInterval();
      await deleteInterval(deps, target(), interval.intervalId, { reason: '誤入力' });

      const payload = await adapter.exportAll({ exportedAt: NOW_ISO });

      expect(validateImportPayload(payload).errors).toEqual([]);
      expect(payload.changeHistory).toHaveLength(1);
    });

    it('理由が無ければ削除できない（仕様書11章）', async () => {
      const interval = await seedInterval();

      const error = await deleteInterval(deps, target(), interval.intervalId, {}).catch(
        (caught) => caught,
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.errors.join('\n')).toContain('理由');
    });

    it('空白のみの理由も拒否する', async () => {
      const interval = await seedInterval();

      await expect(
        deleteInterval(deps, target(), interval.intervalId, { reason: '   ' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('理由が無いときは区間も履歴も変わらない', async () => {
      const interval = await seedInterval();

      await expect(
        deleteInterval(deps, target(), interval.intervalId, { reason: '' }),
      ).rejects.toBeInstanceOf(ValidationError);

      const { workRuns, changeHistory } = await adapter.loadAll();
      expect(workRuns[0].tasks[0].intervals).toHaveLength(1);
      expect(changeHistory).toEqual([]);
    });

    it('削除と履歴を同一の保存でまとめる', async () => {
      const interval = await seedInterval();
      const batch = vi.spyOn(adapter, 'saveEntities');
      const single = vi.spyOn(adapter, 'saveEntity');

      await deleteInterval(deps, target(), interval.intervalId, { reason: '誤入力' });

      expect(single).not.toHaveBeenCalled();
      expect(batch).toHaveBeenCalledTimes(1);
      expect(batch.mock.calls[0][0].map((entry) => entry.type)).toEqual([
        ENTITY_TYPE.WORK_RUNS,
        ENTITY_TYPE.CHANGE_HISTORY,
      ]);
    });

    it('保存に失敗したときは区間も履歴も残さない（部分反映しない）', async () => {
      const interval = await seedInterval();
      vi.spyOn(adapter, 'saveEntities').mockRejectedValue(new Error('書き込み失敗'));

      await expect(
        deleteInterval(deps, target(), interval.intervalId, { reason: '誤入力' }),
      ).rejects.toThrow('書き込み失敗');

      const { workRuns, changeHistory } = await adapter.loadAll();
      expect(workRuns[0].tasks[0].intervals).toHaveLength(1);
      expect(changeHistory).toEqual([]);
    });

    it('存在しない区間の削除では履歴を残さない', async () => {
      await seedInterval();

      await expect(
        deleteInterval(deps, target(), 'missing', { reason: '誤入力' }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('未終了区間も理由を付ければ削除できる', async () => {
      await recordStart(deps, target(), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });
      const { intervalId } = (await reloadTask()).intervals[0];

      const { historyEntry } = await deleteInterval(deps, target(), intervalId, {
        reason: '別の作業項目へ記録すべきだったため',
      });

      expect(taskState(await reloadTask())).toBe(TASK_STATE.NOT_STARTED);
      expect(historyEntry.summary).toContain('未終了');
    });

    it('削除を繰り返すと履歴が積み上がる', async () => {
      const first = await seedInterval();
      await deleteInterval(deps, target(), first.intervalId, { reason: '誤入力' });
      const second = await seedInterval();
      await deleteInterval(deps, target(), second.intervalId, { reason: '重複記録' });

      const { changeHistory } = await adapter.loadAll();
      expect(changeHistory).toHaveLength(2);
      expect(changeHistory.map((entry) => entry.reason)).toEqual(
        expect.arrayContaining(['誤入力', '重複記録']),
      );
    });

    describe('previewIntervalDeletion（削除前の確認）', () => {
      it('対象区間の内容を確認できる', async () => {
        const interval = await seedInterval();
        const { workRuns } = await adapter.loadAll();

        const preview = previewIntervalDeletion(workRuns, target(), interval.intervalId);

        expect(preview.ok).toBe(true);
        expect(preview.deletable).toBe(true);
        expect(preview.interval.intervalId).toBe(interval.intervalId);
        expect(preview.description).toContain('2026-08-01 09:00:00');
        expect(preview.description).toContain('甲、乙');
        expect(preview.taskRecord.name).toBe('受入確認');
      });

      it('確認に出す説明が履歴の要約と一致する', async () => {
        const interval = await seedInterval();
        const { workRuns } = await adapter.loadAll();
        const preview = previewIntervalDeletion(workRuns, target(), interval.intervalId);

        const { historyEntry } = await deleteInterval(deps, target(), interval.intervalId, {
          reason: '誤入力',
        });

        expect(historyEntry.summary).toBe(preview.summary);
      });

      it('転記済みでは削除できない旨を返す（仕様書7.2）', async () => {
        const interval = await seedInterval();
        await setRunStatus('transferred');
        const { workRuns } = await adapter.loadAll();

        const preview = previewIntervalDeletion(workRuns, target(), interval.intervalId);

        expect(preview.ok).toBe(true);
        expect(preview.deletable).toBe(false);
        expect(preview.blockedReason).toContain('転記済み');
      });

      it('見つからない対象は理由つきで返す', async () => {
        const { workRuns } = await adapter.loadAll();

        expect(previewIntervalDeletion(workRuns, target(), 'missing')).toMatchObject({
          ok: false,
        });
        expect(
          previewIntervalDeletion(workRuns, { runId: 'missing', taskRecordId: 'x' }, 'y'),
        ).toMatchObject({ ok: false });
      });
    });
  });

  describe('集計済みからの作業再開（仕様書7.1、レビュー指摘 S8-1）', () => {
    // 集計済みは「未終了区間がない」状態である。作業を再開すればその前提は崩れる
    // ため、確認を取ってから実施回を作業中へ戻す。集計済み→作業中は利用者の確認
    // 操作によると定められている（7.1）ので、黙って戻すことはできない。

    /** 終了済みの区間を1件入れてから集計済みにする。 */
    async function toAggregated() {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      });
      await markAggregated(deps, run.runId);
    }

    it('確認なしでは差し戻す', async () => {
      await toAggregated();

      await expect(
        recordStart(deps, target(), { at: '2026-08-01T11:00:00+09:00', participants: ['甲'] }),
      ).rejects.toBeInstanceOf(ResumeConfirmationRequiredError);
    });

    it('差し戻したときは状態も区間も変えない', async () => {
      await toAggregated();

      await recordStart(deps, target(), {
        at: '2026-08-01T11:00:00+09:00',
        participants: ['甲'],
      }).catch(() => {});

      const saved = await reloadTask();
      expect(saved.intervals).toHaveLength(1);
      expect((await adapter.loadAll()).workRuns[0].status).toBe('aggregated');
    });

    it('差し戻しの文言で何が起きるかを伝える', async () => {
      await toAggregated();

      const error = await recordStart(deps, target(), { participants: ['甲'] }).catch(
        (caught) => caught,
      );

      expect(error.message).toContain('集計済み');
      expect(error.message).toContain('作業中');
      expect(error.runId).toBe(run.runId);
    });

    it('確認すると作業中へ戻り、同時に区間ができる', async () => {
      await toAggregated();

      await recordStart(deps, target(), {
        at: '2026-08-01T11:00:00+09:00',
        participants: ['甲'],
        confirmedResume: true,
      });

      const { workRuns } = await adapter.loadAll();
      expect(workRuns[0].status).toBe('working');
      expect(workRuns[0].tasks[0].intervals).toHaveLength(2);
      expect(taskState(await reloadTask())).toBe(TASK_STATE.WORKING);
    });

    it('状態変更と区間生成が同じ保存で成立する', async () => {
      // WorkRun は状態も区間も同じ文書に持つ。片方だけが保存された状態は作れない。
      await toAggregated();

      await recordStart(deps, target(), {
        participants: ['甲'],
        confirmedResume: true,
      });

      const saved = (await adapter.loadAll()).workRuns[0];
      const open = saved.tasks[0].intervals.filter((interval) => interval.endAt === null);
      expect(saved.status).toBe('working');
      expect(open).toHaveLength(1);
    });

    it('保存に失敗すれば状態も区間も変わらない', async () => {
      await toAggregated();
      const failing = {
        ...deps,
        adapter: {
          ...adapter,
          loadAll: () => adapter.loadAll(),
          saveEntity: async () => {
            throw new Error('書き込み失敗');
          },
        },
      };

      await expect(
        recordStart(failing, target(), { participants: ['甲'], confirmedResume: true }),
      ).rejects.toThrow();

      const saved = (await adapter.loadAll()).workRuns[0];
      expect(saved.status).toBe('aggregated');
      expect(saved.tasks[0].intervals).toHaveLength(1);
    });

    it('作業中では確認を求めない', async () => {
      await expect(
        recordStart(deps, target(), { participants: ['甲'] }),
      ).resolves.toBeDefined();
    });

    describe('未終了区間を生まない操作は集計済みのまま行える（仕様書7.1）', () => {
      it('区間の手動追加（終了日時が必須）', async () => {
        await toAggregated();

        await expect(
          addIntervalManually(deps, target(), {
            type: INTERVAL_TYPE.WORK,
            startAt: '2026-08-01T13:00:00+09:00',
            endAt: '2026-08-01T14:00:00+09:00',
            participants: ['甲'],
          }),
        ).resolves.toBeDefined();

        expect((await adapter.loadAll()).workRuns[0].status).toBe('aggregated');
      });

      it('終了済み区間の編集', async () => {
        await toAggregated();
        const { intervalId } = (await reloadTask()).intervals[0];

        await expect(
          updateInterval(deps, target(), intervalId, { participants: ['甲', '乙'] }),
        ).resolves.toBeDefined();

        expect((await adapter.loadAll()).workRuns[0].status).toBe('aggregated');
      });

      it('区間の削除', async () => {
        await toAggregated();
        const { intervalId } = (await reloadTask()).intervals[0];

        await expect(
          deleteInterval(deps, target(), intervalId, { reason: '誤入力' }),
        ).resolves.toBeDefined();

        expect((await adapter.loadAll()).workRuns[0].status).toBe('aggregated');
      });
    });
  });

  describe('状態ガード（仕様書7.2）', () => {
    beforeEach(async () => {
      await addIntervalManually(deps, target(), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      });
    });

    /** 区間を書き換える操作をひととおり試す。 */
    async function attemptAll(intervalId) {
      return [
        recordStart(deps, target(), { participants: ['甲'] }),
        recordBreak(deps, target(), {}),
        recordResume(deps, target(), {}),
        recordFinish(deps, target(), {}),
        recordParticipantChange(deps, target(), { participants: ['甲'] }),
        addIntervalManually(deps, target(), {
          type: INTERVAL_TYPE.WORK,
          startAt: '2026-08-01T11:00:00+09:00',
          endAt: '2026-08-01T12:00:00+09:00',
          participants: ['甲'],
        }),
        updateInterval(deps, target(), intervalId, { participants: ['乙'] }),
        deleteInterval(deps, target(), intervalId, { reason: '誤入力' }),
      ].map((promise) => promise.catch((error) => error));
    }

    it('転記済みでは区間を書き換えるすべての操作を拒否する', async () => {
      const { intervalId } = (await reloadTask()).intervals[0];
      await setRunStatus('transferred');

      const results = await Promise.all(await attemptAll(intervalId));

      for (const result of results) {
        expect(result).toBeInstanceOf(RunNotEditableError);
      }
      expect((await reloadTask()).intervals).toHaveLength(1);
    });

    it('アーカイブ済みでも同様に拒否する', async () => {
      const { intervalId } = (await reloadTask()).intervals[0];
      await setRunStatus('archived');

      const results = await Promise.all(await attemptAll(intervalId));

      for (const result of results) {
        expect(result).toBeInstanceOf(RunNotEditableError);
      }
    });

    it('転記済みの削除では履歴も残らない', async () => {
      const { intervalId } = (await reloadTask()).intervals[0];
      await setRunStatus('transferred');

      await expect(
        deleteInterval(deps, target(), intervalId, { reason: '誤入力' }),
      ).rejects.toBeInstanceOf(RunNotEditableError);

      expect((await adapter.loadAll()).changeHistory).toEqual([]);
    });

    it('集計済みでは記録できる（閲覧のみではない）', async () => {
      const { intervalId } = (await reloadTask()).intervals[0];
      await setRunStatus('aggregated');

      await expect(
        deleteInterval(deps, target(), intervalId, { reason: '誤入力' }),
      ).resolves.toBeDefined();
    });
  });

  describe('参加者候補（仕様書8.4.7）', () => {
    it('記録した参加者が候補として集まる', async () => {
      await recordStart(deps, target(0), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲', '乙'],
      });
      await addIntervalManually(deps, target(1), {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['丙'],
      });

      const { workRuns } = await adapter.loadAll();
      expect(collectParticipants(workRuns, { runId: run.runId }).sort()).toEqual(
        ['丙', '乙', '甲'].sort(),
      );
    });
  });

  describe('返り値', () => {
    it('保存後のデータセットと作業項目実績を返す', async () => {
      const { dataset, workRun, taskRecord, warnings } = await recordStart(
        deps,
        target(),
        { at: '2026-08-01T09:00:00+09:00', participants: ['甲'] },
      );

      expect(dataset.workRuns).toHaveLength(1);
      expect(workRun.updatedAt).toBe(NOW_ISO);
      expect(taskRecord.intervals).toHaveLength(1);
      expect(warnings).toEqual([]);
    });

    it('他の作業項目の内容は変えない', async () => {
      const before = run.tasks[1];

      await recordStart(deps, target(0), {
        at: '2026-08-01T09:00:00+09:00',
        participants: ['甲'],
      });

      expect(await reloadTask(1)).toEqual(before);
    });
  });
});
