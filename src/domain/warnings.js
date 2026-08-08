/**
 * 画面上部の警告領域に出す内容の組み立て（仕様書8.8.1、8.8.2、12.2）。
 *
 * 純関数のみ。現在日時は引数で受け取る。
 *
 * ## 対象はすべての実施回
 *
 * 未終了区間の収集は実施回の状態で絞らない。転記済みやアーカイブ済みの実施回に
 * 未終了区間が残っていることは通常の操作では起きないが、取り込んだJSONや過去の
 * 修復対象データには存在しうる。警告領域はまさにそうした「気づかれていない記録」
 * を見せる場所なので、状態を理由に隠さない。
 *
 * ## しきい値の判定は描くたびに行う
 *
 * 超過は保存しない派生値である。現在日時と `startAt` の差で判定し（仕様書8.8）、
 * 1分ごとの再評価は呼び出し側（警告領域）が同じ関数を呼び直すことで行う。
 */

import { parseIso } from './datetime.js';
import { openIntervals } from './effort.js';
import { numberRuns } from './runOrder.js';
import { exceedsThreshold } from './taskState.js';

/**
 * データ全体から未終了区間を集める（仕様書8.8.1）。
 *
 * 画面が「どこの何か」を言えるよう、案件・実施回（第n回）・作業項目を添える。
 * 並びは開始日時の古い順とする。長く放置されたものほど先に目へ入るのがよい。
 *
 * @param {{projectGroups: object[], workRuns: object[]}} dataset
 * @returns {{projectGroup: object|null, run: object, runNumber: number,
 *            taskRecord: object, interval: object}[]}
 */
export function collectOpenIntervals(dataset) {
  const groupById = new Map(
    dataset.projectGroups.map((group) => [group.projectGroupId, group]),
  );

  const items = [];
  const runsByProject = new Map();
  for (const run of dataset.workRuns) {
    const list = runsByProject.get(run.projectGroupId) ?? [];
    list.push(run);
    runsByProject.set(run.projectGroupId, list);
  }

  for (const runs of runsByProject.values()) {
    for (const { run, number } of numberRuns(runs)) {
      for (const taskRecord of run.tasks) {
        for (const interval of openIntervals(taskRecord)) {
          items.push({
            projectGroup: groupById.get(run.projectGroupId) ?? null,
            run,
            runNumber: number,
            taskRecord,
            interval,
          });
        }
      }
    }
  }

  items.sort((left, right) => parseIso(left.interval.startAt) - parseIso(right.interval.startAt));
  return items;
}

/**
 * 警告領域へ出す内容をまとめる（仕様書8.8.1、8.8.2）。
 *
 * @param {{projectGroups: object[], workRuns: object[]}} dataset
 * @param {{now: Date, thresholdHours: number}} options
 * @returns {{items: {projectGroup: object|null, run: object, runNumber: number,
 *                    taskRecord: object, interval: object, exceeded: boolean,
 *                    elapsedMinutes: number}[],
 *            exceededCount: number}}
 */
export function summarizeOpenIntervals(dataset, { now, thresholdHours }) {
  const items = collectOpenIntervals(dataset).map((item) => ({
    ...item,
    exceeded: exceedsThreshold(item.interval, now, thresholdHours),
    elapsedMinutes: Math.max(
      0,
      Math.floor((now.getTime() - parseIso(item.interval.startAt)) / (60 * 1000)),
    ),
  }));
  return {
    items,
    exceededCount: items.filter((item) => item.exceeded).length,
  };
}

/**
 * 経過時間の表示文字列。「3時間25分」「45分」の形にする。
 *
 * @param {number} elapsedMinutes
 * @returns {string}
 */
export function formatElapsed(elapsedMinutes) {
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours === 0) {
    return `${minutes}分`;
  }
  return `${hours}時間${minutes}分`;
}
