// @vitest-environment happy-dom

/**
 * 作業項目詳細の単体テスト（仕様書12.2、12.3、12.4、7.2）。
 *
 * 状態と操作の対応（12.4）と区間履歴の表示を固定する。E2E は導線1本の確認に
 * 絞るため、状態ごとの組み合わせはここで見る。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskDetailView } from '../../../src/ui/views/taskDetailView.js';
import { ResumeConfirmationRequiredError } from '../../../src/app/errors.js';
import { previewDirectEntryDeletion } from '../../../src/app/actions/directEntryActions.js';
import { previewIntervalDeletion } from '../../../src/app/actions/intervalActions.js';
import { VIEW } from '../../../src/ui/shell.js';
import {
  breakInterval,
  directEntry,
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
    createDirectEntry: vi.fn(async () => ({ dataset: null, warnings: [] })),
    updateDirectEntry: vi.fn(async () => ({ dataset: null, warnings: [] })),
    deleteDirectEntry: vi.fn(async () => ({ dataset: null, warnings: [] })),
    // 純関数の実体をそのまま使う。テストごとに再実装しない。
    previewIntervalDeletion: (workRuns, target, intervalId) =>
      previewIntervalDeletion(workRuns, target, intervalId),
    previewDirectEntryDeletion: (workRuns, target, entryId) =>
      previewDirectEntryDeletion(workRuns, target, entryId),
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
    /** 実施回の状態が変わった状態を模す（転記済み化・アーカイブ）。 */
    setRunStatus: (status) => {
      state = {
        ...state,
        dataset: { ...state.dataset, workRuns: [{ ...run, status }] },
      };
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

    it('直接入力は全状態で押せる（仕様書12.4）', () => {
      // 計測し損ねた工数を後から入れる操作であり、いま作業中かどうかとは
      // 関わりがない。
      for (const task of [TASKS.notStarted(), TASKS.working(), TASKS.onBreak(), TASKS.done()]) {
        const view = mount({ task });

        expect(view.query('op-directEntry').disabled).toBe(false);
      }
    });

    it('仕様書12.4 の操作がすべて結線済みである', () => {
      const view = mount({ task: TASKS.working() });

      expect(view.query('op-changeParticipants').disabled).toBe(false);
      expect(view.query('op-addInterval').disabled).toBe(false);
      expect(view.query('op-editHistory').disabled).toBe(false);
      expect(view.query('op-directEntry').disabled).toBe(false);
      // 未実装を示す注記は残っていない。
      expect(view.all('op-directEntry')[0].getAttribute('title')).toBeNull();
    });

    it('現在状態をバッジで示す（仕様書12.3）', () => {
      const view = mount({ task: TASKS.onBreak() });

      expect(view.query('task-detail-state').textContent).toBe('休憩中');
    });

    it('作業項目と実施回の状態を区別して示す', () => {
      const view = mount({ task: TASKS.working() });

      expect(view.query('task-detail-state').previousSibling.textContent).toBe('作業項目 ');
      expect(view.query('task-detail-run-status').previousSibling.textContent).toBe('実施回 ');
      expect(view.query('task-detail-state').textContent).toBe('作業中');
      expect(view.query('task-detail-run-status').textContent).toBe('作業中');
    });
  });

  describe('状態ガード（仕様書7.2）', () => {
    it('転記済みでは操作を出さず理由を示す', () => {
      const view = mount({ task: TASKS.working(), status: 'transferred' });

      expect(view.query('task-operations')).toBeNull();
      expect(view.query('task-not-editable').textContent).toContain('転記済み');
    });

    it('閲覧のみへ変わったら開いていた入力を閉じる（過去のレビュー指摘）', () => {
      // フォームを開いたまま同じ画面の操作で転記済みへ進める。「閲覧のみ」の注記と入力欄が同居してはならない。
      const view = mount({ task: TASKS.working() });
      view.query('op-break').click();
      expect(view.query('op-form')).not.toBeNull();

      view.setRunStatus('transferred');
      view.view.render();

      expect(view.query('op-form')).toBeNull();
      expect(view.query('task-not-editable')).not.toBeNull();
    });

    it('閲覧のみへ変わったら直接入力の編集も閉じる（過去のレビュー指摘の追記）', () => {
      const view = mount({
        task: taskRecord({ name: '受入確認', directEntries: [directEntry(600)] }),
      });
      view.query('direct-edit').click();
      expect(view.query('direct-form')).not.toBeNull();

      view.setRunStatus('archived');
      view.view.render();

      expect(view.query('direct-form')).toBeNull();
      expect(view.query('direct-edit')).toBeNull();
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
        // `confirmedResume` は集計済みからの再開の確認済みフラグ（仕様書7.1）。
        // 最初の呼び出しでは false で渡り、差し戻された場合だけ true で呼び直す。
        { at: expect.stringMatching(/^2026-08-01T12:00:00/), confirmedResume: false },
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

    it('保存を待つ間に別の作業項目へ移っていた場合は上書きしない（過去のレビュー指摘）', async () => {
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

    it('保存を待つ間に実施回一覧へ戻っていた場合は上書きしない（過去のレビュー指摘）', async () => {
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

    describe('集計済みからの作業再開（仕様書7.1）', () => {
      /** 差し戻しを返す `recordStart` を仕込む。 */
      function mountWithResumeGuard() {
        const view = mount({ task: TASKS.notStarted(), status: 'aggregated' });
        view.actions.recordStart.mockRejectedValue(
          new ResumeConfirmationRequiredError('実施回: 集計済みです。', view.run.runId),
        );
        return view;
      }

      it('差し戻されると確認パネルを出し、フォームは畳む', async () => {
        const view = mountWithResumeGuard();
        view.query('op-start').click();
        view.query('op-participants').value = '甲';

        view.query('op-submit').click();
        await vi.waitFor(() => expect(view.query('resume-panel')).not.toBeNull());

        // フォーム内のエラー欄には出さない。「入力が誤っている」と読めるため。
        expect(view.query('op-form')).toBeNull();
        expect(view.query('resume-description').textContent).toContain('作業中へ戻します');
      });

      it('確認パネルへフォーカスを移す', async () => {
        const view = mountWithResumeGuard();
        view.query('op-start').click();
        view.query('op-participants').value = '甲';

        view.query('op-submit').click();
        await vi.waitFor(() => expect(view.query('resume-panel')).not.toBeNull());

        expect(document.activeElement).toBe(view.query('resume-accept'));
      });

      it('承諾すると同じ入力を confirmedResume 付きで呼び直す', async () => {
        const view = mountWithResumeGuard();
        view.query('op-start').click();
        view.query('op-participants').value = '甲';
        view.query('op-submit').click();
        await vi.waitFor(() => expect(view.query('resume-panel')).not.toBeNull());

        view.actions.recordStart.mockResolvedValue({ dataset: null, warnings: [] });
        view.query('resume-accept').click();
        await vi.waitFor(() => expect(view.actions.recordStart).toHaveBeenCalledTimes(2));

        const [, second] = view.actions.recordStart.mock.calls;
        expect(second[1]).toMatchObject({ participants: ['甲'], confirmedResume: true });
      });

      it('やめると何も呼ばずにパネルを閉じる', async () => {
        const view = mountWithResumeGuard();
        view.query('op-start').click();
        view.query('op-participants').value = '甲';
        view.query('op-submit').click();
        await vi.waitFor(() => expect(view.query('resume-panel')).not.toBeNull());

        view.query('resume-cancel').click();

        expect(view.query('resume-panel')).toBeNull();
        expect(view.actions.recordStart).toHaveBeenCalledTimes(1);
      });
    });

    describe('保存中の多重操作（過去のレビュー指摘）', () => {
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
        { at: expect.any(String), participants: ['甲', '乙'], confirmedResume: false },
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

    describe('フォーカス（過去のレビュー指摘）', () => {
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

  describe('直接入力（仕様書8.5）', () => {
    /** 直接入力を1件持つ作業項目実績。 */
    function taskWithEntry() {
      return taskRecord({
        name: '受入確認',
        directEntries: [
          directEntry(1230, { participants: ['甲', '乙'], note: '移動時間を追加' }),
        ],
      });
    }

    it('直接入力が無ければ案内を出す', () => {
      const view = mount({ task: TASKS.working() });

      expect(view.query('direct-empty')).not.toBeNull();
      expect(view.query('direct-list')).toBeNull();
    });

    it('一覧に追加工数・参加者・備考を出す', () => {
      const view = mount({ task: taskWithEntry() });

      expect(view.query('direct-effort').textContent).toBe('20分30秒');
      expect(view.query('direct-participants').textContent).toBe('甲、乙');
      expect(view.query('direct-note').textContent).toBe('移動時間を追加');
    });

    it('参加者が0人なら「なし」と出す', () => {
      const view = mount({
        task: taskRecord({
          name: '受入確認',
          directEntries: [directEntry(600, { participants: [] })],
        }),
      });

      expect(view.query('direct-participants').textContent).toBe('なし');
    });

    it('登録した順で並べる', () => {
      const view = mount({
        task: taskRecord({
          name: '受入確認',
          directEntries: [directEntry(600), directEntry(60), directEntry(1200)],
        }),
      });

      expect(view.all('direct-effort').map((cell) => cell.textContent)).toEqual([
        '10分0秒',
        '1分0秒',
        '20分0秒',
      ]);
    });

    describe('追加', () => {
      it('「直接入力」でフォームが開き、入力欄へフォーカスが移る', () => {
        const view = mount({ task: TASKS.working() });

        view.query('op-directEntry').click();

        expect(view.query('direct-form').dataset.mode).toBe('add');
        expect(document.activeElement).toBe(view.query('direct-duration-minutes'));
      });

      it('分と秒を合計した秒数で呼ぶ（仕様書8.5.1）', async () => {
        const view = mount({ task: TASKS.working() });
        view.query('op-directEntry').click();
        view.query('direct-duration-minutes').value = '20';
        view.query('direct-duration-seconds').value = '30';
        view.query('direct-note').value = '移動時間';

        view.query('direct-submit').click();
        await vi.waitFor(() => expect(view.actions.createDirectEntry).toHaveBeenCalled());

        expect(view.actions.createDirectEntry).toHaveBeenCalledWith(
          { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
          { seconds: 1230, participants: [], note: '移動時間' },
        );
      });

      it('分だけの入力も通る（秒は0として扱う）', async () => {
        const view = mount({ task: TASKS.working() });
        view.query('op-directEntry').click();
        view.query('direct-duration-minutes').value = '20';
        view.query('direct-note').value = '移動時間';

        view.query('direct-submit').click();
        await vi.waitFor(() => expect(view.actions.createDirectEntry).toHaveBeenCalled());

        expect(view.actions.createDirectEntry.mock.calls[0][1].seconds).toBe(1200);
      });

      it('整数でない入力は呼ばずにエラーを出す', () => {
        const view = mount({ task: TASKS.working() });
        view.query('op-directEntry').click();
        view.query('direct-duration-minutes').value = '1.5';
        view.query('direct-note').value = '移動時間';

        view.query('direct-submit').click();

        expect(view.actions.createDirectEntry).not.toHaveBeenCalled();
        expect(view.query('direct-errors').hidden).toBe(false);
        expect(view.query('direct-errors').textContent).toContain('0以上の整数');
      });

      it('参加者も添えて呼ぶ', async () => {
        const view = mount({ task: TASKS.working() });
        view.query('op-directEntry').click();
        view.query('direct-duration-minutes').value = '20';
        view.query('direct-participants').value = '甲';
        view.query('direct-note').value = '移動時間';

        view.query('direct-submit').click();
        await vi.waitFor(() => expect(view.actions.createDirectEntry).toHaveBeenCalled());

        expect(view.actions.createDirectEntry.mock.calls[0][1].participants).toEqual(['甲']);
      });

      it('取消でフォームを閉じる', () => {
        const view = mount({ task: TASKS.working() });
        view.query('op-directEntry').click();

        view.query('direct-cancel').click();

        expect(view.query('direct-form')).toBeNull();
      });

      it('保存で出た重複候補の警告を記録後に示す（仕様書8.9.8）', async () => {
        const view = mount({ task: TASKS.working() });
        view.actions.createDirectEntry.mockResolvedValue({
          dataset: null,
          warnings: [
            {
              code: 'directEntryDuplicate',
              path: '直接入力',
              message: '同じ参加者・同じ追加工数の記録が既に 1 件ある',
            },
          ],
        });
        view.query('op-directEntry').click();
        view.query('direct-duration-minutes').value = '20';
        view.query('direct-note').value = '移動時間';

        view.query('direct-submit').click();
        await vi.waitFor(() => expect(view.query('task-warnings')).not.toBeNull());

        expect(view.query('task-warnings').textContent).toContain('同じ参加者');
        expect(view.query('direct-form')).toBeNull();
      });
    });

    describe('編集・削除', () => {
      it('「履歴編集」に隠さず、常に操作ボタンを出す', () => {
        // 区間が1件も無い（＝未着手の）作業項目でも編集・削除できる。仕様書12.4
        // の「履歴編集」は未着手では無効であり、そこへ寄せると直接入力だけを
        // 記録した作業項目で手が出せなくなる。
        const view = mount({ task: taskWithEntry() });

        expect(view.query('task-detail-state').textContent).toBe('未着手');
        expect(view.query('op-editHistory').disabled).toBe(true);
        expect(view.query('direct-edit')).not.toBeNull();
        expect(view.query('direct-delete')).not.toBeNull();
      });

      it('転記済みでは操作ボタンを出さない（仕様書7.2）', () => {
        const view = mount({ task: taskWithEntry(), status: 'transferred' });

        expect(view.query('direct-edit')).toBeNull();
        expect(view.query('direct-delete')).toBeNull();
      });

      it('編集フォームに現在の値が入り、フォーカスが移る', () => {
        const view = mount({ task: taskWithEntry() });

        view.query('direct-edit').click();

        expect(view.query('direct-form').dataset.mode).toBe('edit');
        expect(view.query('direct-duration-minutes').value).toBe('20');
        expect(view.query('direct-duration-seconds').value).toBe('30');
        expect(document.activeElement).toBe(view.query('direct-duration-minutes'));
      });

      it('保存すると対象のIDを添えて呼ぶ', async () => {
        const view = mount({ task: taskWithEntry() });
        const entryId = view.task.directEntries[0].entryId;
        view.query('direct-edit').click();
        view.query('direct-duration-minutes').value = '10';

        view.query('direct-submit').click();
        await vi.waitFor(() => expect(view.actions.updateDirectEntry).toHaveBeenCalled());

        expect(view.actions.updateDirectEntry).toHaveBeenCalledWith(
          { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
          entryId,
          { seconds: 630, participants: ['甲', '乙'], note: '移動時間を追加' },
        );
      });

      it('削除確認に内容が出て、理由の入力欄へフォーカスが移る', () => {
        const view = mount({ task: taskWithEntry() });

        view.query('direct-delete').click();

        expect(view.query('delete-confirm-description').textContent).toContain('20分30秒');
        expect(view.query('delete-confirm-description').textContent).toContain('移動時間を追加');
        expect(document.activeElement).toBe(view.query('delete-reason'));
      });

      it('理由を入力して確定すると、IDと理由を添えて呼ぶ（仕様書11章）', async () => {
        const view = mount({ task: taskWithEntry() });
        const entryId = view.task.directEntries[0].entryId;
        view.query('direct-delete').click();
        view.query('delete-reason').value = '二重に記録していたため';

        view.query('delete-confirm').click();
        await vi.waitFor(() => expect(view.actions.deleteDirectEntry).toHaveBeenCalled());

        expect(view.actions.deleteDirectEntry).toHaveBeenCalledWith(
          { runId: view.run.runId, taskRecordId: view.task.taskRecordId },
          entryId,
          { reason: '二重に記録していたため' },
        );
      });

      it('理由が無ければ確定できない（仕様書11章）', () => {
        const view = mount({ task: taskWithEntry() });
        view.query('direct-delete').click();

        view.query('delete-confirm').click();

        expect(view.actions.deleteDirectEntry).not.toHaveBeenCalled();
      });

      it('区間と直接入力の編集は同時に1つしか開かない', () => {
        const view = mount({
          task: taskRecord({
            name: '受入確認',
            intervals: [
              workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T09:20:00+09:00', ['甲']),
            ],
            directEntries: [directEntry(600)],
          }),
        });
        view.query('op-editHistory').click();

        view.query('interval-edit').click();
        expect(view.query('entry-form')).not.toBeNull();

        view.query('direct-edit').click();
        expect(view.query('entry-form')).toBeNull();
        expect(view.query('direct-form')).not.toBeNull();

        view.query('interval-delete').click();
        expect(view.query('direct-form')).toBeNull();
        expect(view.query('delete-confirm-panel')).not.toBeNull();
      });

      it('区間の削除確認を開くと直接入力の削除確認は閉じる', () => {
        const view = mount({
          task: taskRecord({
            name: '受入確認',
            intervals: [
              workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T09:20:00+09:00', ['甲']),
            ],
            directEntries: [directEntry(600)],
          }),
        });
        view.query('op-editHistory').click();
        view.query('direct-delete').click();
        expect(view.query('direct-delete-row')).not.toBeNull();

        view.query('interval-delete').click();

        expect(view.query('direct-delete-row')).toBeNull();
        expect(view.query('interval-delete-row')).not.toBeNull();
      });

      it('上部の操作を開くと直接入力の編集は閉じる', () => {
        const view = mount({
          task: taskRecord({
            name: '受入確認',
            intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲'])],
            directEntries: [directEntry(600)],
          }),
        });
        view.query('direct-edit').click();
        expect(view.query('direct-form')).not.toBeNull();

        view.query('op-break').click();

        expect(view.query('direct-form')).toBeNull();
        expect(view.query('op-form')).not.toBeNull();
      });
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
