/**
 * 画面の入力欄（文字列）から整数を取り出す。
 *
 * `Number.parseInt()` は使わない。先頭から読める分だけを解釈して残りを捨てるため、
 * `1.5` を `1`、`1e3` を `1`、`12abc` を `12` として通してしまう。数量のように
 * 「1以上の整数」であることが要件（仕様書8.9.2）の欄では、これらは黙って別の値
 * として保存されることになる。
 *
 * ここでは全体を `Number()` で変換し、`Number.isInteger()` で整数性を確かめる。
 * 整数でなければ `NaN` を返し、検証層（`src/domain/validation.js`）が
 * 「1以上の整数である」として捕まえる。画面側で握りつぶさない。
 */

/**
 * 必須の整数入力を変換する。空欄も不正値として `NaN` を返す。
 *
 * @param {unknown} value 入力欄の `value`
 * @returns {number} 整数、または `NaN`
 */
export function toIntegerInput(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return Number.NaN;
  }
  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

/**
 * 任意の整数入力を変換する。空欄は「未設定」として `undefined` を返す。
 *
 * 空欄と「整数でない入力」を区別する。空欄は未入力として扱いたい一方、`1.5` は
 * 未入力ではなく誤った入力であり、`undefined` へ丸めると検証をすり抜ける。
 *
 * @param {unknown} value 入力欄の `value`
 * @returns {number|undefined} 整数、`NaN`、または未設定を表す `undefined`
 */
export function toOptionalIntegerInput(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return undefined;
  }
  return toIntegerInput(text);
}
