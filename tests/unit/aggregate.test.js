/**
 * 実施回集計と転記用テキストの単体テスト（仕様書8.6.5、8.7）。
 *
 * 工数計算そのものは `effort.test.js`、自然順は `naturalSort.test.js` が持つ。
 * ここは「転記のために読む形へ整える」部分だけを固定する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  AGGREGATE_SORT,
  aggregateRun,
  buildTransferText,
  canAggregate,
} from '../../src/domain/aggregate.js';
import {
  directEntry,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../fixtures/builders.js';

beforeEach(resetIds);

/**
 * 終了済みの作業区間を1つ持つ作業項目。
 *
 * @param {{name: string, externalCode?: string|null, order: number, minutes: number,
 *          participants?: string[]}} options
 */
function doneTask({ name, externalCode = 'X-100', order, minutes, participants = ['甲'] }) {
  const end = new Date(Date.UTC(2026, 7, 1, 0, minutes, 0)).toISOString().slice(0, 19);
  return taskRecord({
    name,
    externalCode,
    order,
    intervals: [workInterval('2026-08-01T00:00:00+00:00', `${end}+00:00`, participants)],
  });
}

/**
 * 09:00 から n 秒後の時刻を `hh:mm:ss` で返す。
 *
 * @param {number} seconds
 */
function isoClock(seconds) {
  const total = 9 * 3600 + seconds;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** 未終了区間を持つ作業項目。 */
function openTask({ name, externalCode = 'X-900', order }) {
  return taskRecord({
    name,
    externalCode,
    order,
    intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲'])],
  });
}

describe('aggregateRun()', () => {
  describe('並び順（仕様書8.7.3）', () => {
    /** 表示順と自然順が食い違う実施回。 */
    function run() {
      return workRun({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          doneTask({ name: '本作業', externalCode: 'X-1000', order: 2, minutes: 20 }),
          doneTask({ name: '追加加工', externalCode: 'X-2000', order: 3, minutes: 30 }),
          doneTask({ name: '検査', externalCode: 'X-1100', order: 4, minutes: 40 }),
        ],
      });
    }

    it('既定は外部項目コードの自然順である', () => {
      const result = aggregateRun(run());

      expect(result.rows.map((row) => row.name)).toEqual([
        '受入確認',
        '本作業',
        '検査',
        '追加加工',
      ]);
    });

    it('表示順も選べる', () => {
      const result = aggregateRun(run(), { sort: AGGREGATE_SORT.ORDER });

      expect(result.rows.map((row) => row.name)).toEqual([
        '受入確認',
        '本作業',
        '追加加工',
        '検査',
      ]);
    });

    it('外部項目コード未設定は末尾へ置く（仕様書8.7.3、8.7.4）', () => {
      const target = workRun({
        tasks: [
          doneTask({ name: '後片付け', externalCode: null, order: 1, minutes: 10 }),
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 2, minutes: 10 }),
        ],
      });

      const result = aggregateRun(target);

      expect(result.rows.map((row) => row.name)).toEqual(['受入確認', '後片付け']);
    });

    it('未設定どうしは表示順で安定させる', () => {
      const target = workRun({
        tasks: [
          doneTask({ name: '後始末B', externalCode: null, order: 2, minutes: 10 }),
          doneTask({ name: '後始末A', externalCode: null, order: 1, minutes: 10 }),
        ],
      });

      const result = aggregateRun(target);

      expect(result.rows.map((row) => row.name)).toEqual(['後始末A', '後始末B']);
    });

    it('元の実施回を書き換えない', () => {
      const target = run();

      aggregateRun(target);

      expect(target.tasks.map((task) => task.name)).toEqual([
        '受入確認',
        '本作業',
        '追加加工',
        '検査',
      ]);
    });
  });

  describe('行の内容（仕様書8.7.2）', () => {
    it('時刻入力分・直接入力分・合計秒・転記値を持つ', () => {
      const task = doneTask({ name: '受入確認', order: 1, minutes: 40 });
      task.directEntries = [directEntry(1200)];

      const [row] = aggregateRun(workRun({ tasks: [task] })).rows;

      expect(row).toMatchObject({
        name: '受入確認',
        externalCode: 'X-100',
        timeSeconds: 2400,
        directSeconds: 1200,
        totalSeconds: 3600,
        confirmed: true,
        transferMinutes: 60,
      });
    });

    it('外部項目コード未設定に印を付ける（仕様書8.7.4）', () => {
      const target = workRun({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          doneTask({ name: '後片付け', externalCode: null, order: 2, minutes: 10 }),
        ],
      });

      const result = aggregateRun(target);

      expect(result.rows.map((row) => row.externalCodeMissing)).toEqual([false, true]);
      expect(result.missingExternalCodeCount).toBe(1);
    });

    it('空文字の外部項目コードも未設定として扱う', () => {
      const target = workRun({
        tasks: [doneTask({ name: '受入確認', externalCode: '  ', order: 1, minutes: 10 })],
      });

      expect(aggregateRun(target).rows[0].externalCodeMissing).toBe(true);
    });

    it('未終了区間を含む項目の転記値は未確定にする（仕様書8.6.5）', () => {
      const target = workRun({ tasks: [openTask({ name: '受入確認', order: 1 })] });

      const [row] = aggregateRun(target).rows;

      expect(row.confirmed).toBe(false);
      expect(row.transferMinutes).toBeNull();
      expect(row.openCount).toBe(1);
    });
  });

  describe('実施回の合計（仕様書8.6.5、8.7.1）', () => {
    it('すべて確定していれば転記値の合計を出す', () => {
      const target = workRun({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          doneTask({ name: '本作業', externalCode: 'X-200', order: 2, minutes: 20 }),
        ],
      });

      const result = aggregateRun(target);

      expect(result.confirmed).toBe(true);
      expect(result.transferMinutesSum).toBe(30);
      expect(result.confirmedTransferMinutesSum).toBe(30);
    });

    it('項目ごとに切り上げてから足す（仕様書8.6.4）', () => {
      // 30秒 × 3項目。項目ごとなら1分×3＝3分。まとめて切り上げると90秒→2分。
      const seconds = (name, order) => {
        const task = taskRecord({ name, externalCode: `X-${order}00`, order });
        task.directEntries = [directEntry(30)];
        return task;
      };
      const target = workRun({
        tasks: [seconds('A', 1), seconds('B', 2), seconds('C', 3)],
      });

      const result = aggregateRun(target);

      expect(result.totalSeconds).toBe(90);
      expect(result.transferMinutesSum).toBe(3);
    });

    it('未確定があれば転記値の合計は null にする', () => {
      const target = workRun({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          openTask({ name: '本作業', externalCode: 'X-200', order: 2 }),
        ],
      });

      const result = aggregateRun(target);

      expect(result.confirmed).toBe(false);
      expect(result.transferMinutesSum).toBeNull();
    });

    it('未確定があっても確定済みだけの小計は出す（仕様書8.6.5）', () => {
      const target = workRun({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          openTask({ name: '本作業', externalCode: 'X-200', order: 2 }),
        ],
      });

      const result = aggregateRun(target);

      expect(result.confirmedTransferMinutesSum).toBe(10);
      expect(result.confirmedCount).toBe(1);
      expect(result.unconfirmedCount).toBe(1);
    });

    it('区間を細かく分割しても合計は変わらない（敵対的検証 3.3）', () => {
      // 参加者変更は進行中の区間を分割する（仕様書8.4.10）。分割で切り上げ誤差が
      // 累積するのではないかという指摘への確認である。
      //
      // 累積しない理由は2つある。
      //   1. 切り上げは区間ごとではなく作業項目の合計に対して一度だけ（8.6.4）
      //   2. 日時は秒精度で保存するため（8.4.4）、区間ごとの `floor(ms/1000)` は
      //      端数を切り捨てるところがない
      const whole = taskRecord({
        name: '一括',
        externalCode: 'X-100',
        order: 1,
        intervals: [
          workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T09:10:01+09:00', ['甲']),
        ],
      });
      // 同じ 601 秒を 7 + 7 + ... の細切れへ分ける（端数の出る長さで刻む）。
      const pieces = [];
      for (let offset = 0; offset < 601; offset += 7) {
        const end = Math.min(offset + 7, 601);
        pieces.push(
          workInterval(
            `2026-08-01T${isoClock(offset)}+09:00`,
            `2026-08-01T${isoClock(end)}+09:00`,
            ['甲'],
          ),
        );
      }
      const split = taskRecord({
        name: '分割',
        externalCode: 'X-200',
        order: 2,
        intervals: pieces,
      });

      const result = aggregateRun(workRun({ tasks: [whole, split] }));
      const [wholeRow, splitRow] = result.rows;

      expect(splitRow.timeSeconds).toBe(wholeRow.timeSeconds);
      expect(splitRow.transferMinutes).toBe(wholeRow.transferMinutes);
      expect(splitRow.transferMinutes).toBe(11);
    });

    it('作業項目が無ければ0で確定とする', () => {
      const result = aggregateRun(workRun({ tasks: [] }));

      expect(result.rows).toEqual([]);
      expect(result.confirmed).toBe(true);
      expect(result.transferMinutesSum).toBe(0);
    });
  });
});

describe('buildTransferText()（仕様書8.7.7）', () => {
  it('外部項目コード順にタブ区切りで並べる', () => {
    const target = workRun({
      tasks: [
        doneTask({ name: '検査', externalCode: 'X-1100', order: 2, minutes: 20 }),
        doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
      ],
    });

    const result = buildTransferText(aggregateRun(target));

    expect(result.text).toBe('X-100\t10\nX-1100\t20');
    expect(result.copiedCount).toBe(2);
  });

  it('外部項目コード未設定の行は出さず、件数を返す', () => {
    // 貼り付け先はコードで行を突き合わせる。空のコードを混ぜると行がずれる。
    const target = workRun({
      tasks: [
        doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
        doneTask({ name: '後片付け', externalCode: null, order: 2, minutes: 20 }),
      ],
    });

    const result = buildTransferText(aggregateRun(target));

    expect(result.text).toBe('X-100\t10');
    expect(result.skippedMissingCode).toBe(1);
    expect(result.copiedCount).toBe(1);
  });

  it('未確定の行は出さず、件数を返す（仕様書8.6.5）', () => {
    const target = workRun({
      tasks: [
        doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
        openTask({ name: '本作業', externalCode: 'X-200', order: 2 }),
      ],
    });

    const result = buildTransferText(aggregateRun(target));

    expect(result.text).toBe('X-100\t10');
    expect(result.skippedUnconfirmed).toBe(1);
  });

  it('出せる行が無ければ空文字を返す', () => {
    const target = workRun({ tasks: [openTask({ name: '本作業', order: 1 })] });

    const result = buildTransferText(aggregateRun(target));

    expect(result.text).toBe('');
    expect(result.copiedCount).toBe(0);
  });

  describe('画面の並び順に依存しない（過去のレビュー指摘）', () => {
    /** 表示順と自然順が食い違う実施回。 */
    function mixedRun() {
      return workRun({
        tasks: [
          doneTask({ name: '追加加工', externalCode: 'X-2000', order: 1, minutes: 30 }),
          doneTask({ name: '検査', externalCode: 'X-1100', order: 2, minutes: 40 }),
        ],
      });
    }

    it('表示順で集計してもコピーは外部項目コード順になる', () => {
      // 仕様書8.7.7 が定めるコピーの並びは外部項目コード順の一択である。画面で
      // どう見ていたかで変わってはならない。
      const byOrder = aggregateRun(mixedRun(), { sort: AGGREGATE_SORT.ORDER });

      expect(byOrder.rows.map((row) => row.externalCode)).toEqual(['X-2000', 'X-1100']);
      expect(buildTransferText(byOrder).text).toBe('X-1100\t40\nX-2000\t30');
    });

    it('外部項目コード順で集計した場合と同じ結果になる', () => {
      const byOrder = buildTransferText(aggregateRun(mixedRun(), { sort: AGGREGATE_SORT.ORDER }));
      const byCode = buildTransferText(aggregateRun(mixedRun()));

      expect(byOrder).toEqual(byCode);
    });

    it('渡された集計結果の並びを書き換えない', () => {
      // コピーしただけで画面の並びが変わってはならない。
      const byOrder = aggregateRun(mixedRun(), { sort: AGGREGATE_SORT.ORDER });

      buildTransferText(byOrder);

      expect(byOrder.rows.map((row) => row.externalCode)).toEqual(['X-2000', 'X-1100']);
    });
  });

  it('分の値だけを出す（単位は付けない）', () => {
    // 貼り付け先が数値として読む。「10分」では取り込めない。
    const target = workRun({
      tasks: [doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 })],
    });

    expect(buildTransferText(aggregateRun(target)).text).toBe('X-100\t10');
  });
});

describe('canAggregate()（仕様書8.9.6、A-08）', () => {
  it('未終了区間が無ければ進める', () => {
    const target = workRun({
      tasks: [doneTask({ name: '受入確認', order: 1, minutes: 10 })],
    });

    expect(canAggregate(target)).toEqual({ ok: true, openCount: 0, reason: null });
  });

  it('未終了区間があれば進めない', () => {
    const target = workRun({
      tasks: [
        doneTask({ name: '受入確認', order: 1, minutes: 10 }),
        openTask({ name: '本作業', order: 2 }),
      ],
    });

    const result = canAggregate(target);

    expect(result.ok).toBe(false);
    expect(result.openCount).toBe(1);
    expect(result.reason).toContain('未終了');
  });

  it('複数の未終了区間を数える', () => {
    const target = workRun({
      tasks: [
        openTask({ name: '受入確認', order: 1 }),
        openTask({ name: '本作業', order: 2 }),
      ],
    });

    expect(canAggregate(target).openCount).toBe(2);
  });

  it('作業項目が無ければ進める', () => {
    expect(canAggregate(workRun({ tasks: [] })).ok).toBe(true);
  });
});
