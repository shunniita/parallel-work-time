/**
 * 実施回の並びと「第n回」の採番（仕様書8.2.3、12.1）。
 *
 * 実施回は連番を保存しない（過去の実装計画）。表示のたびに並べて数える派生値である。
 * その数え方が画面ごとに違うと、同じ実施回が場所によって別の番号で呼ばれる
 * （過去のレビュー指摘）。ここへ集約する。
 *
 * ## 採番はアーカイブ済みも数える
 *
 * 番号は**すべての実施回**を通して振り、表示するかどうかとは切り離す。表示中の
 * ものだけを数えると、第1回をアーカイブした瞬間に第2回が「第1回」へ繰り上がる。
 * 利用者は「第2回の分を転記した」のように番号で記録を指すため、後から番号が
 * 動くと過去のやり取りと突き合わせられなくなる。
 *
 * アーカイブは「通常一覧から分離する」操作であって（仕様書10.1）、記録そのものを
 * 無かったことにする操作ではない。数量の累計にもアーカイブ済みを含める
 * （仕様書8.2.5）のと同じ考え方である。
 *
 * ## 並び順
 *
 * 作業日、次に作成日時の昇順とする。同日に複数回を作れるため（仕様書8.2.3）、
 * 作業日だけでは順序が決まらない。
 */

import { RUN_STATUS } from './schema.js';

/**
 * 実施回を表示順へ並べた新しい配列を返す。
 *
 * @param {object[]} runs
 * @returns {object[]}
 */
export function sortRuns(runs) {
  return [...runs].sort(
    (left, right) =>
      left.workDate.localeCompare(right.workDate) ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

/**
 * 実施回へ「第n回」の番号を振る。
 *
 * 渡した配列すべてを数える。アーカイブ済みを除きたい場合は、**採番した後**に
 * {@link visibleRuns} で絞る。順序を先に絞ると番号が繰り上がる。
 *
 * @param {object[]} runs 同一案件グループの実施回
 * @returns {{run: object, number: number}[]} 表示順
 */
export function numberRuns(runs) {
  return sortRuns(runs).map((run, index) => ({ run, number: index + 1 }));
}

/**
 * 通常一覧へ出す実施回だけを残す（仕様書10.1）。
 *
 * アーカイブ済みは専用の画面で扱う。番号は保ったまま絞る。
 *
 * @param {{run: object, number: number}[]} numbered
 * @returns {{run: object, number: number}[]}
 */
export function visibleRuns(numbered) {
  return numbered.filter((item) => item.run.status !== RUN_STATUS.ARCHIVED);
}

/**
 * 通常一覧へ出す実施回を、採番つきで取り出す。
 *
 * 「全件で数えてから絞る」順序を呼び出し側へ書き写さないための入口である。
 *
 * @param {object[]} runs
 * @returns {{run: object, number: number}[]}
 */
export function activeRuns(runs) {
  return visibleRuns(numberRuns(runs));
}
