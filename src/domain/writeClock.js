/**
 * 書き込み時刻の単調性（仕様書9.3、受入基準 A-11、過去のレビュー指摘）。
 *
 * ## 何を守るのか
 *
 * 「ツール自身が書き出したJSONは、同じ版のツールへ必ず取り込める」を契約とする。
 * 取り込み検証は実施回の日時が
 * `createdAt <= transferredAt <= archivedAt <= updatedAt` の順に並ぶことを求める
 * （`integrity.js`）。この検査だけを足すと、次の経路で自分のバックアップを
 * 読み戻せなくなる。
 *
 *   実施回を作る（`createdAt` = 10:00）
 *   → NTP補正や手動修正で時計が 09:50 へ戻る
 *   → 区間を1件足す（`updatedAt` = 09:50）
 *   → エクスポートは成功するが、取り込みは `updatedAt < createdAt` で拒否される
 *
 * 転記済み・アーカイブ済みは閲覧のみなので（仕様書7.2）、画面から日時を直す手段も
 * 無い。破壊的操作の直前に取る退避（9.4）も同じく戻せなくなる。
 *
 * ## 検査ではなく書き込みを直す
 *
 * 取り込みの不変条件は緩めない。緩めると「保持期間の起算が狂う到達不能な時系列」
 * （10.2 の指摘）を再び受け入れることになる。代わりに書き込み側で、
 * 関連する既存の日時より前にならない実効時刻を採用する。
 *
 * 現在時刻そのものを書き換えるわけではない。時計が正常に進んでいる限り実効時刻は
 * 現在時刻に一致し、巻き戻った期間だけ直前の日時で頭打ちになる。
 */

import { compareIso, isValidIsoSecond } from './datetime.js';

/**
 * 実施回へ書き込む日時を決める。
 *
 * 現在時刻と、その実施回が既に持つ日時のうち最も後のものを返す。状態遷移で
 * `transferredAt` / `archivedAt` を打つ場合も同じ値を使えば、鎖全体の順序が保たれる。
 *
 * @param {{createdAt?: string, updatedAt?: string, transferredAt?: string|null,
 *          archivedAt?: string|null}|null|undefined} workRun 変更前の実施回
 * @param {string} nowIso オフセット付きISO 8601（秒精度）
 * @returns {string}
 */
export function runWriteTime(workRun, nowIso) {
  const known = [
    workRun?.createdAt,
    workRun?.transferredAt,
    workRun?.archivedAt,
    workRun?.updatedAt,
  ];
  // 読めない日時は比較しない。保存済みデータが壊れていても、書き込みを例外で
  // 止めるより現在時刻で進める方が復旧しやすい。
  return known.reduce(
    (latest, candidate) =>
      isValidIsoSecond(candidate) && compareIso(candidate, latest) > 0 ? candidate : latest,
    nowIso,
  );
}
