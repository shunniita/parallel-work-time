/**
 * 同一作業項目内の区間重複検出（仕様書8.9.5）。
 *
 * 重複しても保存は禁止しない。別のグループが同じ作業項目を実際に同時並行で
 * 実施した場合を表現できるようにするためである（仕様書8.4 補足1）。
 * ここでは警告のための検出だけを行う。
 */

import { parseIso } from './datetime.js';
import { isOpenInterval } from './effort.js';

/**
 * 区間を比較用の数値範囲へ変換する。未終了区間は終端を無限として扱う。
 *
 * @param {{startAt: string, endAt: string|null}} interval
 * @returns {{start: number, end: number}}
 */
function toRange(interval) {
  return {
    start: parseIso(interval.startAt),
    end: isOpenInterval(interval) ? Number.POSITIVE_INFINITY : parseIso(interval.endAt),
  };
}

/**
 * 2つの区間が重複しているかを判定する。
 *
 * 前の区間の終了と次の区間の開始が同一の場合（接触）は重複としない。
 * 休憩や参加者変更は同時刻で区間を継ぐため、接触を重複と扱うと
 * 正常な記録が常に警告対象になってしまう。
 *
 * @param {object} left
 * @param {object} right
 * @returns {boolean}
 */
export function intervalsOverlap(left, right) {
  const a = toRange(left);
  const b = toRange(right);
  return a.start < b.end && b.start < a.end;
}

/**
 * 重複している区間の組を返す。
 *
 * @param {object[]} intervals
 * @returns {{left: object, right: object}[]}
 */
export function findOverlappingPairs(intervals) {
  const pairs = [];
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      if (intervalsOverlap(intervals[i], intervals[j])) {
        pairs.push({ left: intervals[i], right: intervals[j] });
      }
    }
  }
  return pairs;
}

/**
 * 重複している区間があるかを返す。
 *
 * @param {object[]} intervals
 * @returns {boolean}
 */
export function hasOverlap(intervals) {
  return findOverlappingPairs(intervals).length > 0;
}
