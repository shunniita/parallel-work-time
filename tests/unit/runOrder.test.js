/**
 * 実施回の並びと採番の単体テスト（仕様書8.2.3、10.1、過去のレビュー指摘）。
 *
 * 番号は保存しない派生値であり、画面ごとに数え方が違うと同じ実施回が別の番号で
 * 呼ばれる。ここで数え方を1つに固定する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { activeRuns, numberRuns, sortRuns, visibleRuns } from '../../src/domain/runOrder.js';
import { resetIds, workRun } from '../fixtures/builders.js';

beforeEach(resetIds);

/**
 * 作業日と作成日時を指定した実施回。
 *
 * @param {string} workDate
 * @param {string} createdAt
 * @param {string} [status]
 */
function run(workDate, createdAt, status = 'working') {
  return { ...workRun({ workDate, status }), createdAt };
}

describe('sortRuns()', () => {
  it('作業日の昇順で並べる', () => {
    const runs = [
      run('2026-08-03', '2026-08-03T09:00:00+09:00'),
      run('2026-08-01', '2026-08-01T09:00:00+09:00'),
      run('2026-08-02', '2026-08-02T09:00:00+09:00'),
    ];

    expect(sortRuns(runs).map((item) => item.workDate)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('同じ作業日は作成日時の昇順で並べる（仕様書8.2.3）', () => {
    const runs = [
      run('2026-08-01', '2026-08-01T15:00:00+09:00'),
      run('2026-08-01', '2026-08-01T09:00:00+09:00'),
    ];

    expect(sortRuns(runs).map((item) => item.createdAt)).toEqual([
      '2026-08-01T09:00:00+09:00',
      '2026-08-01T15:00:00+09:00',
    ]);
  });

  it('元の配列を書き換えない', () => {
    const runs = [
      run('2026-08-02', '2026-08-02T09:00:00+09:00'),
      run('2026-08-01', '2026-08-01T09:00:00+09:00'),
    ];

    sortRuns(runs);

    expect(runs[0].workDate).toBe('2026-08-02');
  });
});

describe('numberRuns()', () => {
  it('表示順に1から振る', () => {
    const runs = [
      run('2026-08-02', '2026-08-02T09:00:00+09:00'),
      run('2026-08-01', '2026-08-01T09:00:00+09:00'),
    ];

    expect(numberRuns(runs).map((item) => [item.number, item.run.workDate])).toEqual([
      [1, '2026-08-01'],
      [2, '2026-08-02'],
    ]);
  });

  it('アーカイブ済みも数える', () => {
    const runs = [
      run('2026-08-01', '2026-08-01T09:00:00+09:00', 'archived'),
      run('2026-08-02', '2026-08-02T09:00:00+09:00'),
    ];

    expect(numberRuns(runs).map((item) => item.number)).toEqual([1, 2]);
  });

  it('作業項目が無くても数える', () => {
    expect(numberRuns([])).toEqual([]);
  });
});

describe('activeRuns()（仕様書10.1、過去のレビュー指摘）', () => {
  it('アーカイブ済みを一覧から外す', () => {
    const runs = [
      run('2026-08-01', '2026-08-01T09:00:00+09:00', 'archived'),
      run('2026-08-02', '2026-08-02T09:00:00+09:00'),
    ];

    expect(activeRuns(runs).map((item) => item.run.workDate)).toEqual(['2026-08-02']);
  });

  it('アーカイブしても残りの番号が繰り上がらない', () => {
    // ここが過去のレビュー指摘の核心である。表示中だけで数えると、第1回をアーカイブした
    // 瞬間に第2回が「第1回」になる。利用者は番号で記録を指すため、後から番号が
    // 動くと過去のやり取りと突き合わせられない。
    const before = [
      run('2026-08-01', '2026-08-01T09:00:00+09:00'),
      run('2026-08-02', '2026-08-02T09:00:00+09:00'),
      run('2026-08-03', '2026-08-03T09:00:00+09:00'),
    ];
    expect(activeRuns(before).map((item) => item.number)).toEqual([1, 2, 3]);

    const after = [
      { ...before[0], status: 'archived' },
      before[1],
      before[2],
    ];

    expect(activeRuns(after).map((item) => [item.number, item.run.workDate])).toEqual([
      [2, '2026-08-02'],
      [3, '2026-08-03'],
    ]);
  });

  it('間の回をアーカイブしても前後の番号は変わらない', () => {
    const runs = [
      run('2026-08-01', '2026-08-01T09:00:00+09:00'),
      run('2026-08-02', '2026-08-02T09:00:00+09:00', 'archived'),
      run('2026-08-03', '2026-08-03T09:00:00+09:00'),
    ];

    expect(activeRuns(runs).map((item) => item.number)).toEqual([1, 3]);
  });

  it('すべてアーカイブされると空になる', () => {
    const runs = [
      run('2026-08-01', '2026-08-01T09:00:00+09:00', 'archived'),
      run('2026-08-02', '2026-08-02T09:00:00+09:00', 'archived'),
    ];

    expect(activeRuns(runs)).toEqual([]);
  });

  it('転記済みは一覧へ残す（アーカイブとは別の状態）', () => {
    const runs = [run('2026-08-01', '2026-08-01T09:00:00+09:00', 'transferred')];

    expect(activeRuns(runs)).toHaveLength(1);
  });
});

describe('visibleRuns()', () => {
  it('採番済みの配列から絞る', () => {
    const numbered = numberRuns([
      run('2026-08-01', '2026-08-01T09:00:00+09:00', 'archived'),
      run('2026-08-02', '2026-08-02T09:00:00+09:00'),
    ]);

    expect(visibleRuns(numbered).map((item) => item.number)).toEqual([2]);
  });
});
