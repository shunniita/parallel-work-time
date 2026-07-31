/**
 * 数量集計の単体テスト（仕様書8.2.5、8.2.7、8.9.7）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  groupRunsByProject,
  previewQuantity,
  previewTotalQuantity,
  summarizeQuantity,
} from '../../src/domain/quantity.js';
import { projectGroup, resetIds, workRun } from '../fixtures/builders.js';

beforeEach(() => {
  resetIds();
});

describe('summarizeQuantity()', () => {
  it('総予定数100・第1回50・第2回50で累計100・残数0（T-02、A-02）', () => {
    const group = projectGroup({ totalQuantity: 100 });
    const runs = [
      workRun({ projectGroupId: group.projectGroupId, runQuantity: 50 }),
      workRun({ projectGroupId: group.projectGroupId, runQuantity: 50 }),
    ];

    expect(summarizeQuantity(group, runs)).toEqual({
      totalQuantity: 100,
      accumulated: 100,
      remaining: 0,
      runCount: 2,
      exceeded: false,
    });
  });

  it('実施回が無ければ累計0・残数は総予定数', () => {
    expect(summarizeQuantity(projectGroup({ totalQuantity: 100 }), [])).toMatchObject({
      accumulated: 0,
      remaining: 100,
      runCount: 0,
    });
  });

  it('アーカイブ済みの実施回も累計へ含める（仕様書8.2.5）', () => {
    const group = projectGroup({ totalQuantity: 100 });
    const runs = [
      workRun({ projectGroupId: group.projectGroupId, runQuantity: 30, status: 'working' }),
      workRun({
        projectGroupId: group.projectGroupId,
        runQuantity: 40,
        status: 'archived',
        archivedAt: '2026-07-31T20:00:00+09:00',
      }),
    ];

    // アーカイブを除くと累計30・残数70になってしまい、実態と合わない。
    expect(summarizeQuantity(group, runs)).toMatchObject({ accumulated: 70, remaining: 30 });
  });

  it.each(['working', 'aggregated', 'transferred', 'archived'])(
    '状態が %s の実施回も累計へ含める',
    (status) => {
      const group = projectGroup({ totalQuantity: 100 });
      const runs = [workRun({ projectGroupId: group.projectGroupId, runQuantity: 25, status })];

      expect(summarizeQuantity(group, runs).accumulated).toBe(25);
    },
  );

  it('残数は総予定数 − 累計数量である', () => {
    const group = projectGroup({ totalQuantity: 80 });
    const runs = [workRun({ runQuantity: 30 }), workRun({ runQuantity: 20 })];

    expect(summarizeQuantity(group, runs).remaining).toBe(30);
  });

  it('累計が総予定数を超えると残数が負になり exceeded が立つ（仕様書8.9.7）', () => {
    const group = projectGroup({ totalQuantity: 100 });
    const runs = [workRun({ runQuantity: 60 }), workRun({ runQuantity: 60 })];

    // 0で止めるとどれだけ超えたか分からなくなるため、負値のまま返す。
    expect(summarizeQuantity(group, runs)).toMatchObject({
      accumulated: 120,
      remaining: -20,
      exceeded: true,
    });
  });

  it('ちょうど総予定数に達した場合は超過としない', () => {
    const group = projectGroup({ totalQuantity: 50 });

    expect(summarizeQuantity(group, [workRun({ runQuantity: 50 })]).exceeded).toBe(false);
  });
});

describe('groupRunsByProject()', () => {
  it('案件グループごとに束ねる', () => {
    const runs = [
      workRun({ projectGroupId: 'group-a', runQuantity: 10 }),
      workRun({ projectGroupId: 'group-b', runQuantity: 20 }),
      workRun({ projectGroupId: 'group-a', runQuantity: 30 }),
    ];

    const byProject = groupRunsByProject(runs);

    expect(byProject.get('group-a')).toHaveLength(2);
    expect(byProject.get('group-b')).toHaveLength(1);
  });

  it('該当が無い案件グループはキーを持たない', () => {
    expect(groupRunsByProject([]).get('group-a')).toBeUndefined();
  });
});

describe('previewQuantity()', () => {
  it('追加後の累計を先読みする（仕様書8.9.7）', () => {
    const group = projectGroup({ totalQuantity: 100 });
    const runs = [workRun({ runQuantity: 50 })];

    expect(previewQuantity(group, runs, { runQuantity: 30 })).toEqual({
      accumulated: 80,
      remaining: 20,
      exceeded: false,
      overBy: 0,
    });
  });

  it('超過分を overBy で示す', () => {
    const group = projectGroup({ totalQuantity: 100 });
    const runs = [workRun({ runQuantity: 90 })];

    expect(previewQuantity(group, runs, { runQuantity: 30 })).toMatchObject({
      accumulated: 120,
      remaining: -20,
      exceeded: true,
      overBy: 20,
    });
  });

  it('既存の実施回を修正する場合は古い数量を差し引く（仕様書8.2.7）', () => {
    const group = projectGroup({ totalQuantity: 100 });
    const target = workRun({ runQuantity: 50 });
    const runs = [target, workRun({ runQuantity: 20 })];

    // 50 → 70 へ修正。累計は 20 + 70 = 90。
    expect(
      previewQuantity(group, runs, { runQuantity: 70, excludeRunId: target.runId }),
    ).toMatchObject({ accumulated: 90, remaining: 10 });
  });

  it('excludeRunId が無ければ全実施回に足し込む', () => {
    const group = projectGroup({ totalQuantity: 100 });
    const runs = [workRun({ runQuantity: 50 })];

    expect(previewQuantity(group, runs, { runQuantity: 50, excludeRunId: null }).accumulated).toBe(
      100,
    );
  });
});

describe('previewTotalQuantity()', () => {
  it('総予定数の修正後の残数を先読みする（仕様書8.2.7）', () => {
    const runs = [workRun({ runQuantity: 50 }), workRun({ runQuantity: 30 })];

    expect(previewTotalQuantity(runs, 120)).toEqual({
      accumulated: 80,
      remaining: 40,
      exceeded: false,
      overBy: 0,
    });
  });

  it('累計より小さい値へ修正すると超過になる', () => {
    const runs = [workRun({ runQuantity: 50 }), workRun({ runQuantity: 30 })];

    expect(previewTotalQuantity(runs, 60)).toMatchObject({
      accumulated: 80,
      remaining: -20,
      exceeded: true,
      overBy: 20,
    });
  });

  it('実施回が無ければ残数は総予定数そのもの', () => {
    expect(previewTotalQuantity([], 100)).toMatchObject({ accumulated: 0, remaining: 100 });
  });
});
