import { beforeEach, describe, expect, it } from 'vitest';

import {
  TASK_OPERATION,
  TASK_STATE,
  activeInterval,
  availableOperations,
  canOperate,
  exceedsThreshold,
  taskState,
} from '../../src/domain/taskState.js';
import {
  breakInterval,
  directEntry,
  resetIds,
  taskRecord,
  workInterval,
} from '../fixtures/builders.js';

beforeEach(resetIds);

const CLOSED_WORK = () =>
  workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', ['甲']);

describe('taskState', () => {
  it('作業区間が存在しない場合は未着手（仕様書7.2）', () => {
    expect(taskState(taskRecord())).toBe(TASK_STATE.NOT_STARTED);
  });

  it('直接入力だけがある場合も未着手のまま', () => {
    const task = taskRecord({ directEntries: [directEntry(1200)] });
    expect(taskState(task)).toBe(TASK_STATE.NOT_STARTED);
  });

  it('work の未終了区間があれば作業中', () => {
    const task = taskRecord({
      intervals: [CLOSED_WORK(), workInterval('2026-07-30T09:30:00+09:00', null, ['甲'])],
    });
    expect(taskState(task)).toBe(TASK_STATE.WORKING);
  });

  it('break の未終了区間があれば休憩中', () => {
    const task = taskRecord({
      intervals: [CLOSED_WORK(), breakInterval('2026-07-30T09:20:00+09:00', null, ['甲'])],
    });
    expect(taskState(task)).toBe(TASK_STATE.ON_BREAK);
  });

  it('区間があり未終了がなければ完了', () => {
    expect(taskState(taskRecord({ intervals: [CLOSED_WORK()] }))).toBe(TASK_STATE.DONE);
  });

  it('完了は不可逆ではなく、再開始すると作業中へ戻る（仕様書7.2）', () => {
    const done = taskRecord({ intervals: [CLOSED_WORK()] });
    expect(taskState(done)).toBe(TASK_STATE.DONE);

    const restarted = {
      ...done,
      intervals: [...done.intervals, workInterval('2026-07-30T13:00:00+09:00', null, ['甲'])],
    };
    expect(taskState(restarted)).toBe(TASK_STATE.WORKING);
  });
});

describe('activeInterval', () => {
  it('未終了区間がなければ null', () => {
    expect(activeInterval(taskRecord({ intervals: [CLOSED_WORK()] }))).toBeNull();
  });

  it('未終了区間が複数ある異常データでは開始が最も新しいものを返す', () => {
    const older = workInterval('2026-07-30T09:00:00+09:00', null, ['甲']);
    const newer = breakInterval('2026-07-30T11:00:00+09:00', null, ['乙']);
    const task = taskRecord({ intervals: [older, newer] });

    expect(activeInterval(task).intervalId).toBe(newer.intervalId);
    expect(taskState(task)).toBe(TASK_STATE.ON_BREAK);
  });
});

describe('availableOperations', () => {
  it('未着手では開始・直接入力・区間追加のみ（仕様書12.4）', () => {
    expect(availableOperations(taskRecord()).sort()).toEqual(
      [TASK_OPERATION.START, TASK_OPERATION.DIRECT_ENTRY, TASK_OPERATION.ADD_INTERVAL].sort(),
    );
  });

  it('作業中では休憩・終了・参加者変更・直接入力・履歴編集・区間追加', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲'])],
    });

    expect(availableOperations(task).sort()).toEqual(
      [
        TASK_OPERATION.BREAK,
        TASK_OPERATION.FINISH,
        TASK_OPERATION.CHANGE_PARTICIPANTS,
        TASK_OPERATION.DIRECT_ENTRY,
        TASK_OPERATION.EDIT_HISTORY,
        TASK_OPERATION.ADD_INTERVAL,
      ].sort(),
    );
  });

  it('休憩中では再開が有効で、休憩は無効', () => {
    const task = taskRecord({
      intervals: [CLOSED_WORK(), breakInterval('2026-07-30T09:20:00+09:00', null, ['甲'])],
    });

    expect(canOperate(task, TASK_OPERATION.RESUME)).toBe(true);
    expect(canOperate(task, TASK_OPERATION.BREAK)).toBe(false);
    expect(canOperate(task, TASK_OPERATION.CHANGE_PARTICIPANTS)).toBe(true);
  });

  it('完了では開始が再び有効になり、休憩・終了は無効', () => {
    const task = taskRecord({ intervals: [CLOSED_WORK()] });

    expect(canOperate(task, TASK_OPERATION.START)).toBe(true);
    expect(canOperate(task, TASK_OPERATION.EDIT_HISTORY)).toBe(true);
    expect(canOperate(task, TASK_OPERATION.BREAK)).toBe(false);
    expect(canOperate(task, TASK_OPERATION.FINISH)).toBe(false);
  });

  it('未着手では履歴編集を行えない', () => {
    expect(canOperate(taskRecord(), TASK_OPERATION.EDIT_HISTORY)).toBe(false);
  });

  it('作業中でも開始は無効。未終了区間を二重に作らない（仕様書8.4 補足1、A-17）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲'])],
    });
    expect(canOperate(task, TASK_OPERATION.START)).toBe(false);
  });

  it('実施回が転記済み・アーカイブなら閲覧のみ（仕様書7.2）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', null, ['甲'])],
    });

    expect(availableOperations(task, { runEditable: false })).toEqual([]);
    expect(canOperate(task, TASK_OPERATION.FINISH, { runEditable: false })).toBe(false);
  });

  it('返した配列を変更しても内部の定義に影響しない', () => {
    const first = availableOperations(taskRecord());
    first.push('壊す');
    expect(availableOperations(taskRecord())).not.toContain('壊す');
  });
});

describe('exceedsThreshold', () => {
  const start = '2026-07-30T09:00:00+09:00';
  const startedAt = new Date('2026-07-30T09:00:00+09:00').getTime();
  const open = () => workInterval(start, null, ['甲']);

  it('しきい値を超えていなければ false（仕様書8.8.2）', () => {
    const now = new Date(startedAt + 11 * 60 * 60 * 1000);
    expect(exceedsThreshold(open(), now, 12)).toBe(false);
  });

  it('しきい値と同一時間は超過とみなさない', () => {
    const now = new Date(startedAt + 12 * 60 * 60 * 1000);
    expect(exceedsThreshold(open(), now, 12)).toBe(false);
  });

  it('しきい値を超えたら true', () => {
    const now = new Date(startedAt + 12 * 60 * 60 * 1000 + 1000);
    expect(exceedsThreshold(open(), now, 12)).toBe(true);
  });

  it('しきい値は設定値で変わる（仕様書8.8.3）', () => {
    const now = new Date(startedAt + 3 * 60 * 60 * 1000);
    expect(exceedsThreshold(open(), now, 2)).toBe(true);
    expect(exceedsThreshold(open(), now, 4)).toBe(false);
  });

  it('終了済み区間は対象外', () => {
    const now = new Date(startedAt + 100 * 60 * 60 * 1000);
    expect(exceedsThreshold(CLOSED_WORK(), now, 12)).toBe(false);
  });
});
