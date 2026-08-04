/**
 * 工数直接入力の追加・編集・削除（仕様書8.5、11章）。
 *
 * 変換と検証は `src/domain/directEntryOps.js`、履歴の組み立ては
 * `src/domain/history.js` が持つ。ここは順序と保存だけを持つ。実施回と作業項目を
 * 引く処理と状態ガードは `taskTarget.js` を `intervalActions.js` と共有する。
 *
 * ## 区間と同じ3つの規約
 *
 * - **保存経路**: 読み込みから書き込みまでを `persistence.run()` の中で行う。
 *   WorkRun は配下すべてを内包する単一ドキュメントであり、直接入力1件の変更でも
 *   WorkRun 全体を書き戻す。直列化しないと後勝ちで前の記録が消える。
 * - **状態ガード**: すべての操作が `assertEditable()` を通る（仕様書7.2）。
 * - **例外**: 検証で拒否したものは `ValidationError`、状態で拒否したものは
 *   `RunNotEditableError`。
 *
 * ## 作業項目の状態は問わない
 *
 * 区間の操作と違い、未着手・作業中・休憩中・完了のどれでも足せる（仕様書12.4 の
 * 対応表）。計測し損ねた工数を後から入れる操作なので、いま作業中かどうかとは
 * 関わりがない。制約は実施回の状態（転記済み・アーカイブは閲覧のみ）だけである。
 *
 * ## 警告の扱い
 *
 * 重複候補（仕様書8.9.8）は警告であって拒否ではない。別の日に偶然同じ工数を
 * 足すことはあり、そのたびに確認を挟むと通常の入力が滞る。保存したうえで返し、
 * 画面が警告領域へ出す。
 */

import { toIsoSecond } from '../../domain/datetime.js';
import {
  addDirectEntry,
  editDirectEntry,
  removeDirectEntry,
} from '../../domain/directEntryOps.js';
import {
  HISTORY_ENTITY,
  HISTORY_OP,
  buildHistoryEntry,
  describeDirectEntry,
  summarizeDirectEntryDeletion,
} from '../../domain/history.js';
import { describeNotEditable, isRunEditable } from '../../domain/runStatus.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import { ValidationError } from '../errors.js';
import { resolveDeps } from './deps.js';
import { assertEditable, findTask, locateTask, replaceTaskFields, taskOf } from './taskTarget.js';

/**
 * 作業項目実績の直接入力を差し替えた実施回を作る。
 *
 * @param {object} workRun
 * @param {string} taskRecordId
 * @param {object[]} directEntries
 * @param {string} updatedAt
 * @returns {object}
 */
function replaceDirectEntries(workRun, taskRecordId, directEntries, updatedAt) {
  return replaceTaskFields(workRun, taskRecordId, { directEntries }, updatedAt);
}

/**
 * 直接入力の変換1つを保存まで通す共通処理。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date,
 *          newId?: () => string}} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {(taskRecord: object, context: {now: string, newId: () => string}) => object} apply
 * @returns {Promise<{dataset: object|null, workRun: object, taskRecord: object,
 *                    warnings: object[]}>}
 */
async function applyDirectEntryChange(deps, target, apply) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns }) => {
    const { workRun, taskRecord } = locateTask(workRuns, target);
    assertEditable(workRun);

    const context = { now: toIsoSecond(now()), newId };
    const result = apply(taskRecord, context);
    if (!result.ok) {
      throw new ValidationError(result.errors);
    }

    const nextRun = replaceDirectEntries(
      workRun,
      taskRecord.taskRecordId,
      result.directEntries,
      context.now,
    );

    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, nextRun),
      value: { workRun: nextRun, warnings: result.warnings },
    };
  });

  return {
    dataset,
    workRun: value.workRun,
    taskRecord: taskOf(value.workRun, target.taskRecordId),
    warnings: value.warnings,
  };
}

/**
 * 直接入力を追加する（仕様書8.5.1〜8.5.6）。
 *
 * `seconds` は参加人数を含んだ総工数であり、参加者数を掛けない（仕様書8.5.6）。
 * 画面が分・秒を秒へ直してから渡す。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {{seconds: number, participants: string[], note: string}} input
 */
export async function createDirectEntry(deps, target, input) {
  return applyDirectEntryChange(deps, target, (taskRecord, context) =>
    addDirectEntry(taskRecord, input, context),
  );
}

/**
 * 直接入力を編集する（仕様書8.5）。渡した項目だけを差し替える。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {string} entryId
 * @param {{seconds?: number, participants?: string[], note?: string}} changes
 */
export async function updateDirectEntry(deps, target, entryId, changes) {
  return applyDirectEntryChange(deps, target, (taskRecord, context) =>
    editDirectEntry(taskRecord, entryId, changes, context),
  );
}

/**
 * 直接入力を削除し、変更履歴を1件残す（仕様書8.5、11章）。
 *
 * ## 削除と履歴を分けない
 *
 * 区間削除（`intervalActions.js` の `deleteInterval`）と同じ理由である。直接
 * 入力を取り除いた実施回と履歴1件を `saveEntities` で同一トランザクションへ
 * まとめる（仕様書9.1）。`saveEntity` を2回呼ぶと、間で失敗したときに
 * 「記録だけ消えて履歴が無い」または「履歴だけあって記録が残る」状態になる。
 * どちらも後から機械的に直せない。
 *
 * ## 理由が必須である
 *
 * 仕様書11章が削除に `reason` を必須と定めている。未入力・空白のみは拒否する。
 * 画面は削除前に対象の内容と理由入力を出し、確認を取ってから呼ぶ
 * （{@link previewDirectEntryDeletion}）。
 *
 * @param {object} deps
 * @param {{runId: string, taskRecordId: string}} target
 * @param {string} entryId
 * @param {{reason: string}} input
 * @returns {Promise<{dataset: object|null, workRun: object, taskRecord: object,
 *                    historyEntry: object, warnings: object[]}>}
 */
export async function deleteDirectEntry(deps, target, entryId, input = {}) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ workRuns }) => {
    const { workRun, taskRecord } = locateTask(workRuns, target);
    assertEditable(workRun);

    const nowIso = toIsoSecond(now());
    const result = removeDirectEntry(taskRecord, entryId);
    if (!result.ok) {
      throw new ValidationError(result.errors);
    }

    const history = buildHistoryEntry(
      {
        entityType: HISTORY_ENTITY.DIRECT_ENTRY,
        targetId: result.removed.entryId,
        operation: HISTORY_OP.DIRECT_ENTRY_DELETED,
        summary: summarizeDirectEntryDeletion(workRun, taskRecord, result.removed),
        reason: input.reason,
      },
      { historyId: newId(), timestamp: nowIso },
    );
    if (!history.ok) {
      throw new ValidationError(history.errors);
    }

    const nextRun = replaceDirectEntries(
      workRun,
      taskRecord.taskRecordId,
      result.directEntries,
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

  return {
    dataset,
    workRun: value.workRun,
    taskRecord: taskOf(value.workRun, target.taskRecordId),
    historyEntry: value.historyEntry,
    warnings: value.warnings,
  };
}

/**
 * 削除前の確認に出す内容を組み立てる（仕様書11章、8.5）。
 *
 * 保存へ触れない純関数である。画面はこの結果で確認を描き、利用者が理由を入力して
 * から {@link deleteDirectEntry} を呼ぶ。確認に出す文言と履歴の要約を同じ関数
 * （`describeDirectEntry`）から作るため、「確認した内容」と「履歴へ残る内容」が
 * 食い違わない。
 *
 * 実施回が転記済み・アーカイブの場合も内容は返す。閲覧はできるためである。
 * `deletable` が false のとき、画面は削除ボタンを出さずに `blockedReason` を
 * 示す。実際の拒否は {@link deleteDirectEntry} 側でも行う（画面の制御だけに
 * 頼らない）。
 *
 * @param {object[]} workRuns
 * @param {{runId: string, taskRecordId: string}} target
 * @param {string} entryId
 * @returns {{ok: boolean, errors: string[], workRun?: object, taskRecord?: object,
 *            entry?: object, description?: string, summary?: string,
 *            deletable?: boolean, blockedReason?: string|null}}
 */
export function previewDirectEntryDeletion(workRuns, target, entryId) {
  const { workRun, taskRecord, errors } = findTask(workRuns, target);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const entry = taskRecord.directEntries.find((item) => item.entryId === entryId) ?? null;
  if (entry === null) {
    return { ok: false, errors: [`直接入力: 見つからない（${String(entryId)}）`] };
  }

  const deletable = isRunEditable(workRun);
  return {
    ok: true,
    errors: [],
    workRun,
    taskRecord,
    entry,
    description: describeDirectEntry(entry),
    summary: summarizeDirectEntryDeletion(workRun, taskRecord, entry),
    deletable,
    blockedReason: deletable ? null : describeNotEditable(workRun),
  };
}
