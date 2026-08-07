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

import { addSeconds } from './datetime.js';
import { RUN_STATUS } from './schema.js';

/** 1日の秒数。保持期間は日で指定する（仕様書10.2）。 */
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * 削除候補になる日時を求める。
 *
 * @param {string} archivedAt アーカイブ日時（オフセット付きISO 8601）
 * @param {number} retentionDays 保持期間（日）
 * @returns {string} この日時に達すると削除候補になる
 */
export function deletableFrom(archivedAt, retentionDays) {
  return addSeconds(archivedAt, retentionDays * SECONDS_PER_DAY);
}

/**
 * 削除候補になるまでの残り時間（ミリ秒）。0以下なら経過済み。
 *
 * `isDeletable` と `daysUntilDeletable` はここだけを見る。二つが別々の比較を
 * 持つと、境界のちょうど1点で「候補ではないのに画面は削除候補と出す」ような
 * 食い違いが生じる。判定と表示は同じ数から導く。
 *
 * @param {{status?: string, archivedAt?: string|null}} run
 * @param {{retentionDays: number, now: string}} options
 * @returns {number|null} アーカイブ済みでなく起算日も無ければ null
 */
function remainingMs(run, { retentionDays, now }) {
  if (run?.status !== RUN_STATUS.ARCHIVED) {
    return null;
  }
  const archivedAt = run.archivedAt ?? null;
  if (archivedAt === null) {
    // アーカイブ済みなのに日時が無いデータは候補にしない。起算日が無い以上、
    // 経過を数えられない。取り込み検証（`integrity.js`）が本来は弾く形である。
    return null;
  }
  return Date.parse(deletableFrom(archivedAt, retentionDays)) - Date.parse(now);
}

/**
 * 実施回が削除候補かを判定する（仕様書10.3）。
 *
 * アーカイブ済みで、`archivedAt` から保持期間を経過したものが候補になる。
 * **ちょうど経過した時点を含める。** 保持期間30日は「30日間保つ」であり、
 * 30日が満了した瞬間に保つ義務は終わる。ここを含めないと、満了ちょうどの1点
 * だけ残り日数0で候補ではないという説明できない状態ができる。
 *
 * @param {{status?: string, archivedAt?: string|null}} run
 * @param {{retentionDays: number, now: string}} options `now` はISO 8601
 * @returns {boolean}
 */
export function isDeletable(run, options) {
  const remaining = remainingMs(run, options);
  return remaining !== null && remaining <= 0;
}

/**
 * 削除候補になるまでの残り日数を求める。
 *
 * 画面が「あと n 日」を出すために使う。既に候補であれば0を返す。切り上げるのは、
 * 残り0.5日を「あと0日」と出すと今日中に消えるように読めるためである。
 *
 * `0` を返すことと {@link isDeletable} が真であることは一致する。
 *
 * @param {{status?: string, archivedAt?: string|null}} run
 * @param {{retentionDays: number, now: string}} options
 * @returns {number|null} アーカイブ済みでなければ null
 */
export function daysUntilDeletable(run, options) {
  const remaining = remainingMs(run, options);
  if (remaining === null) {
    return null;
  }
  if (remaining <= 0) {
    return 0;
  }
  return Math.ceil(remaining / (SECONDS_PER_DAY * 1000));
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

/**
 * 実施回を完全削除してよいかを判定する（仕様書7.1、10.3、10.4）。
 *
 * 仕様書7.1 の遷移表は `アーカイブ → 削除候補 → 完全削除` と定めており、
 * アーカイブ済みから直接完全削除へ進む辺は無い。したがって削除候補である
 * ことが完全削除の事前条件になる。保持期間は「削除を勧める目安」ではなく
 * 「削除できるようになるまでの保護期間」である。
 *
 * 誤って作った実施回をすぐ消したい場合は、保持期間の設定を短くする（10.2）。
 *
 * @param {{status?: string, archivedAt?: string|null}} run
 * @param {{retentionDays: number, now: string}} options
 * @returns {{ok: boolean, reason: string|null}}
 */
export function canDeleteRun(run, options) {
  if (run?.status !== RUN_STATUS.ARCHIVED) {
    return {
      ok: false,
      reason:
        '実施回: アーカイブ済みのものだけ削除できる（仕様書7.1）。' +
        '先に転記済みからアーカイブへ移す。',
    };
  }
  if (!isDeletable(run, options)) {
    const remaining = daysUntilDeletable(run, options);
    return {
      ok: false,
      reason:
        `実施回: 保持期間が残っているため削除できない（仕様書7.1、10.3）。` +
        `削除候補になるまであと${remaining}日。設定で保持期間を短くすれば早められる。`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * 案件グループを配下ごと完全削除してよいかを判定する（仕様書10.4）。
 *
 * 配下の実施回がすべて削除候補であることを求める。1件ずつ消せない記録を、
 * 案件ごとならまとめて消せるという抜け道を作らないためである。
 *
 * 実施回が0件の案件は条件を満たす。消える記録が無いので、保持期間が守る対象も
 * 無い。登録しただけで使わなかった案件を消す唯一の経路でもある。
 *
 * @param {object[]} runs その案件の全実施回
 * @param {{retentionDays: number, now: string}} options
 * @returns {{ok: boolean, reason: string|null}}
 */
export function canDeleteProjectGroup(runs, options) {
  const active = runs.filter((run) => run.status !== RUN_STATUS.ARCHIVED);
  if (active.length > 0) {
    return {
      ok: false,
      reason:
        `案件: アーカイブ済みでない実施回が ${active.length} 件ある。` +
        'すべてアーカイブしてから案件を削除する（仕様書10.4）。',
    };
  }
  const keeping = runs.filter((run) => !isDeletable(run, options));
  if (keeping.length > 0) {
    return {
      ok: false,
      reason:
        `案件: 保持期間が残っている実施回が ${keeping.length} 件ある。` +
        'すべて削除候補になってから案件を削除する（仕様書7.1、10.3）。',
    };
  }
  return { ok: true, reason: null };
}
