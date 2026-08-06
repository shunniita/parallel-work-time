// @vitest-environment happy-dom

/**
 * 集計・転記画面の単体テスト（仕様書8.6.5、8.7、7.1）。
 *
 * 集計そのものは `aggregate.test.js`、遷移の可否は `runStatus.test.js` が持つ。
 * ここは画面の表示と操作の結線を固定する。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { previewStatusChange } from '../../../src/app/actions/transferActions.js';
import { createSummaryView } from '../../../src/ui/views/summaryView.js';
import {
  directEntry,
  projectGroup,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../../fixtures/builders.js';

/**
 * 終了済みの作業区間を1つ持つ作業項目。
 *
 * @param {{name: string, externalCode?: string|null, order: number, minutes: number}} options
 */
function doneTask({ name, externalCode = 'X-100', order, minutes }) {
  const endMinutes = String(minutes).padStart(2, '0');
  return taskRecord({
    name,
    externalCode,
    order,
    intervals: [
      workInterval('2026-08-01T09:00:00+09:00', `2026-08-01T09:${endMinutes}:00+09:00`, ['甲']),
    ],
  });
}

/** 未終了区間を持つ作業項目。 */
function openTask({ name, externalCode = 'X-900', order }) {
  return taskRecord({
    name,
    externalCode,
    order,
    intervals: [workInterval('2026-08-01T09:00:00+09:00', null, ['甲'])],
  });
}

/**
 * 画面を描いて操作の口を返す。
 *
 * @param {{tasks?: object[], status?: string, copyText?: Function}} [options]
 */
function mount(options = {}) {
  const tasks = options.tasks ?? [doneTask({ name: '受入確認', order: 1, minutes: 10 })];
  const group = projectGroup({ projectId: 'PJ-0001' });
  const run = workRun({
    tasks,
    projectGroupId: group.projectGroupId,
    status: options.status ?? 'working',
    workDate: '2026-08-01',
    runQuantity: 50,
  });
  const container = document.createElement('div');
  document.body.replaceChildren(container);

  const actions = {
    markAggregated: vi.fn(async () => ({ dataset: null })),
    reopenRun: vi.fn(async () => ({ dataset: null })),
    markTransferred: vi.fn(async () => ({ dataset: null })),
    revertTransfer: vi.fn(async () => ({ dataset: null })),
    // 純関数の実体をそのまま使う。テストごとに再実装しない。
    previewStatusChange,
  };
  const handlers = { onSelectRun: vi.fn() };
  const copyText = options.copyText ?? vi.fn(async () => ({ ok: true, method: 'clipboard', reason: null }));

  let state = {
    dataset: { workRuns: [run], projectGroups: [group] },
    selection: { projectGroupId: group.projectGroupId, runId: run.runId, taskRecordId: null },
  };
  const store = { getState: () => state };

  const view = createSummaryView({ container, store, actions, handlers, copyText });
  view.render();

  const query = (testid) => container.querySelector(`[data-testid="${testid}"]`);
  const all = (testid) => [...container.querySelectorAll(`[data-testid="${testid}"]`)];
  return {
    view,
    container,
    actions,
    handlers,
    copyText,
    run,
    query,
    all,
    /** 行の n 番目のセルを引く。 */
    cells: (testid) => all(testid).map((cell) => cell.textContent),
    /** 実施回が選ばれていない状態を模す。 */
    clearSelection: () => {
      state = { ...state, selection: { ...state.selection, runId: null } };
    },
  };
}

beforeEach(resetIds);

describe('createSummaryView', () => {
  it('実施回を選んでいなければ案内を出す', () => {
    const view = mount();
    view.clearSelection();

    view.view.render();

    expect(view.query('summary-no-run')).not.toBeNull();
  });

  describe('一覧（仕様書8.7.1、8.7.2）', () => {
    it('外部項目コード・作業項目・内訳・転記値を出す', () => {
      const task = doneTask({ name: '受入確認', order: 1, minutes: 40 });
      task.directEntries = [directEntry(1200)];
      const view = mount({ tasks: [task] });

      expect(view.query('summary-code').textContent).toBe('X-100');
      expect(view.query('summary-name').textContent).toBe('受入確認');
      expect(view.query('summary-time').textContent).toBe('40分');
      expect(view.query('summary-direct').textContent).toBe('20分');
      expect(view.query('summary-total-seconds').textContent).toBe('3600');
      expect(view.query('summary-transfer').textContent).toBe('60分');
    });

    it('既定は外部項目コードの自然順である（仕様書8.7.3）', () => {
      const view = mount({
        tasks: [
          doneTask({ name: '追加加工', externalCode: 'X-2000', order: 1, minutes: 10 }),
          doneTask({ name: '検査', externalCode: 'X-1100', order: 2, minutes: 10 }),
        ],
      });

      expect(view.cells('summary-name')).toEqual(['検査', '追加加工']);
    });

    it('表示順へ切り替えられる', () => {
      const view = mount({
        tasks: [
          doneTask({ name: '追加加工', externalCode: 'X-2000', order: 1, minutes: 10 }),
          doneTask({ name: '検査', externalCode: 'X-1100', order: 2, minutes: 10 }),
        ],
      });

      const select = view.query('summary-sort');
      select.value = 'order';
      select.dispatchEvent(new Event('change'));

      expect(view.cells('summary-name')).toEqual(['追加加工', '検査']);
    });

    it('外部項目コード未設定を注記して警告する（仕様書8.7.4）', () => {
      const view = mount({
        tasks: [doneTask({ name: '後片付け', externalCode: null, order: 1, minutes: 10 })],
      });

      expect(view.query('summary-code').textContent).toBe('（未設定）');
      expect(view.query('missing-code-warning').textContent).toContain('1 件');
    });

    it('未確定の行は転記値の代わりに進行中の件数を出す（仕様書8.6.5）', () => {
      const view = mount({ tasks: [openTask({ name: '本作業', order: 1 })] });

      expect(view.query('summary-transfer').textContent).toContain('未確定');
      expect(view.query('summary-transfer').textContent).toContain('1件');
    });

    it('作業項目が無ければ案内を出す', () => {
      const view = mount({ tasks: [] });

      expect(view.query('summary-empty')).not.toBeNull();
    });
  });

  describe('合計（仕様書8.6.5、8.7.1）', () => {
    it('すべて確定していれば転記値合計を出す', () => {
      const view = mount({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          doneTask({ name: '本作業', externalCode: 'X-200', order: 2, minutes: 20 }),
        ],
      });

      expect(view.query('total-transfer').textContent).toBe('30分');
    });

    it('未確定があれば確定済みだけの小計であることを明示する', () => {
      const view = mount({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          openTask({ name: '本作業', externalCode: 'X-200', order: 2 }),
        ],
      });

      const text = view.query('total-transfer').textContent;
      expect(text).toContain('未確定');
      expect(text).toContain('確定済み1件の小計は10分');
    });
  });

  describe('転記の目印（仕様書8.7.5）', () => {
    it('チェックできるが保存しない旨を明示する', () => {
      const view = mount();

      expect(view.query('summary-check')).not.toBeNull();
      expect(view.query('check-note').textContent).toContain('保存しない');
    });

    it('チェックしても保存アクションを呼ばない', () => {
      const view = mount();

      const box = view.query('summary-check');
      box.checked = true;
      box.dispatchEvent(new Event('change'));

      expect(view.actions.markTransferred).not.toHaveBeenCalled();
    });

    it('並べ替えてもチェックが残る', () => {
      const view = mount({
        tasks: [
          doneTask({ name: '追加加工', externalCode: 'X-2000', order: 1, minutes: 10 }),
          doneTask({ name: '検査', externalCode: 'X-1100', order: 2, minutes: 10 }),
        ],
      });
      // 先頭（検査）へチェックを付ける。
      const box = view.all('summary-check')[0];
      box.checked = true;
      box.dispatchEvent(new Event('change'));

      const select = view.query('summary-sort');
      select.value = 'order';
      select.dispatchEvent(new Event('change'));

      // 表示順では検査が2番目へ移る。チェックも一緒に移る。
      expect(view.cells('summary-name')).toEqual(['追加加工', '検査']);
      expect(view.all('summary-check').map((item) => item.checked)).toEqual([false, true]);
    });
  });

  describe('転記値のコピー（仕様書8.7.7）', () => {
    it('外部項目コードと転記値をタブ区切りで渡す', async () => {
      const view = mount({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          doneTask({ name: '本作業', externalCode: 'X-200', order: 2, minutes: 20 }),
        ],
      });

      view.query('copy-transfer').click();
      await vi.waitFor(() => expect(view.copyText).toHaveBeenCalled());

      expect(view.copyText).toHaveBeenCalledWith('X-100\t10\nX-200\t20');
    });

    it('件数を知らせる', async () => {
      const view = mount();

      view.query('copy-transfer').click();
      await vi.waitFor(() => expect(view.query('summary-notice')).not.toBeNull());

      expect(view.query('summary-notice').textContent).toContain('1件をコピーしました');
    });

    it('除いた行があれば理由を添える', async () => {
      const view = mount({
        tasks: [
          doneTask({ name: '受入確認', externalCode: 'X-100', order: 1, minutes: 10 }),
          doneTask({ name: '後片付け', externalCode: null, order: 2, minutes: 20 }),
          openTask({ name: '本作業', externalCode: 'X-200', order: 3 }),
        ],
      });

      view.query('copy-transfer').click();
      await vi.waitFor(() => expect(view.query('summary-notice')).not.toBeNull());

      const notice = view.query('summary-notice').textContent;
      expect(notice).toContain('外部項目コード未設定の1件は含めていません');
      expect(notice).toContain('転記値が未確定の1件は含めていません');
    });

    it('コピーできなければ理由を出す', async () => {
      const view = mount({
        copyText: vi.fn(async () => ({ ok: false, method: null, reason: 'この環境では書き込めません' })),
      });

      view.query('copy-transfer').click();
      await vi.waitFor(() => expect(view.query('summary-errors')).not.toBeNull());

      expect(view.query('summary-errors').textContent).toContain('書き込めません');
    });
  });

  describe('状態遷移（仕様書7.1）', () => {
    it('作業中では集計済みにできる', async () => {
      const view = mount({ status: 'working' });

      expect(view.query('mark-aggregated').disabled).toBe(false);
      view.query('mark-aggregated').click();
      await vi.waitFor(() => expect(view.actions.markAggregated).toHaveBeenCalledWith(view.run.runId));
    });

    it('未終了区間があると集計済みボタンを押せず理由を添える（A-08、仕様書8.9.6）', () => {
      const view = mount({ tasks: [openTask({ name: '本作業', order: 1 })] });

      const button = view.query('mark-aggregated');
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('未終了');
    });

    it('作業中では転記済みボタンを出さない', () => {
      const view = mount({ status: 'working' });

      expect(view.query('mark-transferred')).toBeNull();
    });

    it('集計済みでは転記済みと作業中へ戻すを出す', () => {
      const view = mount({ status: 'aggregated' });

      expect(view.query('mark-transferred')).not.toBeNull();
      expect(view.query('reopen-run')).not.toBeNull();
      expect(view.query('mark-aggregated')).toBeNull();
    });

    it('転記済みにできる（仕様書8.7.6）', async () => {
      const view = mount({ status: 'aggregated' });

      view.query('mark-transferred').click();
      await vi.waitFor(() => expect(view.actions.markTransferred).toHaveBeenCalled());

      expect(view.query('summary-notice').textContent).toContain('転記済み');
    });

    it('作業中へ戻せる', async () => {
      const view = mount({ status: 'aggregated' });

      view.query('reopen-run').click();
      await vi.waitFor(() => expect(view.actions.reopenRun).toHaveBeenCalled());
    });
  });

  describe('転記済みの取り消し（仕様書7.1、11章）', () => {
    it('転記済みでは取り消しボタンだけを出す', () => {
      const view = mount({ status: 'transferred' });

      expect(view.query('revert-transfer')).not.toBeNull();
      expect(view.query('mark-transferred')).toBeNull();
      expect(view.query('reopen-run')).toBeNull();
    });

    it('押すと理由の入力を求め、入力欄へフォーカスが移る', () => {
      const view = mount({ status: 'transferred' });

      view.query('revert-transfer').click();

      expect(view.query('revert-confirm-panel')).not.toBeNull();
      expect(document.activeElement).toBe(view.query('revert-reason'));
      expect(view.actions.revertTransfer).not.toHaveBeenCalled();
    });

    it('理由が無ければ確定できない（仕様書11章）', () => {
      const view = mount({ status: 'transferred' });
      view.query('revert-transfer').click();

      view.query('revert-confirm').click();

      expect(view.actions.revertTransfer).not.toHaveBeenCalled();
      expect(view.query('revert-errors').textContent).toContain('理由');
    });

    it('理由を添えて取り消せる', async () => {
      const view = mount({ status: 'transferred' });
      view.query('revert-transfer').click();
      view.query('revert-reason').value = '転記先の数値を誤っていたため';

      view.query('revert-confirm').click();
      await vi.waitFor(() => expect(view.actions.revertTransfer).toHaveBeenCalled());

      expect(view.actions.revertTransfer).toHaveBeenCalledWith(view.run.runId, {
        reason: '転記先の数値を誤っていたため',
      });
    });

    it('取消で閉じる', () => {
      const view = mount({ status: 'transferred' });
      view.query('revert-transfer').click();

      view.query('revert-cancel').click();

      expect(view.query('revert-confirm-panel')).toBeNull();
    });

    it('見出しは削除ではなく取り消しにする', () => {
      const view = mount({ status: 'transferred' });

      view.query('revert-transfer').click();

      expect(view.container.textContent).toContain('転記済みを取り消します');
      expect(view.container.textContent).not.toContain('削除します');
    });
  });

  it('実施回詳細へ移れる', () => {
    const view = mount();

    view.query('open-run-detail').click();

    expect(view.handlers.onSelectRun).toHaveBeenCalledWith(view.run.runId);
  });
});
