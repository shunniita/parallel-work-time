/**
 * 実施回の状態に対する判定（仕様書7.2）。
 *
 * 状態そのものの定義は `src/domain/schema.js` の `RUN_STATUS` にある。ここは
 * 「その状態で何ができるか」だけを持つ純関数である。
 *
 * ## 状態ガードの規約
 *
 * 実施回の内容を書き換えるアクション（数量の修正、区間の記録・編集・削除、
 * 直接入力の追加・編集・削除）は、保存の前に必ず {@link isRunEditable} を通す。
 * 仕様書7.2 の「転記済み／アーカイブは閲覧のみ」を、アクションごとの `if` では
 * なく1つの判定へ集約するためである。判定が散ると、アクションが増えるたびに
 * 同じ穴が空く。
 *
 * 例外は2つだけである。
 *
 * - 読み取りしかしないアクション
 * - 状態そのものを進める／戻す遷移アクション（実装計画 Step 10）。転記済みから
 *   集計済みへ戻す操作は、まさに閲覧のみの状態から抜けるための操作である。
 *
 * 状態遷移そのものの規則（7.1）は Step 10 でこのモジュールへ足す。
 */

import { RUN_STATUS } from './schema.js';

/** 内容を書き換えられる状態（仕様書7.2）。 */
const EDITABLE_STATUS = new Set([RUN_STATUS.WORKING, RUN_STATUS.AGGREGATED]);

/**
 * 実施回の内容を書き換えられるか。
 *
 * 転記済みとアーカイブは閲覧のみとする。転記済みは外部システムへ数字を渡した
 * 後であり、こちらだけ書き換えると突き合わせができなくなる。アーカイブは
 * 通常運用から外した記録である。
 *
 * @param {{status?: string}} run
 * @returns {boolean}
 */
export function isRunEditable(run) {
  return EDITABLE_STATUS.has(run?.status);
}

/**
 * 書き換えを拒否する理由の文言。
 *
 * @param {{status?: string}} run
 * @returns {string}
 */
export function describeNotEditable(run) {
  const label = run?.status === RUN_STATUS.ARCHIVED ? 'アーカイブ済み' : '転記済み';
  return `実施回: ${label}のため変更できない。閲覧のみ可能である（仕様書7.2）。`;
}
