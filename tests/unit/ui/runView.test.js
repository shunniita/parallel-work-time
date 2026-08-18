// @vitest-environment happy-dom

/**
 * 実施回詳細の単体テスト（仕様書12.3、12.4、8.4.9）。
 *
 * 作業項目行からの操作（状態に応じたボタン、対象行の直下に開くフォーム）と、
 * 複数項目を独立して扱えることを固定する。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRunView } from '../../../src/ui/views/runView.js';
import { VIEW } from '../../../src/ui/shell.js';
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
 * 実施回詳細を描く。
 *
 * @param {{tasks?: object[], status?: string}} [options]
 */
function mount(options = {}) {
  const tasks = options.tasks ?? [taskRecord({ name: '受入確認', order: 1 })];
  const group = projectGroup({ projectId: 'PJ-0001' });
  const run = workRun({
    tasks,
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
    recordParticipantChange: vi.fn(async () => ({ dataset: null, warnings: [] })),
  };
  const handlers = { onOpenTask: vi.fn(), onSelectProject: vi.fn() };
  /** 案件画面・当該実施回を表示中の状態。navigateAway() で書き換えて模擬する。 */
  let state = {
    view: VIEW.PROJECTS,
    dataset: { workRuns: [run], projectGroups: [group] },
    selection: {
      projectGroupId: group.projectGroupId,
      runId: run.runId,
      taskRecordId: null,
    },
  };
  const store = { getState: () => state };

  const view = createRunView({
    container,
    store,
    actions,
    handlers,
    now: () => FIXED_NOW,
  });
  view.render();

  const rows = () => [...container.querySelectorAll('[data-testid="task-row"]')];
  const rowOf = (name) =>
    rows().find(
      (row) => row.querySelector('[data-testid="task-name"]').textContent === name,
    );
  return {
    view,
    container,
    actions,
    handlers,
    run,
    tasks,
    rows,
    rowOf,
    query: (testid) => container.querySelector(`[data-testid="${testid}"]`),
    /** 行に出ている操作ボタンの名前。 */
    rowOperations: (name) =>
      [...rowOf(name).querySelectorAll('button')].map((button) => button.textContent),
    /** 保存を待つあいだに、利用者が別の画面／別の実施回へ移った状態を模す。 */
    navigateAway: (patch) => {
      state = { ...state, selection: { ...state.selection, ...patch } };
    },
  };
}

const working = (name, order) =>
  taskRecord({
    name,
    order,
    intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲'])],
  });

describe('createRunView', () => {
  beforeEach(resetIds);

  describe('作業項目行の操作ボタン（仕様書12.4）', () => {
    it('未着手の行には開始を出す', () => {
      const view = mount();

      expect(view.rowOperations('受入確認')).toEqual(['受入確認', '開始', '詳細']);
    });

    it('作業中の行には休憩・終了・参加者変更を出す', () => {
      const view = mount({ tasks: [working('受入確認', 1)] });

      expect(view.rowOperations('受入確認')).toEqual([
        '受入確認',
        '休憩',
        '終了',
        '参加者変更',
        '詳細',
      ]);
    });

    it('休憩中の行には再開・終了・参加者変更を出す', () => {
      const view = mount({
        tasks: [
          taskRecord({
            name: '受入確認',
            intervals: [
              workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00', ['甲']),
              breakInterval('2026-08-01T10:00:00+09:00', null, ['甲']),
            ],
          }),
        ],
      });

      expect(view.rowOperations('受入確認')).toEqual([
        '受入確認',
        '再開',
        '終了',
        '参加者変更',
        '詳細',
      ]);
    });

    it('転記済みでは操作を出さず理由を示す（仕様書7.2）', () => {
      const view = mount({ tasks: [working('受入確認', 1)], status: 'transferred' });

      expect(view.rowOperations('受入確認')).toEqual(['受入確認', '詳細']);
      expect(view.query('run-not-editable').textContent).toContain('転記済み');
    });
  });

  describe('操作フォーム', () => {
    it('押した行の直下に開く', () => {
      const view = mount({ tasks: [working('受入確認', 1)] });

      view.rowOf('受入確認').querySelector('[data-testid="row-op-break"]').click();

      const formRow = view.query('task-form-row');
      expect(formRow).not.toBeNull();
      expect(view.rowOf('受入確認').nextElementSibling).toBe(formRow);
      expect(formRow.querySelector('[data-testid="op-form"]').dataset.operation).toBe('break');
    });

    it('押した時点では記録しない（仕様書12.4）', () => {
      const view = mount({ tasks: [working('受入確認', 1)] });

      view.rowOf('受入確認').querySelector('[data-testid="row-op-break"]').click();

      expect(view.actions.recordBreak).not.toHaveBeenCalled();
    });

    it('確定すると対象の作業項目を添えてアクションを呼ぶ', async () => {
      const view = mount({ tasks: [working('受入確認', 1)] });
      view.rowOf('受入確認').querySelector('[data-testid="row-op-finish"]').click();

      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

      expect(view.actions.recordFinish.mock.calls[0][0]).toEqual({
        runId: view.run.runId,
        taskRecordId: view.tasks[0].taskRecordId,
      });
    });

    it('参加者変更は現在の参加者を初期値にする（仕様書8.4.10、A-16、T-16）', async () => {
      const task = taskRecord({
        name: '受入確認',
        order: 1,
        intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲', '乙'])],
      });
      const view = mount({ tasks: [task] });

      view.rowOf('受入確認').querySelector('[data-testid="row-op-changeParticipants"]').click();

      expect(
        [...view.container.querySelectorAll('[data-testid="op-participants-item"] span')].map(
          (node) => node.textContent,
        ),
      ).toEqual(['甲', '乙']);

      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordParticipantChange).toHaveBeenCalled());

      expect(view.actions.recordParticipantChange).toHaveBeenCalledWith(
        { runId: view.run.runId, taskRecordId: task.taskRecordId },
        // `confirmedResume` は集計済みからの再開の確認済みフラグ（仕様書7.1）。
        { at: expect.any(String), participants: ['甲', '乙'], confirmedResume: false },
      );
    });

    it('開いているフォームは1つだけにする', () => {
      const view = mount({ tasks: [working('受入確認', 1), working('本作業', 2)] });

      view.rowOf('受入確認').querySelector('[data-testid="row-op-break"]').click();
      view.rowOf('本作業').querySelector('[data-testid="row-op-finish"]').click();

      const forms = view.container.querySelectorAll('[data-testid="task-form-row"]');
      expect(forms).toHaveLength(1);
      expect(view.rowOf('本作業').nextElementSibling).toBe(forms[0]);
    });

    it('保存の途中で再描画が走っても閉じる', async () => {
      const view = mount({ tasks: [working('受入確認', 1)] });
      // 保存に成功すると `main.js` のストア購読が再描画する。それはビューが
      // 開いているフォームを片付ける前に起きる。
      view.actions.recordFinish.mockImplementation(async () => {
        view.view.render();
        return { dataset: { workRuns: [] }, warnings: [] };
      });
      view.rowOf('受入確認').querySelector('[data-testid="row-op-finish"]').click();

      view.query('op-submit').click();

      await vi.waitFor(() => expect(view.query('task-form-row')).toBeNull());
    });

    it('保存を待つ間に別の実施回へ移っていた場合は上書きしない（過去のレビュー指摘）', async () => {
      const view = mount({ tasks: [working('受入確認', 1)] });
      let resolveAction;
      view.actions.recordFinish.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve;
          }),
      );
      view.rowOf('受入確認').querySelector('[data-testid="row-op-finish"]').click();
      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

      // 保存を待つ間に、利用者が別の実施回へ移ったとする。移動先の画面が
      // 既に detailPane を描いた状態を模す。
      view.navigateAway({ runId: 'other-run', taskRecordId: null });
      view.container.textContent = 'マーカー';

      resolveAction({ dataset: null, warnings: [] });
      await Promise.resolve();
      await Promise.resolve();

      expect(view.container.textContent).toBe('マーカー');
    });

    it('保存を待つ間に作業項目詳細へ移っていた場合は上書きしない（過去のレビュー指摘）', async () => {
      const view = mount({ tasks: [working('受入確認', 1)] });
      let resolveAction;
      view.actions.recordFinish.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve;
          }),
      );
      view.rowOf('受入確認').querySelector('[data-testid="row-op-finish"]').click();
      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

      view.navigateAway({ taskRecordId: view.tasks[0].taskRecordId });
      view.container.textContent = 'マーカー';

      resolveAction({ dataset: null, warnings: [] });
      await Promise.resolve();
      await Promise.resolve();

      expect(view.container.textContent).toBe('マーカー');
    });

    it('取消で閉じる', () => {
      const view = mount({ tasks: [working('受入確認', 1)] });
      view.rowOf('受入確認').querySelector('[data-testid="row-op-break"]').click();

      view.query('op-cancel').click();

      expect(view.query('task-form-row')).toBeNull();
    });

    it('保存中は別の行の操作ボタンを押せない（過去のレビュー指摘）', async () => {
      const view = mount({ tasks: [working('受入確認', 1), working('外観確認', 2)] });
      let resolveAction;
      view.actions.recordFinish.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve;
          }),
      );
      view.rowOf('受入確認').querySelector('[data-testid="row-op-finish"]').click();
      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

      // 別の行のフォームを開けてしまうと、先の保存の完了処理が `local.operation`
      // を畳み、開いたばかりの入力ごと消える。
      expect(
        view.rowOf('外観確認').querySelector('[data-testid="row-op-break"]').disabled,
      ).toBe(true);

      resolveAction({ dataset: null, warnings: [] });
      await vi.waitFor(() => expect(view.query('task-form-row')).toBeNull());

      expect(
        view.rowOf('外観確認').querySelector('[data-testid="row-op-break"]').disabled,
      ).toBe(false);
    });

    it('reset で閉じる（別の実施回へ移るとき）', () => {
      const view = mount({ tasks: [working('受入確認', 1)] });
      view.rowOf('受入確認').querySelector('[data-testid="row-op-break"]').click();

      view.view.reset();
      view.view.render();

      expect(view.query('task-form-row')).toBeNull();
    });
  });

  describe('複数の作業項目（仕様書8.4.9、A-16）', () => {
    it('項目ごとに独立した操作を出す', () => {
      const view = mount({
        tasks: [working('受入確認', 1), taskRecord({ name: '本作業', order: 2 })],
      });

      expect(view.rowOperations('受入確認')).toEqual([
        '受入確認',
        '休憩',
        '終了',
        '参加者変更',
        '詳細',
      ]);
      expect(view.rowOperations('本作業')).toEqual(['本作業', '開始', '詳細']);
    });

    it('同時に作業中の項目を並べられる', () => {
      const view = mount({ tasks: [working('受入確認', 1), working('本作業', 2)] });

      const states = [...view.container.querySelectorAll('[data-testid="task-state"]')].map(
        (node) => node.textContent,
      );
      expect(states).toEqual(['作業中', '作業中']);
    });
  });

  it('作業項目名から詳細を開ける（仕様書12.2）', () => {
    const view = mount();

    view.rowOf('受入確認').querySelector('[data-testid="task-name"]').click();

    expect(view.handlers.onOpenTask).toHaveBeenCalledWith(view.tasks[0].taskRecordId);
  });

  it('詳細ボタンからも開ける', () => {
    const view = mount();

    view.rowOf('受入確認').querySelector('[data-testid="open-task"]').click();

    expect(view.handlers.onOpenTask).toHaveBeenCalledWith(view.tasks[0].taskRecordId);
  });

  it('保存で出た警告を示す（仕様書8.9.5）', async () => {
    const view = mount({ tasks: [working('受入確認', 1)] });
    view.actions.recordFinish.mockResolvedValue({
      dataset: null,
      warnings: [{ code: 'intervalOverlap', path: '作業区間', message: '時間帯が重なる組がある' }],
    });
    view.rowOf('受入確認').querySelector('[data-testid="row-op-finish"]').click();

    view.query('op-submit').click();
    await vi.waitFor(() => expect(view.query('run-warnings')).not.toBeNull());

    expect(view.query('run-warnings').textContent).toContain('時間帯が重なる');
  });

  it('作業項目の一行に12.3の項目を出す', () => {
    const view = mount({ tasks: [working('受入確認', 1)] });

    expect(view.query('task-name').textContent).toBe('受入確認');
    expect(view.query('task-code').textContent).toBe('X-100');
    expect(view.query('task-state').textContent).toBe('作業中');
    expect(view.query('task-time').textContent).toBe('0分');
    expect(view.query('task-direct').textContent).toBe('0分');
    expect(view.query('task-transfer').textContent).toBe('未確定');
  });
});
