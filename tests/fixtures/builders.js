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
 * `withTaskDetail` は入れ子（tasks → intervals / directEntries）が保存と
 * 読み込みで保たれるかを見る結合テスト向け。`tasks` を明示した場合はそちらを使う。
 *
 * @param {{tasks?: object[], status?: string, projectGroupId?: string,
 *          runQuantity?: number, workDate?: string, withTaskDetail?: boolean,
 *          transferredAt?: string|null, archivedAt?: string|null}} [options]
 */
export function workRun(options = {}) {
  const {
    status = 'working',
    projectGroupId = nextId('group'),
    runQuantity = 50,
    workDate = '2026-07-30',
    withTaskDetail = false,
    transferredAt = null,
    archivedAt = null,
  } = options;
  const tasks = options.tasks ?? (withTaskDetail ? [detailedTaskRecord()] : []);
  return {
    runId: nextId('run'),
    projectGroupId,
    workDate,
    runQuantity,
    status,
    templateId: nextId('template'),
    templateVersion: 1,
    createdAt: '2026-07-30T09:00:00+09:00',
    updatedAt: '2026-07-30T09:00:00+09:00',
    transferredAt,
    archivedAt,
    tasks,
  };
}

/**
 * 終了済み区間・未終了区間・直接入力をひととおり持つ作業項目実績を作る。
 */
function detailedTaskRecord() {
  return taskRecord({
    intervals: [
      workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', ['甲', '乙']),
      workInterval('2026-07-30T09:30:00+09:00', null, ['甲']),
    ],
    directEntries: [directEntry(1200)],
  });
}

/**
 * 作業テンプレートを作る（仕様書6.3）。
 *
 * @param {{templateSeriesId?: string, templateId?: string, targetType?: string,
 *          variant?: string, version?: number, active?: boolean,
 *          tasks?: object[]}} [options]
 */
export function taskTemplate(options = {}) {
  const seriesId = options.templateSeriesId ?? nextId('series');
  const {
    templateId = nextId('template'),
    targetType = '対象種別A',
    variant = '標準',
    version = 1,
    active = true,
    tasks = [
      templateTask({ name: '作業項目A', externalCode: 'X-100', order: 1 }),
      templateTask({ name: '作業項目B', externalCode: 'X-200', order: 2 }),
    ],
  } = options;
  return {
    templateSeriesId: seriesId,
    templateId,
    targetType,
    variant,
    version,
    active,
    createdAt: '2026-07-30T08:00:00+09:00',
    tasks,
  };
}

/**
 * テンプレート内の作業項目定義を作る。
 *
 * @param {{name?: string, externalCode?: string|null, order?: number,
 *          active?: boolean}} [options]
 */
export function templateTask(options = {}) {
  const { name = '作業項目A', externalCode = 'X-100', order = 1, active = true } = options;
  return {
    taskDefinitionId: nextId('taskDef'),
    name,
    externalCode,
    order,
    active,
  };
}

/**
 * 案件グループを作る（仕様書6.4）。
 *
 * @param {{projectId?: string, targetType?: string, variant?: string,
 *          totalQuantity?: number}} [options]
 */
export function projectGroup(options = {}) {
  const {
    projectId = nextId('PJ'),
    targetType = '対象種別A',
    variant = '標準',
    totalQuantity = 100,
  } = options;
  return {
    projectGroupId: nextId('group'),
    projectId,
    targetType,
    variant,
    totalQuantity,
    createdAt: '2026-07-30T08:30:00+09:00',
    updatedAt: '2026-07-30T08:30:00+09:00',
  };
}

/**
 * 簡易変更履歴を作る（仕様書11章）。`reason` は必須。
 *
 * @param {{entityType?: string, targetId?: string, operation?: string,
 *          summary?: string, reason?: string}} [options]
 */
export function historyEntry(options = {}) {
  const {
    entityType = 'workRun',
    targetId = nextId('run'),
    operation = 'statusReverted',
    summary = '転記済み → 集計済み',
    reason = '転記先の誤りに気づいたため',
  } = options;
  return {
    historyId: nextId('history'),
    timestamp: '2026-07-30T11:00:00+09:00',
    entityType,
    targetId,
    operation,
    summary,
    reason,
  };
}
