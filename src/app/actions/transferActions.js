/**
 * 実施回の状態遷移と転記済み管理（仕様書7.1、8.7.6、11章）。
 *
 * 遷移の可否は `src/domain/runStatus.js`、記録が揃っているかは
 * `src/domain/aggregate.js` が持つ。ここは順序と保存だけを持つ。
 *
 * ## 状態ガードを通さない唯一のアクション群
 *
 * 他のアクションは `assertEditable()` を通す（`taskTarget.js`）。ここだけは通さ
 * ない。転記済みから集計済みへ戻す操作は、まさに「閲覧のみ」の状態から抜ける
 * ための操作であり、閲覧のみを理由に拒むと二度と戻せなくなる。代わりに
 * `canTransition()` が状態の図の上で辺があるかを見る。
 *
 * ## 拒む理由を2つに分ける
 *
 * 「その遷移が許されているか」（7.1）と「記録の中身が揃っているか」（8.9.6）は
 * 別の問いである。前者は `canTransition()`、後者は `canAggregate()` が答える。
 * まとめて1つのエラーにすると、利用者は「なぜ進めないのか」を区別できない。
 * どの遷移で中身を確かめるかは {@link requiresClosedIntervals} が決める。
 *
 * ## 自動遷移は行わない
 *
 * 未終了区間が無くなっても集計済みへは進まない（仕様書7.1、確認事項N）。
 * 条件が揃うことと、利用者が「集計を終えた」と決めることは別である。
 */

import { toIsoSecond } from '../../domain/datetime.js';
import { canAggregate } from '../../domain/aggregate.js';
import {
  HISTORY_ENTITY,
  HISTORY_OP,
  buildHistoryEntry,
} from '../../domain/history.js';
import {
  RUN_STATUS_LABEL,
  canTransition,
  isStatusRetreat,
  timestampsForStatus,
} from '../../domain/runStatus.js';
import { RUN_STATUS } from '../../domain/schema.js';
import { runWriteTime } from '../../domain/writeClock.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import { ValidationError } from '../errors.js';
import { resolveDeps } from './deps.js';

/**
 * 遷移先が「未終了区間が無いこと」を要求するか（仕様書7章、8.9.6）。
 *
 * 集計済みと転記済みはどちらも「未終了区間がなく、転記値を確認できる」状態と
 * 定義されている（仕様書7章の状態表）。したがって**その状態へ入るたびに**中身を
 * 確かめる必要がある。入口を1つだけ見ればよいわけではない。
 *
 * ## 集計済みからの再編集で破れる（過去のレビュー指摘）
 *
 * 集計済みは編集できる状態である（7.2 で閲覧のみとするのは転記済みとアーカイブ
 * だけ）。そのため「集計済みにする → 新しい区間を開始する → 転記済みにする」が
 * できてしまい、当初の実装はこの経路で中身を確かめていなかった。結果、転記値が
 * 未確定（`transferMinutesSum === null`）のまま `status="transferred"` と
 * `transferredAt` が保存され、しかも転記済みは閲覧のみなので、利用者は理由を
 * 書いて集計済みへ戻すまでその区間を終了できなくなる。
 *
 * 状態の意味は「その状態へ到達した瞬間に条件を満たしていた」ではなく「その状態で
 * ある間は条件を満たしている」である。遷移のたびに評価する。
 *
 * ## 転記済みから戻すときは確かめない
 *
 * 戻す操作は、まさにその未終了区間を直すためにある。中身を理由に拒むと直す手段が
 * 無くなる。
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function requiresClosedIntervals(from, to) {
  if (to === RUN_STATUS.TRANSFERRED) {
    return true;
  }
  return to === RUN_STATUS.AGGREGATED && from === RUN_STATUS.WORKING;
}

/**
 * 実施回を引く。見つからなければ例外にする。
 *
 * @param {object[]} workRuns
 * @param {string} runId
 * @returns {object}
 */
function locateRun(workRuns, runId) {
  const workRun = workRuns.find((run) => run.runId === runId);
  if (workRun === undefined) {
    throw new ValidationError([`実施回: 見つからない（${String(runId)}）`]);
  }
  return workRun;
}

/**
 * 状態遷移1つを保存まで通す共通処理。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date,
 *          newId?: () => string}} deps
 * @param {string} runId
 * @param {string} nextStatus
 * @param {{reason?: string}} [input] 転記済みからの後退でのみ使う（仕様書11章）
 * @returns {Promise<{dataset: object|null, workRun: object,
 *                    historyEntry: object|null}>}
 */
async function changeStatus(deps, runId, nextStatus, input = {}) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns }) => {
    const current = locateRun(workRuns, runId);
    const from = current.status;

    const allowed = canTransition(from, nextStatus);
    if (!allowed.ok) {
      throw new ValidationError([allowed.reason]);
    }

    if (requiresClosedIntervals(from, nextStatus)) {
      const ready = canAggregate(current);
      if (!ready.ok) {
        throw new ValidationError([`実施回: ${ready.reason}`]);
      }
    }

    // 既存の日時より前にならない実効時刻で打つ（`writeClock.js`）。同じ値を
    // `transferredAt` / `archivedAt` / `updatedAt` へ使うことで鎖の順序が保たれる。
    const nowIso = runWriteTime(current, toIsoSecond(now()));
    const workRun = {
      ...current,
      status: nextStatus,
      // アーカイブは転記済みを内包するため転記日時を保ち、アーカイブ日時を足す。
      // 作業中・集計済みへ戻す場合は両方を消す（過去の設計メモ）。
      ...timestampsForStatus(current, nextStatus, nowIso),
      updatedAt: nowIso,
    };

    // 転記済みからの後退だけは変更履歴へ残す（仕様書11章）。外部の正式な記録先へ
    // 数字を渡した後で「渡していないこと」にする操作であり、経緯をたどれないと
    // 突き合わせができなくなる。
    if (!isStatusRetreat(from, nextStatus)) {
      return {
        write: () => adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun),
        value: { workRun, historyEntry: null },
      };
    }

    const history = buildHistoryEntry(
      {
        entityType: HISTORY_ENTITY.WORK_RUN,
        targetId: workRun.runId,
        operation: HISTORY_OP.STATUS_REVERTED,
        summary: summarizeStatusChange(current, from, nextStatus),
        reason: input.reason,
      },
      { historyId: newId(), timestamp: nowIso },
    );
    if (!history.ok) {
      throw new ValidationError(history.errors);
    }

    // 状態の書き換えと履歴を同一トランザクションへまとめる（仕様書9.1）。
    // 片方だけが残ると、「戻した記録が無いのに集計済み」か「戻した履歴だけ
    // あって転記済みのまま」になる。どちらも後から機械的に直せない。
    return {
      write: () =>
        adapter.saveEntities([
          { type: ENTITY_TYPE.WORK_RUNS, entity: workRun },
          { type: ENTITY_TYPE.CHANGE_HISTORY, entity: history.entry },
        ]),
      value: { workRun, historyEntry: history.entry },
    };
  });

  return { dataset, workRun: value.workRun, historyEntry: value.historyEntry };
}

/**
 * 状態変更の要約文を作る（仕様書11章）。
 *
 * @param {{workDate: string, transferredAt: string|null}} workRun 変更前の実施回
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function summarizeStatusChange(workRun, from, to) {
  const label = (status) => RUN_STATUS_LABEL[status] ?? status;
  const transferred =
    workRun.transferredAt === null ? '' : `（転記日時 ${workRun.transferredAt}）`;
  return `実施回 ${workRun.workDate} の状態を ${label(from)} → ${label(to)} へ戻した${transferred}`;
}

/**
 * 集計済みにする（仕様書7.1、8.9.6）。
 *
 * 作業中からの遷移では、未終了区間が1つでもあれば拒否する（A-08）。
 *
 * @param {object} deps
 * @param {string} runId
 */
export async function markAggregated(deps, runId) {
  return changeStatus(deps, runId, RUN_STATUS.AGGREGATED);
}

/**
 * 集計済みから作業中へ戻す（仕様書7.1）。
 *
 * 記録を直すために戻す操作である。変更履歴は残さない。仕様書11章が記録を求めて
 * いるのは「転記済み状態からの後退」であり、集計済みは外部へ渡す前の状態である。
 *
 * @param {object} deps
 * @param {string} runId
 */
export async function reopenRun(deps, runId) {
  return changeStatus(deps, runId, RUN_STATUS.WORKING);
}

/**
 * 転記済みにする（仕様書7.1、8.7.6）。
 *
 * 転記済みは実施回単位でのみ管理する。作業項目単位の転記済みは保存しない
 * （仕様書8.7.5）。画面の一時チェックは画面の中だけで持つ。
 *
 * 集計済みになった後で記録が増えている場合があるため、ここでも未終了区間が
 * 無いことを確かめる（過去のレビュー指摘、{@link requiresClosedIntervals}）。
 *
 * @param {object} deps
 * @param {string} runId
 */
export async function markTransferred(deps, runId) {
  return changeStatus(deps, runId, RUN_STATUS.TRANSFERRED);
}

/**
 * 転記済みから集計済みへ戻す（仕様書7.1、11章）。
 *
 * 理由が必須である。未入力・空白のみは拒否し、状態も履歴も書き込まない。
 *
 * @param {object} deps
 * @param {string} runId
 * @param {{reason: string}} input
 */
export async function revertTransfer(deps, runId, input = {}) {
  return changeStatus(deps, runId, RUN_STATUS.AGGREGATED, input);
}

/**
 * 状態を変えられるかを画面へ知らせる（保存しない純関数）。
 *
 * ボタンの活性と、押せない理由の表示に使う。実際の拒否は各アクション側でも行う
 * （画面の制御だけに頼らない）。
 *
 * @param {object} workRun
 * @param {string} nextStatus
 * @returns {{ok: boolean, reason: string|null}}
 */
export function previewStatusChange(workRun, nextStatus) {
  const allowed = canTransition(workRun.status, nextStatus);
  if (!allowed.ok) {
    return allowed;
  }
  // 判定は {@link requiresClosedIntervals} と同じ条件でなければならない。ここが
  // 緩いとボタンは押せるのにアクション層が拒み、押してから初めて理由を知る。
  if (requiresClosedIntervals(workRun.status, nextStatus)) {
    const ready = canAggregate(workRun);
    if (!ready.ok) {
      return { ok: false, reason: ready.reason };
    }
  }
  return { ok: true, reason: null };
}
