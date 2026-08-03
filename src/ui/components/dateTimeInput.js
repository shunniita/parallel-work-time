/**
 * 日時の入力欄（仕様書8.4.3、8.4.4）。
 *
 * 初期値は現在日時、秒まで入力できる。`<input type="datetime-local">` は `step`
 * を指定しないと分までしか扱わないため、`step="1"` を必ず付ける。
 *
 * 値の読み書きは `src/domain/datetime.js` を通す。入力欄が持つのは壁時計の値
 * だけであり、保存形式（オフセット付きISO 8601）への変換規則を画面へ写さない。
 * オフセットは `fromDateTimeLocal()` に決めさせる。入力された日のローカル
 * オフセットが使われるため、呼び出し側が現在日時のオフセットを渡して取り違える
 * 余地がない（レビュー指摘 SOL-1、設計メモ §4.2.1）。
 *
 * 入力途中に再描画しない。この部品は自分の要素を作り直さず、値の読み出しだけを
 * 提供する（`src/app/store.js` の再描画の規約3）。
 */

import {
  fromDateTimeLocal,
  isValidDateTimeLocal,
  toDateTimeLocal,
  toIsoSecond,
} from '../../domain/datetime.js';
import { el, field } from '../dom.js';

/**
 * 日時入力欄を作る。
 *
 * @param {{id: string, testid?: string, label?: string, hint?: string,
 *          value?: string, now?: () => Date}} options
 *   `value` はオフセット付きISO 8601。省略すると現在日時（仕様書8.4.3）
 * @returns {{element: HTMLElement, input: HTMLElement,
 *            read: () => {ok: boolean, iso: string|null, error: string|null},
 *            setValue: (iso: string) => void, focus: () => void}}
 */
export function createDateTimeInput({
  id,
  testid = id,
  label = '日時',
  hint,
  value,
  now = () => new Date(),
}) {
  const input = el('input', {
    type: 'datetime-local',
    step: '1',
    class: 'input input--auto',
    value: toDateTimeLocal(value ?? toIsoSecond(now())),
    dataset: { testid },
  });

  return {
    element: field({ id, label, input, hint }),
    input,

    /**
     * 入力値を保存形式で読む。
     *
     * 未入力・不正な日付は `ok: false` で返し、例外にしない。画面はエラー文を
     * そのまま出せる。判定は `fromDateTimeLocal()` が受け付ける範囲と一致する
     * （レビュー指摘 SOL-3）。
     *
     * @returns {{ok: boolean, iso: string|null, error: string|null}}
     */
    read() {
      if (!isValidDateTimeLocal(input.value)) {
        return {
          ok: false,
          iso: null,
          error: `${label}: 日付と時刻を入力してください（実在する日時、秒まで）`,
        };
      }
      return { ok: true, iso: fromDateTimeLocal(input.value), error: null };
    },

    /**
     * @param {string} iso オフセット付きISO 8601
     */
    setValue(iso) {
      input.value = toDateTimeLocal(iso);
    },

    focus() {
      input.focus();
    },
  };
}
