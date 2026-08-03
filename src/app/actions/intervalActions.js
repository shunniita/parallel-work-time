/**
 * 作業区間の記録・修正・削除（仕様書8.4、11章）。
 *
 * 変換と検証は `src/domain/intervalOps.js`、履歴の組み立ては
 * `src/domain/history.js` が持つ。ここは順序と保存だけを持つ。
 *
 * ## 3つの規約
 *
 * - **保存経路**: 読み込みから書き込みまでを `persistence.run()` の中で行う。
 *   WorkRun は `tasks[] → intervals[]` を内包する単一ドキュメントであり、区間
 *   1件の変更でも WorkRun 全体を書き戻す。「項目Aで開始 → 項目Bで開始」の
 *   ように同一 WorkRun への連続書き込みが常態になるため、直列化しないと後勝ちで
 *   前の記録が消える（`src/app/persistence.js`）。
 * - **状態ガード**: すべての操作が `isRunEditable()` を通る。転記済み・
 *   アーカイブの実施回は閲覧のみである（仕様書7.2、`src/domain/runStatus.js`）。
 * - **例外**: 検証で拒否したものは `ValidationError`、状態で拒否したものは
 *   `RunNotEditableError`（`src/app/errors.js`）。
 *
 * ## 警告の扱い
 *
 * 区間の重複は警告であって拒否ではない（仕様書8.9.5）。数量超過のように確認を
 * 求めて差し戻すこともしない。別のグループによる同時並行の記録として正しい
 * 場合があり、そのたびに確認を挟むと通常の入力が滞る。警告は保存したうえで
 * 返し、画面が警告領域へ出す。
 */

import { toIsoSecond } from '../../domain/datetime.js';
import {
  HISTORY_ENTITY,
  HISTORY_OP,
  buildHistoryEntry,
  describeInterval,
  summarizeIntervalDeletion,
} from '../../domain/history.js';
import {
  addInterval,
  changeParticipants,
  editInterval,
  finishWork,
  removeInterval,
  resumeWork,
  startBreak,
  startWork,
} from '../../domain/intervalOps.js';
import { describeNotEditable, isRunEditable } from '../../domain/runStatus.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import { RunNotEditableError, ValidationError } from '../errors.js';
import { resolveDeps } from './deps.js';

/**
 * 実施回と作業項目実績を引く。見つからない理由を返す。
 *
 * 削除前の確認（{@link previewIntervalDeletion}）は例外を投げずに理由を表示
 * したいので、探す処理と例外にする処理を分けてある。
 *
 * @param {object[]} workRuns
 * @param {{runId: string, taskRecordId: string}} target
 * @returns {{workRun: object|null, taskRecord: object|null, errors: string[]}}
 */
function findTask(workRuns, target) {
  const workRun = workRuns.find((run) => run.runId === target.runId);
  if (workRun === undefined) {
    return {
      workRun: null,
      taskRecord: null,
      errors: [`実施回: 見つからない（${String(target.runId)}）`],
    };
  }
  const taskRecord = workRun.tasks.find(
    (task) => task.taskRecordId === target.taskRecordId,
  );
  if (taskRecord === undefined) {
    return {
      workRun,
      taskRecord: null,
      errors: [`作業項目: 見つからない（${String(target.taskRecordId)}）`],
    };
  }
  return { workRun, taskRecord, errors: [] };
}

/**
 * 実施回と作業項目実績を引く。見つからなければ例外にする。
 *
 * @param {object[]} workRuns
 * @param {{runId: string, taskRecordId: string}} target
 * @returns {{workRun: object, taskRecord: object}}
 * @throws {ValidationError} 見つからない場合
 */
function locateTask(workRuns, target) {
  const found = findTask(workRuns, target);
  if (found.errors.length > 0) {
    throw new ValidationError(found.errors);
  }
  return found;
}

/**
 * 実施回が書き換えられる状態かを確かめる（仕様書7.2）。
 *
 * @param {object} workRun
 * @throws {RunNotEditableError}
 */
function assertEditable(workRun) {
  if (!isRunEditable(workRun)) {
    throw new RunNotEditableError(describeNotEditable(workRun), workRun.status);
  }
}

/**
 * 作業項目実績の区間を差し替えた実施回を作る。
 *
 * 元のオブジェクトは書き換えない。保存に失敗したとき、画面が持っている
 * データセットが中途半端に変わっているのを避けるためである。
 *
 * @param {object} workRun
 * @param {string} taskRecordId
 * @param {object[]} intervals
 * @param {string} updatedAt
 * @returns {object}
 */
function replaceIntervals(workRun, taskRecordId, intervals, updatedAt) {
  return {
    ...workRun,
    tasks: workRun.tasks.map((task) =>
      task.taskRecordId === taskRecordId ? { ...task, intervals } : task,
    ),
    updatedAt,
  };
}

/**
 * 区間の変換1つを保存まで通す共通処理。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date,
 *          newId?: () => string}} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {(taskRecord: object, context: {now: string, newId: () => string}) => object} apply
 * @returns {Promise<{dataset: object|null, workRun: object, taskRecord: object,
 *                    warnings: object[]}>}
 */
async function applyIntervalChange(deps, target, apply) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns }) => {
    const { workRun, taskRecord } = locateTask(workRuns, target);
    assertEditable(workRun);

    const context = { now: toIsoSecond(now()), newId };
    const result = apply(taskRecord, context);
    if (!result.ok) {
      throw new ValidationError(result.errors);
    }

    const nextRun = replaceIntervals(
      workRun,
      taskRecord.taskRecordId,
      result.intervals,
      context.now,
    );

    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, nextRun),
      value: { workRun: nextRun, warnings: result.warnings },
    };
  });

  const taskRecord = value.workRun.tasks.find(
    (task) => task.taskRecordId === target.taskRecordId,
  );
  return { dataset, workRun: value.workRun, taskRecord, warnings: value.warnings };
}

/**
 * 現在日時を既定とする（仕様書8.4.3）。
 *
 * @param {string|undefined} at
 * @param {string} nowIso
 * @returns {string}
 */
function atOrNow(at, nowIso) {
  return at ?? nowIso;
}

/**
 * 作業を開始する（仕様書8.4.1）。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {{at?: string, participants: string[]}} input
 */
export async function recordStart(deps, target, input) {
  return applyIntervalChange(deps, target, (taskRecord, context) =>
    startWork(
      taskRecord,
      { at: atOrNow(input.at, context.now), participants: input.participants },
      context,
    ),
  );
}

/**
 * 休憩を開始する（仕様書8.4.1）。参加者は直前の作業区間から引き継ぐ。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {{at?: string}} [input]
 */
export async function recordBreak(deps, target, input = {}) {
  return applyIntervalChange(deps, target, (taskRecord, context) =>
    startBreak(taskRecord, { at: atOrNow(input.at, context.now) }, context),
  );
}

/**
 * 作業を再開する（仕様書8.4.1）。
 *
 * 直前の休憩が0人だった場合、引き継ぐと0人の作業区間になる（仕様書8.9.4 違反）。
 * その場合は拒否されるので、画面は参加者を入力してから `participants` 付きで
 * 呼び直す（設計メモ §2.1）。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {{at?: string, participants?: string[]}} [input]
 */
export async function recordResume(deps, target, input = {}) {
  return applyIntervalChange(deps, target, (taskRecord, context) =>
    resumeWork(
      taskRecord,
      { at: atOrNow(input.at, context.now), participants: input.participants },
      context,
    ),
  );
}

/**
 * 作業を終了する（仕様書8.4.1）。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {{at?: string}} [input]
 */
export async function recordFinish(deps, target, input = {}) {
  return applyIntervalChange(deps, target, (taskRecord, context) =>
    finishWork(taskRecord, { at: atOrNow(input.at, context.now) }, context),
  );
}

/**
 * 参加者を変更する（仕様書8.4.10）。進行中の区間を分割する。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {{at?: string, participants: string[]}} input
 */
export async function recordParticipantChange(deps, target, input) {
  return applyIntervalChange(deps, target, (taskRecord, context) =>
    changeParticipants(
      taskRecord,
      { at: atOrNow(input.at, context.now), participants: input.participants },
      context,
    ),
  );
}

/**
 * 作業区間を手動で追加する（仕様書8.4.11）。`endAt` は必須である。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {{type: string, startAt: string, endAt: string, participants: string[]}} input
 */
export async function addIntervalManually(deps, target, input) {
  return applyIntervalChange(deps, target, (taskRecord, context) =>
    addInterval(taskRecord, input, context),
  );
}

/**
 * 作業区間を編集する（仕様書8.4.5）。渡した項目だけを差し替える。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {string} intervalId
 * @param {{type?: string, startAt?: string, endAt?: string|null,
 *          participants?: string[]}} changes
 */
export async function updateInterval(deps, target, intervalId, changes) {
  return applyIntervalChange(deps, target, (taskRecord, context) =>
    editInterval(taskRecord, intervalId, changes, context),
  );
}

/**
 * 作業区間を削除し、変更履歴を1件残す（仕様書8.4.5、11章）。
 *
 * ## 削除と履歴を分けない
 *
 * 区間を取り除いた実施回と履歴1件を `saveEntities` で同一トランザクションへ
 * まとめる（仕様書9.1）。`saveEntity` を2回呼ぶと、間で失敗したときに
 * 「区間だけ消えて履歴が無い」または「履歴だけあって区間が残る」状態になる。
 * 前者は仕様書11章が記録を求めている操作の記録欠落であり、後者は履歴の意味を
 * 損なう。どちらも後から機械的に直せない。
 *
 * 検証で拒否する場合は書き込みを一切試みない。`persistence.run()` は `plan` が
 * 投げた時点では保存へ進まない（`src/app/persistence.js`）。
 *
 * ## 理由が必須である
 *
 * 仕様書11章が削除に `reason` を必須と定めている。未入力・空白のみは拒否する。
 * 画面は削除前に対象区間の内容と理由入力を出し、確認を取ってから呼ぶ
 * （{@link previewIntervalDeletion}）。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {string} intervalId
 * @param {{reason: string}} input
 * @returns {Promise<{dataset: object|null, workRun: object, taskRecord: object,
 *                    historyEntry: object, warnings: object[]}>}
 */
export async function deleteInterval(deps, target, intervalId, input = {}) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns }) => {
    const { workRun, taskRecord } = locateTask(workRuns, target);
    assertEditable(workRun);

    const nowIso = toIsoSecond(now());
    const result = removeInterval(taskRecord, intervalId);
    if (!result.ok) {
      throw new ValidationError(result.errors);
    }

    const history = buildHistoryEntry(
      {
        entityType: HISTORY_ENTITY.INTERVAL,
        targetId: result.removed.intervalId,
        operation: HISTORY_OP.INTERVAL_DELETED,
        summary: summarizeIntervalDeletion(workRun, taskRecord, result.removed),
        reason: input.reason,
      },
      { historyId: newId(), timestamp: nowIso },
    );
    if (!history.ok) {
      throw new ValidationError(history.errors);
    }

    const nextRun = replaceIntervals(
      workRun,
      taskRecord.taskRecordId,
      result.intervals,
      nowIso,
    );

    return {
      write: () =>
        adapter.saveEntities([
          { type: ENTITY_TYPE.WORK_RUNS, entity: nextRun },
          { type: ENTITY_TYPE.CHANGE_HISTORY, entity: history.entry },
        ]),
      value: { workRun: nextRun, historyEntry: history.entry, warnings: result.warnings },
    };
  });

  const taskRecord = value.workRun.tasks.find(
    (task) => task.taskRecordId === target.taskRecordId,
  );
  return {
    dataset,
    workRun: value.workRun,
    taskRecord,
    historyEntry: value.historyEntry,
    warnings: value.warnings,
  };
}

/**
 * 削除前の確認に出す内容を組み立てる（仕様書11章、8.4.5）。
 *
 * 保存へ触れない純関数である。画面はこの結果でダイアログを描き、利用者が理由を
 * 入力してから {@link deleteInterval} を呼ぶ。確認に出す文言と履歴の要約を同じ
 * 関数（`describeInterval`）から作るため、「確認した内容」と「履歴へ残る内容」が
 * 食い違わない。
 *
 * 実施回が転記済み・アーカイブの場合も内容は返す。閲覧はできるためである。
 * `deletable` が false のとき、画面は削除ボタンを出さずに `blockedReason` を
 * 示す。実際の拒否は {@link deleteInterval} 側でも行う（画面の制御だけに
 * 頼らない）。
 *
 * @param {object[]} workRuns
 * @param {{runId: string, taskRecordId: string}} target
 * @param {string} intervalId
 * @returns {{ok: boolean, errors: string[], workRun?: object, taskRecord?: object,
 *            interval?: object, description?: string, summary?: string,
 *            deletable?: boolean, blockedReason?: string|null}}
 */
export function previewIntervalDeletion(workRuns, target, intervalId) {
  const { workRun, taskRecord, errors } = findTask(workRuns, target);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const interval =
    taskRecord.intervals.find((item) => item.intervalId === intervalId) ?? null;
  if (interval === null) {
    return { ok: false, errors: [`作業区間: 見つからない（${String(intervalId)}）`] };
  }

  const deletable = isRunEditable(workRun);
  return {
    ok: true,
    errors: [],
    workRun,
    taskRecord,
    interval,
    description: describeInterval(interval),
    summary: summarizeIntervalDeletion(workRun, taskRecord, interval),
    deletable,
    blockedReason: deletable ? null : describeNotEditable(workRun),
  };
}
