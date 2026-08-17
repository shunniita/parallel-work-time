/**
 * 画面表示のための語と数値の書式。
 *
 * 状態や種別そのものの表示名は `src/domain/` 側（`taskState.js` の
 * `TASK_STATE_LABEL`、`effort.js` の `INTERVAL_TYPE_LABEL`、`runStatus.js` の
 * `RUN_STATUS_LABEL`）が持つ。ここへ置くのは保存する値と対応しない、画面だけの
 * 語と書式である。
 *
 * 過去のレビュー指摘（ラベル定数の重複）の寄せ先である。`RUN_STATUS_LABEL` は
 * `domain/runStatus.js` にある。状態遷移を拒む理由の文言でも同じ語を使うため、
 * 画面側に置くと domain が UI を参照することになる。
 */

/**
 * 秒を「n分」表記へ直す。
 *
 * 表示用であり、転記値の計算とは別である。転記値は作業項目の合計に対して一度
 * だけ分へ切り上げる（仕様書8.6.4、`src/domain/effort.js`）。こちらは端数の秒を
 * そのまま見せて、記録の粒度が分からなくならないようにする。
 *
 * @param {number} seconds
 * @returns {string}
 */
export function toMinutesLabel(seconds) {
  if (seconds === 0) {
    return '0分';
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}分` : `${minutes}分${rest}秒`;
}
