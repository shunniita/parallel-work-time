// @vitest-environment happy-dom

/**
 * 作業項目詳細の単体テスト（仕様書12.2、12.3、12.4、7.2）。
 *
 * 状態と操作の対応（12.4）と区間履歴の表示を固定する。E2E は導線1本の確認に
 * 絞るため、状態ごとの組み合わせはここで見る。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskDetailView } from '../../../src/ui/views/taskDetailView.js';
import {
  breakInterval,
  projectGroup,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../../fixtures/builders.js';

const FIXED_NOW = new Date(2026, 7, 1, 12, 0, 0);

/**
 * 画面を描いて操作の口を返す。
 *
 * @param {{task?: object, status?: string}} [options]
 */
function mount(options = {}) {
  const task = options.task ?? taskRecord({ name: '受入確認' });
  const group = projectGroup({ projectId: 'PJ-0001' });
  const run = workRun({
    tasks: [task],
    projectGroupId: group.projectGroupId,
    status: options.status ?? 'working',
    workDate: '2026-08-01',
  });
  const container = document.createElement('div');
  document.body.replaceChildren(container);

  const actions = {
    recordStart: vi.fn(async () => ({ dataset: null, warnings: [] })),
    recordBreak: vi.fn(async () => ({ dataset: null, warnings: [] })),
    recordResume: vi.fn(async () => ({ dataset: null, warnings: [] })),
    recordFinish: vi.fn(async () => ({ dataset: null, warnings: [] })),
  };
  const handlers = { onBackToRun: vi.fn() };
  const store = {
    getState: () => ({
      dataset: { workRuns: [run], projectGroups: [group] },
      selection: {
        projectGroupId: group.projectGroupId,
        runId: run.runId,
        taskRecordId: task.taskRecordId,
      },
    }),
  };

  const view = createTaskDetailView({
    container,
    store,
    actions,
    handlers,
    now: () => FIXED_NOW,
  });
  view.render();

  const query = (testid) => container.querySelector(`[data-testid="${testid}"]`);
  const all = (testid) => [...container.querySelectorAll(`[data-testid="${testid}"]`)];
  return { view, container, actions, handlers, run, task, query, all };
}

/** 状態ごとの作業項目実績。 */
const TASKS = {
  notStarted: () => taskRecord({ name: '受入確認' }),
  working: () =>
    taskRecord({
      name: '受入確認',
      intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲'])],
    }),
  onBreak: () =>
    taskRecord({
      name: '受入確認',
      intervals: [
        workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00', ['甲']),
        breakInterval('2026-08-01T10:00:00+09:00', null, ['甲']),
      ],
    }),
  done: () =>
    taskRecord({
      name: '受入確認',
      intervals: [
        workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00', ['甲']),
      ],
    }),
};

describe('createTaskDetailView', () => {
  beforeEach(resetIds);

  describe('状態と操作の対応（仕様書12.4）', () => {
    it('未着手では開始だけを押せる', () => {
      const view = mount({ task: TASKS.notStarted() });

      expect(view.query('op-start').disabled).toBe(false);
      expect(view.query('op-break').disabled).toBe(true);
      expect(view.query('op-resume').disabled).toBe(true);
      expect(view.query('op-finish').disabled).toBe(true);
    });

    it('作業中では休憩と終了を押せる', () => {
      const view = mount({ task: TASKS.working() });

      expect(view.query('op-start').disabled).toBe(true);
      expect(view.query('op-break').disabled).toBe(false);
      expect(view.query('op-finish').disabled).toBe(false);
      expect(view.query('op-resume').disabled).toBe(true);
    });

    it('休憩中では再開と終了を押せる', () => {
      const view = mount({ task: TASKS.onBreak() });

      expect(view.query('op-resume').disabled).toBe(false);
      expect(view.query('op-finish').disabled).toBe(false);
      expect(view.query('op-break').disabled).toBe(true);
    });

    it('完了からは開始し直せる（仕様書7.2）', () => {
      const view = mount({ task: TASKS.done() });

      expect(view.query('op-start').disabled).toBe(false);
      expect(view.query('op-finish').disabled).toBe(true);
    });

    it('未実装の操作は理由を添えて無効にする', () => {
      const view = mount({ task: TASKS.working() });

      const button = view.query('op-changeParticipants');
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('次の段階');
    });

    it('現在状態をバッジで示す（仕様書12.3）', () => {
      const view = mount({ task: TASKS.onBreak() });

      expect(view.query('task-detail-state').textContent).toBe('休憩中');
    });
  });

  describe('状態ガード（仕様書7.2）', () => {
    it('転記済みでは操作を出さず理由を示す', () => {
      const view = mount({ task: TASKS.working(), status: 'transferred' });

      expect(view.query('task-operations')).toBeNull();
      expect(view.query('task-not-editable').textContent).toContain('転記済み');
    });

    it('アーカイブ済みでも同様に閲覧のみとする', () => {
      const view = mount({ task: TASKS.working(), status: 'archived' });

      expect(view.query('task-operations')).toBeNull();
      expect(view.query('task-not-editable').textContent).toContain('アーカイブ');
    });

    it('集計済みでは操作できる', () => {
      const view = mount({ task: TASKS.working(), status: 'aggregated' });

      expect(view.query('op-finish').disabled).toBe(false);
    });
  });

  describe('区間履歴', () => {
    it('区間が無ければ案内を出す', () => {
      const view = mount({ task: TASKS.notStarted() });

      expect(view.query('interval-empty')).not.toBeNull();
      expect(view.query('interval-list')).toBeNull();
    });

    it('種別・開始・終了・参加者・工数を出す', () => {
      const view = mount({
        task: taskRecord({
          intervals: [
            workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T09:20:00+09:00', [
              '甲',
              '乙',
            ]),
          ],
        }),
      });

      expect(view.query('interval-type').textContent).toBe('作業');
      expect(view.query('interval-start').textContent).toBe('2026-08-01 09:00:00');
      expect(view.query('interval-end').textContent).toBe('2026-08-01 09:20:00');
      expect(view.query('interval-participants').textContent).toBe('甲、乙');
      // 20分 × 2人 = 40分（仕様書8.6.1）。
      expect(view.query('interval-effort').textContent).toBe('40分');
    });

    it('未終了区間は進行中と示す（仕様書6.7）', () => {
      const view = mount({ task: TASKS.working() });

      expect(view.query('interval-end').textContent).toBe('進行中');
    });

    it('日をまたぐ区間でも終了の日付が読める（仕様書8.4.8）', () => {
      const view = mount({
        task: taskRecord({
          intervals: [
            workInterval('2026-07-31T23:30:00+09:00', '2026-08-01T01:15:00+09:00', ['甲']),
          ],
        }),
      });

      expect(view.query('interval-end').textContent).toBe('2026-08-01 01:15:00');
    });

    it('開始が早い順に並べる', () => {
      const view = mount({
        task: taskRecord({
          intervals: [
            workInterval('2026-08-01T13:00:00+09:00', '2026-08-01T14:00:00+09:00', ['甲']),
            workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00', ['甲']),
          ],
        }),
      });

      expect(view.all('interval-start').map((node) => node.textContent)).toEqual([
        '2026-08-01 09:00:00',
        '2026-08-01 13:00:00',
      ]);
    });

    it('休憩区間は0秒として出す（仕様書8.6.2）', () => {
      const view = mount({ task: TASKS.onBreak() });

      const efforts = view.all('interval-effort').map((node) => node.textContent);
      expect(efforts).toEqual(['60分', '0分']);
    });
  });

  describe('工数内訳（仕様書12.3、8.6.5）', () => {
    it('時刻入力分・直接入力分・合計・転記値を出す', () => {
      const view = mount({ task: TASKS.done() });

      expect(view.query('summary-time').textContent).toBe('60分');
      expect(view.query('summary-direct').textContent).toBe('0分');
      expect(view.query('summary-total').textContent).toBe('60分');
      expect(view.query('summary-transfer').textContent).toBe('60分');
    });

    it('未終了区間があるうちは転記値を未確定とする', () => {
      const view = mount({ task: TASKS.working() });

      expect(view.query('summary-transfer').textContent).toContain('未確定');
    });
  });

  describe('操作', () => {
    it('ボタンを押すとフォームが開く（押した時点では記録しない）', () => {
      const view = mount({ task: TASKS.working() });

      view.query('op-break').click();

      expect(view.query('op-form').dataset.operation).toBe('break');
      expect(view.actions.recordBreak).not.toHaveBeenCalled();
    });

    it('確定すると対象を添えてアクションを呼ぶ', async () => {
      const view = mount({ task: TASKS.working() });
      view.query('op-break').click();

      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordBreak).toHaveBeenCalled());

      expect(view.actions.recordBreak).toHaveBeenCalledWith(
        { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
        { at: expect.stringMatching(/^2026-08-01T12:00:00/) },
      );
    });

    it('開始では参加者も渡す（仕様書8.9.4）', async () => {
      const view = mount({ task: TASKS.notStarted() });
      view.query('op-start').click();
      view.query('op-participants').value = '甲';

      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordStart).toHaveBeenCalled());

      expect(view.actions.recordStart.mock.calls[0][1].participants).toEqual(['甲']);
    });

    it('保存の途中で再描画が走ってもフォームを閉じる', async () => {
      const view = mount({ task: TASKS.working() });
      // 保存に成功すると `main.js` のストア購読が再描画する。それはビューが
      // 開いているフォームを片付ける前に起きるため、後から描き直さないと
      // 記録済みなのに入力欄が残る。
      view.actions.recordFinish.mockImplementation(async () => {
        view.view.render();
        return { dataset: { workRuns: [] }, warnings: [] };
      });
      view.query('op-finish').click();

      view.query('op-submit').click();

      await vi.waitFor(() => expect(view.query('op-form')).toBeNull());
    });

    it('取消でフォームを閉じる', () => {
      const view = mount({ task: TASKS.working() });
      view.query('op-break').click();

      view.query('op-cancel').click();

      expect(view.query('op-form')).toBeNull();
    });

    it('保存で出た警告を記録後に示す（仕様書8.9.5）', async () => {
      const view = mount({ task: TASKS.working() });
      view.actions.recordFinish.mockResolvedValue({
        dataset: null,
        warnings: [{ code: 'intervalOverlap', path: '作業区間', message: '時間帯が重なる組がある' }],
      });
      view.query('op-finish').click();

      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.query('task-warnings')).not.toBeNull());

      expect(view.query('task-warnings').textContent).toContain('時間帯が重なる');
      expect(view.query('op-form')).toBeNull();
    });
  });

  it('実施回へ戻れる', () => {
    const view = mount({ task: TASKS.working() });

    view.query('back-to-run').click();

    expect(view.handlers.onBackToRun).toHaveBeenCalledWith(view.run.runId);
  });

  it('作業項目を選んでいなければ案内を出す', () => {
    const container = document.createElement('div');
    const store = {
      getState: () => ({
        dataset: { workRuns: [], projectGroups: [] },
        selection: { projectGroupId: null, runId: null, taskRecordId: null },
      }),
    };
    const view = createTaskDetailView({
      container,
      store,
      actions: {},
      handlers: { onBackToRun: vi.fn() },
    });

    view.render();

    expect(container.querySelector('[data-testid="task-detail-empty"]')).not.toBeNull();
  });
});
