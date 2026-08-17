// @vitest-environment happy-dom

/**
 * 操作フォームの単体テスト（仕様書12.4、8.9.4、8.9 補足）。
 *
 * 「どの操作で何を尋ねるか」と「確定前に日時を直せること」を固定する。
 * 保存の可否そのものは domain 層の単体テスト（`intervalOps.test.js`）が持つ。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIntervalOperationForm } from '../../../src/ui/components/intervalOperationForm.js';
import { ValidationError } from '../../../src/app/errors.js';
import { TASK_OPERATION } from '../../../src/domain/taskState.js';
import { toIsoSecond } from '../../../src/domain/datetime.js';
import {
  breakInterval,
  resetIds,
  taskRecord,
  workInterval,
} from '../../fixtures/builders.js';

const FIXED_NOW = new Date(2026, 7, 1, 12, 0, 0);

/**
 * フォームを組み立てて DOM へ載せる。
 *
 * @param {{operation: string, taskRecord: object, candidates?: string[],
 *          onSubmit?: Function, onCancel?: Function}} options
 */
function mount(options) {
  const onSubmit = options.onSubmit ?? vi.fn(async () => ({ warnings: [], dataset: {} }));
  const onCancel = options.onCancel ?? vi.fn();
  const form = createIntervalOperationForm({
    operation: options.operation,
    taskRecord: options.taskRecord,
    candidates: options.candidates ?? [],
    now: () => FIXED_NOW,
    onSubmit,
    onCancel,
  });
  document.body.replaceChildren(form.element);

  const query = (testid) => form.element.querySelector(`[data-testid="${testid}"]`);
  return {
    form,
    onSubmit,
    onCancel,
    query,
    at: query('op-at'),
    participants: query('op-participants'),
    submit: () => query('op-submit').click(),
    cancel: () => query('op-cancel').click(),
    errors: () => query('op-errors'),
    note: form.element.querySelector('.note'),
    /** 参加者入力欄に積まれている名前（チップ）。 */
    participantChips: () =>
      [...form.element.querySelectorAll('[data-testid="op-participants-item"] span')].map(
        (node) => node.textContent,
      ),
  };
}

/** 作業中の作業項目（未終了の work 区間を持つ）。 */
function workingTask(participants = ['甲', '乙']) {
  return taskRecord({
    intervals: [workInterval('2026-08-01T09:00:00+09:00', null, participants)],
  });
}

/** 休憩中の作業項目。 */
function breakingTask(participants = ['甲', '乙']) {
  return taskRecord({
    intervals: [
      workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00', participants),
      breakInterval('2026-08-01T10:00:00+09:00', null, participants),
    ],
  });
}

describe('createIntervalOperationForm', () => {
  beforeEach(resetIds);

  describe('参加者を尋ねる操作（仕様書8.9.4、8.9 補足）', () => {
    it('開始では参加者を入力させる', () => {
      const view = mount({ operation: TASK_OPERATION.START, taskRecord: taskRecord() });

      expect(view.participants).not.toBeNull();
    });

    it('休憩では入力させず、引き継ぐ参加者を示す', () => {
      const view = mount({ operation: TASK_OPERATION.BREAK, taskRecord: workingTask() });

      expect(view.participants).toBeNull();
      expect(view.note.textContent).toContain('甲、乙');
    });

    it('終了では入力させない', () => {
      const view = mount({ operation: TASK_OPERATION.FINISH, taskRecord: workingTask() });

      expect(view.participants).toBeNull();
      expect(view.note.textContent).toContain('新しい区間は作りません');
    });

    it('再開は休憩中の参加者を初期値として入力させる', () => {
      const view = mount({ operation: TASK_OPERATION.RESUME, taskRecord: breakingTask() });

      expect(view.participants).not.toBeNull();
      expect(view.participantChips()).toEqual(['甲', '乙']);
      expect(view.note.textContent).toContain('再開時の参加者に合わせて変更');
    });

    it('0人の休憩からの再開では入力させる（過去の設計メモ）', () => {
      const view = mount({
        operation: TASK_OPERATION.RESUME,
        taskRecord: breakingTask([]),
      });

      expect(view.participants).not.toBeNull();
      expect(view.note.textContent).toContain('1人以上');
    });

    it('進行中の休憩が無ければ「見つからない」と区別して伝える（過去のレビュー指摘）', () => {
      // 状態表示とボタン制御が一致しないままフォームが開かれた場合を想定する。
      // 到達には多重タブでの競合などが要り、通常操作では起きない。
      const view = mount({ operation: TASK_OPERATION.RESUME, taskRecord: taskRecord() });

      expect(view.note.textContent).toContain('進行中の休憩が見つかりません');
      expect(view.note.textContent).not.toContain('参加者0人');
    });
  });

  describe('参加者変更（仕様書8.4.10）', () => {
    it('現在の参加者を初期値にする（空欄からではない）', () => {
      const view = mount({
        operation: TASK_OPERATION.CHANGE_PARTICIPANTS,
        taskRecord: workingTask(['甲', '乙']),
      });

      expect(view.participants).not.toBeNull();
      expect(view.participantChips()).toEqual(['甲', '乙']);
    });

    it('休憩中でも参加者を尋ねる（0人にもできる、仕様書8.9.4）', () => {
      const view = mount({
        operation: TASK_OPERATION.CHANGE_PARTICIPANTS,
        taskRecord: breakingTask(['甲']),
      });

      expect(view.participants).not.toBeNull();
      expect(view.participantChips()).toEqual(['甲']);
    });

    it('進行中の区間が無ければ「見つからない」と伝える', () => {
      const view = mount({
        operation: TASK_OPERATION.CHANGE_PARTICIPANTS,
        taskRecord: taskRecord(),
      });

      expect(view.note.textContent).toContain('進行中の区間が見つかりません');
    });
  });

  describe('確定', () => {
    it('日時の初期値は現在日時で、そのまま確定できる（仕様書12.4）', async () => {
      const view = mount({ operation: TASK_OPERATION.FINISH, taskRecord: workingTask() });

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({ at: toIsoSecond(FIXED_NOW) });
    });

    it('確定前に日時を直せる（仕様書12.4）', async () => {
      const view = mount({ operation: TASK_OPERATION.FINISH, taskRecord: workingTask() });
      view.at.value = '2026-08-01T18:30:00';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({
        at: toIsoSecond(new Date(2026, 7, 1, 18, 30, 0)),
      });
    });

    it('参加者を添えて渡す', async () => {
      const view = mount({ operation: TASK_OPERATION.START, taskRecord: taskRecord() });
      view.participants.value = '甲';
      view.query('op-participants-add').click();
      view.participants.value = '乙';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({
        at: toIsoSecond(FIXED_NOW),
        // 「追加」を押していない入力欄の値も拾う。
        participants: ['甲', '乙'],
      });
    });

    it('参加者変更は初期値から編集した一覧を渡す（丙が離脱）', async () => {
      const view = mount({
        operation: TASK_OPERATION.CHANGE_PARTICIPANTS,
        taskRecord: workingTask(['甲', '乙', '丙']),
      });
      // 最後に積んだ丙を外す。
      const removeButtons = view.form.element.querySelectorAll(
        '[data-testid="op-participants-remove"]',
      );
      removeButtons[removeButtons.length - 1].click();

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({
        at: toIsoSecond(FIXED_NOW),
        participants: ['甲', '乙'],
      });
    });

    it('再開は休憩中の参加者を変更して渡せる（乙が離脱、丙が参加）', async () => {
      const view = mount({
        operation: TASK_OPERATION.RESUME,
        taskRecord: breakingTask(['甲', '乙']),
      });
      view.form.element
        .querySelector('[data-testid="op-participants-item"]:last-child')
        .querySelector('[data-testid="op-participants-remove"]')
        .click();
      view.participants.value = '丙';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({
        at: toIsoSecond(FIXED_NOW),
        participants: ['甲', '丙'],
      });
    });

    it('候補を参加者入力へ渡す（仕様書8.4.7）', () => {
      const view = mount({
        operation: TASK_OPERATION.START,
        taskRecord: taskRecord(),
        candidates: ['甲', '丙'],
      });

      expect(
        [...view.form.element.querySelectorAll('option')].map((option) => option.value),
      ).toEqual(['甲', '丙']);
    });

    it('日時が未入力なら保存を呼ばずエラーを出す', () => {
      const view = mount({ operation: TASK_OPERATION.FINISH, taskRecord: workingTask() });
      view.at.value = '';

      view.submit();

      expect(view.onSubmit).not.toHaveBeenCalled();
      expect(view.errors().hidden).toBe(false);
      expect(view.errors().textContent).toContain('日時');
    });

    it('保存を拒否されたらフォームへエラーを出す', async () => {
      const onSubmit = vi.fn(async () => {
        throw new ValidationError(['参加者: 作業区間は1人以上必要である（仕様書8.9.4）']);
      });
      const view = mount({
        operation: TASK_OPERATION.START,
        taskRecord: taskRecord(),
        onSubmit,
      });

      view.submit();
      await vi.waitFor(() => expect(view.errors().hidden).toBe(false));

      expect(view.errors().textContent).toContain('1人以上');
    });

    it('拒否された後も入力を保ったまま押し直せる', async () => {
      const onSubmit = vi.fn(async () => {
        throw new ValidationError(['参加者: 作業区間は1人以上必要である']);
      });
      const view = mount({
        operation: TASK_OPERATION.START,
        taskRecord: taskRecord(),
        onSubmit,
      });
      view.at.value = '2026-08-01T09:00:00';

      view.submit();
      await vi.waitFor(() => expect(view.errors().hidden).toBe(false));

      // 秒が 0 のとき入力欄は `09:00` へ正規化しうる。打ち込んだ時刻が残って
      // いることを見る。
      expect(view.at.value).toMatch(/^2026-08-01T09:00/);
      expect(view.query('op-submit').disabled).toBe(false);
    });

    it('保存中は二重に押せない', async () => {
      let release;
      const onSubmit = vi.fn(() => new Promise((resolve) => {
        release = resolve;
      }));
      const view = mount({
        operation: TASK_OPERATION.FINISH,
        taskRecord: workingTask(),
        onSubmit,
      });

      view.submit();
      await vi.waitFor(() => expect(view.query('op-submit').disabled).toBe(true));
      view.submit();

      expect(onSubmit).toHaveBeenCalledTimes(1);
      release();
    });
  });

  it('取消で呼び出し元へ戻す', () => {
    const view = mount({ operation: TASK_OPERATION.FINISH, taskRecord: workingTask() });

    view.cancel();

    expect(view.onCancel).toHaveBeenCalled();
  });

  it('操作の種類を要素へ持たせる', () => {
    const view = mount({ operation: TASK_OPERATION.BREAK, taskRecord: workingTask() });

    expect(view.form.element.dataset.operation).toBe('break');
    expect(view.form.element.getAttribute('aria-label')).toBe('休憩の入力');
  });
});
