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
 * 値は「通常の書き込み経路が保存する形」まで求める。前後空白付きの文字列や
 * 安全整数の外にある数値を通すと、保存はできても画面から引けないデータになる
 * （{@link isNormalizedString}）。
 */

import {
  MAX_DIRECT_ENTRY_SECONDS,
  MAX_IMPORT_ENTITIES,
  MAX_LONG_RUNNING_THRESHOLD_HOURS,
  MAX_ORDINAL,
  MAX_PARTICIPANTS,
  MAX_QUANTITY,
  MAX_RETENTION_DAYS,
  MAX_SUMMARY_LENGTH,
  MAX_TEXT_LENGTH,
  SCHEMA_VERSION,
  isIntegerInRange,
  isNonNegativeIntegerInRange,
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

/**
 * 通常の書き込み経路が保存する形の文字列か（レビュー指摘 F12-01）。
 *
 * 案件ID・対象種別・バリエーション・作業項目名・外部項目コード・備考・理由は、
 * いずれも保存の直前に前後空白を落としている（`templateOps.js`、
 * `templateInstantiate.js`、`directEntryOps.js`、`history.js`）。取り込みだけが
 * この経路を通らないため、前後空白付きの値がそのまま保存されうる。
 *
 * 保存されてしまうと、画面側の検索・重複判定は正規化した入力と生値を比べるため、
 * 取り込んだ案件を引けず、正規化すると同一になる案件IDの新規登録も通ってしまう。
 * 全置換（9.3）である以上、直す機会は取り込み前にしかないので、黙って正規化せず
 * 場所を添えて拒む（本モジュール冒頭および `integrity.js` の方針）。
 *
 * 長さの上限も同時に見る。取り込みはツール外で作られた任意の入力を受け取る唯一の
 * 経路であり、際限のない文字列は表示と比較の両方で費用になる。
 */
function isNormalizedString(value) {
  return (
    isNonEmptyString(value) && value === value.trim() && value.length <= MAX_TEXT_LENGTH
  );
}

const NORMALIZED_STRING_MESSAGE =
  `前後に空白の無い ${MAX_TEXT_LENGTH} 文字以内の非空文字列である必要がある`;

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * 参加者一覧の形を確かめる（仕様書6.7、8.6.1）。
 *
 * 前後空白・重複・実質0人は `integrity.js` が業務的整合性として見る（GAR-2）。
 * ここで見るのは形と規模だけである。
 *
 * @param {unknown} participants
 * @param {string} path
 * @param {Problems} problems
 * @returns {boolean} 形が整っていれば true
 */
function validateParticipantArray(participants, path, problems) {
  if (!isStringArray(participants)) {
    problems.add(path, '文字列配列である必要がある');
    return false;
  }
  if (participants.length > MAX_PARTICIPANTS) {
    problems.add(path, `参加者は ${MAX_PARTICIPANTS} 名以下である必要がある`);
    return false;
  }
  if (participants.some((name) => name.length > MAX_TEXT_LENGTH)) {
    problems.add(path, `参加者名は ${MAX_TEXT_LENGTH} 文字以内である必要がある`);
    return false;
  }
  return true;
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
  if (value.length > MAX_IMPORT_ENTITIES) {
    // 件数だけ先に断る。1件ずつ検証すると、拒否すると決まっている入力のために
    // 場所つきメッセージを数十万件積むことになる。
    problems.add(path, `件数が上限 ${MAX_IMPORT_ENTITIES} を超えている（${value.length}件）`);
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
  if (!isIntegerInRange(settings.retentionDays, MAX_RETENTION_DAYS)) {
    problems.add('settings.retentionDays', `1以上 ${MAX_RETENTION_DAYS} 以下の整数である必要がある`);
  }
  if (!isIntegerInRange(settings.longRunningThresholdHours, MAX_LONG_RUNNING_THRESHOLD_HOURS)) {
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
  for (const key of ['templateSeriesId', 'templateId']) {
    if (!isNonEmptyString(template[key])) {
      problems.add(`${path}.${key}`, '非空文字列である必要がある');
    }
  }
  // 対象種別とバリエーションは有効版の一意性キーである（8.1.1）。空白差で別物に
  // なると、画面から有効版を引けないテンプレートが保存される。
  for (const key of ['targetType', 'variant']) {
    if (!isNormalizedString(template[key])) {
      problems.add(`${path}.${key}`, NORMALIZED_STRING_MESSAGE);
    }
  }
  if (!isIntegerInRange(template.version, MAX_ORDINAL)) {
    problems.add(`${path}.version`, `1以上 ${MAX_ORDINAL} 以下の整数である必要がある`);
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
  if (!isNormalizedString(task.name)) {
    problems.add(`${path}.name`, NORMALIZED_STRING_MESSAGE);
  }
  // 外部項目コードは未設定を許す（仕様書8.7.4 は警告のみ）。
  if (task.externalCode !== null && !isNormalizedString(task.externalCode)) {
    problems.add(`${path}.externalCode`, `null または、${NORMALIZED_STRING_MESSAGE}`);
  }
  if (!isIntegerInRange(task.order, MAX_ORDINAL)) {
    problems.add(`${path}.order`, `1以上 ${MAX_ORDINAL} 以下の整数である必要がある`);
  }
  if (typeof task.active !== 'boolean') {
    problems.add(`${path}.active`, '真偽値である必要がある');
  }
}

/** 案件グループ（仕様書6.4）。 */
function validateProjectGroup(group, path, problems) {
  if (!isNonEmptyString(group.projectGroupId)) {
    problems.add(`${path}.projectGroupId`, '非空文字列である必要がある');
  }
  // 案件IDは一意制約を持つ唯一の利用者入力である（8.2.6）。対象種別・
  // バリエーションは案件詳細の表示とテンプレート照合に使う。
  for (const key of ['projectId', 'targetType', 'variant']) {
    if (!isNormalizedString(group[key])) {
      problems.add(`${path}.${key}`, NORMALIZED_STRING_MESSAGE);
    }
  }
  if (!isIntegerInRange(group.totalQuantity, MAX_QUANTITY)) {
    problems.add(
      `${path}.totalQuantity`,
      `1以上 ${MAX_QUANTITY} 以下の整数である必要がある（仕様書8.9.2）`,
    );
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
  if (!isIntegerInRange(run.runQuantity, MAX_QUANTITY)) {
    problems.add(
      `${path}.runQuantity`,
      `1以上 ${MAX_QUANTITY} 以下の整数である必要がある（仕様書8.9.2）`,
    );
  }
  if (!Object.values(RUN_STATUS).includes(run.status)) {
    problems.add(
      `${path}.status`,
      `${Object.values(RUN_STATUS).join(' / ')} のいずれかである必要がある`,
    );
  }
  if (!isIntegerInRange(run.templateVersion, MAX_ORDINAL)) {
    problems.add(`${path}.templateVersion`, `1以上 ${MAX_ORDINAL} 以下の整数である必要がある`);
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
  for (const key of ['taskRecordId', 'taskDefinitionId']) {
    if (!isNonEmptyString(task[key])) {
      problems.add(`${path}.${key}`, '非空文字列である必要がある');
    }
  }
  // 名称と外部項目コードはテンプレートからの複製値であり（6.6、8.1.4）、複製元が
  // 正規化済みである以上、実績側にも同じ形を求める。
  if (!isNormalizedString(task.name)) {
    problems.add(`${path}.name`, NORMALIZED_STRING_MESSAGE);
  }
  if (task.externalCode !== null && !isNormalizedString(task.externalCode)) {
    problems.add(`${path}.externalCode`, `null または、${NORMALIZED_STRING_MESSAGE}`);
  }
  if (!isIntegerInRange(task.order, MAX_ORDINAL)) {
    problems.add(`${path}.order`, `1以上 ${MAX_ORDINAL} 以下の整数である必要がある`);
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
  if (!validateParticipantArray(interval.participants, `${path}.participants`, problems)) {
    // 形が壊れているときは人数の要件を重ねて指摘しない。
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
  if (!isNonNegativeIntegerInRange(entry.seconds, MAX_DIRECT_ENTRY_SECONDS)) {
    problems.add(
      `${path}.seconds`,
      `0以上 ${MAX_DIRECT_ENTRY_SECONDS} 以下の整数である必要がある（仕様書8.5.5）`,
    );
  }
  validateParticipantArray(entry.participants, `${path}.participants`, problems);
  if (!isNormalizedString(entry.note)) {
    problems.add(`${path}.note`, `備考は必須（仕様書8.5.4）。${NORMALIZED_STRING_MESSAGE}`);
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
  if (typeof entry.summary !== 'string' || entry.summary.length > MAX_SUMMARY_LENGTH) {
    problems.add(`${path}.summary`, `${MAX_SUMMARY_LENGTH} 文字以内の文字列である必要がある`);
  }
  if (!isNormalizedString(entry.reason)) {
    problems.add(`${path}.reason`, `理由は必須（仕様書11章）。${NORMALIZED_STRING_MESSAGE}`);
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
