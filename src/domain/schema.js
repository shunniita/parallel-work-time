/**
 * エクスポート／インポートJSONの検証（仕様書9.3）。
 *
 * 検証は純関数とし、保存層は結果を見て取り込みの可否を決める。取り込みを
 * 拒否した場合、既存データは一切変更しない。
 *
 * 判定の順序に意味がある。`schemaVersion` の不一致は取り込みを拒否する
 * 独立した理由であり（移行処理を行わないため）、それ以外の構造上の不備とは
 * 区別して返す。
 *
 * 本モジュールは Step 3 の時点で全データの構造検証を担う。実装計画 Step 9 で
 * エクスポート往復とエラー表示を組み込む際、必要になった項目を追加する。
 */

import {
  MAX_LONG_RUNNING_THRESHOLD_HOURS,
  MAX_RETENTION_DAYS,
  SCHEMA_VERSION,
  isSettingInRange,
} from '../config.js';
import { isValidDateKey, isValidIsoSecond } from './datetime.js';
import { INTERVAL_TYPE } from './effort.js';

/** 実施回の状態（仕様書6.5）。`削除候補` は保存しない導出値なので含めない。 */
export const RUN_STATUS = {
  WORKING: 'working',
  AGGREGATED: 'aggregated',
  TRANSFERRED: 'transferred',
  ARCHIVED: 'archived',
};

/** 変更履歴の対象種別（仕様書11章）。業務用語の「対象種別」とは別概念。 */
export const HISTORY_ENTITY_TYPE = ['workRun', 'projectGroup', 'interval', 'directEntry'];

/** 変更履歴の操作種別（仕様書11章の3分類）。 */
export const HISTORY_OPERATION = [
  'statusReverted',
  'intervalDeleted',
  'directEntryDeleted',
  'workRunDeleted',
  'projectGroupDeleted',
];

/** エクスポートJSONの最上位キー（仕様書9.2）。 */
const REQUIRED_TOP_LEVEL_KEYS = [
  'schemaVersion',
  'settings',
  'taskTemplates',
  'projectGroups',
  'workRuns',
  'changeHistory',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * 検証結果を集めるための入れ物。
 *
 * `errors` へ場所つきのメッセージを積む。利用者が原因を特定できるよう、
 * 何件目のどのフィールドかを含める。
 */
class Problems {
  constructor() {
    this.errors = [];
  }

  /**
   * @param {string} path 例: `workRuns[2].tasks[0].intervals[1].startAt`
   * @param {string} message
   */
  add(path, message) {
    this.errors.push(`${path}: ${message}`);
  }

  get ok() {
    return this.errors.length === 0;
  }
}

/**
 * インポートJSONを検証する（仕様書9.3）。
 *
 * @param {unknown} payload
 * @returns {{ok: boolean, schemaMismatch: boolean, errors: string[]}}
 *   `schemaMismatch` が true のとき、`schemaVersion` が現行値と一致しない。
 *   移行処理は行わないため、この場合は他の不備を調べずに拒否してよい。
 */
export function validateImportPayload(payload) {
  if (!isPlainObject(payload)) {
    return {
      ok: false,
      schemaMismatch: false,
      errors: ['最上位: JSONオブジェクトである必要がある'],
    };
  }

  if (payload.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      schemaMismatch: true,
      errors: [
        `schemaVersion: 現行値 ${SCHEMA_VERSION} と一致しない（${String(payload.schemaVersion)}）。` +
          'このファイルは取り込めない。',
      ],
    };
  }

  const problems = new Problems();

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in payload)) {
      problems.add(key, '必須キーが欠けている');
    }
  }
  // exportedAt は形式のみ確認する。欠けていても取り込み自体は妨げない。
  if ('exportedAt' in payload && !isValidIsoSecond(payload.exportedAt)) {
    problems.add('exportedAt', 'オフセット付きISO 8601（秒精度）である必要がある');
  }

  validateSettings(payload.settings, problems);
  validateCollection(payload.taskTemplates, 'taskTemplates', validateTaskTemplate, problems);
  validateCollection(payload.projectGroups, 'projectGroups', validateProjectGroup, problems);
  validateCollection(payload.workRuns, 'workRuns', validateWorkRun, problems);
  validateCollection(payload.changeHistory, 'changeHistory', validateHistoryEntry, problems);

  return { ok: problems.ok, schemaMismatch: false, errors: problems.errors };
}

function validateCollection(value, path, validateItem, problems) {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      problems.add(path, '配列である必要がある');
    }
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      problems.add(itemPath, 'オブジェクトである必要がある');
      return;
    }
    validateItem(item, itemPath, problems);
  });
}

/** 設定（仕様書6.2）。 */
function validateSettings(settings, problems) {
  if (!isPlainObject(settings)) {
    if (settings !== undefined) {
      problems.add('settings', 'オブジェクトである必要がある');
    }
    return;
  }
  if (settings.schemaVersion !== SCHEMA_VERSION) {
    problems.add('settings.schemaVersion', `現行値 ${SCHEMA_VERSION} と一致しない`);
  }
  if (!isSettingInRange(settings.retentionDays, MAX_RETENTION_DAYS)) {
    problems.add('settings.retentionDays', `1以上 ${MAX_RETENTION_DAYS} 以下の整数である必要がある`);
  }
  if (!isSettingInRange(settings.longRunningThresholdHours, MAX_LONG_RUNNING_THRESHOLD_HOURS)) {
    problems.add(
      'settings.longRunningThresholdHours',
      `1以上 ${MAX_LONG_RUNNING_THRESHOLD_HOURS} 以下の整数である必要がある`,
    );
  }
  if (settings.lastExportedAt !== null && !isValidIsoSecond(settings.lastExportedAt)) {
    problems.add(
      'settings.lastExportedAt',
      'null またはオフセット付きISO 8601（秒精度）である必要がある',
    );
  }
}

/** 作業テンプレート（仕様書6.3）。 */
function validateTaskTemplate(template, path, problems) {
  for (const key of ['templateSeriesId', 'templateId', 'targetType', 'variant']) {
    if (!isNonEmptyString(template[key])) {
      problems.add(`${path}.${key}`, '非空文字列である必要がある');
    }
  }
  if (!isPositiveInteger(template.version)) {
    problems.add(`${path}.version`, '1以上の整数である必要がある');
  }
  if (typeof template.active !== 'boolean') {
    problems.add(`${path}.active`, '真偽値である必要がある');
  }
  if (!isValidIsoSecond(template.createdAt)) {
    problems.add(`${path}.createdAt`, 'オフセット付きISO 8601（秒精度）である必要がある');
  }
  if (template.tasks === undefined) {
    problems.add(`${path}.tasks`, '必須キーが欠けている');
  }
  validateCollection(template.tasks, `${path}.tasks`, validateTemplateTask, problems);
}

function validateTemplateTask(task, path, problems) {
  if (!isNonEmptyString(task.taskDefinitionId)) {
    problems.add(`${path}.taskDefinitionId`, '非空文字列である必要がある');
  }
  if (!isNonEmptyString(task.name)) {
    problems.add(`${path}.name`, '非空文字列である必要がある');
  }
  // 外部項目コードは未設定を許す（仕様書8.7.4 は警告のみ）。
  if (task.externalCode !== null && !isNonEmptyString(task.externalCode)) {
    problems.add(`${path}.externalCode`, 'null または非空文字列である必要がある');
  }
  if (!Number.isInteger(task.order)) {
    problems.add(`${path}.order`, '整数である必要がある');
  }
  if (typeof task.active !== 'boolean') {
    problems.add(`${path}.active`, '真偽値である必要がある');
  }
}

/** 案件グループ（仕様書6.4）。 */
function validateProjectGroup(group, path, problems) {
  for (const key of ['projectGroupId', 'projectId', 'targetType', 'variant']) {
    if (!isNonEmptyString(group[key])) {
      problems.add(`${path}.${key}`, '非空文字列である必要がある');
    }
  }
  if (!isPositiveInteger(group.totalQuantity)) {
    problems.add(`${path}.totalQuantity`, '1以上の整数である必要がある（仕様書8.9.2）');
  }
  validateTimestamps(group, path, problems);
}

/** 実施回（仕様書6.5）。 */
function validateWorkRun(run, path, problems) {
  for (const key of ['runId', 'projectGroupId', 'templateId']) {
    if (!isNonEmptyString(run[key])) {
      problems.add(`${path}.${key}`, '非空文字列である必要がある');
    }
  }
  if (!isValidDateKey(run.workDate)) {
    problems.add(`${path}.workDate`, 'YYYY-MM-DD 形式である必要がある');
  }
  if (!isPositiveInteger(run.runQuantity)) {
    problems.add(`${path}.runQuantity`, '1以上の整数である必要がある（仕様書8.9.2）');
  }
  if (!Object.values(RUN_STATUS).includes(run.status)) {
    problems.add(
      `${path}.status`,
      `${Object.values(RUN_STATUS).join(' / ')} のいずれかである必要がある`,
    );
  }
  if (!isPositiveInteger(run.templateVersion)) {
    problems.add(`${path}.templateVersion`, '1以上の整数である必要がある');
  }
  validateTimestamps(run, path, problems);
  validateNullableIso(run, 'transferredAt', path, problems);
  validateNullableIso(run, 'archivedAt', path, problems);
  if (run.tasks === undefined) {
    problems.add(`${path}.tasks`, '必須キーが欠けている');
  }
  validateCollection(run.tasks, `${path}.tasks`, validateTaskRecord, problems);
}

/** 作業項目実績（仕様書6.6）。 */
function validateTaskRecord(task, path, problems) {
  for (const key of ['taskRecordId', 'taskDefinitionId', 'name']) {
    if (!isNonEmptyString(task[key])) {
      problems.add(`${path}.${key}`, '非空文字列である必要がある');
    }
  }
  if (task.externalCode !== null && !isNonEmptyString(task.externalCode)) {
    problems.add(`${path}.externalCode`, 'null または非空文字列である必要がある');
  }
  if (!Number.isInteger(task.order)) {
    problems.add(`${path}.order`, '整数である必要がある');
  }
  if (typeof task.manuallyAdded !== 'boolean') {
    problems.add(`${path}.manuallyAdded`, '真偽値である必要がある');
  }
  if (task.intervals === undefined) {
    problems.add(`${path}.intervals`, '必須キーが欠けている');
  }
  validateCollection(task.intervals, `${path}.intervals`, validateInterval, problems);
  if (task.directEntries === undefined) {
    problems.add(`${path}.directEntries`, '必須キーが欠けている');
  }
  validateCollection(task.directEntries, `${path}.directEntries`, validateDirectEntry, problems);
}

/** 作業区間（仕様書6.7）。 */
function validateInterval(interval, path, problems) {
  if (!isNonEmptyString(interval.intervalId)) {
    problems.add(`${path}.intervalId`, '非空文字列である必要がある');
  }
  if (!Object.values(INTERVAL_TYPE).includes(interval.type)) {
    problems.add(
      `${path}.type`,
      `${Object.values(INTERVAL_TYPE).join(' / ')} のいずれかである必要がある`,
    );
  }
  if (!isValidIsoSecond(interval.startAt)) {
    problems.add(`${path}.startAt`, 'オフセット付きISO 8601（秒精度）である必要がある');
  }
  // endAt が null の区間を未終了区間とする（仕様書6.7）。
  validateNullableIso(interval, 'endAt', path, problems);
  if (!isStringArray(interval.participants)) {
    problems.add(`${path}.participants`, '文字列配列である必要がある');
  } else if (
    interval.type === INTERVAL_TYPE.WORK &&
    interval.participants.length === 0
  ) {
    // work のみ0人を禁止する。break は0人を許す（仕様書8.9.4）。
    problems.add(`${path}.participants`, 'work 区間は1人以上必要（仕様書8.9.4）');
  }
  validateTimestamps(interval, path, problems);
}

/** 直接入力（仕様書6.8）。 */
function validateDirectEntry(entry, path, problems) {
  if (!isNonEmptyString(entry.entryId)) {
    problems.add(`${path}.entryId`, '非空文字列である必要がある');
  }
  if (!Number.isInteger(entry.seconds) || entry.seconds < 0) {
    problems.add(`${path}.seconds`, '0以上の整数である必要がある（仕様書8.5.5）');
  }
  if (!isStringArray(entry.participants)) {
    problems.add(`${path}.participants`, '文字列配列である必要がある');
  }
  if (!isNonEmptyString(entry.note)) {
    problems.add(`${path}.note`, '備考は必須（仕様書8.5.4）');
  }
  validateTimestamps(entry, path, problems);
}

/** 簡易変更履歴（仕様書11章）。 */
function validateHistoryEntry(entry, path, problems) {
  if (!isNonEmptyString(entry.historyId)) {
    problems.add(`${path}.historyId`, '非空文字列である必要がある');
  }
  if (!isValidIsoSecond(entry.timestamp)) {
    problems.add(`${path}.timestamp`, 'オフセット付きISO 8601（秒精度）である必要がある');
  }
  if (!HISTORY_ENTITY_TYPE.includes(entry.entityType)) {
    problems.add(`${path}.entityType`, `${HISTORY_ENTITY_TYPE.join(' / ')} のいずれか`);
  }
  if (!isNonEmptyString(entry.targetId)) {
    problems.add(`${path}.targetId`, '非空文字列である必要がある');
  }
  if (!HISTORY_OPERATION.includes(entry.operation)) {
    problems.add(`${path}.operation`, `${HISTORY_OPERATION.join(' / ')} のいずれか`);
  }
  if (typeof entry.summary !== 'string') {
    problems.add(`${path}.summary`, '文字列である必要がある');
  }
  if (!isNonEmptyString(entry.reason)) {
    problems.add(`${path}.reason`, '理由は必須（仕様書11章）');
  }
}

function validateTimestamps(entity, path, problems) {
  for (const key of ['createdAt', 'updatedAt']) {
    if (!isValidIsoSecond(entity[key])) {
      problems.add(`${path}.${key}`, 'オフセット付きISO 8601（秒精度）である必要がある');
    }
  }
}

function validateNullableIso(entity, key, path, problems) {
  const value = entity[key];
  if (value !== null && !isValidIsoSecond(value)) {
    problems.add(
      `${path}.${key}`,
      'null またはオフセット付きISO 8601（秒精度）である必要がある',
    );
  }
}
