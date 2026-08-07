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
 * - 状態そのものを進める／戻す遷移アクション。転記済みから集計済みへ戻す操作は、
 *   まさに閲覧のみの状態から抜けるための操作である。
 *
 * ## 状態遷移（仕様書7.1）
 *
 * Step 8 で集計済み・転記済みまわりの4遷移を足した。アーカイブと完全削除
 * （実装計画 Step 10）は未実装であり、{@link TRANSITIONS} に含めていない。
 *
 * **自動遷移は行わない**（仕様書7.1、確認事項N）。未終了区間が無くなっても
 * 集計済みへは進まず、転記済みにしてもアーカイブへは移らない。条件が揃うことと
 * 利用者が「そう決めたこと」は別だからである。ここが持つのは「その遷移が許されて
 * いるか」だけで、いつ呼ぶかは画面と `src/app/actions/transferActions.js` が決める。
 */

import { RUN_STATUS } from './schema.js';

/**
 * 実施回の状態の表示名（仕様書7章）。
 *
 * `TASK_STATE_LABEL`（`taskState.js`）や `INTERVAL_TYPE_LABEL`（`effort.js`）と
 * 同じく、保存する値と対応する語は定義の近くに置く（レビュー指摘 D-16）。
 * 遷移を拒む理由の文言でもここを使うため、画面側に置くと domain が UI を参照する
 * ことになる。
 */
export const RUN_STATUS_LABEL = {
  [RUN_STATUS.WORKING]: '作業中',
  [RUN_STATUS.AGGREGATED]: '集計済み',
  [RUN_STATUS.TRANSFERRED]: '転記済み',
  [RUN_STATUS.ARCHIVED]: 'アーカイブ',
};

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

/**
 * 実施回の状態遷移（仕様書7.1）。
 *
 * `from` から進める先を列挙する。仕様書7.1 の遷移表のうち、状態どうしの辺を
 * すべて持つ。「削除候補」は保存しない派生状態なので含めない（6.5、10.3）。
 * 完全削除はレコードごと消す操作であり、遷移ではない（10.4）。
 *
 * **アーカイブからは戻れない。** 仕様書7.1 にその辺が無い。アーカイブは通常
 * 一覧から分離する操作であり（10.1）、戻す必要があるなら分離していない。
 */
const TRANSITIONS = {
  [RUN_STATUS.WORKING]: [RUN_STATUS.AGGREGATED],
  [RUN_STATUS.AGGREGATED]: [RUN_STATUS.WORKING, RUN_STATUS.TRANSFERRED],
  [RUN_STATUS.TRANSFERRED]: [RUN_STATUS.AGGREGATED, RUN_STATUS.ARCHIVED],
  [RUN_STATUS.ARCHIVED]: [],
};

/**
 * 転記済みから後退する遷移かどうか（仕様書11章）。
 *
 * この遷移だけは変更履歴へ理由つきで記録する。外部の正式な記録先へ数字を渡した
 * 後で「渡していないこと」にする操作であり、後から経緯をたどれないと突き合わせが
 * できなくなる。
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function isStatusRetreat(from, to) {
  return from === RUN_STATUS.TRANSFERRED && to === RUN_STATUS.AGGREGATED;
}

/**
 * 遷移後の状態日時を組み立てる（仕様書6.5、7.1、10.1）。
 *
 * アーカイブは「転記済みとして通常一覧から分離されている」状態なので、転記完了
 * 日時を保持したままアーカイブ日時を足す。作業中・集計済みへ戻る場合は、転記済み
 * ではなくなるため両方を消す。
 *
 * @param {{transferredAt?: string|null}} run 遷移前の実施回
 * @param {string} nextStatus
 * @param {string} nowIso 遷移日時
 * @returns {{transferredAt: string|null, archivedAt: string|null}}
 */
export function timestampsForStatus(run, nextStatus, nowIso) {
  if (nextStatus === RUN_STATUS.TRANSFERRED) {
    return { transferredAt: nowIso, archivedAt: null };
  }
  if (nextStatus === RUN_STATUS.ARCHIVED) {
    return { transferredAt: run?.transferredAt ?? null, archivedAt: nowIso };
  }
  return { transferredAt: null, archivedAt: null };
}

/**
 * 状態遷移が許されるかを判定する（仕様書7.1）。
 *
 * 記録の中身が揃っているか（未終了区間の有無、仕様書8.9.6）はここでは見ない。
 * それは `aggregate.js` の `canAggregate()` が持つ。状態の図の上で辺があるかと、
 * 中身が条件を満たすかは別の問いであり、混ぜると「なぜ進めないのか」を利用者へ
 * 説明し分けられなくなる。
 *
 * @param {string} from
 * @param {string} to
 * @returns {{ok: boolean, reason: string|null}}
 */
export function canTransition(from, to) {
  if (!Object.values(RUN_STATUS).includes(to)) {
    return { ok: false, reason: `実施回: ${String(to)} は状態として扱えない` };
  }
  if (from === to) {
    return { ok: false, reason: `実施回: 既に${statusLabel(to)}である` };
  }
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason:
        `実施回: ${statusLabel(from)}から${statusLabel(to)}へは変更できない` +
        `（仕様書7.1）。${describeAllowed(allowed)}`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * 状態から進める先の一覧を返す。画面のボタン制御に使う。
 *
 * @param {{status?: string}} run
 * @returns {string[]}
 */
export function nextStatuses(run) {
  return [...(TRANSITIONS[run?.status] ?? [])];
}

function statusLabel(status) {
  return RUN_STATUS_LABEL[status] ?? String(status);
}

function describeAllowed(allowed) {
  if (allowed.length === 0) {
    return 'この状態から進める先は無い。';
  }
  return `進める先は ${allowed.map(statusLabel).join(' / ')} である。`;
}
