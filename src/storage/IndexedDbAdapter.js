/**
 * IndexedDB による保存アダプター。初版の実装（仕様書5.2、5.3）。
 *
 * 呼び出し側はこのクラスのメソッドしか使わない。IndexedDB API の作法
 * （リクエストのイベント、トランザクションの自動コミット）はここへ閉じ込める。
 *
 * トランザクションの扱いに注意点がある。IndexedDB のトランザクションは
 * 保留中のリクエストが無くなった時点で自動コミットされるため、リクエストの
 * 発行と発行の間に `await` を挟むとトランザクションが閉じてしまう。本実装では
 * 1つのトランザクション内で必要なリクエストをすべて同期的に発行し、完了だけを
 * `await` する形に揃えている。これにより関連書き込みが同一トランザクションへ
 * まとまる（仕様書9.1）。
 */

import { DB_NAME, DB_VERSION, createDefaultSettings } from '../config.js';
import { toIsoSecond } from '../domain/datetime.js';
import { validateImport } from '../domain/integrity.js';
import {
  COLLECTION_TYPES,
  ENTITY_TYPE,
  KEY_PATH,
  STORAGE_ERROR_KIND,
  SETTINGS_KEY,
  StorageAdapter,
  StorageError,
  assertKnownType,
  createEmptyDataset,
  entityKeyOf,
  normalizeSaveEntries,
  toExportPayload,
  toStorageError,
} from './StorageAdapter.js';

/** 全ストア名。全置換と読み込みで同一トランザクションへまとめる対象。 */
const ALL_STORES = Object.values(ENTITY_TYPE);

/**
 * トランザクションの完了を待つ。
 *
 * `abort` は書き込みが取り消されたことを意味するため、成功として扱わない。
 *
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('トランザクションが中断された'));
  });
}

/**
 * トランザクション内で失敗したリクエストの例外を保持する入れ物を作る。
 *
 * トランザクションの `error` は中断処理の途中で設定されるため、`onerror` の
 * 時点では未設定のことがある。実際の原因（`ConstraintError` や
 * `QuotaExceededError`）はリクエスト側にあるので、そちらを控えておき、
 * 失敗時はこちらを優先して報告する。
 *
 * `preventDefault()` は呼ばない。既定どおりトランザクションを中断させ、
 * 書き込みを残さないためである。
 *
 * @returns {{error: unknown, watch: (request: IDBRequest) => IDBRequest}}
 */
function createErrorSink() {
  const sink = {
    error: null,
    watch(request) {
      request.onerror = () => {
        // 最初の失敗が原因である。後続の失敗で上書きしない。
        if (sink.error === null) {
          sink.error = request.error;
        }
      };
      return request;
    },
  };
  return sink;
}

export class IndexedDbAdapter extends StorageAdapter {
  /**
   * @param {{dbName?: string, dbVersion?: number, indexedDB?: IDBFactory}} [options]
   *   `indexedDB` はテストで `fake-indexeddb` へ差し替えるために受け取る。
   */
  constructor(options = {}) {
    super();
    this.dbName = options.dbName ?? DB_NAME;
    this.dbVersion = options.dbVersion ?? DB_VERSION;
    this.factory = options.indexedDB ?? globalThis.indexedDB;
    /** @type {IDBDatabase|null} */
    this.db = null;
    /** @type {Promise<IDBDatabase>|null} 開きかけの接続。並行 initialize の合流先。 */
    this.opening = null;
  }

  async initialize() {
    if (this.db === null) {
      // 並行して呼ばれても接続は1つにする（レビュー指摘 C-13）。null 確認と
      // await の間に別の呼び出しが入ると、データベースを二重に開いてしまう。
      this.opening ??= this.openDatabase();
      try {
        this.db = await this.opening;
      } finally {
        this.opening = null;
      }
    }
    await this.ensureSettings();
  }

  /**
   * データベースを開き、必要ならストアと索引を作る。
   *
   * @returns {Promise<IDBDatabase>}
   */
  openDatabase() {
    if (!this.factory) {
      throw new StorageError(
        STORAGE_ERROR_KIND.UNAVAILABLE,
        'このブラウザでは IndexedDB を利用できません。プライベートウィンドウでは無効化されている場合があります。',
      );
    }
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.dbName, this.dbVersion);
      // `onblocked` で Promise を拒否しても、要求そのものは取り消せない。塞いで
      // いた接続が後から閉じれば `onsuccess` が遅れて発生する。その接続は誰の
      // 手にも渡らないまま開き続けるため、決着済みかどうかを覚えておく
      // （レビュー指摘 S11-4）。
      let settled = false;

      request.onupgradeneeded = () => upgradeSchema(request.result);
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          // 拒否済みの要求が遅れて成功した。呼び出し元へ渡す先が無いので、
          // ここで閉じる。放置すると `close()` できない接続が残り、C-13 で
          // 防ごうとした状態が別経路で生じる。
          db.close();
          return;
        }
        settled = true;
        // 別タブが新しい版で開こうとしたら、こちらの接続を手放す（レビュー指摘
        // C-13）。放置すると相手の upgrade が永久にブロックされる。閉じた後の
        // 操作は assertOpen() が明確な文言で拒む。
        db.onversionchange = () => {
          db.close();
          if (this.db === db) {
            this.db = null;
            this.closedByVersionChange = true;
          }
        };
        resolve(db);
      };
      request.onerror = () => {
        settled = true;
        reject(toStorageError(request.error, 'データベースを開く処理'));
      };
      // 別タブが旧版のまま開いていると upgrade がブロックされる。多重タブ警告
      // （仕様書8.10）とは別に、ここでも原因の分かる形で失敗させる。
      request.onblocked = () => {
        settled = true;
        reject(
          new StorageError(
            STORAGE_ERROR_KIND.UNAVAILABLE,
            'ほかのタブがデータベースを使用中のため開けません。ほかのタブを閉じてから再読み込みしてください。',
          ),
        );
      };
    });
  }

  /**
   * 設定が未保存であれば既定値を書き込む（冪等）。
   *
   * @returns {Promise<void>}
   */
  async ensureSettings() {
    const existing = await this.runRead(ENTITY_TYPE.SETTINGS, (store) =>
      store.get(SETTINGS_KEY),
    );
    if (existing === undefined) {
      await this.saveEntity(ENTITY_TYPE.SETTINGS, createDefaultSettings());
    }
  }

  async loadAll() {
    const db = this.assertOpen();
    const dataset = createEmptyDataset();
    try {
      // 全ストアを1つの読み取りトランザクションで読む。読み込み中に他の
      // 書き込みが割り込んで、ストア間で食い違った内容を読まないようにする。
      const tx = db.transaction(ALL_STORES, 'readonly');
      const settingsRequest = tx.objectStore(ENTITY_TYPE.SETTINGS).get(SETTINGS_KEY);
      const collectionRequests = COLLECTION_TYPES.map((type) => ({
        type,
        request: tx.objectStore(type).getAll(),
      }));
      await transactionDone(tx);

      dataset.settings = settingsRequest.result ?? null;
      for (const { type, request } of collectionRequests) {
        dataset[type] = request.result ?? [];
      }
      return dataset;
    } catch (error) {
      throw toStorageError(error, 'データの読み込み');
    }
  }

  async saveEntity(type, entity) {
    assertKnownType(type);
    const key = entityKeyOf(type, entity);
    const db = this.assertOpen();
    const sink = createErrorSink();
    try {
      const tx = db.transaction([type], 'readwrite');
      const store = tx.objectStore(type);
      // 設定ストアだけ主キーを外から与える（固定キーのため、仕様書6.2）。
      sink.watch(type === ENTITY_TYPE.SETTINGS ? store.put(entity, key) : store.put(entity));
      await transactionDone(tx);
    } catch (error) {
      throw toStorageError(sink.error ?? error, `${type} の保存`);
    }
  }

  async saveEntities(entries) {
    const normalized = normalizeSaveEntries(entries);
    if (normalized.length === 0) {
      return;
    }
    const db = this.assertOpen();
    // 関与するストアだけをトランザクションの対象にする。無関係なストアを
    // 含めると、その間ほかの書き込みを不要に待たせる。
    const stores = [...new Set(normalized.map((entry) => entry.type))];
    const sink = createErrorSink();
    try {
      const tx = db.transaction(stores, 'readwrite');
      for (const { type, entity, key, remove } of normalized) {
        const store = tx.objectStore(type);
        if (remove) {
          sink.watch(store.delete(key));
          continue;
        }
        sink.watch(type === ENTITY_TYPE.SETTINGS ? store.put(entity, key) : store.put(entity));
      }
      await transactionDone(tx);
    } catch (error) {
      throw toStorageError(sink.error ?? error, `${stores.join(' / ')} の一括保存`);
    }
  }

  async deleteEntity(type, id) {
    assertKnownType(type);
    if (type === ENTITY_TYPE.SETTINGS) {
      throw new StorageError(
        STORAGE_ERROR_KIND.VALIDATION,
        '設定は削除できない。値の変更は saveEntity で行う。',
      );
    }
    const db = this.assertOpen();
    const sink = createErrorSink();
    try {
      const tx = db.transaction([type], 'readwrite');
      // 存在しないキーの delete は IndexedDB では成功する。呼び出し側で
      // 事前の存在確認を要らなくするため、そのまま冪等な操作として扱う。
      sink.watch(tx.objectStore(type).delete(id));
      await transactionDone(tx);
    } catch (error) {
      throw toStorageError(sink.error ?? error, `${type} の削除`);
    }
  }

  async exportAll(options = {}) {
    const dataset = await this.loadAll();
    const exportedAt = options.exportedAt ?? toIsoSecond(new Date());
    return toExportPayload(dataset, exportedAt);
  }

  async importAll(data) {
    const db = this.assertOpen();
    const result = validateImport(data);
    if (!result.ok) {
      // 検証は書き込みの前に済ませる。ここで投げれば既存データは触っていない
      // （仕様書9.3）。
      throw new StorageError(
        result.schemaMismatch
          ? STORAGE_ERROR_KIND.SCHEMA_MISMATCH
          : STORAGE_ERROR_KIND.VALIDATION,
        result.schemaMismatch
          ? 'スキーマ版が一致しないため取り込めません。'
          : 'JSONの内容が不正なため取り込めません。',
        { details: result.errors },
      );
    }

    // 主キーの取り出しも書き込み前に済ませる。トランザクション開始後に
    // 例外を投げると、一部のストアだけ clear された状態で中断されうる。
    const keyed = COLLECTION_TYPES.map((type) => ({
      type,
      entities: data[type].map((entity) => ({ key: entityKeyOf(type, entity), entity })),
    }));

    const sink = createErrorSink();
    try {
      // 全ストアの clear と put を1つの書き込みトランザクションで行う。
      // 途中で失敗すればすべて巻き戻り、部分反映しない（仕様書9.1、9.3）。
      const tx = db.transaction(ALL_STORES, 'readwrite');
      const settingsStore = tx.objectStore(ENTITY_TYPE.SETTINGS);
      sink.watch(settingsStore.clear());
      sink.watch(settingsStore.put(data.settings, SETTINGS_KEY));
      for (const { type, entities } of keyed) {
        const store = tx.objectStore(type);
        sink.watch(store.clear());
        for (const { entity } of entities) {
          sink.watch(store.put(entity));
        }
      }
      await transactionDone(tx);
    } catch (error) {
      throw toStorageError(sink.error ?? error, 'データの取り込み');
    }
  }

  /**
   * 対象種別・バリエーションの作業テンプレートを索引で引く。
   *
   * 複合索引は `[targetType, variant]` までとし、`active` は取得後に
   * メモリ上で絞り込む。IndexedDB の有効なキー型は number / string / Date /
   * ArrayBuffer / Array であり boolean を含まないため、`active` を複合索引の
   * キーパスへ加えると該当レコードが例外なく索引から除外される。
   *
   * @param {string} targetType
   * @param {string} variant
   * @param {{activeOnly?: boolean}} [options] `activeOnly` の既定は false
   * @returns {Promise<object[]>}
   */
  async findTaskTemplates(targetType, variant, options = {}) {
    const db = this.assertOpen();
    try {
      const tx = db.transaction([ENTITY_TYPE.TASK_TEMPLATES], 'readonly');
      const index = tx.objectStore(ENTITY_TYPE.TASK_TEMPLATES).index('byTargetVariant');
      const request = index.getAll([targetType, variant]);
      await transactionDone(tx);
      const templates = request.result ?? [];
      return options.activeOnly === true
        ? templates.filter((template) => template.active === true)
        : templates;
    } catch (error) {
      throw toStorageError(error, '作業テンプレートの検索');
    }
  }

  /**
   * 版系列に属する全版の作業テンプレートを返す（仕様書6.3）。
   *
   * @param {string} templateSeriesId
   * @returns {Promise<object[]>}
   */
  async findTemplateSeries(templateSeriesId) {
    const db = this.assertOpen();
    try {
      const tx = db.transaction([ENTITY_TYPE.TASK_TEMPLATES], 'readonly');
      const index = tx.objectStore(ENTITY_TYPE.TASK_TEMPLATES).index('bySeries');
      const request = index.getAll(templateSeriesId);
      await transactionDone(tx);
      return request.result ?? [];
    } catch (error) {
      throw toStorageError(error, '作業テンプレート版系列の検索');
    }
  }

  /**
   * 案件グループを利用者入力の案件IDで引く（仕様書8.2.6 の一意性検証）。
   *
   * @param {string} projectId
   * @returns {Promise<object|null>}
   */
  async findProjectGroupByProjectId(projectId) {
    const db = this.assertOpen();
    try {
      const tx = db.transaction([ENTITY_TYPE.PROJECT_GROUPS], 'readonly');
      const index = tx.objectStore(ENTITY_TYPE.PROJECT_GROUPS).index('byProjectId');
      const request = index.get(projectId);
      await transactionDone(tx);
      return request.result ?? null;
    } catch (error) {
      throw toStorageError(error, '案件IDの検索');
    }
  }

  /**
   * 単一ストアの読み取りを1件だけ行う小さな補助。
   *
   * @param {string} type
   * @param {(store: IDBObjectStore) => IDBRequest} build
   * @returns {Promise<any>}
   */
  async runRead(type, build) {
    const db = this.assertOpen();
    try {
      const tx = db.transaction([type], 'readonly');
      const request = build(tx.objectStore(type));
      await transactionDone(tx);
      return request.result;
    } catch (error) {
      throw toStorageError(error, `${type} の読み込み`);
    }
  }

  /**
   * @returns {IDBDatabase}
   */
  assertOpen() {
    if (this.db === null) {
      throw new StorageError(
        STORAGE_ERROR_KIND.UNAVAILABLE,
        this.closedByVersionChange
          ? '別のタブがデータベースを更新したため、この接続は閉じられました。再読み込みしてください。'
          : 'initialize() を先に呼ぶ必要がある',
      );
    }
    return this.db;
  }

  async close() {
    if (this.db !== null) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * ストアと索引を作る。`onupgradeneeded` から呼ぶ。
 *
 * 索引に boolean を含めない。IndexedDB の有効なキー型は number / string /
 * Date / ArrayBuffer / Array であり、キーパスが boolean を返すとそのレコードは
 * 索引へ入らない。`active`（作業テンプレートの有効版）と `manuallyAdded` が
 * 該当するため、いずれも索引にしていない（実装計画3.1）。
 *
 * @param {IDBDatabase} db
 */
function upgradeSchema(db) {
  // 設定は固定キー1件のみ。keyPath を持たず、put 時にキーを外から与える。
  if (!db.objectStoreNames.contains(ENTITY_TYPE.SETTINGS)) {
    db.createObjectStore(ENTITY_TYPE.SETTINGS);
  }

  if (!db.objectStoreNames.contains(ENTITY_TYPE.TASK_TEMPLATES)) {
    const store = db.createObjectStore(ENTITY_TYPE.TASK_TEMPLATES, {
      keyPath: KEY_PATH[ENTITY_TYPE.TASK_TEMPLATES],
    });
    store.createIndex('bySeries', 'templateSeriesId');
    store.createIndex('byTargetVariant', ['targetType', 'variant']);
  }

  if (!db.objectStoreNames.contains(ENTITY_TYPE.PROJECT_GROUPS)) {
    const store = db.createObjectStore(ENTITY_TYPE.PROJECT_GROUPS, {
      keyPath: KEY_PATH[ENTITY_TYPE.PROJECT_GROUPS],
    });
    // 案件IDは一意（仕様書8.2.6）。索引側でも一意制約を掛け、検証漏れが
    // あっても重複が保存されないようにする。
    store.createIndex('byProjectId', 'projectId', { unique: true });
  }

  if (!db.objectStoreNames.contains(ENTITY_TYPE.WORK_RUNS)) {
    const store = db.createObjectStore(ENTITY_TYPE.WORK_RUNS, {
      keyPath: KEY_PATH[ENTITY_TYPE.WORK_RUNS],
    });
    store.createIndex('byProjectGroup', 'projectGroupId');
    store.createIndex('byStatus', 'status');
    store.createIndex('byWorkDate', 'workDate');
  }

  if (!db.objectStoreNames.contains(ENTITY_TYPE.CHANGE_HISTORY)) {
    const store = db.createObjectStore(ENTITY_TYPE.CHANGE_HISTORY, {
      keyPath: KEY_PATH[ENTITY_TYPE.CHANGE_HISTORY],
    });
    store.createIndex('byTarget', 'targetId');
    store.createIndex('byTimestamp', 'timestamp');
  }
}

export { transactionDone, upgradeSchema };
