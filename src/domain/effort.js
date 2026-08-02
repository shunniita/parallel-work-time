/**
 * 工数計算（仕様書8.6）。
 *
 *   作業区間秒 = floor((endAt - startAt) / 1000) × 参加者数
 *   休憩区間秒 = 0
 *   直接入力秒 = seconds（参加者数を掛けない）
 *   作業項目合計秒 = Σ作業区間秒 + Σ直接入力秒
 *   転記値分 = ceil(作業項目合計秒 / 60)
 *
 * 丸めの位置が要件である。各区間では丸めず、作業項目の合計に対して
 * 一度だけ分単位へ切り上げる（仕様書8.6.4）。
 */

import { diffMs } from './datetime.js';

/** 作業区間の種別（仕様書6.7）。 */
export const INTERVAL_TYPE = {
  WORK: 'work',
  BREAK: 'break',
};

/**
 * 区間種別の表示名。
 *
 * 種別の定義と同じ場所へ置く。画面と、変更履歴の要約文（仕様書11章）の
 * 両方が同じ語を使う必要があるためである。
 */
export const INTERVAL_TYPE_LABEL = {
  [INTERVAL_TYPE.WORK]: '作業',
  [INTERVAL_TYPE.BREAK]: '休憩',
};

/**
 * 未終了区間かどうかを判定する（仕様書6.7）。
 *
 * @param {{endAt: string|null}} interval
 * @returns {boolean}
 */
export function isOpenInterval(interval) {
  return interval.endAt === null || interval.endAt === undefined;
}

/**
 * 作業区間の工数を秒で返す。
 *
 * 休憩区間は0秒（仕様書8.6.2）。未終了区間は確定分へ含めないため0秒を返し、
 * 未確定であることは {@link summarizeTask} の `confirmed` で示す（仕様書8.6.5）。
 *
 * 終了が開始より前のデータは入力検証（仕様書8.9.3）で保存を禁止しているが、
 * 手編集したJSONを取り込んだ場合に画面が壊れないよう0秒として扱う。
 *
 * @param {{type: string, startAt: string, endAt: string|null, participants: string[]}} interval
 * @returns {number}
 */
export function intervalEffortSeconds(interval) {
  if (isOpenInterval(interval) || interval.type === INTERVAL_TYPE.BREAK) {
    return 0;
  }
  const elapsedMs = diffMs(interval.startAt, interval.endAt);
  if (elapsedMs <= 0) {
    return 0;
  }
  return Math.floor(elapsedMs / 1000) * interval.participants.length;
}

/**
 * 作業項目の時刻入力分を秒で返す。未終了区間は含めない。
 *
 * @param {{intervals: object[]}} taskRecord
 * @returns {number}
 */
export function taskTimeSeconds(taskRecord) {
  return taskRecord.intervals.reduce(
    (total, interval) => total + intervalEffortSeconds(interval),
    0,
  );
}

/**
 * 作業項目の直接入力分を秒で返す。
 *
 * 直接入力値はすでに参加人数を含んだ総工数であり、参加者数を掛けない
 * （仕様書8.5.6、8.6.6）。
 *
 * @param {{directEntries: {seconds: number}[]}} taskRecord
 * @returns {number}
 */
export function taskDirectSeconds(taskRecord) {
  return taskRecord.directEntries.reduce((total, entry) => total + entry.seconds, 0);
}

/**
 * 作業項目内の未終了区間を返す。
 *
 * @param {{intervals: object[]}} taskRecord
 * @returns {object[]}
 */
export function openIntervals(taskRecord) {
  return taskRecord.intervals.filter(isOpenInterval);
}

/**
 * 合計秒を転記値の分へ切り上げる（仕様書8.6.4）。
 *
 * @param {number} totalSeconds
 * @returns {number}
 */
export function toTransferMinutes(totalSeconds) {
  return Math.ceil(totalSeconds / 60);
}

/**
 * 作業項目の工数内訳を求める。
 *
 * 未終了区間がある場合、`confirmed` は false になり `transferMinutes` は null を返す。
 * 確定済みの区間と直接入力から求めた `totalSeconds` は、未確定でも小計として
 * 表示できるよう常に返す（仕様書8.6.5）。
 *
 * @param {{intervals: object[], directEntries: object[]}} taskRecord
 * @returns {{timeSeconds: number, directSeconds: number, totalSeconds: number,
 *            openCount: number, confirmed: boolean, transferMinutes: number|null}}
 */
export function summarizeTask(taskRecord) {
  const timeSeconds = taskTimeSeconds(taskRecord);
  const directSeconds = taskDirectSeconds(taskRecord);
  const totalSeconds = timeSeconds + directSeconds;
  const openCount = openIntervals(taskRecord).length;
  const confirmed = openCount === 0;
  return {
    timeSeconds,
    directSeconds,
    totalSeconds,
    openCount,
    confirmed,
    transferMinutes: confirmed ? toTransferMinutes(totalSeconds) : null,
  };
}

/**
 * 実施回の集計を求める。
 *
 * `transferMinutesSum` は各作業項目の転記値の合計である。実施回の合計秒を
 * まとめて切り上げた値ではない。転記は作業項目ごとに行うため、項目単位で
 * 切り上げた値を足す必要がある（仕様書8.6.4、8.7.1）。
 *
 * @param {{tasks: object[]}} workRun
 * @returns {{tasks: object[], totalSeconds: number, openCount: number,
 *            confirmed: boolean, transferMinutesSum: number|null}}
 */
export function summarizeRun(workRun) {
  const tasks = workRun.tasks.map((taskRecord) => ({
    taskRecordId: taskRecord.taskRecordId,
    name: taskRecord.name,
    externalCode: taskRecord.externalCode,
    order: taskRecord.order,
    ...summarizeTask(taskRecord),
  }));

  const totalSeconds = tasks.reduce((total, task) => total + task.totalSeconds, 0);
  const openCount = tasks.reduce((total, task) => total + task.openCount, 0);
  const confirmed = openCount === 0;

  return {
    tasks,
    totalSeconds,
    openCount,
    confirmed,
    transferMinutesSum: confirmed
      ? tasks.reduce((total, task) => total + task.transferMinutes, 0)
      : null,
  };
}
