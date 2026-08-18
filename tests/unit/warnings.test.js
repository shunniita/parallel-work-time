/**
 * 警告領域の内容組み立ての単体テスト（仕様書8.8.1、8.8.2）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  collectOpenIntervals,
  formatElapsed,
  summarizeOpenIntervals,
} from '../../src/domain/warnings.js';
import { RUN_STATUS } from '../../src/domain/schema.js';
import {
  projectGroup,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../fixtures/builders.js';

beforeEach(resetIds);

const NOW = new Date('2026-08-01T12:00:00+09:00');

/** 未終了区間を1本持つ作業項目。 */
function openTask(startAt, overrides = {}) {
  return taskRecord({ intervals: [workInterval(startAt, null)], ...overrides });
}

describe('collectOpenIntervals()（仕様書8.8.1）', () => {
  it('未終了区間だけを集め、案件・実施回・作業項目を添える', () => {
    const group = projectGroup({ projectId: 'PJ-0001' });
    const run = workRun({
      projectGroupId: group.projectGroupId,
      tasks: [
        taskRecord({
          name: '受入確認',
          intervals: [
            workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00'),
            workInterval('2026-08-01T10:30:00+09:00', null),
          ],
        }),
      ],
    });

    const items = collectOpenIntervals({ projectGroups: [group], workRuns: [run] });

    expect(items).toHaveLength(1);
    expect(items[0].projectGroup.projectId).toBe('PJ-0001');
    expect(items[0].runNumber).toBe(1);
    expect(items[0].taskRecord.name).toBe('受入確認');
    expect(items[0].interval.startAt).toBe('2026-08-01T10:30:00+09:00');
  });

  it('開始の古い順に並べる', () => {
    const group = projectGroup();
    const run = workRun({
      projectGroupId: group.projectGroupId,
      tasks: [
        openTask('2026-08-01T11:00:00+09:00', { name: '後' }),
        openTask('2026-08-01T09:00:00+09:00', { name: '先' }),
      ],
    });

    const items = collectOpenIntervals({ projectGroups: [group], workRuns: [run] });

    expect(items.map((item) => item.taskRecord.name)).toEqual(['先', '後']);
  });

  it('実施回の状態では絞らない（転記済みに残る未終了も出す）', () => {
    // 通常の操作では起きないが、取り込んだJSONには存在しうる。警告領域は
    // 「気づかれていない記録」を見せる場所なので、状態を理由に隠さない。
    const group = projectGroup();
    const run = workRun({
      projectGroupId: group.projectGroupId,
      status: RUN_STATUS.TRANSFERRED,
      transferredAt: '2026-08-01T11:00:00+09:00',
      tasks: [openTask('2026-08-01T09:00:00+09:00')],
    });

    const items = collectOpenIntervals({ projectGroups: [group], workRuns: [run] });

    expect(items).toHaveLength(1);
  });

  it('第n回の採番は案件の全実施回を通して振る（過去のレビュー指摘と同じ規則）', () => {
    const group = projectGroup();
    const first = workRun({
      projectGroupId: group.projectGroupId,
      workDate: '2026-07-01',
    });
    const second = workRun({
      projectGroupId: group.projectGroupId,
      workDate: '2026-08-01',
      tasks: [openTask('2026-08-01T09:00:00+09:00')],
    });

    const items = collectOpenIntervals({
      projectGroups: [group],
      workRuns: [first, second],
    });

    expect(items[0].runNumber).toBe(2);
  });

  it('未終了が無ければ空になる', () => {
    const group = projectGroup();
    const run = workRun({
      projectGroupId: group.projectGroupId,
      tasks: [
        taskRecord({
          intervals: [workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00')],
        }),
      ],
    });

    expect(collectOpenIntervals({ projectGroups: [group], workRuns: [run] })).toEqual([]);
  });
});

describe('summarizeOpenIntervals()（仕様書8.8.2）', () => {
  it('しきい値を超えたものへ超過の印を付ける', () => {
    const group = projectGroup();
    const run = workRun({
      projectGroupId: group.projectGroupId,
      tasks: [
        openTask('2026-07-31T23:00:00+09:00', { name: '超過' }),
        openTask('2026-08-01T11:00:00+09:00', { name: '正常' }),
      ],
    });

    const summary = summarizeOpenIntervals(
      { projectGroups: [group], workRuns: [run] },
      { now: NOW, thresholdHours: 12 },
    );

    expect(summary.items.map((item) => [item.taskRecord.name, item.exceeded])).toEqual([
      ['超過', true],
      ['正常', false],
    ]);
    expect(summary.exceededCount).toBe(1);
  });

  it('経過を分で持つ', () => {
    const group = projectGroup();
    const run = workRun({
      projectGroupId: group.projectGroupId,
      tasks: [openTask('2026-08-01T09:30:00+09:00')],
    });

    const summary = summarizeOpenIntervals(
      { projectGroups: [group], workRuns: [run] },
      { now: NOW, thresholdHours: 12 },
    );

    expect(summary.items[0].elapsedMinutes).toBe(150);
  });

  it('開始が現在より後でも負にならない', () => {
    // 手動追加やインポートで未来開始の区間が存在しうる。「経過 -5分」は出さない。
    const group = projectGroup();
    const run = workRun({
      projectGroupId: group.projectGroupId,
      tasks: [openTask('2026-08-01T12:05:00+09:00')],
    });

    const summary = summarizeOpenIntervals(
      { projectGroups: [group], workRuns: [run] },
      { now: NOW, thresholdHours: 12 },
    );

    expect(summary.items[0].elapsedMinutes).toBe(0);
    expect(summary.items[0].exceeded).toBe(false);
  });
});

describe('formatElapsed()', () => {
  it.each([
    [0, '0分'],
    [45, '45分'],
    [60, '1時間0分'],
    [150, '2時間30分'],
  ])('%i分 → %s', (minutes, expected) => {
    expect(formatElapsed(minutes)).toBe(expected);
  });
});
