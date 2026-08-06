/**
 * 保存アダプターのインターフェース定義（仕様書5.3）。
 *
 * 画面処理・計算処理は IndexedDB API を直接呼ばず、必ずこの6操作を経由する。
 *
 *   initialize()
 *   loadAll()
 *   saveEntity(type, entity)
 *   deleteEntity(type, id)
 *   exportAll()
 *   importAll(data)
 *
 * 初版の実装は {@link ../storage/IndexedDbAdapter.js IndexedDbAdapter} であり、
 * テストでは {@link ../storage/MemoryAdapter.js MemoryAdapter} へ差し替える。
 * 将来の保存先変更もアダプターの差し替えで対応する。
 */

import { SCHEMA_VERSION } from '../config.js';

/**
 * 保存対象の種別。IndexedDB のオブジェクトストア名と一致させる（実装計画3.1）。
 */
export const ENTITY_TYPE = {
  SETTINGS: 'settings',
  TASK_TEMPLATES: 'taskTemplates',
  PROJECT_GROUPS: 'projectGroups',
  WORK_RUNS: 'workRuns',
  CHANGE_HISTORY: 'changeHistory',
};

/** 一覧を保持する種別（設定を除く4種別）。読み書きの反復に使う。 */
export const COLLECTION_TYPES = [
  ENTITY_TYPE.TASK_TEMPLATES,
  ENTITY_TYPE.PROJECT_GROUPS,
  ENTITY_TYPE.WORK_RUNS,
  ENTITY_TYPE.CHANGE_HISTORY,
];

/** 種別ごとの主キー名（実装計画3.1）。 */
export const KEY_PATH = {
  [ENTITY_TYPE.TASK_TEMPLATES]: 'templateId',
  [ENTITY_TYPE.PROJECT_GROUPS]: 'projectGroupId',
  [ENTITY_TYPE.WORK_RUNS]: 'runId',
  [ENTITY_TYPE.CHANGE_HISTORY]: 'historyId',
};

/** 設定ストアの固定キー。設定は常に1件（仕様書6.2）。 */
export const SETTINGS_KEY = 'singleton';

/**
 * 保存処理の失敗種別。
 *
 * 画面側は `kind` を見て案内を切り替える。特に `quota` は
 * JSONエクスポートと不要データ削除を促す対象である（仕様書9.1）。
 */
export const STORAGE_ERROR_KIND = {
  /** IndexedDB が使えない、または開けない。 */
  UNAVAILABLE: 'unavailable',
  /** 容量超過（`QuotaExceededError`）。仕様書9.1。 */
  QUOTA: 'quota',
  /** 引数・データ形状の誤り。呼び出し側の不具合またはインポートJSONの不備。 */
  VALIDATION: 'validation',
  /** インポートJSONの `schemaVersion` が現行値と一致しない（仕様書9.3）。 */
  SCHEMA_MISMATCH: 'schemaMismatch',
  /** 一意制約違反。案件IDの重複（仕様書8.2.6）が該当する。 */
  CONSTRAINT: 'constraint',
  /** 上記以外の書き込み・読み込み失敗。 */
  UNKNOWN: 'unknown',
};

/**
 * 保存処理の失敗を表す例外。
 *
 * 元の例外は `cause` へ保持し、画面表示には `message` と `kind` を使う。
 */
export class StorageError extends Error {
  /**
   * @param {string} kind {@link STORAGE_ERROR_KIND} のいずれか
   * @param {string} message 利用者へ提示できる説明
   * @param {{cause?: unknown, details?: string[]}} [options]
   */
  constructor(kind, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'StorageError';
    this.kind = kind;
    /** 検証失敗の内訳。`validation` および `schemaMismatch` で使う。 */
    this.details = options.details ?? [];
  }
}

/**
 * 例外を {@link StorageError} へ変換する。
 *
 * `QuotaExceededError` を取りこぼすと保存失敗が沈黙し、記録の欠落に
 * 気づけないため、名称で判定して `quota` へ振り分ける（仕様書9.1）。
 * ブラウザによっては `DOMException` ではなく独自のエラーを投げるため、
 * `name` と `code` の両方を見る。
 *
 * @param {unknown} error
 * @param {string} context 失敗した操作の説明
 * @returns {StorageError}
 */
export function toStorageError(error, context) {
  if (error instanceof StorageError) {
    return error;
  }
  const name = error && typeof error === 'object' ? error.name : undefined;
  // 22 は旧仕様の QUOTA_EXCEEDED_ERR。現行ブラウザは name で判定できるが、
  // 古い実装のために code も見る。
  const isQuota = name === 'QuotaExceededError' || error?.code === 22;
  if (isQuota) {
    return new StorageError(
      STORAGE_ERROR_KIND.QUOTA,
      `保存領域が不足しています（${context}）。JSONへエクスポートし、不要なデータを削除してください。`,
      { cause: error },
    );
  }
  // 一意索引への重複書き込み。IndexedDB は ConstraintError を投げる。
  // MemoryAdapter は同じ状況を自前で検出して同じ kind の例外を投げるため、
  // 呼び出し側は実装の違いを気にしなくてよい。
  if (name === 'ConstraintError') {
    return new StorageError(
      STORAGE_ERROR_KIND.CONSTRAINT,
      `一意制約に違反しています（${context}）。`,
      { cause: error },
    );
  }
  return new StorageError(
    STORAGE_ERROR_KIND.UNKNOWN,
    `${context}に失敗しました: ${error?.message ?? String(error)}`,
    { cause: error },
  );
}

/**
 * 種別名が既知かどうかを検証し、不正なら例外を投げる。
 *
 * @param {string} type
 * @returns {string} 検証済みの種別名
 */
export function assertKnownType(type) {
  if (!Object.values(ENTITY_TYPE).includes(type)) {
    throw new StorageError(
      STORAGE_ERROR_KIND.VALIDATION,
      `未知の保存種別: ${String(type)}`,
    );
  }
  return type;
}

/**
 * エンティティから主キーの値を取り出す。
 *
 * 設定は固定キーであり、エンティティ側にキーを持たない。
 *
 * @param {string} type
 * @param {object} entity
 * @returns {string}
 */
export function entityKeyOf(type, entity) {
  assertKnownType(type);
  if (type === ENTITY_TYPE.SETTINGS) {
    return SETTINGS_KEY;
  }
  if (entity === null || typeof entity !== 'object') {
    throw new StorageError(
      STORAGE_ERROR_KIND.VALIDATION,
      `${type} へ保存する値はオブジェクトである必要がある`,
    );
  }
  const keyPath = KEY_PATH[type];
  const key = entity[keyPath];
  if (typeof key !== 'string' || key === '') {
    throw new StorageError(
      STORAGE_ERROR_KIND.VALIDATION,
      `${type} には非空文字列の ${keyPath} が必要`,
    );
  }
  return key;
}

/**
 * `saveEntities` の引数を検証し、主キーを添えて返す。
 *
 * 書き込みを始める前にすべての主キーを取り出しておく。トランザクション開始後に
 * 例外を投げると、一部だけ書き込まれた状態で中断されうるためである。
 *
 * @param {unknown} entries
 * @returns {{type: string, entity: object, key: string}[]}
 */
export function normalizeSaveEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new StorageError(
      STORAGE_ERROR_KIND.VALIDATION,
      'saveEntities() には {type, entity} の配列が必要',
    );
  }
  return entries.map((entry) => {
    if (entry === null || typeof entry !== 'object') {
      throw new StorageError(
        STORAGE_ERROR_KIND.VALIDATION,
        'saveEntities() の要素は {type, entity} である必要がある',
      );
    }
    assertKnownType(entry.type);
    return {
      type: entry.type,
      entity: entry.entity,
      key: entityKeyOf(entry.type, entry.entity),
    };
  });
}

/**
 * 空のデータセットを返す。
 *
 * `settings` は初期化時に既定値で埋めるため、ここでは null を置く。
 *
 * @returns {{settings: object|null, taskTemplates: object[], projectGroups: object[],
 *            workRuns: object[], changeHistory: object[]}}
 */
export function createEmptyDataset() {
  return {
    settings: null,
    taskTemplates: [],
    projectGroups: [],
    workRuns: [],
    changeHistory: [],
  };
}

/**
 * データセットをエクスポートJSONの形へ包む（仕様書9.2）。
 *
 * `schemaVersion` の値の正は `src/config.js` の定数である（仕様書6.2）。
 *
 * @param {object} dataset {@link createEmptyDataset} と同じ形
 * @param {string} exportedAt オフセット付きISO 8601
 * @returns {object}
 */
export function toExportPayload(dataset, exportedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    settings: dataset.settings,
    taskTemplates: dataset.taskTemplates,
    projectGroups: dataset.projectGroups,
    workRuns: dataset.workRuns,
    changeHistory: dataset.changeHistory,
  };
}

/**
 * 保存アダプターの基底クラス。
 *
 * 実装漏れを実行時に気づけるよう、すべての操作を未実装例外にしてある。
 * JavaScript にインターフェース構文がないため、この形で契約を表す。
 */
export class StorageAdapter {
  /**
   * 保存先を使える状態にする。
   *
   * 複数回呼んでも安全（冪等）とする。設定が未保存であれば既定値を書き込む。
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('initialize() は実装が必要');
  }

  /**
   * 全データを読み込む。
   *
   * ## 実装が守る契約（レビュー指摘 C-9）
   *
   * - **並び順**: 各コレクションは主キーの昇順で返す。IndexedDB の `getAll()` が
   *   この順で返すため、実装側の都合ではなくこちらを契約とした。順序を約束して
   *   おかないと、`MemoryAdapter` で書いたテストが通るのに `IndexedDbAdapter`
   *   では別の順になる、という形の差が残る。
   * - **設定の欠落**: 保存された設定が無ければ `settings` は `null` とする
   *   （`undefined` ではない）。呼び出し側が `settings === null` の1つの形だけを
   *   見ればよいようにする。`initialize()` が既定値を書き、`deleteEntity()` は
   *   設定の削除を拒むため、この状態へは現在の公開APIから到達しない。契約テスト
   *   が無いのはそのためで、実装をそろえてあるのは防御である。
   *
   * ただし**画面が並び順をこの契約に頼ってはならない**。主キーはUUIDであり、
   * 昇順に意味は無い。表示順・外部項目コード順・時刻順はいずれも表示側で明示的に
   * 並べ替える（`naturalSort.js`、`compareIso`）。ここで順序を定めるのは、
   * 2つの実装の間で結果が食い違わないようにするためだけである。
   *
   * @returns {Promise<{settings: object|null, taskTemplates: object[],
   *                    projectGroups: object[], workRuns: object[],
   *                    changeHistory: object[]}>}
   */
  async loadAll() {
    throw new Error('loadAll() は実装が必要');
  }

  /**
   * エンティティ1件を保存する。同じキーが存在すれば置き換える。
   *
   * @param {string} type {@link ENTITY_TYPE} のいずれか
   * @param {object} entity
   * @returns {Promise<void>}
   */
  async saveEntity(type, entity) {
    throw new Error('saveEntity() は実装が必要');
  }

  /**
   * 複数のエンティティをまとめて保存する。
   *
   * 一連の関連書き込みを同一トランザクションへまとめるための操作である
   * （仕様書9.1）。1件でも失敗すれば全件を反映しない。テンプレート改訂のように
   * 「新版の追加」と「旧版の無効化」が同時に成立しなければ整合しない場面で使う。
   *
   * @param {{type: string, entity: object}[]} entries
   * @returns {Promise<void>}
   */
  async saveEntities(entries) {
    throw new Error('saveEntities() は実装が必要');
  }

  /**
   * エンティティ1件を削除する。存在しないキーでも失敗させない。
   *
   * @param {string} type
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteEntity(type, id) {
    throw new Error('deleteEntity() は実装が必要');
  }

  /**
   * エクスポートJSONの内容を返す（仕様書9.2）。
   *
   * @param {{exportedAt?: string}} [options] `exportedAt` を渡すと現在時刻を参照しない
   * @returns {Promise<object>}
   */
  async exportAll(options) {
    throw new Error('exportAll() は実装が必要');
  }

  /**
   * エクスポートJSONで全データを置き換える（仕様書9.3）。
   *
   * 差分マージは行わない。検証に失敗した場合は既存データを一切変更しない。
   *
   * @param {object} data
   * @returns {Promise<void>}
   */
  async importAll(data) {
    throw new Error('importAll() は実装が必要');
  }

  /**
   * 対象種別・バリエーションの作業テンプレートを引く。
   *
   * `activeOnly` の絞り込みは索引ではなく取得後のメモリ上で行う。IndexedDB の
   * 有効なキー型は number / string / Date / ArrayBuffer / Array であり boolean を
   * 含まないため、`active` を複合索引のキーパスへ加えると該当レコードが例外なく
   * 索引から除外される（実装計画3.1）。
   *
   * @param {string} targetType
   * @param {string} variant
   * @param {{activeOnly?: boolean}} [options] `activeOnly` の既定は false
   * @returns {Promise<object[]>}
   */
  async findTaskTemplates(targetType, variant, options) {
    throw new Error('findTaskTemplates() は実装が必要');
  }

  /**
   * 版系列に属する全版の作業テンプレートを返す（仕様書6.3）。
   *
   * @param {string} templateSeriesId
   * @returns {Promise<object[]>}
   */
  async findTemplateSeries(templateSeriesId) {
    throw new Error('findTemplateSeries() は実装が必要');
  }

  /**
   * 案件グループを利用者入力の案件IDで引く（仕様書8.2.6 の一意性検証）。
   *
   * @param {string} projectId
   * @returns {Promise<object|null>}
   */
  async findProjectGroupByProjectId(projectId) {
    throw new Error('findProjectGroupByProjectId() は実装が必要');
  }

  /**
   * 保存先を閉じる。テストと再初期化のために用意する。
   *
   * @returns {Promise<void>}
   */
  async close() {}
}
