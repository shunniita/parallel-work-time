import { beforeEach, describe, expect, it } from 'vitest';

import { findOverlappingPairs, hasOverlap, intervalsOverlap } from '../../src/domain/overlap.js';
import { breakInterval, resetIds, workInterval } from '../fixtures/builders.js';

beforeEach(resetIds);

describe('intervalsOverlap', () => {
  it('時間帯が重なっていれば重複とする（仕様書8.9.5）', () => {
    const left = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:30:00+09:00');
    const right = workInterval('2026-07-30T09:20:00+09:00', '2026-07-30T09:40:00+09:00');
    expect(intervalsOverlap(left, right)).toBe(true);
  });

  it('前の終了と次の開始が同一なら重複としない', () => {
    // 休憩や参加者変更は同時刻で区間を継ぐため、接触を重複とすると
    // 正常な記録が常に警告対象になってしまう。
    const left = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00');
    const right = breakInterval('2026-07-30T09:20:00+09:00', '2026-07-30T09:30:00+09:00');
    expect(intervalsOverlap(left, right)).toBe(false);
  });

  it('離れている区間は重複としない', () => {
    const left = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00');
    const right = workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T10:20:00+09:00');
    expect(intervalsOverlap(left, right)).toBe(false);
  });

  it('一方が他方を完全に含む場合も重複とする', () => {
    const outer = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T12:00:00+09:00');
    const inner = workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T10:30:00+09:00');
    expect(intervalsOverlap(outer, inner)).toBe(true);
    expect(intervalsOverlap(inner, outer)).toBe(true);
  });

  it('未終了区間は以降のすべてと重複する', () => {
    const open = workInterval('2026-07-30T09:00:00+09:00', null);
    const later = workInterval('2026-07-31T09:00:00+09:00', '2026-07-31T09:30:00+09:00');
    expect(intervalsOverlap(open, later)).toBe(true);
  });

  it('未終了区間より前に終わった区間とは重複しない', () => {
    const open = workInterval('2026-07-30T09:00:00+09:00', null);
    const earlier = workInterval('2026-07-30T08:00:00+09:00', '2026-07-30T09:00:00+09:00');
    expect(intervalsOverlap(open, earlier)).toBe(false);
  });

  it('未終了区間どうしは重複とする', () => {
    const first = workInterval('2026-07-30T09:00:00+09:00', null);
    const second = workInterval('2026-07-30T10:00:00+09:00', null);
    expect(intervalsOverlap(first, second)).toBe(true);
  });

  it('0秒の区間が他区間の内部にあれば重複とする', () => {
    // 0秒の区間は許可されている（仕様書8.9.3）。他区間の内部にある場合は
    // 含まれているため重複として警告する。
    const zero = workInterval('2026-07-30T09:20:00+09:00', '2026-07-30T09:20:00+09:00');
    const surrounding = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:30:00+09:00');
    expect(intervalsOverlap(zero, surrounding)).toBe(true);
  });

  it('0秒の区間が他区間の境界上にあれば重複としない', () => {
    const zero = workInterval('2026-07-30T09:30:00+09:00', '2026-07-30T09:30:00+09:00');
    const before = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:30:00+09:00');
    expect(intervalsOverlap(zero, before)).toBe(false);
  });
});

describe('findOverlappingPairs / hasOverlap', () => {
  it('作業・休憩・作業と続く正常な記録では重複を検出しない', () => {
    const intervals = [
      workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00'),
      breakInterval('2026-07-30T09:20:00+09:00', '2026-07-30T09:30:00+09:00'),
      workInterval('2026-07-30T09:30:00+09:00', '2026-07-30T09:50:00+09:00'),
    ];

    expect(hasOverlap(intervals)).toBe(false);
    expect(findOverlappingPairs(intervals)).toEqual([]);
  });

  it('手動追加で重複した区間の組を返す（仕様書8.4.11）', () => {
    const base = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:00:00+09:00', ['甲']);
    const added = workInterval('2026-07-30T09:30:00+09:00', '2026-07-30T10:30:00+09:00', ['乙']);
    const separate = workInterval('2026-07-30T11:00:00+09:00', '2026-07-30T11:30:00+09:00', ['丙']);

    const pairs = findOverlappingPairs([base, added, separate]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].left.intervalId).toBe(base.intervalId);
    expect(pairs[0].right.intervalId).toBe(added.intervalId);
  });

  it('3区間がすべて重なる場合は3組を返す', () => {
    const intervals = [
      workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T12:00:00+09:00'),
      workInterval('2026-07-30T10:00:00+09:00', '2026-07-30T13:00:00+09:00'),
      workInterval('2026-07-30T11:00:00+09:00', '2026-07-30T14:00:00+09:00'),
    ];
    expect(findOverlappingPairs(intervals)).toHaveLength(3);
  });

  it('区間が0件または1件なら重複しない', () => {
    expect(hasOverlap([])).toBe(false);
    expect(hasOverlap([workInterval('2026-07-30T09:00:00+09:00', null)])).toBe(false);
  });
});
