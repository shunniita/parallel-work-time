// @vitest-environment happy-dom

/**
 * 工数直接入力フォームの単体テスト（仕様書8.5）。
 *
 * 保存の可否そのものは domain 層（`directEntryOps.test.js`）が持つ。ここは
 * 「入力を組み立てて渡すこと」と「拒否されたときにエラーを出すこと」を固定する。
 */

import { describe, expect, it, vi } from 'vitest';

import { createDirectEntryForm } from '../../../src/ui/components/directEntryForm.js';
import { ValidationError } from '../../../src/app/errors.js';

/**
 * フォームを組み立てて DOM へ載せる。
 *
 * @param {{mode: 'add'|'edit', entry?: object, candidates?: string[],
 *          onSubmit?: Function, onCancel?: Function}} options
 */
function mount(options) {
  const onSubmit = options.onSubmit ?? vi.fn(async () => ({ warnings: [], dataset: {} }));
  const onCancel = options.onCancel ?? vi.fn();
  const form = createDirectEntryForm({
    mode: options.mode,
    entry: options.entry,
    candidates: options.candidates ?? [],
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
    minutes: query('direct-duration-minutes'),
    seconds: query('direct-duration-seconds'),
    participants: query('direct-participants'),
    note: query('direct-note'),
    submit: () => query('direct-submit').click(),
    cancel: () => query('direct-cancel').click(),
    errors: () => query('direct-errors'),
  };
}

describe('createDirectEntryForm', () => {
  describe('追加（mode: add）', () => {
    it('空欄から始め、参加者数を掛けない旨を注記する（仕様書8.5.6）', () => {
      const view = mount({ mode: 'add' });

      expect(view.minutes.value).toBe('');
      expect(view.note.value).toBe('');
      expect(view.form.element.textContent).toContain('参加者数は掛けません');
    });

    it('分・秒・参加者・備考をまとめて渡す', async () => {
      const view = mount({ mode: 'add' });
      view.minutes.value = '20';
      view.seconds.value = '30';
      view.participants.value = '甲';
      view.note.value = '移動時間';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({
        seconds: 1230,
        participants: ['甲'],
        note: '移動時間',
      });
    });

    it('参加者が空でも渡す（仕様書6.8）', async () => {
      // 直接入力の秒数は既に人数を含んだ総工数であり、参加者は照合用の補助情報
      // にすぎない。`work` 区間のように0人を禁じる理由が無い。
      const view = mount({ mode: 'add' });
      view.minutes.value = '20';
      view.note.value = '誰の分か不明の計測漏れ';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit.mock.calls[0][0].participants).toEqual([]);
    });

    it('備考は素通しし、必須判定は domain へ任せる（仕様書8.5.4）', async () => {
      // 同じ規則を画面と domain の両方へ書かない。
      const view = mount({ mode: 'add' });
      view.minutes.value = '20';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit.mock.calls[0][0].note).toBe('');
    });

    it('分・秒が読めなければ呼ばずにエラーを出す', () => {
      const view = mount({ mode: 'add' });
      view.minutes.value = '1.5';
      view.note.value = '移動時間';

      view.submit();

      expect(view.onSubmit).not.toHaveBeenCalled();
      expect(view.errors().hidden).toBe(false);
      expect(view.errors().textContent).toContain('0以上の整数');
    });
  });

  describe('編集（mode: edit）', () => {
    /** 編集対象の直接入力。 */
    const entry = {
      entryId: 'entry-1',
      seconds: 1230,
      participants: ['甲', '乙'],
      note: '移動時間を追加',
      createdAt: '2026-08-01T10:00:00+09:00',
      updatedAt: '2026-08-01T10:00:00+09:00',
    };

    it('既存の値を初期値にする', () => {
      const view = mount({ mode: 'edit', entry });

      expect(view.minutes.value).toBe('20');
      expect(view.seconds.value).toBe('30');
      expect(view.note.value).toBe('移動時間を追加');
      expect(view.form.element.dataset.mode).toBe('edit');
    });

    it('参加者も初期値として復元する', async () => {
      const view = mount({ mode: 'edit', entry });

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit.mock.calls[0][0].participants).toEqual(['甲', '乙']);
    });

    it('変えた分だけを反映して渡す', async () => {
      const view = mount({ mode: 'edit', entry });
      view.minutes.value = '10';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit.mock.calls[0][0]).toEqual({
        seconds: 630,
        participants: ['甲', '乙'],
        note: '移動時間を追加',
      });
    });

    it('見出しを「編集」にする', () => {
      const view = mount({ mode: 'edit', entry });

      expect(view.form.element.textContent).toContain('直接入力を編集');
    });
  });

  describe('保存の失敗', () => {
    it('拒否された理由をそのまま出す', async () => {
      const view = mount({
        mode: 'add',
        onSubmit: vi.fn(async () => {
          throw new ValidationError(['備考: 必須項目である（仕様書8.5.4）']);
        }),
      });
      view.minutes.value = '20';

      view.submit();
      await vi.waitFor(() => expect(view.errors().hidden).toBe(false));

      expect(view.errors().textContent).toContain('備考');
    });

    it('失敗しても入力は残る', async () => {
      const view = mount({
        mode: 'add',
        onSubmit: vi.fn(async () => {
          throw new ValidationError(['備考: 必須項目である']);
        }),
      });
      view.minutes.value = '20';
      view.seconds.value = '30';

      view.submit();
      await vi.waitFor(() => expect(view.errors().hidden).toBe(false));

      expect(view.minutes.value).toBe('20');
      expect(view.seconds.value).toBe('30');
    });

    it('失敗した後に押し直せる', async () => {
      const onSubmit = vi
        .fn()
        .mockRejectedValueOnce(new ValidationError(['備考: 必須項目である']))
        .mockResolvedValueOnce({ warnings: [], dataset: {} });
      const view = mount({ mode: 'add', onSubmit });
      view.minutes.value = '20';

      view.submit();
      await vi.waitFor(() => expect(view.errors().hidden).toBe(false));
      view.note.value = '移動時間';
      view.submit();

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    });
  });

  it('取消で onCancel を呼ぶ', () => {
    const view = mount({ mode: 'add' });

    view.cancel();

    expect(view.onCancel).toHaveBeenCalled();
  });

  it('focus() で分の欄へ移る', () => {
    const view = mount({ mode: 'add' });

    view.form.focus();

    expect(document.activeElement).toBe(view.minutes);
  });
});
