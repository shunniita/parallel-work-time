// @vitest-environment happy-dom

/**
 * 分・秒入力の単体テスト（仕様書8.5.1）。
 *
 * ここが持つのは「分・秒それぞれが0以上の整数として読めるか」だけである。
 * 合計が0秒であることの可否は domain 層（`directEntryOps.test.js`）が持つ。
 */

import { describe, expect, it } from 'vitest';

import { createDurationInput } from '../../../src/ui/components/durationInput.js';

/**
 * 入力欄を組み立てて DOM へ載せる。
 *
 * @param {{seconds?: number}} [options]
 */
function mount(options = {}) {
  const input = createDurationInput({ idPrefix: 'test', seconds: options.seconds });
  document.body.replaceChildren(input.element);

  const query = (testid) => input.element.querySelector(`[data-testid="${testid}"]`);
  return {
    input,
    query,
    minutes: query('test-minutes'),
    seconds: query('test-seconds'),
    read: () => input.read(),
  };
}

describe('createDurationInput', () => {
  describe('初期値', () => {
    it('省略すると空欄から始める', () => {
      const view = mount();

      expect(view.minutes.value).toBe('');
      expect(view.seconds.value).toBe('');
    });

    it('秒数を分と秒へ割って入れる', () => {
      const view = mount({ seconds: 1230 });

      expect(view.minutes.value).toBe('20');
      expect(view.seconds.value).toBe('30');
    });

    it('60秒未満なら分は0', () => {
      const view = mount({ seconds: 45 });

      expect(view.minutes.value).toBe('0');
      expect(view.seconds.value).toBe('45');
    });

    it('0秒でも空欄にはしない', () => {
      // 編集で「0秒の記録」を開いた場合に、未入力と見分けられる必要がある。
      const view = mount({ seconds: 0 });

      expect(view.minutes.value).toBe('0');
      expect(view.seconds.value).toBe('0');
    });
  });

  describe('read()', () => {
    it('分と秒を足した秒数を返す', () => {
      const view = mount();
      view.minutes.value = '20';
      view.seconds.value = '30';

      expect(view.read()).toEqual({ ok: true, seconds: 1230, error: null });
    });

    it('空欄は0として扱う', () => {
      // 分だけ、秒だけを入れる使い方を許す。
      const view = mount();
      view.minutes.value = '20';

      expect(view.read().seconds).toBe(1200);
    });

    it('両方空欄なら0秒を返す（可否は domain が決める）', () => {
      const view = mount();

      expect(view.read()).toEqual({ ok: true, seconds: 0, error: null });
    });

    it('59を超える秒も受け付ける', () => {
      // 90秒は1分30秒として扱う。繰り上げを暗算させるより誤りが少ない。
      const view = mount();
      view.seconds.value = '90';

      expect(view.read().seconds).toBe(90);
    });

    it('数字でない文字は入力欄が受け付けないため0になる', () => {
      // `type="number"` は代入時に非数値を空文字へ正規化する。空欄と同じ扱いに
      // なり、合計0秒として domain 側が拒む。
      const view = mount();
      view.minutes.value = 'abc';

      expect(view.minutes.value).toBe('');
      expect(view.read()).toEqual({ ok: true, seconds: 0, error: null });
    });

    it.each([
      ['1.5', '0'],
      ['0', '1.5'],
      ['-1', '0'],
      ['0', '-1'],
    ])('分=%s 秒=%s は拒否する', (minutes, seconds) => {
      const view = mount();
      view.minutes.value = minutes;
      view.seconds.value = seconds;

      const result = view.read();
      expect(result.ok).toBe(false);
      expect(result.seconds).toBeNull();
      expect(result.error).toContain('0以上の整数');
    });

    it('エラー文にどちらの欄かを入れる', () => {
      const view = mount();
      view.seconds.value = '1.5';

      expect(view.read().error).toContain('秒');
    });
  });

  it('総工数であることを注記に出す（仕様書8.5 補足、8.5.6）', () => {
    // 「時間」ではなく総工数と分かる表記にする。取り違えると工数が人数分ずれる。
    const view = mount();

    expect(view.input.element.textContent).toContain('総工数');
    expect(view.input.element.textContent).toContain('参加者数は掛けません');
  });

  it('focus() で分の欄へ移る', () => {
    const view = mount();

    view.input.focus();

    expect(document.activeElement).toBe(view.minutes);
  });

  it('ラベルと入力欄が id で結びつく（仕様書13章）', () => {
    const view = mount();

    const labels = [...view.input.element.querySelectorAll('label')];
    expect(labels.map((label) => label.getAttribute('for'))).toEqual([
      'test-minutes',
      'test-seconds',
    ]);
    expect(view.minutes.id).toBe('test-minutes');
    expect(view.seconds.id).toBe('test-seconds');
  });
});
