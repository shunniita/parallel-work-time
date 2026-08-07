/**
 * 保持期間と削除候補の判定（仕様書10.2、10.3）。
 *
 * 純関数のみ。現在日時は引数で受け取る。
 *
 * ## 削除候補は保存しない
 *
 * 仕様書10.3 は「判定は現在日時から導出し、状態として保存しない」と定めている。
 * `status` に `削除候補` は無い（6.5）。時間の経過だけで変わる値を保存すると、
 * 保存した瞬間の判断が固定され、保持期間を変えたときに古い判断が残る。
 *
 * ## 起算日は `archivedAt`
 *
 * 作業日でも更新日時でもない（仕様書10.2）。「通常運用から外してから何日経ったか」
 * を数えるので、外した日が起点になる。アーカイブしていない実施回は、どれだけ古く
 * ても削除候補にならない。
 *
 * ## 自動削除はしない
 *
 * 削除候補は「消してよい候補」を利用者へ示すだけである（仕様書10.6）。ここは
 * 判定しか持たず、削除そのものは利用者の確認を経て
 * `src/app/actions/retentionActions.js` が行う。
 */

import { addSeconds, compareIso } from './datetime.js';
import { RUN_STATUS } from './schema.js';

/** 1日の秒数。保持期間は日で指定する（仕様書10.2）。 */
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * 削除候補になる日時を求める。
 *
 * @param {string} archivedAt アーカイブ日時（オフセット付きISO 8601）
 * @param {number} retentionDays 保持期間（日）
 * @returns {string} この日時を過ぎると削除候補になる
 */
export function deletableFrom(archivedAt, retentionDays) {
  return addSeconds(archivedAt, retentionDays * SECONDS_PER_DAY);
}

/**
 * 実施回が削除候補かを判定する（仕様書10.3）。
 *
 * アーカイブ済みで、`archivedAt` から保持期間を**経過した**ものが候補になる。
 * ちょうど経過した時点は含めない。保持期間30日なら「30日間は保つ」という意味で
 * あり、30日目のうちはまだ保つ。
 *
 * @param {{status?: string, archivedAt?: string|null}} run
 * @param {{retentionDays: number, now: string}} options `now` はISO 8601
 * @returns {boolean}
 */
export function isDeletable(run, { retentionDays, now }) {
  if (run?.status !== RUN_STATUS.ARCHIVED) {
    return false;
  }
  const archivedAt = run.archivedAt ?? null;
  if (archivedAt === null) {
    // アーカイブ済みなのに日時が無いデータは候補にしない。起算日が無い以上、
    // 経過を数えられない。取り込み検証（`integrity.js`）が本来は弾く形である。
    return false;
  }
  return compareIso(now, deletableFrom(archivedAt, retentionDays)) > 0;
}

/**
 * 削除候補になるまでの残り日数を求める。
 *
 * 画面が「あと n 日」を出すために使う。既に候補であれば0を返す。切り上げるのは、
 * 残り0.5日を「あと0日」と出すと今日中に消えるように読めるためである。
 *
 * @param {{status?: string, archivedAt?: string|null}} run
 * @param {{retentionDays: number, now: string}} options
 * @returns {number|null} アーカイブ済みでなければ null
 */
export function daysUntilDeletable(run, { retentionDays, now }) {
  if (run?.status !== RUN_STATUS.ARCHIVED || (run.archivedAt ?? null) === null) {
    return null;
  }
  const threshold = deletableFrom(run.archivedAt, retentionDays);
  const remainingMs = Date.parse(threshold) - Date.parse(now);
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.ceil(remainingMs / (SECONDS_PER_DAY * 1000));
}

/**
 * アーカイブ済みの実施回を、削除候補かどうかで仕分ける（仕様書10.3）。
 *
 * アーカイブ画面が一覧を作るために使う。並べ替えはしない。呼び出し側が
 * `runOrder.js` の並びを使う。
 *
 * @param {object[]} runs すべての実施回
 * @param {{retentionDays: number, now: string}} options
 * @returns {{archived: object[], deletable: object[], keeping: object[]}}
 */
export function classifyArchived(runs, options) {
  const archived = runs.filter((run) => run.status === RUN_STATUS.ARCHIVED);
  const deletable = archived.filter((run) => isDeletable(run, options));
  const keeping = archived.filter((run) => !isDeletable(run, options));
  return { archived, deletable, keeping };
}
