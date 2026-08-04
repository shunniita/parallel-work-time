// @vitest-environment happy-dom

/**
 * 区間削除確認の単体テスト（仕様書8.4.5、11章）。
 *
 * 理由の必須と、転記済み・アーカイブでは確定できないことを固定する。
 */

import { describe, expect, it, vi } from 'vitest';

import { createDeleteIntervalConfirm } from '../../../src/ui/components/deleteIntervalConfirm.js';
import { ValidationError } from '../../../src/app/errors.js';

const DELETABLE_PREVIEW = {
  ok: true,
  description: '作業 2026-07-30 09:00:00 〜 09:20:00 / 参加者: 甲、乙 / 工数: 2400秒',
  deletable: true,
  blockedReason: null,
};

function mount(overrides = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn(async () => ({}));
  const onCancel = overrides.onCancel ?? vi.fn();
  const form = createDeleteIntervalConfirm({
    preview: overrides.preview ?? DELETABLE_PREVIEW,
    onConfirm,
    onCancel,
  });
  document.body.replaceChildren(form.element);

  const query = (testid) => form.element.querySelector(`[data-testid="${testid}"]`);
  return {
    form,
    onConfirm,
    onCancel,
    query,
    reason: query('delete-reason'),
    confirm: () => query('delete-confirm').click(),
    cancel: () => query('delete-cancel').click(),
    errors: () => query('delete-errors'),
  };
}

describe('createDeleteIntervalConfirm', () => {
  it('対象区間の内容を確認できる（削除前）', () => {
    const view = mount();

    expect(view.query('delete-confirm-description').textContent).toBe(
      DELETABLE_PREVIEW.description,
    );
  });

  it('理由を入力して確定すると渡す', async () => {
    const view = mount();
    view.reason.value = '二重に記録していたため';

    view.confirm();
    await vi.waitFor(() => expect(view.onConfirm).toHaveBeenCalled());

    expect(view.onConfirm).toHaveBeenCalledWith('二重に記録していたため');
  });

  it('理由が無ければ確定できない（仕様書11章）', () => {
    const view = mount();

    view.confirm();

    expect(view.onConfirm).not.toHaveBeenCalled();
    expect(view.errors().hidden).toBe(false);
    expect(view.errors().textContent).toContain('理由');
  });

  it('空白のみの理由も拒否する', () => {
    const view = mount();
    view.reason.value = '   ';

    view.confirm();

    expect(view.onConfirm).not.toHaveBeenCalled();
  });

  it('理由の前後空白を落として渡す', async () => {
    const view = mount();
    view.reason.value = '  誤入力  ';

    view.confirm();
    await vi.waitFor(() => expect(view.onConfirm).toHaveBeenCalled());

    expect(view.onConfirm).toHaveBeenCalledWith('誤入力');
  });

  it('削除を拒否されたらエラーを出す', async () => {
    const onConfirm = vi.fn(async () => {
      throw new ValidationError(['理由: 必須項目である（仕様書11章）']);
    });
    const view = mount({ onConfirm });
    view.reason.value = '誤入力';

    view.confirm();
    await vi.waitFor(() => expect(view.errors().hidden).toBe(false));

    expect(view.errors().textContent).toContain('理由');
  });

  it('保存中は二重に押せない', async () => {
    let release;
    const onConfirm = vi.fn(() => new Promise((resolve) => {
      release = resolve;
    }));
    const view = mount({ onConfirm });
    view.reason.value = '誤入力';

    view.confirm();
    await vi.waitFor(() => expect(view.query('delete-confirm').disabled).toBe(true));
    view.confirm();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
  });

  it('取消で呼び出し元へ戻す', () => {
    const view = mount();

    view.cancel();

    expect(view.onCancel).toHaveBeenCalled();
  });

  it('理由欄へフォーカスを移せる', () => {
    const view = mount();

    view.form.focus();

    expect(document.activeElement).toBe(view.reason);
  });

  describe('転記済み・アーカイブ（仕様書7.2）', () => {
    it('確定ボタンを無効にし、理由欄の代わりに拒否理由を出す', () => {
      const view = mount({
        preview: {
          ...DELETABLE_PREVIEW,
          deletable: false,
          blockedReason: '実施回: 転記済みのため変更できない。閲覧のみ可能である（仕様書7.2）。',
        },
      });

      expect(view.query('delete-confirm').disabled).toBe(true);
      expect(view.reason).toBeNull();
      expect(view.query('delete-blocked').textContent).toContain('転記済み');
    });
  });
});
