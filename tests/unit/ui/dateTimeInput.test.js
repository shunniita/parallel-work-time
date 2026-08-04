// @vitest-environment happy-dom

/**
 * 日時入力欄の単体テスト（仕様書8.4.3、8.4.4）。
 *
 * 現在日時の既定、秒までの入力、保存形式への変換を固定する。
 */

import { describe, expect, it } from 'vitest';

import { createDateTimeInput } from '../../../src/ui/components/dateTimeInput.js';
import { toIsoSecond } from '../../../src/domain/datetime.js';

/** 実行環境のタイムゾーンに依存しないよう、ローカルの壁時計で固定する。 */
const FIXED_NOW = new Date(2026, 7, 1, 9, 30, 15);

function mount(options = {}) {
  const component = createDateTimeInput({ id: 'at', now: () => FIXED_NOW, ...options });
  document.body.replaceChildren(component.element);
  return { component, input: component.element.querySelector('[data-testid="at"]') };
}

describe('createDateTimeInput', () => {
  it('初期値を現在日時にする（仕様書8.4.3）', () => {
    const { input } = mount();

    expect(input.value).toBe('2026-08-01T09:30:15');
  });

  it('秒まで入力できるようにする（仕様書8.4.4）', () => {
    const { input } = mount();

    expect(input.getAttribute('type')).toBe('datetime-local');
    expect(input.getAttribute('step')).toBe('1');
  });

  it('初期値を明示できる（区間の編集で使う）', () => {
    const { input } = mount({ value: '2026-07-30T23:30:00+09:00' });

    expect(input.value).toBe('2026-07-30T23:30:00');
  });

  it('入力値を保存形式で読む', () => {
    const { component, input } = mount();
    input.value = '2026-08-01T10:00:00';

    const result = component.read();

    expect(result.ok).toBe(true);
    // オフセットは入力された日のローカル値になる（レビュー指摘 SOL-1）。
    expect(result.iso).toBe(toIsoSecond(new Date(2026, 7, 1, 10, 0, 0)));
  });

  it('現在日時のまま確定すると初期値がそのまま保存形式になる', () => {
    const { component } = mount();

    expect(component.read().iso).toBe(toIsoSecond(FIXED_NOW));
  });

  it('秒を省いた値は0秒として読む', () => {
    const { component, input } = mount();
    input.value = '2026-08-01T10:00';

    expect(component.read().iso).toBe(toIsoSecond(new Date(2026, 7, 1, 10, 0, 0)));
  });

  it('未入力は例外にせずエラー文で返す', () => {
    const { component, input } = mount();
    input.value = '';

    const result = component.read();

    expect(result.ok).toBe(false);
    expect(result.iso).toBeNull();
    expect(result.error).toContain('日時');
  });

  it('実在しない日付を拒否する（レビュー指摘 SOL-3）', () => {
    const { component, input } = mount();
    input.value = '2026-02-30T09:00:00';

    expect(component.read().ok).toBe(false);
  });

  it('値を差し替えられる', () => {
    const { component, input } = mount();

    component.setValue('2026-12-31T23:59:59+09:00');

    expect(input.value).toBe('2026-12-31T23:59:59');
  });

  it('ラベルが入力欄と結び付いている（レビュー指摘 D-17）', () => {
    const { component, input } = mount();

    expect(component.element.querySelector('label').getAttribute('for')).toBe('at');
    expect(input.id).toBe('at');
  });

  describe('startEmpty（区間編集で未終了のまま始める、設計メモ §4.2.2）', () => {
    it('value / now を無視して空欄から始める', () => {
      const { input } = mount({ startEmpty: true, value: '2026-07-30T09:00:00+09:00' });

      expect(input.value).toBe('');
    });
  });

  describe('optional（未終了区間を未終了のまま保存する編集）', () => {
    it('空欄のまま確定すると iso: null を返す', () => {
      const { component, input } = mount({ startEmpty: true, optional: true });
      input.value = '';

      expect(component.read()).toEqual({ ok: true, iso: null, error: null });
    });

    it('optional でも入力があれば通常どおり変換する', () => {
      const { component, input } = mount({ startEmpty: true, optional: true });
      input.value = '2026-08-01T10:00:00';

      const result = component.read();
      expect(result.ok).toBe(true);
      expect(result.iso).toBe(toIsoSecond(new Date(2026, 7, 1, 10, 0, 0)));
    });

    it('optional が false なら空欄はエラーのまま', () => {
      const { component, input } = mount({ startEmpty: true });
      input.value = '';

      expect(component.read().ok).toBe(false);
    });
  });
});
