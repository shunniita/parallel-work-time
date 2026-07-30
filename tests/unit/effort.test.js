import { beforeEach, describe, expect, it } from 'vitest';

import {
  intervalEffortSeconds,
  isOpenInterval,
  openIntervals,
  summarizeRun,
  summarizeTask,
  taskDirectSeconds,
  taskTimeSeconds,
  toTransferMinutes,
} from '../../src/domain/effort.js';
import {
  breakInterval,
  directEntry,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../fixtures/builders.js';

beforeEach(resetIds);

describe('intervalEffortSeconds', () => {
  it('経過秒へ参加人数を掛ける（仕様書8.6.1）', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', [
      '甲',
      '乙',
      '丙',
    ]);
    expect(intervalEffortSeconds(interval)).toBe(1200 * 3);
  });

  it('休憩区間は0秒（仕様書8.6.2）', () => {
    const interval = breakInterval('2026-07-30T09:20:00+09:00', '2026-07-30T09:30:00+09:00', [
      '甲',
      '乙',
    ]);
    expect(intervalEffortSeconds(interval)).toBe(0);
  });

  it('未終了区間は確定分へ含めない（仕様書8.6.5）', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', null, ['甲']);
    expect(intervalEffortSeconds(interval)).toBe(0);
  });

  it('同一日時は0秒（仕様書8.9.3）', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:00:00+09:00', ['甲']);
    expect(intervalEffortSeconds(interval)).toBe(0);
  });

  it('終了が開始より前の異常データは0秒として扱う', () => {
    const interval = workInterval('2026-07-30T09:20:00+09:00', '2026-07-30T09:00:00+09:00', ['甲']);
    expect(intervalEffortSeconds(interval)).toBe(0);
  });

  it('日をまたぐ区間を扱える（T-13）', () => {
    const interval = workInterval('2026-07-30T23:30:00+09:00', '2026-07-31T01:15:00+09:00', ['甲']);
    expect(intervalEffortSeconds(interval)).toBe(105 * 60);
  });
});

describe('isOpenInterval / openIntervals', () => {
  it('endAt が null または未定義の区間を未終了とみなす', () => {
    expect(isOpenInterval(workInterval('2026-07-30T09:00:00+09:00', null))).toBe(true);
    expect(isOpenInterval({ startAt: '2026-07-30T09:00:00+09:00' })).toBe(true);
    expect(
      isOpenInterval(workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00')),
    ).toBe(false);
  });

  it('未終了区間だけを抽出する', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00'),
        workInterval('2026-07-30T09:30:00+09:00', null),
      ],
    });
    expect(openIntervals(task)).toHaveLength(1);
  });
});

describe('toTransferMinutes', () => {
  it('分単位へ切り上げる（仕様書8.6.4）', () => {
    expect(toTransferMinutes(0)).toBe(0);
    expect(toTransferMinutes(1)).toBe(1);
    expect(toTransferMinutes(59)).toBe(1);
    expect(toTransferMinutes(60)).toBe(1);
    expect(toTransferMinutes(61)).toBe(2);
  });
});

describe('taskDirectSeconds', () => {
  it('直接入力値へ参加者数を掛けない（仕様書8.5.6、8.6.6）', () => {
    const task = taskRecord({
      directEntries: [directEntry(1200, { participants: ['甲', '乙', '丙'] })],
    });
    expect(taskDirectSeconds(task)).toBe(1200);
  });

  it('複数の直接入力を秒単位で合計する（仕様書8.6.3）', () => {
    const task = taskRecord({
      directEntries: [directEntry(620), directEntry(320)],
    });
    expect(taskDirectSeconds(task)).toBe(940);
  });
});

describe('summarizeTask', () => {
  it('20分を3人、30分を2人で入力すると合計120分になる（T-04）', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', ['甲', '乙', '丙']),
        workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T10:30:00+09:00', ['甲', '乙']),
      ],
    });

    const summary = summarizeTask(task);

    expect(summary.timeSeconds).toBe(7200);
    expect(summary.transferMinutes).toBe(120);
  });

  it('10分20秒と5分20秒で合計940秒、転記値16分になる（T-05）', () => {
    const task = taskRecord({
      intervals: [
        // 10分20秒
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:10:20+09:00', ['甲']),
        // 5分20秒
        workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T10:05:20+09:00', ['甲']),
      ],
    });

    const summary = summarizeTask(task);

    expect(summary.totalSeconds).toBe(940);
    expect(summary.transferMinutes).toBe(16);
  });

  it('作業40分と直接入力20分を加算して転記値60分になる（T-06）', () => {
    const task = taskRecord({
      intervals: [workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:40:00+09:00', ['甲'])],
      directEntries: [directEntry(20 * 60)],
    });

    const summary = summarizeTask(task);

    expect(summary.timeSeconds).toBe(2400);
    expect(summary.directSeconds).toBe(1200);
    expect(summary.totalSeconds).toBe(3600);
    expect(summary.transferMinutes).toBe(60);
  });

  it('作業、休憩、作業を入力すると休憩が工数へ含まれない（T-07）', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', ['甲', '乙']),
        breakInterval('2026-07-30T09:20:00+09:00', '2026-07-30T09:30:00+09:00', ['甲', '乙']),
        workInterval('2026-07-30T09:30:00+09:00', '2026-07-30T09:50:00+09:00', ['甲', '乙']),
      ],
    });

    const summary = summarizeTask(task);

    // 20分×2人 + 20分×2人 = 80分。休憩10分は含まれない。
    expect(summary.totalSeconds).toBe(80 * 60);
    expect(summary.transferMinutes).toBe(80);
  });

  it('区間ごとには丸めず、合計に対して一度だけ切り上げる（仕様書8.6.4）', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:00:30+09:00', ['甲']),
        workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T10:00:30+09:00', ['甲']),
        workInterval('2026-07-30T11:00:00+09:00', '2026-07-30T11:00:30+09:00', ['甲']),
      ],
    });

    const summary = summarizeTask(task);

    // 30秒×3区間＝90秒。合計へ一度だけ切り上げて2分。
    // 区間ごとに切り上げると3分になってしまう。
    expect(summary.totalSeconds).toBe(90);
    expect(summary.transferMinutes).toBe(2);
  });

  it('未終了区間があると転記値が未確定になり、確定分の小計は返す（仕様書8.6.5、T-08）', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', ['甲', '乙', '丙']),
        workInterval('2026-07-30T09:30:00+09:00', null, ['甲', '乙']),
      ],
      directEntries: [directEntry(1200)],
    });

    const summary = summarizeTask(task);

    expect(summary.confirmed).toBe(false);
    expect(summary.openCount).toBe(1);
    expect(summary.transferMinutes).toBeNull();
    // 確定済みの3600秒と直接入力1200秒は小計として表示できる。
    expect(summary.totalSeconds).toBe(4800);
  });

  it('区間も直接入力もない作業項目は0秒・転記値0分になる', () => {
    const summary = summarizeTask(taskRecord());

    expect(summary.totalSeconds).toBe(0);
    expect(summary.confirmed).toBe(true);
    expect(summary.transferMinutes).toBe(0);
  });
});

describe('taskTimeSeconds', () => {
  it('未終了区間を時刻入力分へ含めない', () => {
    const task = taskRecord({
      intervals: [
        workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:10:00+09:00', ['甲']),
        workInterval('2026-07-30T09:10:00+09:00', null, ['甲']),
      ],
    });
    expect(taskTimeSeconds(task)).toBe(600);
  });
});

describe('summarizeRun', () => {
  it('作業項目ごとに切り上げた転記値を合計する', () => {
    const run = workRun({
      tasks: [
        taskRecord({
          name: '作業項目A',
          externalCode: 'X-100',
          order: 1,
          // 90秒 → 2分
          intervals: [
            workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:01:30+09:00', ['甲']),
          ],
        }),
        taskRecord({
          name: '作業項目B',
          externalCode: 'X-200',
          order: 2,
          // 90秒 → 2分
          intervals: [
            workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T10:01:30+09:00', ['甲']),
          ],
        }),
      ],
    });

    const summary = summarizeRun(run);

    expect(summary.totalSeconds).toBe(180);
    // 項目ごとに切り上げた 2分 + 2分 = 4分。実施回合計180秒を一度に
    // 切り上げた3分ではない。転記は項目ごとに行うため項目単位で丸める。
    expect(summary.transferMinutesSum).toBe(4);
    expect(summary.confirmed).toBe(true);
  });

  it('未終了区間がある実施回は転記値の合計を未確定にする（T-08）', () => {
    const run = workRun({
      tasks: [
        taskRecord({
          intervals: [
            workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', ['甲']),
          ],
        }),
        taskRecord({
          name: '作業項目B',
          externalCode: 'X-200',
          order: 2,
          intervals: [workInterval('2026-07-30T09:30:00+09:00', null, ['甲'])],
        }),
      ],
    });

    const summary = summarizeRun(run);

    expect(summary.openCount).toBe(1);
    expect(summary.confirmed).toBe(false);
    expect(summary.transferMinutesSum).toBeNull();
    expect(summary.totalSeconds).toBe(1200);
  });

  it('作業項目の識別情報を集計結果へ引き継ぐ', () => {
    const run = workRun({
      tasks: [taskRecord({ name: '作業項目C', externalCode: null, order: 3 })],
    });

    const [task] = summarizeRun(run).tasks;

    expect(task.name).toBe('作業項目C');
    expect(task.externalCode).toBeNull();
    expect(task.order).toBe(3);
  });
});
