/**
 * 作業項目の状態と、状態に応じて有効な操作（仕様書7.2、12.4）。
 *
 * 状態は保存せず、区間の内容から導出する。「完了」は不可逆ではなく、
 * 未終了区間が存在しないことを表すのみである。再び開始すれば作業中へ戻る。
 */

import { INTERVAL_TYPE, isOpenInterval, openIntervals } from './effort.js';
import { parseIso } from './datetime.js';

/** 作業項目の状態（仕様書7.2）。 */
export const TASK_STATE = {
  /** 作業区間が存在しない。 */
  NOT_STARTED: 'notStarted',
  /** work の未終了区間が存在する。 */
  WORKING: 'working',
  /** break の未終了区間が存在する。 */
  ON_BREAK: 'onBreak',
  /** 作業区間が存在し、未終了区間がない。 */
  DONE: 'done',
};

/**
 * 作業項目の状態の表示名（仕様書7.2、12.3）。
 *
 * 状態の定義と同じ場所へ置く。画面のほか、状態が合わない操作を拒否したときの
 * 文言（`intervalOps.js`）でも使う。画面側に同じ対応表を持たせると、拒否理由と
 * 表示で語が食い違う（過去のレビュー指摘）。
 */
export const TASK_STATE_LABEL = {
  [TASK_STATE.NOT_STARTED]: '未着手',
  [TASK_STATE.WORKING]: '作業中',
  [TASK_STATE.ON_BREAK]: '休憩中',
  [TASK_STATE.DONE]: '完了',
};

/** 作業項目に対する操作（仕様書12.4）。 */
export const TASK_OPERATION = {
  START: 'start',
  BREAK: 'break',
  RESUME: 'resume',
  FINISH: 'finish',
  CHANGE_PARTICIPANTS: 'changeParticipants',
  DIRECT_ENTRY: 'directEntry',
  EDIT_HISTORY: 'editHistory',
  ADD_INTERVAL: 'addInterval',
};

/**
 * 操作の表示名（仕様書12.4）。
 *
 * 操作の定義と同じ場所へ置く。画面のボタン名と、状態が合わない操作を拒否した
 * ときの文言（`intervalOps.js`）で同じ語を使うためである。
 */
export const TASK_OPERATION_LABEL = {
  [TASK_OPERATION.START]: '開始',
  [TASK_OPERATION.BREAK]: '休憩',
  [TASK_OPERATION.RESUME]: '再開',
  [TASK_OPERATION.FINISH]: '終了',
  [TASK_OPERATION.CHANGE_PARTICIPANTS]: '参加者変更',
  [TASK_OPERATION.DIRECT_ENTRY]: '直接入力',
  [TASK_OPERATION.EDIT_HISTORY]: '履歴編集',
  [TASK_OPERATION.ADD_INTERVAL]: '区間追加',
};

/** 状態ごとに有効な操作（仕様書12.4の対応表）。 */
const OPERATIONS_BY_STATE = {
  [TASK_STATE.NOT_STARTED]: [
    TASK_OPERATION.START,
    TASK_OPERATION.DIRECT_ENTRY,
    TASK_OPERATION.ADD_INTERVAL,
  ],
  [TASK_STATE.WORKING]: [
    TASK_OPERATION.BREAK,
    TASK_OPERATION.FINISH,
    TASK_OPERATION.CHANGE_PARTICIPANTS,
    TASK_OPERATION.DIRECT_ENTRY,
    TASK_OPERATION.EDIT_HISTORY,
    TASK_OPERATION.ADD_INTERVAL,
  ],
  [TASK_STATE.ON_BREAK]: [
    TASK_OPERATION.RESUME,
    TASK_OPERATION.FINISH,
    TASK_OPERATION.CHANGE_PARTICIPANTS,
    TASK_OPERATION.DIRECT_ENTRY,
    TASK_OPERATION.EDIT_HISTORY,
    TASK_OPERATION.ADD_INTERVAL,
  ],
  [TASK_STATE.DONE]: [
    TASK_OPERATION.START,
    TASK_OPERATION.DIRECT_ENTRY,
    TASK_OPERATION.EDIT_HISTORY,
    TASK_OPERATION.ADD_INTERVAL,
  ],
};

/**
 * 進行中の区間を返す。存在しない場合は null。
 *
 * ボタン操作による未終了区間は作業項目ごとに一つまでだが（仕様書8.4 補足1）、
 * 手編集したデータで複数存在した場合は開始が最も新しいものを進行中とみなす。
 *
 * @param {{intervals: object[]}} taskRecord
 * @returns {object|null}
 */
export function activeInterval(taskRecord) {
  const open = openIntervals(taskRecord);
  if (open.length === 0) {
    return null;
  }
  return open.reduce((latest, interval) =>
    parseIso(interval.startAt) > parseIso(latest.startAt) ? interval : latest,
  );
}

/**
 * 作業項目の状態を求める（仕様書7.2）。
 *
 * 直接入力だけがある作業項目は「未着手」である。状態は作業区間の有無で
 * 判定すると仕様書7.2が定めている。
 *
 * @param {{intervals: object[]}} taskRecord
 * @returns {string} {@link TASK_STATE} のいずれか
 */
export function taskState(taskRecord) {
  if (taskRecord.intervals.length === 0) {
    return TASK_STATE.NOT_STARTED;
  }
  const active = activeInterval(taskRecord);
  if (active === null) {
    return TASK_STATE.DONE;
  }
  return active.type === INTERVAL_TYPE.BREAK ? TASK_STATE.ON_BREAK : TASK_STATE.WORKING;
}

/**
 * 有効な操作の一覧を返す（仕様書12.4）。
 *
 * 実施回が転記済みまたはアーカイブの場合は閲覧のみとなるため、
 * `runEditable` に false を渡すと空配列を返す（仕様書7.2、7章）。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{runEditable?: boolean}} [options]
 * @returns {string[]}
 */
export function availableOperations(taskRecord, options = {}) {
  const { runEditable = true } = options;
  if (!runEditable) {
    return [];
  }
  return [...OPERATIONS_BY_STATE[taskState(taskRecord)]];
}

/**
 * 指定した操作が現在有効かどうかを返す。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {string} operation
 * @param {{runEditable?: boolean}} [options]
 * @returns {boolean}
 */
export function canOperate(taskRecord, operation, options = {}) {
  return availableOperations(taskRecord, options).includes(operation);
}

/**
 * 未終了区間がしきい値を超えているかを判定する（仕様書8.8.2）。
 *
 * @param {{startAt: string, endAt: string|null}} interval
 * @param {Date} now
 * @param {number} thresholdHours
 * @returns {boolean}
 */
export function exceedsThreshold(interval, now, thresholdHours) {
  if (!isOpenInterval(interval)) {
    return false;
  }
  const elapsedMs = now.getTime() - parseIso(interval.startAt);
  return elapsedMs > thresholdHours * 60 * 60 * 1000;
}
