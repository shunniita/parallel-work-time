// @vitest-environment happy-dom

/**
 * 区間の手動追加・編集フォームの単体テスト（仕様書8.4.11、8.4.5、8.8.4）。
 *
 * 追加は終了日時必須、編集はもともと未終了の区間に限り空欄のまま保存できる
 * （設計メモ §2.2）ことを固定する。保存の可否そのものは domain 層
 * （`intervalOps.test.js`）が持つ。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIntervalEntryForm } from '../../../src/ui/components/intervalEntryForm.js';
import { ValidationError } from '../../../src/app/errors.js';
import { INTERVAL_TYPE } from '../../../src/domain/effort.js';
import { toIsoSecond } from '../../../src/domain/datetime.js';
import { resetIds, workInterval } from '../../fixtures/builders.js';

const FIXED_NOW = new Date(2026, 7, 1, 12, 0, 0);

/**
 * フォームを組み立てて DOM へ載せる。
 *
 * @param {{mode: 'add'|'edit', interval?: object, candidates?: string[],
 *          onSubmit?: Function, onCancel?: Function}} options
 */
function mount(options) {
  const onSubmit = options.onSubmit ?? vi.fn(async () => ({ warnings: [], dataset: {} }));
  const onCancel = options.onCancel ?? vi.fn();
  const form = createIntervalEntryForm({
    mode: options.mode,
    interval: options.interval,
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
    type: query('entry-type'),
    start: query('entry-start'),
    end: query('entry-end'),
    participants: query('entry-participants'),
    submit: () => query('entry-submit').click(),
    cancel: () => query('entry-cancel').click(),
    errors: () => query('entry-errors'),
  };
}

describe('異なるオフセットの区間を編集する（レビュー指摘 FB-9）', () => {
  // インポートしたJSON（仕様書9.3）は、端末とは違うオフセットの区間を含みうる。
  // 実行環境のタイムゾーンに依存しないよう、瞬間の一致だけを見る。

  /** `+00:00` で記録された終了済みの区間。 */
  function foreignInterval() {
    return {
      ...workInterval('2026-08-01T09:00:00+00:00', '2026-08-01T10:00:00+00:00', ['甲']),
    };
  }

  it('何も変えずに保存すると開始も終了も同じ瞬間のままになる', async () => {
    const interval = foreignInterval();
    const view = mount({ mode: 'edit', interval });

    view.submit();
    await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

    const input = view.onSubmit.mock.calls[0][0];
    expect(Date.parse(input.startAt)).toBe(Date.parse(interval.startAt));
    expect(Date.parse(input.endAt)).toBe(Date.parse(interval.endAt));
  });

  it('元のオフセット表記のまま書き戻す', async () => {
    const view = mount({ mode: 'edit', interval: foreignInterval() });

    view.submit();
    await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

    const input = view.onSubmit.mock.calls[0][0];
    expect(input.startAt).toBe('2026-08-01T09:00:00+00:00');
    expect(input.endAt).toBe('2026-08-01T10:00:00+00:00');
  });

  it('時刻を変えても元のオフセットを保つ', async () => {
    const view = mount({ mode: 'edit', interval: foreignInterval() });
    view.end.value = '2026-08-01T11:00:00';

    view.submit();
    await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

    expect(view.onSubmit.mock.calls[0][0].endAt).toBe('2026-08-01T11:00:00+00:00');
  });

  it('未終了区間へ終了時刻を補う場合も開始側のオフセットを使う（仕様書8.8.4）', async () => {
    const interval = workInterval('2026-08-01T09:00:00+00:00', null, ['甲']);
    const view = mount({ mode: 'edit', interval });
    view.end.value = '2026-08-01T10:00:00';

    view.submit();
    await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

    expect(view.onSubmit.mock.calls[0][0].endAt).toBe('2026-08-01T10:00:00+00:00');
  });

  it('追加では端末のオフセットを使う（元の区間が無い）', async () => {
    const view = mount({ mode: 'add' });
    view.start.value = '2026-08-01T09:00:00';
    view.end.value = '2026-08-01T10:00:00';

    view.submit();
    await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

    const input = view.onSubmit.mock.calls[0][0];
    expect(input.startAt).toBe(toIsoSecond(new Date(2026, 7, 1, 9, 0, 0)));
    expect(input.endAt).toBe(toIsoSecond(new Date(2026, 7, 1, 10, 0, 0)));
  });
});

describe('createIntervalEntryForm', () => {
  beforeEach(resetIds);

  describe('追加（仕様書8.4.11）', () => {
    it('種別・開始・終了・参加者を入力できる', async () => {
      const view = mount({ mode: 'add' });
      view.type.value = INTERVAL_TYPE.BREAK;
      view.start.value = '2026-07-30T09:00:00';
      view.end.value = '2026-07-30T10:00:00';
      view.participants.value = '甲';
      view.query('entry-participants-add').click();

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({
        type: INTERVAL_TYPE.BREAK,
        startAt: toIsoSecond(new Date(2026, 6, 30, 9, 0, 0)),
        endAt: toIsoSecond(new Date(2026, 6, 30, 10, 0, 0)),
        participants: ['甲'],
      });
    });

    it('終了日時が空欄では保存できない（設計メモ §2.2）', () => {
      const view = mount({ mode: 'add' });
      view.end.value = '';

      view.submit();

      expect(view.onSubmit).not.toHaveBeenCalled();
      expect(view.errors().hidden).toBe(false);
    });

    it('開始日時が不正なら終了日時を見る前に止める', () => {
      const view = mount({ mode: 'add' });
      view.start.value = '';

      view.submit();

      expect(view.onSubmit).not.toHaveBeenCalled();
      expect(view.errors().textContent).toContain('開始日時');
    });

    it('開始・終了とも現在日時が初期値になる', () => {
      const view = mount({ mode: 'add' });

      expect(view.start.value).toBe('2026-08-01T12:00:00');
      expect(view.end.value).toBe('2026-08-01T12:00:00');
    });

    it('種別の既定は作業である', () => {
      const view = mount({ mode: 'add' });

      expect(view.type.value).toBe(INTERVAL_TYPE.WORK);
    });

    it('保存を拒否されたらフォームへエラーを出す（重複は拒否しない旨とは別）', async () => {
      const onSubmit = vi.fn(async () => {
        throw new ValidationError(['終了日時: 開始日時以降である必要がある（仕様書8.9.3）']);
      });
      const view = mount({ mode: 'add', onSubmit });

      view.submit();
      await vi.waitFor(() => expect(view.errors().hidden).toBe(false));

      expect(view.errors().textContent).toContain('開始日時以降');
    });

    it('取消で呼び出し元へ戻す', () => {
      const view = mount({ mode: 'add' });

      view.cancel();

      expect(view.onCancel).toHaveBeenCalled();
    });

    it('候補を参加者入力へ渡す（仕様書8.4.7）', () => {
      const view = mount({ mode: 'add', candidates: ['甲', '乙'] });

      expect(
        [...view.form.element.querySelectorAll('option[value]:not([selected])')].length,
      ).toBeGreaterThanOrEqual(0);
      const datalistOptions = view.form.element.querySelectorAll('datalist option');
      expect([...datalistOptions].map((option) => option.value)).toEqual(['甲', '乙']);
    });
  });

  describe('編集（仕様書8.4.5、8.8.4）', () => {
    it('既存の値を初期値にする', () => {
      const interval = workInterval(
        '2026-07-30T09:00:00+09:00',
        '2026-07-30T10:00:00+09:00',
        ['甲', '乙'],
      );

      const view = mount({ mode: 'edit', interval });

      expect(view.type.value).toBe(INTERVAL_TYPE.WORK);
      expect(view.start.value).toBe('2026-07-30T09:00:00');
      expect(view.end.value).toBe('2026-07-30T10:00:00');
    });

    it('渡した項目だけを送るのではなく、現在値のまま送る（変更が無ければ実質的な変更なし）', async () => {
      const interval = workInterval(
        '2026-07-30T09:00:00+09:00',
        '2026-07-30T10:00:00+09:00',
        ['甲'],
      );
      const view = mount({ mode: 'edit', interval });

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith({
        type: INTERVAL_TYPE.WORK,
        startAt: '2026-07-30T09:00:00+09:00',
        endAt: '2026-07-30T10:00:00+09:00',
        participants: ['甲'],
      });
    });

    it('もともと未終了なら終了日時が空欄から始まる', () => {
      const interval = workInterval('2026-07-30T09:00:00+09:00', null, ['甲']);

      const view = mount({ mode: 'edit', interval });

      expect(view.end.value).toBe('');
    });

    it('もともと未終了なら空欄のまま保存できる（未終了のまま、設計メモ §2.2）', async () => {
      const interval = workInterval('2026-07-30T09:00:00+09:00', null, ['甲']);
      const view = mount({ mode: 'edit', interval });

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ endAt: null }),
      );
    });

    it('もともと未終了なら終了日時を入れて閉じられる', async () => {
      const interval = workInterval('2026-07-30T09:00:00+09:00', null, ['甲']);
      const view = mount({ mode: 'edit', interval });
      view.end.value = '2026-07-30T18:00:00';

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          endAt: toIsoSecond(new Date(2026, 6, 30, 18, 0, 0)),
        }),
      );
    });

    it('もともと終了済みなら空欄にできない（終了済みを未終了へ戻さない）', () => {
      const interval = workInterval(
        '2026-07-30T09:00:00+09:00',
        '2026-07-30T10:00:00+09:00',
        ['甲'],
      );
      const view = mount({ mode: 'edit', interval });
      view.end.value = '';

      view.submit();

      expect(view.onSubmit).not.toHaveBeenCalled();
      expect(view.errors().hidden).toBe(false);
    });

    it('区間種別を変更できる', async () => {
      const interval = workInterval(
        '2026-07-30T09:00:00+09:00',
        '2026-07-30T10:00:00+09:00',
        ['甲'],
      );
      const view = mount({ mode: 'edit', interval });
      view.type.value = INTERVAL_TYPE.BREAK;

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: INTERVAL_TYPE.BREAK }),
      );
    });

    it('参加者を差し替えられる', async () => {
      const interval = workInterval(
        '2026-07-30T09:00:00+09:00',
        '2026-07-30T10:00:00+09:00',
        ['甲'],
      );
      const view = mount({ mode: 'edit', interval });
      view.participants.value = '乙';
      view.query('entry-participants-add').click();

      view.submit();
      await vi.waitFor(() => expect(view.onSubmit).toHaveBeenCalled());

      expect(view.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ participants: ['甲', '乙'] }),
      );
    });

    it('見出しが「保存」になる（追加は「追加」）', () => {
      const interval = workInterval('2026-07-30T09:00:00+09:00', null, ['甲']);

      expect(mount({ mode: 'edit', interval }).query('entry-submit').textContent).toBe('保存');
      expect(mount({ mode: 'add' }).query('entry-submit').textContent).toBe('追加');
    });
  });
});
