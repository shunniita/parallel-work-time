/**
 * 参加者名の正規化と候補抽出（仕様書8.4.7、8.6.1）。
 *
 * 正規化は区間・直接入力・取り込み検証が共有する唯一の「同じ顔ぶれ」の定義で
 * ある。収集範囲は全実施回、並びは「当該実施回で出ている名前 → それ以外」
 * （過去の設計メモ）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  collectParticipants,
  normalizeParticipants,
  participantsInRun,
} from '../../src/domain/participants.js';
import {
  breakInterval,
  directEntry,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../fixtures/builders.js';

const START = '2026-07-30T09:00:00+09:00';
const END = '2026-07-30T10:00:00+09:00';

describe('normalizeParticipants（仕様書8.6.1、8.9.9）', () => {
  it('前後空白を落とす', () => {
    expect(normalizeParticipants([' 甲 ', '乙'])).toEqual(['甲', '乙']);
  });

  it('空文字を除く', () => {
    expect(normalizeParticipants(['甲', '', '   '])).toEqual(['甲']);
  });

  it('完全一致の重複をまとめる', () => {
    expect(normalizeParticipants(['甲', '甲', '乙'])).toEqual(['甲', '乙']);
  });

  it('表記ゆれは別人として残す（仕様書8.9.9）', () => {
    expect(normalizeParticipants(['甲', '甲 太郎'])).toEqual(['甲', '甲 太郎']);
  });

  it('配列でなければ null', () => {
    expect(normalizeParticipants('甲')).toBeNull();
    expect(normalizeParticipants(undefined)).toBeNull();
    expect(normalizeParticipants(['甲', 1])).toBeNull();
  });
});

describe('participantsInRun', () => {
  beforeEach(resetIds);

  it('全作業項目の区間から名前を集める', () => {
    const run = workRun({
      tasks: [
        taskRecord({ intervals: [workInterval(START, END, ['甲', '乙'])] }),
        taskRecord({ intervals: [workInterval(START, END, ['丙'])] }),
      ],
    });

    expect([...participantsInRun(run)].sort()).toEqual(['丙', '乙', '甲'].sort());
  });

  it('直接入力の参加者も含める（仕様書6.8）', () => {
    const run = workRun({
      tasks: [taskRecord({ directEntries: [directEntry(600, { participants: ['丁'] })] })],
    });

    expect([...participantsInRun(run)]).toEqual(['丁']);
  });

  it('作業項目が無い実施回は空', () => {
    expect([...participantsInRun(workRun())]).toEqual([]);
  });
});

describe('collectParticipants（仕様書8.4.7）', () => {
  beforeEach(resetIds);

  it('全実施回から重複なく集める', () => {
    const runs = [
      workRun({ tasks: [taskRecord({ intervals: [workInterval(START, END, ['甲'])] })] }),
      workRun({
        tasks: [taskRecord({ intervals: [workInterval(START, END, ['甲', '乙'])] })],
      }),
    ];

    expect(collectParticipants(runs)).toHaveLength(2);
    expect(collectParticipants(runs)).toEqual(expect.arrayContaining(['甲', '乙']));
  });

  it('当該実施回で出ている名前を先頭群へ置く', () => {
    const current = workRun({
      tasks: [taskRecord({ intervals: [workInterval(START, END, ['丙'])] })],
    });
    const other = workRun({
      tasks: [taskRecord({ intervals: [workInterval(START, END, ['甲', '乙'])] })],
    });

    const candidates = collectParticipants([other, current], { runId: current.runId });

    expect(candidates[0]).toBe('丙');
    expect(candidates.slice(1).sort()).toEqual(['乙', '甲'].sort());
  });

  it('当該実施回にも他の実施回にもいる名前は先頭群へ入れる', () => {
    const current = workRun({
      tasks: [taskRecord({ intervals: [workInterval(START, END, ['甲'])] })],
    });
    const other = workRun({
      tasks: [taskRecord({ intervals: [workInterval(START, END, ['甲', '乙'])] })],
    });

    expect(collectParticipants([other, current], { runId: current.runId })).toEqual([
      '甲',
      '乙',
    ]);
  });

  it('runId を渡さなければ全体を一つの群として並べる', () => {
    const runs = [
      workRun({
        tasks: [taskRecord({ intervals: [workInterval(START, END, ['B-2', 'B-10'])] })],
      }),
    ];

    // 群の中は自然順。数値部分を数値として比べる（`naturalSort.js`）。
    expect(collectParticipants(runs)).toEqual(['B-2', 'B-10']);
  });

  it('該当しない runId を渡しても落ちない', () => {
    const runs = [
      workRun({ tasks: [taskRecord({ intervals: [workInterval(START, END, ['甲'])] })] }),
    ];

    expect(collectParticipants(runs, { runId: 'missing' })).toEqual(['甲']);
  });

  it('前後空白を落とし、空文字は候補にしない', () => {
    const runs = [
      workRun({
        tasks: [taskRecord({ intervals: [workInterval(START, END, [' 甲 ', '', '  '])] })],
      }),
    ];

    expect(collectParticipants(runs)).toEqual(['甲']);
  });

  it('休憩区間の参加者も候補になる', () => {
    const runs = [
      workRun({ tasks: [taskRecord({ intervals: [breakInterval(START, END, ['戊'])] })] }),
    ];

    expect(collectParticipants(runs)).toEqual(['戊']);
  });

  it('壊れたデータが混じっても走査を止めない', () => {
    const runs = [
      { runId: 'run-broken', tasks: [{ intervals: [{ participants: null }] }] },
      { runId: 'run-broken-2' },
      { runId: 'run-broken-3', tasks: [{ intervals: [{ participants: [42, null] }] }] },
      workRun({ tasks: [taskRecord({ intervals: [workInterval(START, END, ['甲'])] })] }),
    ];

    expect(collectParticipants(runs)).toEqual(['甲']);
  });

  it('実施回が無ければ空', () => {
    expect(collectParticipants([])).toEqual([]);
    expect(collectParticipants(undefined)).toEqual([]);
  });
});
