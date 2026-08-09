/**
 * 作業区間の変換（仕様書8.4、8.9.3、8.9.4、8.9.5）。
 *
 * 状態と操作の対応（設計メモ PWT-DESIGN-006 §2 の表）をここで固定する。
 * 画面のボタン制御ではなく、この層で前提状態を弾けることを確かめる（A-17）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  INTERVAL_WARNING,
  addInterval,
  changeParticipants,
  editInterval,
  findInterval,
  removeInterval,
  resumeWork,
  startBreak,
  startWork,
  finishWork,
} from '../../src/domain/intervalOps.js';
import { INTERVAL_TYPE } from '../../src/domain/effort.js';
import { TASK_STATE, taskState } from '../../src/domain/taskState.js';
import { breakInterval, resetIds, taskRecord, workInterval } from '../fixtures/builders.js';

const NOW = '2026-07-30T12:00:00+09:00';

function contextWith(prefix = 'new') {
  let sequence = 0;
  return {
    now: NOW,
    newId: () => {
      sequence += 1;
      return `${prefix}-${sequence}`;
    },
  };
}

/** 変換後の区間一覧を持つ作業項目実績を作る。連続した操作を書きやすくする。 */
function applied(taskRecordValue, result) {
  return { ...taskRecordValue, intervals: result.intervals };
}

describe('startWork（仕様書8.4.1）', () => {
  beforeEach(resetIds);

  it('未着手から未終了の作業区間を開く', () => {
    const task = taskRecord();

    const result = startWork(
      task,
      { at: '2026-07-30T09:00:00+09:00', participants: ['甲', '乙'] },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.intervals).toHaveLength(1);
    expect(result.created).toMatchObject({
      type: INTERVAL_TYPE.WORK,
      startAt: '2026-07-30T09:00:00+09:00',
      endAt: null,
      participants: ['甲', '乙'],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(taskState(applied(task, result))).toBe(TASK_STATE.WORKING);
  });

  it('完了から開始し直せる（仕様書7.2 の「完了」は不可逆でない）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00')],
    });

    const result = startWork(
      task,
      { at: '2026-07-30T11:00:00+09:00', participants: ['甲'] },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.intervals).toHaveLength(2);
  });

  it('作業中からは開始できない（仕様書8.4 補足1、A-17）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    const result = startWork(
      task,
      { at: '2026-07-30T10:00:00+09:00', participants: ['甲'] },
      contextWith(),
    );

    expect(result.ok).toBe(false);
    expect(result.intervals).toBeNull();
    expect(result.errors.join('\n')).toContain('作業中');
  });

  it('休憩中からは開始できない', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00'),
        breakInterval('2026-07-30T10:00:00+09:00', null),
      ],
    });

    expect(
      startWork(task, { at: NOW, participants: ['甲'] }, contextWith()).ok,
    ).toBe(false);
  });

  it('参加者0人は拒否する（仕様書8.9.4）', () => {
    const result = startWork(taskRecord(), { at: NOW, participants: [] }, contextWith());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('1人以上');
  });

  it('参加者が配列でなければ拒否する', () => {
    const result = startWork(taskRecord(), { at: NOW, participants: '甲' }, contextWith());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('配列');
  });

  it('日時の形式が不正なら拒否する（仕様書8.4.4）', () => {
    const result = startWork(
      taskRecord(),
      { at: '2026-07-30 09:00', participants: ['甲'] },
      contextWith(),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('ISO 8601');
  });
});

describe('startBreak（仕様書8.4.1、8.9 補足）', () => {
  beforeEach(resetIds);

  it('進行中の作業を閉じ、参加者を引き継いだ休憩を開く', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲', '乙'])],
    });

    const result = startBreak(task, { at: '2026-07-30T10:00:00+09:00' }, contextWith());

    expect(result.ok).toBe(true);
    expect(result.closed).toMatchObject({
      endAt: '2026-07-30T10:00:00+09:00',
      updatedAt: NOW,
    });
    expect(result.created).toMatchObject({
      type: INTERVAL_TYPE.BREAK,
      startAt: '2026-07-30T10:00:00+09:00',
      endAt: null,
      participants: ['甲', '乙'],
    });
    expect(taskState(applied(task, result))).toBe(TASK_STATE.ON_BREAK);
  });

  it('元の作業項目実績を書き換えない（純関数である）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    startBreak(task, { at: '2026-07-30T10:00:00+09:00' }, contextWith());

    expect(task.intervals).toHaveLength(1);
    expect(task.intervals[0].endAt).toBeNull();
  });

  it('未着手からは休憩できない', () => {
    expect(startBreak(taskRecord(), { at: NOW }, contextWith()).ok).toBe(false);
  });

  it('休憩中に重ねて休憩できない', () => {
    const task = taskRecord({
      intervals: [breakInterval('2026-07-30T10:00:00+09:00', null)],
    });

    expect(startBreak(task, { at: NOW }, contextWith()).ok).toBe(false);
  });

  it('進行中区間の開始より前の時刻では閉じられない（仕様書8.9.3）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    const result = startBreak(task, { at: '2026-07-30T08:59:59+09:00' }, contextWith());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('開始日時以降');
  });

  it('接触（終了＝開始）は重複としない（0秒の区間を許す）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    const result = startBreak(task, { at: '2026-07-30T09:00:00+09:00' }, contextWith());

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe('resumeWork（仕様書8.4.1、設計メモ §2.1）', () => {
  beforeEach(resetIds);

  it('休憩を閉じ、参加者を引き継いだ作業を開く', () => {
    const task = taskRecord({
      intervals: [breakInterval('2026-07-30T10:00:00+09:00', null, ['甲', '乙'])],
    });

    const result = resumeWork(task, { at: '2026-07-30T10:15:00+09:00' }, contextWith());

    expect(result.ok).toBe(true);
    expect(result.created).toMatchObject({
      type: INTERVAL_TYPE.WORK,
      participants: ['甲', '乙'],
    });
  });

  it('0人の休憩から引き継ぐと拒否する（仕様書8.9.4）', () => {
    const task = taskRecord({
      intervals: [breakInterval('2026-07-30T10:00:00+09:00', null, [])],
    });

    const result = resumeWork(task, { at: '2026-07-30T10:15:00+09:00' }, contextWith());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('1人以上');
  });

  it('0人の休憩でも参加者を渡せば再開できる', () => {
    const task = taskRecord({
      intervals: [breakInterval('2026-07-30T10:00:00+09:00', null, [])],
    });

    const result = resumeWork(
      task,
      { at: '2026-07-30T10:15:00+09:00', participants: ['甲'] },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.created.participants).toEqual(['甲']);
  });

  it('参加者を渡すと引き継ぎより優先する', () => {
    const task = taskRecord({
      intervals: [breakInterval('2026-07-30T10:00:00+09:00', null, ['甲', '乙'])],
    });

    const result = resumeWork(
      task,
      { at: '2026-07-30T10:15:00+09:00', participants: ['甲'] },
      contextWith(),
    );

    expect(result.created.participants).toEqual(['甲']);
  });

  it('作業中からは再開できない', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    expect(resumeWork(task, { at: NOW }, contextWith()).ok).toBe(false);
  });
});

describe('finishWork（仕様書8.4.1）', () => {
  beforeEach(resetIds);

  it('作業中から終了すると未終了区間が無くなる', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    const result = finishWork(task, { at: '2026-07-30T18:00:00+09:00' }, contextWith());

    expect(result.ok).toBe(true);
    expect(result.created).toBeNull();
    expect(taskState(applied(task, result))).toBe(TASK_STATE.DONE);
  });

  it('休憩中からも終了できる', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00'),
        breakInterval('2026-07-30T10:00:00+09:00', null),
      ],
    });

    const result = finishWork(task, { at: '2026-07-30T10:30:00+09:00' }, contextWith());

    expect(result.ok).toBe(true);
    expect(taskState(applied(task, result))).toBe(TASK_STATE.DONE);
  });

  it('未着手からは終了できない', () => {
    expect(finishWork(taskRecord(), { at: NOW }, contextWith()).ok).toBe(false);
  });

  it('完了からは終了できない', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00')],
    });

    expect(finishWork(task, { at: NOW }, contextWith()).ok).toBe(false);
  });

  it('日をまたぐ区間を閉じられる（仕様書8.4.8）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T23:30:00+09:00', null)],
    });

    const result = finishWork(task, { at: '2026-07-31T01:15:00+09:00' }, contextWith());

    expect(result.ok).toBe(true);
    expect(result.closed.endAt).toBe('2026-07-31T01:15:00+09:00');
  });
});

describe('changeParticipants（仕様書8.4.10、補足2）', () => {
  beforeEach(resetIds);

  it('作業中は同時刻で作業区間を分割する（丙が離脱）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲', '乙', '丙'])],
    });

    const result = changeParticipants(
      task,
      { at: '2026-07-30T09:20:00+09:00', participants: ['甲', '乙'] },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.intervals.map((interval) => [
      interval.startAt,
      interval.endAt,
      interval.participants,
    ])).toEqual([
      ['2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', ['甲', '乙', '丙']],
      ['2026-07-30T09:20:00+09:00', null, ['甲', '乙']],
    ]);
  });

  it('休憩中は休憩区間を分割する（同じ種別を継ぐ）', () => {
    const task = taskRecord({
      intervals: [breakInterval('2026-07-30T10:00:00+09:00', null, ['甲', '乙'])],
    });

    const result = changeParticipants(
      task,
      { at: '2026-07-30T10:10:00+09:00', participants: ['甲'] },
      contextWith(),
    );

    expect(result.created.type).toBe(INTERVAL_TYPE.BREAK);
    expect(taskState(applied(task, result))).toBe(TASK_STATE.ON_BREAK);
  });

  it('参加者の追加も同じ形で表す（丙が参加）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲', '乙'])],
    });

    const result = changeParticipants(
      task,
      { at: '2026-07-30T09:30:00+09:00', participants: ['甲', '乙', '丙'] },
      contextWith(),
    );

    expect(result.created.participants).toEqual(['甲', '乙', '丙']);
  });

  it('分割で区間が重複したとは判定しない（接触）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲'])],
    });

    const result = changeParticipants(
      task,
      { at: '2026-07-30T09:20:00+09:00', participants: ['乙'] },
      contextWith(),
    );

    expect(result.warnings).toEqual([]);
  });

  it('作業中に0人へは変更できない（仕様書8.9.4）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲'])],
    });

    const result = changeParticipants(
      task,
      { at: '2026-07-30T09:20:00+09:00', participants: [] },
      contextWith(),
    );

    expect(result.ok).toBe(false);
  });

  it('休憩中は0人へ変更できる（仕様書8.9.4）', () => {
    const task = taskRecord({
      intervals: [breakInterval('2026-07-30T10:00:00+09:00', null, ['甲'])],
    });

    const result = changeParticipants(
      task,
      { at: '2026-07-30T10:10:00+09:00', participants: [] },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.created.participants).toEqual([]);
  });

  it('未着手では変更できない', () => {
    expect(
      changeParticipants(taskRecord(), { at: NOW, participants: ['甲'] }, contextWith())
        .ok,
    ).toBe(false);
  });
});

describe('addInterval（仕様書8.4.11、8.9.5）', () => {
  beforeEach(resetIds);

  it('終了済みの区間を後から足せる', () => {
    const task = taskRecord();

    const result = addInterval(
      task,
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-29T09:00:00+09:00',
        endAt: '2026-07-29T10:00:00+09:00',
        participants: ['甲'],
      },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(taskState(applied(task, result))).toBe(TASK_STATE.DONE);
  });

  it('作業中の作業項目にも足せる（状態を問わない）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    const result = addInterval(
      task,
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-29T09:00:00+09:00',
        endAt: '2026-07-29T10:00:00+09:00',
        participants: ['甲'],
      },
      contextWith(),
    );

    expect(result.ok).toBe(true);
  });

  it('終了日時が無ければ拒否する（設計メモ §2.2）', () => {
    const result = addInterval(
      taskRecord(),
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-29T09:00:00+09:00',
        endAt: null,
        participants: ['甲'],
      },
      contextWith(),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('手動追加では必須');
  });

  it('終了が開始より前なら拒否する（仕様書8.9.3）', () => {
    const result = addInterval(
      taskRecord(),
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-29T10:00:00+09:00',
        endAt: '2026-07-29T09:00:00+09:00',
        participants: ['甲'],
      },
      contextWith(),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('開始日時以降');
  });

  it('同一日時は0秒として許す（仕様書8.9.3）', () => {
    const result = addInterval(
      taskRecord(),
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-29T09:00:00+09:00',
        endAt: '2026-07-29T09:00:00+09:00',
        participants: ['甲'],
      },
      contextWith(),
    );

    expect(result.ok).toBe(true);
  });

  it('区間種別が不正なら拒否する', () => {
    const result = addInterval(
      taskRecord(),
      {
        type: 'idle',
        startAt: '2026-07-29T09:00:00+09:00',
        endAt: '2026-07-29T10:00:00+09:00',
        participants: ['甲'],
      },
      contextWith(),
    );

    expect(result.ok).toBe(false);
  });

  it('重複しても保存は止めず、種別コードつきで警告する（仕様書8.9.5、D-15）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T11:00:00+09:00')],
    });

    const result = addInterval(
      task,
      {
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-30T10:00:00+09:00',
        endAt: '2026-07-30T12:00:00+09:00',
        participants: ['乙'],
      },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: INTERVAL_WARNING.OVERLAP, path: '作業区間' }),
    ]);
  });
});

describe('editInterval（仕様書8.4.5、8.8.4）', () => {
  beforeEach(resetIds);

  it('渡した項目だけを差し替える', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00', ['甲']),
      ],
    });
    const target = task.intervals[0];

    const result = editInterval(
      task,
      target.intervalId,
      { endAt: '2026-07-30T10:30:00+09:00' },
      contextWith(),
    );

    expect(result.updated).toMatchObject({
      intervalId: target.intervalId,
      startAt: '2026-07-30T09:00:00+09:00',
      endAt: '2026-07-30T10:30:00+09:00',
      participants: ['甲'],
      createdAt: target.createdAt,
      updatedAt: NOW,
    });
  });

  it('未終了区間へ終了時刻を補える（仕様書8.8.4）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    const result = editInterval(
      task,
      task.intervals[0].intervalId,
      { endAt: '2026-07-30T10:00:00+09:00' },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(taskState(applied(task, result))).toBe(TASK_STATE.DONE);
  });

  it('終了済みを未終了へは戻せない（設計メモ §2.2）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00')],
    });

    const result = editInterval(
      task,
      task.intervals[0].intervalId,
      { endAt: null },
      contextWith(),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('未終了へ戻す');
  });

  it('もともと未終了なら未終了のまま保存できる', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲'])],
    });

    const result = editInterval(
      task,
      task.intervals[0].intervalId,
      { endAt: null, participants: ['甲', '乙'] },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.updated.endAt).toBeNull();
    expect(result.updated.participants).toEqual(['甲', '乙']);
  });

  it('区間種別を変更できる', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00')],
    });

    const result = editInterval(
      task,
      task.intervals[0].intervalId,
      { type: INTERVAL_TYPE.BREAK },
      contextWith(),
    );

    expect(result.updated.type).toBe(INTERVAL_TYPE.BREAK);
  });

  it('作業へ変更したとき参加者0人なら拒否する（仕様書8.9.4）', () => {
    const task = taskRecord({
      intervals: [
        breakInterval('2026-07-30T10:00:00+09:00', '2026-07-30T10:10:00+09:00', []),
      ],
    });

    const result = editInterval(
      task,
      task.intervals[0].intervalId,
      { type: INTERVAL_TYPE.WORK },
      contextWith(),
    );

    expect(result.ok).toBe(false);
  });

  it('終了が開始より前になる編集を拒否する（仕様書8.9.3）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00')],
    });

    const result = editInterval(
      task,
      task.intervals[0].intervalId,
      { startAt: '2026-07-30T11:00:00+09:00' },
      contextWith(),
    );

    expect(result.ok).toBe(false);
  });

  it('存在しない区間は拒否する', () => {
    const result = editInterval(taskRecord(), 'missing', { participants: ['甲'] }, contextWith());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('見つからない');
  });

  it('編集で重複が生じたら警告する（仕様書8.9.5）', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00'),
        workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T11:00:00+09:00'),
      ],
    });

    const result = editInterval(
      task,
      task.intervals[1].intervalId,
      { startAt: '2026-07-30T09:30:00+09:00' },
      contextWith(),
    );

    expect(result.ok).toBe(true);
    expect(result.warnings[0].code).toBe(INTERVAL_WARNING.OVERLAP);
  });
});

describe('removeInterval（仕様書8.4.5、11章）', () => {
  beforeEach(resetIds);

  it('指定した区間だけを取り除き、削除した内容を返す', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00'),
        workInterval('2026-07-30T11:00:00+09:00', '2026-07-30T12:00:00+09:00'),
      ],
    });
    const target = task.intervals[0];

    const result = removeInterval(task, target.intervalId);

    expect(result.ok).toBe(true);
    expect(result.removed).toEqual(target);
    expect(result.intervals).toEqual([task.intervals[1]]);
  });

  it('元の作業項目実績を書き換えない', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    removeInterval(task, task.intervals[0].intervalId);

    expect(task.intervals).toHaveLength(1);
  });

  it('未終了区間も削除できる', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    const result = removeInterval(task, task.intervals[0].intervalId);

    expect(result.ok).toBe(true);
    expect(taskState(applied(task, result))).toBe(TASK_STATE.NOT_STARTED);
  });

  it('残った区間の重複は蒸し返さない', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T11:00:00+09:00'),
        workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T12:00:00+09:00'),
        workInterval('2026-07-30T14:00:00+09:00', '2026-07-30T15:00:00+09:00'),
      ],
    });

    const result = removeInterval(task, task.intervals[2].intervalId);

    expect(result.warnings).toEqual([]);
  });

  it('存在しない区間は拒否する', () => {
    const result = removeInterval(taskRecord(), 'missing');

    expect(result.ok).toBe(false);
    expect(result.intervals).toBeNull();
  });
});

describe('findInterval', () => {
  beforeEach(resetIds);

  it('区間を引ける。無ければ null', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null)],
    });

    expect(findInterval(task, task.intervals[0].intervalId)).toBe(task.intervals[0]);
    expect(findInterval(task, 'missing')).toBeNull();
  });
});

describe('作業と休憩の繰り返し（仕様書8.4.2、T-03）', () => {
  beforeEach(resetIds);

  it('開始 → 休憩 → 再開 → 終了で4区間になる', () => {
    const context = contextWith();
    let task = taskRecord();

    task = applied(
      task,
      startWork(task, { at: '2026-07-30T09:00:00+09:00', participants: ['甲'] }, context),
    );
    task = applied(task, startBreak(task, { at: '2026-07-30T12:00:00+09:00' }, context));
    task = applied(task, resumeWork(task, { at: '2026-07-30T13:00:00+09:00' }, context));
    task = applied(task, finishWork(task, { at: '2026-07-30T18:00:00+09:00' }, context));

    expect(task.intervals.map((interval) => interval.type)).toEqual([
      INTERVAL_TYPE.WORK,
      INTERVAL_TYPE.BREAK,
      INTERVAL_TYPE.WORK,
    ]);
    expect(task.intervals.every((interval) => interval.endAt !== null)).toBe(true);
    expect(taskState(task)).toBe(TASK_STATE.DONE);
  });

  it('未終了区間は常に1つ以下である（仕様書8.4 補足1、A-17）', () => {
    const context = contextWith();
    let task = taskRecord();
    const openCounts = [];
    const record = (next) => {
      task = next;
      openCounts.push(task.intervals.filter((interval) => interval.endAt === null).length);
    };

    record(
      applied(
        task,
        startWork(task, { at: '2026-07-30T09:00:00+09:00', participants: ['甲'] }, context),
      ),
    );
    record(applied(task, startBreak(task, { at: '2026-07-30T10:00:00+09:00' }, context)));
    record(
      applied(
        task,
        changeParticipants(
          task,
          { at: '2026-07-30T10:10:00+09:00', participants: ['甲', '乙'] },
          context,
        ),
      ),
    );
    record(applied(task, resumeWork(task, { at: '2026-07-30T10:20:00+09:00' }, context)));
    record(applied(task, finishWork(task, { at: '2026-07-30T18:00:00+09:00' }, context)));

    expect(openCounts).toEqual([1, 1, 1, 1, 0]);
  });
});
