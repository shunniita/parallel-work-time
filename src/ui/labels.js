/**
 * 画面表示のための語と数値の書式。
 *
 * 状態や種別そのものの表示名は `src/domain/` 側（`taskState.js` の
 * `TASK_STATE_LABEL`、`effort.js` の `INTERVAL_TYPE_LABEL`）が持つ。ここへ置くのは
 * 保存する値と対応しない、画面だけの語と書式である。
 *
 * レビュー指摘 D-16（ラベル定数の重複）の寄せ先である。Step 8 の集計画面を作る
 * ときに、`tree.js` と `projectView.js` に残っている複製をここへ向け直す。
 */

/** 実施回の状態の表示名（仕様書7章）。 */
export const RUN_STATUS_LABEL = {
  working: '作業中',
  aggregated: '集計済み',
  transferred: '転記済み',
  archived: 'アーカイブ',
};

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
