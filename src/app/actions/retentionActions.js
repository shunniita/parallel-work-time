/**
 * アーカイブと完全削除（仕様書10章、11章）。
 *
 * 削除候補の判定は `src/domain/retention.js`、遷移の可否は
 * `src/domain/runStatus.js` が持つ。ここは順序と保存だけを持つ。
 *
 * ## 自動では何もしない
 *
 * アーカイブへの移動は利用者の操作によってのみ行う（仕様書10.1）。無確認の自動
 * 削除も行わない（10.6）。保持期間を過ぎた実施回は「削除候補」として画面へ出る
 * だけで、消すかどうかは利用者が決める。したがってここには「期限が来たら消す」
 * 処理が存在しない。
 *
 * ## 削除は履歴を伴う
 *
 * 実施回と案件グループの削除は変更履歴の記録対象である（仕様書11章）。理由は
 * 必須で、削除本体と履歴1件を同一トランザクションへまとめる。区間削除（Step 6）・
 * 直接入力削除（Step 7）・転記済みからの後退（Step 8）と同じ形である。
 *
 * 消えるレコードそのものは復元できないので、履歴の要約に何がどれだけ消えたかを
 * 残す（`history.js` の `summarizeWorkRunDeletion` / `summarizeProjectGroupDeletion`）。
 *
 * ## 退避は画面が担う
 *
 * 完全削除の前にJSONへ退避する導線（仕様書10.5、9.4）は `io/safetyExport.js` の
 * `runDestructiveAction()` が扱い、画面がここのアクションを渡す。退避と削除を
 * このモジュールで結ぶと、退避せずに削除する選択肢を画面から作れなくなる。
 */

import { resolveRetentionDays } from '../../config.js';
import { toIsoSecond } from '../../domain/datetime.js';
import {
  HISTORY_ENTITY,
  HISTORY_OP,
  buildHistoryEntry,
  summarizeProjectGroupDeletion,
  summarizeWorkRunDeletion,
} from '../../domain/history.js';
import {
  canDeleteProjectGroup,
  canDeleteRun,
  classifyArchived,
} from '../../domain/retention.js';
import { numberRuns } from '../../domain/runOrder.js';
import { canTransition, timestampsForStatus } from '../../domain/runStatus.js';
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
 * 案件グループを引く。見つからなければ例外にする。
 *
 * @param {object[]} projectGroups
 * @param {string} projectGroupId
 * @returns {object}
 */
function locateGroup(projectGroups, projectGroupId) {
  const group = projectGroups.find((item) => item.projectGroupId === projectGroupId);
  if (group === undefined) {
    throw new ValidationError([`案件: 見つからない（${String(projectGroupId)}）`]);
  }
  return group;
}

/**
 * 実施回をアーカイブへ移す（仕様書10.1）。
 *
 * 転記済みからのみ進める（7.1）。`archivedAt` を記録し、これが保持期間の起算日に
 * なる（10.2）。転記完了日時は保つ（`timestampsForStatus`）。
 *
 * 変更履歴は残さない。仕様書11章が記録を求めるのは後退と削除であり、アーカイブは
 * どちらでもない。記録は残ったままで、通常一覧から分離するだけである。
 *
 * @param {object} deps
 * @param {string} runId
 * @returns {Promise<{dataset: object|null, workRun: object}>}
 */
export async function archiveRun(deps, runId) {
  const { adapter, persistence, now } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns }) => {
    const current = locateRun(workRuns, runId);
    const allowed = canTransition(current.status, RUN_STATUS.ARCHIVED);
    if (!allowed.ok) {
      throw new ValidationError([allowed.reason]);
    }

    const nowIso = toIsoSecond(now());
    const workRun = {
      ...current,
      status: RUN_STATUS.ARCHIVED,
      ...timestampsForStatus(current, RUN_STATUS.ARCHIVED, nowIso),
      updatedAt: nowIso,
    };

    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun),
      value: workRun,
    };
  });

  return { dataset, workRun: value };
}

/**
 * 実施回を完全に削除し、変更履歴を1件残す（仕様書10.4、11章）。
 *
 * 削除候補であることを要求する。判定は `retention.js` の `canDeleteRun()` が持つ
 * （仕様書7.1 の遷移表）。画面もボタンの活殺に同じ関数を使うが、ここでも改めて
 * 検査する。保持期間の経過は時間で変わるため、画面を描いた時点で候補でも、
 * 押した時点で候補とは限らない——逆もある。
 *
 * @param {object} deps
 * @param {string} runId
 * @param {{reason: string}} input
 * @returns {Promise<{dataset: object|null, workRun: object, historyEntry: object}>}
 */
export async function deleteRun(deps, runId, input = {}) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns, projectGroups, settings }) => {
    const current = locateRun(workRuns, runId);
    const nowIso = toIsoSecond(now());
    const allowed = canDeleteRun(current, {
      retentionDays: resolveRetentionDays(settings),
      now: nowIso,
    });
    if (!allowed.ok) {
      throw new ValidationError([allowed.reason]);
    }
    const group = locateGroup(projectGroups, current.projectGroupId);

    const history = buildHistoryEntry(
      {
        entityType: HISTORY_ENTITY.WORK_RUN,
        targetId: current.runId,
        operation: HISTORY_OP.WORK_RUN_DELETED,
        summary: summarizeWorkRunDeletion(group, current),
        reason: input.reason,
      },
      { historyId: newId(), timestamp: nowIso },
    );
    if (!history.ok) {
      throw new ValidationError(history.errors);
    }

    // 削除と履歴を同一トランザクションへまとめる（仕様書9.1）。片方だけが残ると
    // 「消えたのに履歴が無い」か「履歴だけあって記録が残る」になり、どちらも
    // 後から機械的に直せない。
    return {
      write: () =>
        adapter.saveEntities([
          { type: ENTITY_TYPE.WORK_RUNS, entity: current, remove: true },
          { type: ENTITY_TYPE.CHANGE_HISTORY, entity: history.entry },
        ]),
      value: { workRun: current, historyEntry: history.entry },
    };
  });

  return { dataset, ...value };
}

/**
 * 案件グループを配下の実施回ごと削除し、変更履歴を1件残す（仕様書10.4、11章）。
 *
 * 履歴は案件グループの1件だけにする。実施回1件ずつの履歴は残さない。利用者から
 * 見て「案件を消す」という1つの操作であり、複数の削除ではない。消えた規模は要約に
 * 件数と累計数量で残す。
 *
 * 配下の実施回がすべて削除候補であることを要求する。判定は `retention.js` の
 * `canDeleteProjectGroup()` が持つ。1件ずつ消せない記録を案件ごとならまとめて
 * 消せる、という抜け道を作らないためである。
 *
 * @param {object} deps
 * @param {string} projectGroupId
 * @param {{reason: string}} input
 * @returns {Promise<{dataset: object|null, projectGroup: object, removedRuns: object[],
 *                    historyEntry: object}>}
 */
export async function deleteProjectGroup(deps, projectGroupId, input = {}) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns, projectGroups, settings }) => {
    const group = locateGroup(projectGroups, projectGroupId);
    const runs = workRuns.filter((run) => run.projectGroupId === projectGroupId);
    const nowIso = toIsoSecond(now());
    const allowed = canDeleteProjectGroup(runs, {
      retentionDays: resolveRetentionDays(settings),
      now: nowIso,
    });
    if (!allowed.ok) {
      throw new ValidationError([allowed.reason]);
    }

    const history = buildHistoryEntry(
      {
        entityType: HISTORY_ENTITY.PROJECT_GROUP,
        targetId: group.projectGroupId,
        operation: HISTORY_OP.PROJECT_GROUP_DELETED,
        summary: summarizeProjectGroupDeletion(group, runs),
        reason: input.reason,
      },
      { historyId: newId(), timestamp: nowIso },
    );
    if (!history.ok) {
      throw new ValidationError(history.errors);
    }

    // 案件・配下の実施回・履歴を1回の書き込みへまとめる。途中で失敗すると
    // 「案件だけ消えて実施回が親を失う」状態になる（`integrity.js` が取り込みで
    // 拒む形のデータが、保存済みに生じてしまう）。
    return {
      write: () =>
        adapter.saveEntities([
          ...runs.map((run) => ({ type: ENTITY_TYPE.WORK_RUNS, entity: run, remove: true })),
          { type: ENTITY_TYPE.PROJECT_GROUPS, entity: group, remove: true },
          { type: ENTITY_TYPE.CHANGE_HISTORY, entity: history.entry },
        ]),
      value: { projectGroup: group, removedRuns: runs, historyEntry: history.entry },
    };
  });

  return { dataset, ...value };
}

/**
 * アーカイブ画面へ出す内容を組み立てる（保存しない純関数）。
 *
 * 削除候補は保存しない派生値なので（仕様書10.3）、描くたびに現在日時から求める。
 *
 * ## 実施回が0件の案件も含める
 *
 * アーカイブ済みの実施回から案件を逆引きすると、実施回が1件も無い案件が一覧へ
 * 出ない。ところが案件削除を呼べる画面はここしかないため、最後の実施回を消した
 * 案件や、登録しただけで使わなかった案件が、通常操作では二度と消せなくなる。
 * 実施回を新たに作ってアーカイブまで進める、という不自然な迂回を強いることに
 * なるので、消せる案件は消せる場所へ出す。
 *
 * 逆に、アーカイブ済みが0件で運用中の実施回だけを持つ案件は出さない。アーカイブ
 * 画面に出す意味が無く、削除もできない。
 *
 * @param {{workRuns: object[], projectGroups: object[], settings: object}} dataset
 * @param {{now: string}} options
 * @returns {{archived: object[], deletable: object[], keeping: object[],
 *            retentionDays: number,
 *            groups: {group: object, runs: {run: object, number: number}[],
 *                     deletion: {ok: boolean, reason: string|null}}[]}}
 */
export function summarizeArchive(dataset, { now }) {
  const retentionDays = resolveRetentionDays(dataset.settings);
  const options = { retentionDays, now };
  const classified = classifyArchived(dataset.workRuns, options);

  const groups = dataset.projectGroups
    .map((group) => {
      const runs = dataset.workRuns.filter(
        (run) => run.projectGroupId === group.projectGroupId,
      );
      const archived = runs.filter((run) => run.status === RUN_STATUS.ARCHIVED);
      return {
        group,
        // 番号は案件の全実施回を通して振る。アーカイブ済みだけで数えると通常一覧と
        // 食い違う（`runOrder.js`）。
        runs: numberRuns(runs).filter((item) => item.run.status === RUN_STATUS.ARCHIVED),
        archivedCount: archived.length,
        totalCount: runs.length,
        deletion: canDeleteProjectGroup(runs, options),
      };
    })
    .filter((entry) => entry.archivedCount > 0 || entry.totalCount === 0);

  return { ...classified, retentionDays, groups };
}
