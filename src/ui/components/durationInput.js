/**
 * 工数の分・秒入力（仕様書8.5.1）。
 *
 * 分と秒を別々の欄で受け取り、合計の秒数として読み出す。区間のように開始・終了の
 * 時刻を持たない直接入力のための部品である。
 *
 * ## 見出しを「時間」にしない
 *
 * 仕様書8.5 補足が、単に「時間」とせず総工数と分かる表記にするよう定めている。
 * ここでの既定は「追加工数」で、注記に「参加人数を含んだ総工数」と明記する。
 * 直接入力の値には参加者数を掛けない（仕様書8.5.6、8.6.6）。3人で20分作業した
 * 分を足すなら、20分ではなく60分を入れる欄である。取り違えると工数が3分の1に
 * なるため、注記を省かない。
 *
 * ## 検証をどこまで持つか
 *
 * ここが見るのは「分・秒それぞれが0以上の整数として読めるか」だけである。合計が
 * 0秒であることや上限は `src/domain/directEntryOps.js` が判断する。画面の部品が
 * 業務の可否を決めると、同じ規則が2箇所に散る。
 *
 * 秒欄に59を超える値を入れてもよい。90秒は1分30秒として扱う。利用者が計測した
 * 数字をそのまま打てるほうが、繰り上げを暗算させるより誤りが少ない。
 *
 * 入力途中に再描画しない。この部品は自分の要素を作り直さず、値の読み出しだけを
 * 提供する（`src/app/store.js` の再描画の規約3）。
 */

import { el, field } from '../dom.js';
import { toOptionalIntegerInput } from '../numeric.js';

/**
 * 分・秒の入力欄を作る。
 *
 * @param {{idPrefix: string, testidPrefix?: string, legend?: string,
 *          hint?: string, seconds?: number}} options
 *   `seconds` は初期値の合計秒数。省略すると空欄から始める。
 * @returns {{element: HTMLElement, minutesInput: HTMLElement, secondsInput: HTMLElement,
 *            read: () => {ok: boolean, seconds: number|null, error: string|null},
 *            focus: () => void}}
 */
export function createDurationInput({
  idPrefix,
  testidPrefix = idPrefix,
  legend = '追加工数',
  hint = '参加人数を含んだ総工数（人×時間）を入力します。参加者数は掛けません。',
  seconds,
}) {
  const hasInitial = Number.isInteger(seconds);
  const minutesInput = el('input', {
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    class: 'input input--num',
    value: hasInitial ? String(Math.floor(seconds / 60)) : '',
    dataset: { testid: `${testidPrefix}-minutes` },
  });
  const secondsInput = el('input', {
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    class: 'input input--num',
    value: hasInitial ? String(seconds % 60) : '',
    dataset: { testid: `${testidPrefix}-seconds` },
  });

  /**
   * 欄1つを0以上の整数として読む。空欄は0として扱う。
   *
   * 分だけ、秒だけを入れる使い方を許すためである。両方空なら合計0秒になり、
   * `directEntryOps` が「1秒以上を入力する」として拒む。
   *
   * @param {HTMLElement} input
   * @param {string} label
   * @returns {{ok: boolean, value: number, error: string|null}}
   */
  function readPart(input, label) {
    const parsed = toOptionalIntegerInput(input.value);
    if (parsed === undefined) {
      return { ok: true, value: 0, error: null };
    }
    if (Number.isNaN(parsed) || parsed < 0) {
      return {
        ok: false,
        value: 0,
        error: `${legend}の${label}: 0以上の整数を入力してください`,
      };
    }
    return { ok: true, value: parsed, error: null };
  }

  return {
    element: el('fieldset', { class: 'fieldset', dataset: { testid: `${testidPrefix}-group` } }, [
      el('legend', { text: legend }),
      el('div', { class: 'field-row' }, [
        field({ id: `${idPrefix}-minutes`, label: '分', input: minutesInput }),
        field({ id: `${idPrefix}-seconds`, label: '秒', input: secondsInput }),
      ]),
      el('p', { class: 'field__hint', text: hint }),
    ]),
    minutesInput,
    secondsInput,

    /**
     * 合計秒数を読む。
     *
     * 不正な入力は `ok: false` で返し、例外にしない。画面はエラー文をそのまま
     * 出せる。
     *
     * @returns {{ok: boolean, seconds: number|null, error: string|null}}
     */
    read() {
      const minutes = readPart(minutesInput, '分');
      if (!minutes.ok) {
        return { ok: false, seconds: null, error: minutes.error };
      }
      const rest = readPart(secondsInput, '秒');
      if (!rest.ok) {
        return { ok: false, seconds: null, error: rest.error };
      }
      return { ok: true, seconds: minutes.value * 60 + rest.value, error: null };
    },

    focus() {
      minutesInput.focus();
    },
  };
}
