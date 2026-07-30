/**
 * テスト用のデータ生成ヘルパー。
 *
 * 参加者名・作業項目名はすべて架空とする（仕様書14章）。
 * 日時はオフセットを明示し、実行環境のタイムゾーンに依存しないようにする。
 */

import { INTERVAL_TYPE } from '../../src/domain/effort.js';

let sequence = 0;

function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** テスト間でIDを再現可能にするためのリセット。 */
export function resetIds() {
  sequence = 0;
}

/**
 * 作業区間を作る。
 *
 * @param {string} startAt
 * @param {string|null} endAt `null` で未終了区間
 * @param {string[]} [participants]
 */
export function workInterval(startAt, endAt, participants = ['甲']) {
  return {
    intervalId: nextId('interval'),
    type: INTERVAL_TYPE.WORK,
    startAt,
    endAt,
    participants,
    createdAt: startAt,
    updatedAt: startAt,
  };
}

/**
 * 休憩区間を作る。参加者は0人でも保存できる（仕様書8.9.4）。
 *
 * @param {string} startAt
 * @param {string|null} endAt
 * @param {string[]} [participants]
 */
export function breakInterval(startAt, endAt, participants = ['甲']) {
  return {
    ...workInterval(startAt, endAt, participants),
    type: INTERVAL_TYPE.BREAK,
  };
}

/**
 * 直接入力を作る。`seconds` は人数を含んだ総工数（仕様書8.5.6）。
 *
 * @param {number} seconds
 * @param {{participants?: string[], note?: string}} [options]
 */
export function directEntry(seconds, options = {}) {
  const { participants = ['甲'], note = '計測漏れ分を追加' } = options;
  return {
    entryId: nextId('entry'),
    seconds,
    participants,
    note,
    createdAt: '2026-07-30T10:00:00+09:00',
    updatedAt: '2026-07-30T10:00:00+09:00',
  };
}

/**
 * 作業項目実績を作る。
 *
 * @param {{name?: string, externalCode?: string|null, order?: number,
 *          intervals?: object[], directEntries?: object[]}} [options]
 */
export function taskRecord(options = {}) {
  const {
    name = '作業項目A',
    externalCode = 'X-100',
    order = 1,
    intervals = [],
    directEntries = [],
  } = options;
  return {
    taskRecordId: nextId('task'),
    taskDefinitionId: nextId('taskDef'),
    name,
    externalCode,
    order,
    manuallyAdded: false,
    intervals,
    directEntries,
  };
}

/**
 * 実施回を作る。
 *
 * @param {{tasks?: object[], status?: string}} [options]
 */
export function workRun(options = {}) {
  const { tasks = [], status = 'working' } = options;
  return {
    runId: nextId('run'),
    projectGroupId: nextId('group'),
    workDate: '2026-07-30',
    runQuantity: 50,
    status,
    templateId: nextId('template'),
    templateVersion: 1,
    createdAt: '2026-07-30T09:00:00+09:00',
    updatedAt: '2026-07-30T09:00:00+09:00',
    transferredAt: null,
    archivedAt: null,
    tasks,
  };
}
