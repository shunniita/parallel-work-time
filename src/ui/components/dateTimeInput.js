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
 * 余地がない（過去のレビュー指摘、過去の設計メモ）。
 *
 * 入力途中に再描画しない。この部品は自分の要素を作り直さず、値の読み出しだけを
 * 提供する（`src/app/store.js` の再描画の規約3）。
 *
 * ## 編集ではオフセットを保つ（過去のレビュー指摘）
 *
 * 入力欄は保存済みISOの**壁時計部分だけ**を表示する（`toDateTimeLocal`）。
 * そのため、書き戻すときのオフセットを別に決める必要がある。
 *
 * 既定は「入力された日の端末ローカルオフセット」である。新規入力はこれでよい。
 * しかし**編集**でこれを使うと、保存値のオフセットと端末のオフセットが違う区間
 * （インポートしたJSONなど、仕様書9.3）で、値を何も変えずに保存しただけで指す
 * 瞬間が変わってしまう。
 *
 * ```text
 * 元の値:     2026-08-01T09:00:00Z
 * 入力欄:     2026-08-01T09:00:00     ← 壁時計だけを出す
 * 端末が JST なら書き戻し: 2026-08-01T09:00:00+09:00   ← 9時間ずれる
 * ```
 *
 * そこで編集では、元の区間が持つオフセット（`offsetMinutesOf()`）を
 * `offsetMinutes` として渡す。表示は元の壁時計のまま、書き戻しも元のオフセット
 * のままになり、無変更保存で瞬間が変わらない。
 *
 * 壁時計を端末ローカルへ変換して見せる案は採らない。作業記録は「その場所の
 * 何時に作業したか」であり、9時に作業した記録を18時と見せるほうが読み違えを招く。
 *
 * 夏時間は引き続き想定しない（`datetime.js` 冒頭、過去のレビュー指摘）。ただし
 * 元のオフセットを保つ規則は、切替日をまたぐ編集でも無変更保存が瞬間を変えない
 * 側に働く。
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
 *          value?: string, startEmpty?: boolean, optional?: boolean,
 *          offsetMinutes?: number, now?: () => Date}} options
 *   `value` はオフセット付きISO 8601。省略すると現在日時（仕様書8.4.3）。
 *   `startEmpty` を渡すと `value` / `now` を無視して空欄から始める（区間編集で
 *   「もともと未終了」の場合に使う。過去の設計メモ）。
 *   `optional` を渡すと、空欄のまま確定しても `ok: true, iso: null` を返す。
 *   これも未終了区間を未終了のまま保存する編集のためにある。
 *   `offsetMinutes` は書き戻すときのオフセット。省略すると入力された日の端末
 *   ローカル値を使う（新規入力はこちら）。詳細は下の「編集ではオフセットを保つ」。
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
  startEmpty = false,
  optional = false,
  offsetMinutes,
  now = () => new Date(),
}) {
  const input = el('input', {
    type: 'datetime-local',
    step: '1',
    class: 'input input--auto',
    value: startEmpty ? '' : toDateTimeLocal(value ?? toIsoSecond(now())),
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
     * （過去のレビュー指摘）。`optional` が true の場合に限り、空欄は
     * `iso: null` の成功として返す。
     *
     * @returns {{ok: boolean, iso: string|null, error: string|null}}
     */
    read() {
      if (optional && input.value === '') {
        return { ok: true, iso: null, error: null };
      }
      if (!isValidDateTimeLocal(input.value)) {
        return {
          ok: false,
          iso: null,
          error: `${label}: 日付と時刻を入力してください（実在する日時、秒まで）`,
        };
      }
      return { ok: true, iso: fromDateTimeLocal(input.value, offsetMinutes), error: null };
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
