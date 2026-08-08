// @vitest-environment happy-dom

/**
 * 警告領域の単体テスト（仕様書8.8.1、8.8.2、8.10）。
 *
 * 内容の計算そのものは `warnings.test.js` が持つ。ここは表示・畳み・1分ごとの
 * 部分更新・多重タブ警告の切り替えを固定する。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultSettings } from '../../../src/config.js';
import { MULTI_TAB_MESSAGE, createWarningBar } from '../../../src/ui/warningBar.js';
import {
  projectGroup,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../../fixtures/builders.js';

beforeEach(resetIds);

const NOW = new Date('2026-08-01T12:00:00+09:00');

/**
 * 警告領域を描いて操作の口を返す。
 *
 * @param {{runs?: object[], groups?: object[], now?: Date,
 *          thresholdHours?: number}} [options]
 */
function mount(options = {}) {
  const container = document.createElement('section');
  container.hidden = true;
  document.body.replaceChildren(container);

  const state = {
    dataset: {
      settings: {
        ...createDefaultSettings(),
        longRunningThresholdHours: options.thresholdHours ?? 12,
      },
      taskTemplates: [],
      projectGroups: options.groups ?? [],
      workRuns: options.runs ?? [],
      changeHistory: [],
    },
  };
  const handlers = { onSelectTask: vi.fn() };
  let now = options.now ?? NOW;
  const bar = createWarningBar({
    container,
    store: { getState: () => state },
    now: () => now,
    handlers,
  });
  bar.render();

  return {
    bar,
    container,
    handlers,
    state,
    setNow: (next) => {
      now = next;
    },
    query: (testid) => container.querySelector(`[data-testid="${testid}"]`),
    all: (testid) => [...container.querySelectorAll(`[data-testid="${testid}"]`)],
  };
}

/** 未終了区間を1本持つ実施回と案件。 */
function openRunFixture(startAt, taskName = '受入確認') {
  const group = projectGroup({ projectId: 'PJ-0001' });
  const run = workRun({
    projectGroupId: group.projectGroupId,
    tasks: [taskRecord({ name: taskName, intervals: [workInterval(startAt, null)] })],
  });
  return { group, run };
}

describe('createWarningBar', () => {
  it('中身が無いあいだは畳まれている', () => {
    const view = mount();

    expect(view.container.hidden).toBe(true);
  });

  it('未終了区間があると一覧を出す（仕様書8.8.1）', () => {
    const { group, run } = openRunFixture('2026-08-01T10:30:00+09:00');
    const view = mount({ groups: [group], runs: [run] });

    expect(view.container.hidden).toBe(false);
    expect(view.query('warning-open-count').textContent).toBe('未終了の区間 1件');
    const link = view.query('warning-open-link');
    expect(link.textContent).toBe('PJ-0001 第1回 受入確認');
    expect(view.query('warning-elapsed').textContent).toBe('経過 1時間30分');
  });

  it('リンクを押すと作業項目へ移る', () => {
    const { group, run } = openRunFixture('2026-08-01T10:30:00+09:00');
    const view = mount({ groups: [group], runs: [run] });

    view.query('warning-open-link').click();

    expect(view.handlers.onSelectTask).toHaveBeenCalledWith(
      group.projectGroupId,
      run.runId,
      run.tasks[0].taskRecordId,
    );
  });

  it('しきい値を超えると強調する（仕様書8.8.2）', () => {
    const { group, run } = openRunFixture('2026-07-31T23:00:00+09:00');
    const view = mount({ groups: [group], runs: [run] });

    expect(view.query('warning-open-count').textContent).toContain('しきい値超過 1件');
    expect(view.query('warning-elapsed').textContent).toContain('しきい値超過');
    expect(view.query('warning-open-interval').className).toContain('--exceeded');
  });

  it('しきい値は設定値を使う（仕様書8.8.3）', () => {
    const { group, run } = openRunFixture('2026-08-01T10:30:00+09:00');
    const view = mount({ groups: [group], runs: [run], thresholdHours: 1 });

    expect(view.query('warning-elapsed').textContent).toContain('しきい値超過');
  });

  describe('1分ごとの再評価（仕様書8.8）', () => {
    it('tick で経過と超過が更新される', () => {
      const { group, run } = openRunFixture('2026-08-01T10:30:00+09:00');
      const view = mount({ groups: [group], runs: [run], thresholdHours: 2 });
      expect(view.query('warning-elapsed').textContent).toBe('経過 1時間30分');

      view.setNow(new Date('2026-08-01T12:31:00+09:00'));
      view.bar.tick();

      expect(view.query('warning-elapsed').textContent).toBe(
        '経過 2時間1分（しきい値超過）',
      );
      expect(view.query('warning-open-interval').className).toContain('--exceeded');
      // 件数見出しも取り残さない。
      expect(view.query('warning-open-count').textContent).toBe(
        '未終了の区間 1件（しきい値超過 1件）',
      );
    });

    it('tick は構造を作り直さず、フォーカスを奪わない', () => {
      // 1分ごとに全再描画すると、警告領域のリンクへフォーカスしていた利用者が
      // 毎分フォーカスを失う（store.js の規約3）。
      const { group, run } = openRunFixture('2026-08-01T10:30:00+09:00');
      const view = mount({ groups: [group], runs: [run] });
      const link = view.query('warning-open-link');
      link.focus();
      expect(document.activeElement).toBe(link);

      view.setNow(new Date('2026-08-01T12:01:00+09:00'));
      view.bar.tick();

      expect(document.activeElement).toBe(link);
      expect(view.query('warning-open-link')).toBe(link);
    });

    it('未終了区間の集合が変わっていたら描き直す', () => {
      const { group, run } = openRunFixture('2026-08-01T10:30:00+09:00');
      const view = mount({ groups: [group], runs: [run] });
      expect(view.all('warning-open-interval')).toHaveLength(1);

      run.tasks[0].intervals[0].endAt = '2026-08-01T11:00:00+09:00';
      view.bar.tick();

      expect(view.container.hidden).toBe(true);
    });
  });

  describe('多重タブの警告（仕様書8.10）', () => {
    it('検知すると定めの文言を出す', () => {
      const view = mount();

      view.bar.setMultiTab(true);

      expect(view.container.hidden).toBe(false);
      expect(view.query('multi-tab-warning').textContent).toBe(MULTI_TAB_MESSAGE);
    });

    it('相手がいなくなったら畳む', () => {
      const view = mount();
      view.bar.setMultiTab(true);

      view.bar.setMultiTab(false);

      expect(view.container.hidden).toBe(true);
    });
  });

  describe('アプリの通知', () => {
    it('通知を出せる', () => {
      const view = mount();

      view.bar.addNotice('サンプルテンプレートを読み込めませんでした。');

      expect(view.query('warning-notice').textContent).toContain('サンプルテンプレート');
    });

    it('同じ文言は重ねない', () => {
      const view = mount();

      view.bar.addNotice('同じ通知');
      view.bar.addNotice('同じ通知');

      expect(view.all('warning-notice')).toHaveLength(1);
    });
  });

  it('閲覧のみの実施回に残る未終了区間には状態を添える', () => {
    const group = projectGroup({ projectId: 'PJ-0001' });
    const run = workRun({
      projectGroupId: group.projectGroupId,
      status: 'transferred',
      transferredAt: '2026-08-01T11:00:00+09:00',
      tasks: [
        taskRecord({ intervals: [workInterval('2026-08-01T09:00:00+09:00', null)] }),
      ],
    });
    const view = mount({ groups: [group], runs: [run] });

    expect(view.query('warning-open-interval').textContent).toContain('閲覧のみの実施回');
  });
});
