/**
 * 作業項目実績を対象にするアクションの共通部品。
 *
 * 区間（`intervalActions.js`）と直接入力（`directEntryActions.js`）は、どちらも
 * 「実施回と作業項目を引く → 状態ガードを通す → 配下の配列を差し替えて WorkRun を
 * 書き戻す」という同じ形をとる。差は差し替える配列だけなので、その手前をここへ
 * 集約する。
 *
 * WorkRun は `tasks[] → intervals[] / directEntries[]` を内包する単一ドキュメント
 * である（実装計画3.1）。配下を1件変えても WorkRun 全体を書き戻す粒度になる。
 */

import { describeNotEditable, isRunEditable } from '../../domain/runStatus.js';
import { runWriteTime } from '../../domain/writeClock.js';
import { RunNotEditableError, ValidationError } from '../errors.js';

/**
 * 実施回と作業項目実績を引く。見つからない理由を返す。
 *
 * 削除前の確認（`previewIntervalDeletion` など）は例外を投げずに理由を表示したい
 * ので、探す処理と例外にする処理を分けてある。
 *
 * @param {object[]} workRuns
 * @param {{runId: string, taskRecordId: string}} target
 * @returns {{workRun: object|null, taskRecord: object|null, errors: string[]}}
 */
export function findTask(workRuns, target) {
  const workRun = workRuns.find((run) => run.runId === target.runId);
  if (workRun === undefined) {
    return {
      workRun: null,
      taskRecord: null,
      errors: [`実施回: 見つからない（${String(target.runId)}）`],
    };
  }
  const taskRecord = workRun.tasks.find((task) => task.taskRecordId === target.taskRecordId);
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
export function locateTask(workRuns, target) {
  const found = findTask(workRuns, target);
  if (found.errors.length > 0) {
    throw new ValidationError(found.errors);
  }
  return found;
}

/**
 * 実施回が書き換えられる状態かを確かめる（仕様書7.2）。
 *
 * 転記済み・アーカイブの実施回は閲覧のみである。画面のボタン制御だけに頼らず、
 * 保存の手前でも確かめる。
 *
 * @param {object} workRun
 * @throws {RunNotEditableError}
 */
export function assertEditable(workRun) {
  if (!isRunEditable(workRun)) {
    throw new RunNotEditableError(describeNotEditable(workRun), workRun.status);
  }
}

/**
 * 作業項目実績の一部を差し替えた実施回を作る。
 *
 * 元のオブジェクトは書き換えない。保存に失敗したとき、画面が持っているデータ
 * セットが中途半端に変わっているのを避けるためである。
 *
 * `updatedAt` は実施回が既に持つ日時より前にしない（`writeClock.js`）。時計が
 * 巻き戻っている間に書いても、自分のエクスポートを読み戻せる。
 *
 * @param {object} workRun
 * @param {string} taskRecordId
 * @param {object} patch 例: `{intervals}` / `{directEntries}`
 * @param {string} updatedAt
 * @returns {object}
 */
export function replaceTaskFields(workRun, taskRecordId, patch, updatedAt) {
  return {
    ...workRun,
    tasks: workRun.tasks.map((task) =>
      task.taskRecordId === taskRecordId ? { ...task, ...patch } : task,
    ),
    updatedAt: runWriteTime(workRun, updatedAt),
  };
}

/**
 * 保存後の実施回から対象の作業項目実績を引き直す。
 *
 * @param {object} workRun
 * @param {string} taskRecordId
 * @returns {object|undefined}
 */
export function taskOf(workRun, taskRecordId) {
  return workRun.tasks.find((task) => task.taskRecordId === taskRecordId);
}
