// @vitest-environment happy-dom

/**
 * 作業項目詳細の単体テスト（仕様書12.2、12.3、12.4、7.2）。
 *
 * 状態と操作の対応（12.4）と区間履歴の表示を固定する。E2E は導線1本の確認に
 * 絞るため、状態ごとの組み合わせはここで見る。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskDetailView } from '../../../src/ui/views/taskDetailView.js';
import { previewIntervalDeletion } from '../../../src/app/actions/intervalActions.js';
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
    recordParticipantChange: vi.fn(async () => ({ dataset: null, warnings: [] })),
    addIntervalManually: vi.fn(async () => ({ dataset: null, warnings: [] })),
    updateInterval: vi.fn(async () => ({ dataset: null, warnings: [] })),
    deleteInterval: vi.fn(async () => ({ dataset: null, warnings: [] })),
    // 純関数の実体をそのまま使う。テストごとに再実装しない。
    previewIntervalDeletion: (workRuns, target, intervalId) =>
      previewIntervalDeletion(workRuns, target, intervalId),
  };
  const handlers = { onBackToRun: vi.fn() };
  /** 案件画面・当該作業項目を表示中の状態。navigateAway() で書き換えて模擬する。 */
  let state = {
    view: VIEW.PROJECTS,
    dataset: { workRuns: [run], projectGroups: [group] },
    selection: {
      projectGroupId: group.projectGroupId,
      runId: run.runId,
      taskRecordId: task.taskRecordId,
    },
  };
  const store = { getState: () => state };

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
  return {
    view,
    container,
    actions,
    handlers,
    run,
    task,
    query,
    all,
    /** 保存を待つあいだに、利用者が別の画面／別の作業項目へ移った状態を模す。 */
    navigateAway: (patch) => {
      state = { ...state, selection: { ...state.selection, ...patch } };
    },
  };
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

    it('未実装の操作（直接入力）は理由を添えて無効にする', () => {
      const view = mount({ task: TASKS.working() });

      const button = view.query('op-directEntry');
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('次の段階');
    });

    it('参加者変更・区間追加・履歴編集は結線済みである', () => {
      const view = mount({ task: TASKS.working() });

      expect(view.query('op-changeParticipants').disabled).toBe(false);
      expect(view.query('op-addInterval').disabled).toBe(false);
      expect(view.query('op-editHistory').disabled).toBe(false);
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

    it('保存を待つ間に別の作業項目へ移っていた場合は上書きしない（レビュー指摘 FB-7）', async () => {
      const view = mount({ task: TASKS.working() });
      let resolveAction;
      view.actions.recordFinish.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve;
          }),
      );
      view.query('op-finish').click();
      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

      // 保存を待つ間に、利用者が別の作業項目へ移ったとする。移動先の画面が
      // 既に detailPane を描いた状態を模す。
      view.navigateAway({ taskRecordId: 'other-task' });
      view.container.textContent = 'マーカー';

      resolveAction({ dataset: null, warnings: [] });
      await Promise.resolve();
      await Promise.resolve();

      expect(view.container.textContent).toBe('マーカー');
    });

    it('保存を待つ間に実施回一覧へ戻っていた場合は上書きしない（レビュー指摘 FB-7）', async () => {
      const view = mount({ task: TASKS.working() });
      let resolveAction;
      view.actions.recordFinish.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve;
          }),
      );
      view.query('op-finish').click();
      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

      view.navigateAway({ taskRecordId: null });
      view.container.textContent = 'マーカー';

      resolveAction({ dataset: null, warnings: [] });
      await Promise.resolve();
      await Promise.resolve();

      expect(view.container.textContent).toBe('マーカー');
    });

    it('取消でフォームを閉じる', () => {
      const view = mount({ task: TASKS.working() });
      view.query('op-break').click();

      view.query('op-cancel').click();

      expect(view.query('op-form')).toBeNull();
    });

    describe('保存中の多重操作（レビュー指摘 FB-10）', () => {
      /**
       * 保存を止めたまま送信した状態を作る。
       *
       * @returns {{view: object, finish: (result?: object) => void}}
       */
      function submitAndHold() {
        const view = mount({ task: TASKS.working() });
        let settle;
        view.actions.recordFinish.mockImplementation(
          () =>
            new Promise((resolve, reject) => {
              settle = { resolve, reject };
            }),
        );
        view.query('op-finish').click();
        view.query('op-submit').click();
        return { view, settle: () => settle };
      }

      it('保存中は上部の操作ボタンを押せない', async () => {
        const { view } = submitAndHold();
        await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

        // ここで別のフォームを開けてしまうと、先の保存の完了処理が
        // `activeForm` を畳み、開いたばかりの入力ごと消える。
        expect(view.query('op-break').disabled).toBe(true);
        expect(view.query('op-addInterval').disabled).toBe(true);
        expect(view.query('op-editHistory').disabled).toBe(true);
      });

      it('保存中は区間履歴の編集・削除ボタンも押せない', async () => {
        const view = mount({ task: taskRecord({
          name: '受入確認',
          intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲'])],
        }) });
        let resolveAction;
        view.actions.recordFinish.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveAction = resolve;
            }),
        );
        view.query('op-editHistory').click();
        view.query('op-finish').click();
        view.query('op-submit').click();
        await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

        expect(view.query('interval-edit').disabled).toBe(true);
        expect(view.query('interval-delete').disabled).toBe(true);

        resolveAction({ dataset: null, warnings: [] });
      });

      it('保存が終われば操作ボタンが戻る', async () => {
        const { view, settle } = submitAndHold();
        await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

        settle().resolve({ dataset: null, warnings: [] });
        await vi.waitFor(() => expect(view.query('op-form')).toBeNull());

        // 状態が許す操作だけが戻る。「作業中」なので休憩は押せて開始は押せない。
        expect(view.query('op-break').disabled).toBe(false);
        expect(view.query('op-start').disabled).toBe(true);
      });

      it('保存が失敗したらフォームは開いたまま、操作ボタンだけ戻る', async () => {
        const { view, settle } = submitAndHold();
        await vi.waitFor(() => expect(view.actions.recordFinish).toHaveBeenCalled());

        settle().reject(new Error('保存できない'));
        await vi.waitFor(() => expect(view.query('op-break').disabled).toBe(false));

        // 入力を直して押し直せるよう、フォームは閉じない。
        expect(view.query('op-form')).not.toBeNull();
      });
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

    it('参加者変更は現在の参加者を初期値にし、対象を添えて呼ぶ（仕様書8.4.10）', async () => {
      const view = mount({
        task: taskRecord({
          name: '受入確認',
          intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲', '乙'])],
        }),
      });

      view.query('op-changeParticipants').click();

      expect(
        [...view.container.querySelectorAll('[data-testid="op-participants-item"] span')].map(
          (node) => node.textContent,
        ),
      ).toEqual(['甲', '乙']);

      view.query('op-submit').click();
      await vi.waitFor(() => expect(view.actions.recordParticipantChange).toHaveBeenCalled());

      expect(view.actions.recordParticipantChange).toHaveBeenCalledWith(
        { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
        { at: expect.any(String), participants: ['甲', '乙'] },
      );
    });
  });

  describe('区間追加（仕様書8.4.11）', () => {
    it('「区間追加」を押すと追加フォームが開く', () => {
      const view = mount({ task: TASKS.working() });

      view.query('op-addInterval').click();

      expect(view.query('entry-form').dataset.mode).toBe('add');
      expect(view.actions.addIntervalManually).not.toHaveBeenCalled();
    });

    it('確定すると対象を添えてアクションを呼ぶ', async () => {
      const view = mount({ task: TASKS.working() });
      view.query('op-addInterval').click();
      view.query('entry-start').value = '2026-07-30T09:00:00';
      view.query('entry-end').value = '2026-07-30T10:00:00';
      view.query('entry-participants').value = '甲';
      view.query('entry-participants-add').click();

      view.query('entry-submit').click();
      await vi.waitFor(() => expect(view.actions.addIntervalManually).toHaveBeenCalled());

      expect(view.actions.addIntervalManually).toHaveBeenCalledWith(
        { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
        expect.objectContaining({ participants: ['甲'] }),
      );
    });

    it('未着手でも区間追加は開ける（仕様書8.4.11 は状態を問わない）', () => {
      const view = mount({ task: TASKS.notStarted() });

      expect(view.query('op-addInterval').disabled).toBe(false);
    });

    it('取消で閉じる', () => {
      const view = mount({ task: TASKS.working() });
      view.query('op-addInterval').click();

      view.query('entry-cancel').click();

      expect(view.query('entry-form')).toBeNull();
    });
  });

  describe('履歴編集（仕様書8.4.5、11章）', () => {
    /** 終了済みの区間を1件持つ作業項目。 */
    function taskWithInterval() {
      return taskRecord({
        name: '受入確認',
        intervals: [
          workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T09:20:00+09:00', ['甲', '乙']),
        ],
      });
    }

    it('「履歴編集」を押すと行に編集・削除ボタンが出る', () => {
      const view = mount({ task: taskWithInterval() });

      expect(view.query('interval-edit')).toBeNull();

      view.query('op-editHistory').click();

      expect(view.query('interval-edit')).not.toBeNull();
      expect(view.query('interval-delete')).not.toBeNull();
    });

    it('もう一度押すと畳む', () => {
      const view = mount({ task: taskWithInterval() });
      view.query('op-editHistory').click();

      view.query('op-editHistory').click();

      expect(view.query('interval-edit')).toBeNull();
    });

    describe('編集', () => {
      it('区間の行に編集フォームが開き、既存の値を初期値にする', () => {
        const view = mount({ task: taskWithInterval() });
        view.query('op-editHistory').click();

        view.query('interval-edit').click();

        const form = view.query('entry-form');
        expect(form.dataset.mode).toBe('edit');
        expect(view.query('entry-start').value).toBe('2026-08-01T09:00:00');
      });

      it('保存すると対象区間のIDを添えてアクションを呼ぶ', async () => {
        const view = mount({ task: taskWithInterval() });
        const intervalId = view.task.intervals[0].intervalId;
        view.query('op-editHistory').click();
        view.query('interval-edit').click();
        view.query('entry-end').value = '2026-08-01T09:30:00';

        view.query('entry-submit').click();
        await vi.waitFor(() => expect(view.actions.updateInterval).toHaveBeenCalled());

        expect(view.actions.updateInterval).toHaveBeenCalledWith(
          { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
          intervalId,
          expect.objectContaining({ participants: ['甲', '乙'] }),
        );
      });

      it('取消で閉じる（履歴編集モードは維持する）', () => {
        const view = mount({ task: taskWithInterval() });
        view.query('op-editHistory').click();
        view.query('interval-edit').click();

        view.query('entry-cancel').click();

        expect(view.query('entry-form')).toBeNull();
        expect(view.query('interval-edit')).not.toBeNull();
      });
    });

    describe('削除', () => {
      it('区間の行に削除確認が開き、内容を確認できる', () => {
        const view = mount({ task: taskWithInterval() });
        view.query('op-editHistory').click();

        view.query('interval-delete').click();

        expect(view.query('delete-confirm-description').textContent).toContain('甲、乙');
        expect(view.actions.deleteInterval).not.toHaveBeenCalled();
      });

      it('理由を入力して確定すると、対象区間のIDと理由を添えて呼ぶ', async () => {
        const view = mount({ task: taskWithInterval() });
        const intervalId = view.task.intervals[0].intervalId;
        view.query('op-editHistory').click();
        view.query('interval-delete').click();
        view.query('delete-reason').value = '二重に記録していたため';

        view.query('delete-confirm').click();
        await vi.waitFor(() => expect(view.actions.deleteInterval).toHaveBeenCalled());

        expect(view.actions.deleteInterval).toHaveBeenCalledWith(
          { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
          intervalId,
          { reason: '二重に記録していたため' },
        );
      });

      it('理由が無ければ確定できない（仕様書11章）', () => {
        const view = mount({ task: taskWithInterval() });
        view.query('op-editHistory').click();
        view.query('interval-delete').click();

        view.query('delete-confirm').click();

        expect(view.actions.deleteInterval).not.toHaveBeenCalled();
      });

      it('取消で閉じる（履歴編集モードは維持する）', () => {
        const view = mount({ task: taskWithInterval() });
        view.query('op-editHistory').click();
        view.query('interval-delete').click();

        view.query('delete-cancel').click();

        expect(view.query('delete-confirm-panel')).toBeNull();
        expect(view.query('interval-delete')).not.toBeNull();
      });
    });

    describe('フォーカス（レビュー指摘 FB-11）', () => {
      it('編集を押すと編集フォームの先頭入力欄へフォーカスが移る', () => {
        const view = mount({ task: taskWithInterval() });
        view.query('op-editHistory').click();

        view.query('interval-edit').click();

        // 押したボタンは再描画で捨てられる。移す先が無いとフォーカスは画面
        // 先頭側へ戻り、キーボードだけでは入力欄へたどり着けない（仕様書13章）。
        expect(document.activeElement).toBe(view.query('entry-start'));
      });

      it('削除を押すと削除理由の入力欄へフォーカスが移る', () => {
        const view = mount({ task: taskWithInterval() });
        view.query('op-editHistory').click();

        view.query('interval-delete').click();

        expect(document.activeElement).toBe(view.query('delete-reason'));
      });
    });

    it('編集と削除は同時に1つしか開かない', () => {
      const view = mount({
        task: taskRecord({
          name: '受入確認',
          intervals: [
            workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T09:20:00+09:00', ['甲']),
            workInterval('2026-08-01T10:00:00+09:00', '2026-08-01T10:20:00+09:00', ['甲']),
          ],
        }),
      });
      view.query('op-editHistory').click();
      const [firstEdit, secondEdit] = view.all('interval-edit');
      const [firstDelete] = view.all('interval-delete');

      firstEdit.click();
      expect(view.query('entry-form')).not.toBeNull();

      secondEdit.click();
      expect(view.all('entry-form')).toHaveLength(1);

      firstDelete.click();
      expect(view.query('entry-form')).toBeNull();
      expect(view.query('delete-confirm-panel')).not.toBeNull();
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
