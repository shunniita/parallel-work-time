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
 * 作業中から集計済みへ進む場合だけ、両方を順に確かめる。
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
} from '../../domain/runStatus.js';
import { RUN_STATUS } from '../../domain/schema.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import { ValidationError } from '../errors.js';
import { resolveDeps } from './deps.js';

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

    // 集計済みへ進むときだけ、記録の中身も確かめる（仕様書8.9.6、A-08）。
    // 転記済みから戻る場合は確かめない。既に集計済みだった記録であり、
    // 戻すこと自体を未終了区間の有無で拒む理由が無い。
    if (nextStatus === RUN_STATUS.AGGREGATED && from === RUN_STATUS.WORKING) {
      const ready = canAggregate(current);
      if (!ready.ok) {
        throw new ValidationError([`実施回: ${ready.reason}`]);
      }
    }

    const nowIso = toIsoSecond(now());
    const workRun = {
      ...current,
      status: nextStatus,
      // 転記完了日時は「いま転記済みであること」を表す（実装計画3.2）。戻したら
      // 消す。転記した事実そのものは変更履歴が残すため、ここへ残す必要はない。
      transferredAt: nextStatus === RUN_STATUS.TRANSFERRED ? nowIso : null,
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
 * 未終了区間が1つでもあれば拒否する（A-08）。作業中からの遷移でのみ確かめる。
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
  if (nextStatus === RUN_STATUS.AGGREGATED && workRun.status === RUN_STATUS.WORKING) {
    const ready = canAggregate(workRun);
    if (!ready.ok) {
      return { ok: false, reason: ready.reason };
    }
  }
  return { ok: true, reason: null };
}
