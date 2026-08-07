/**
 * メモリ上に保持する保存アダプター。テスト用（実装計画4.1）。
 *
 * {@link ./IndexedDbAdapter.js IndexedDbAdapter} と同一の契約を満たす。
 * 両者は同じ結合テストスイートへ通す（実装計画8.2）。
 *
 * IndexedDB は値を構造化複製して保存するため、呼び出し側が後から
 * オブジェクトを書き換えても保存内容は変わらない。この振る舞いの差が
 * テストと本番で出ないよう、本実装も出入りの両方で複製する。
 */

import { createDefaultSettings } from '../config.js';
import { validateImport } from '../domain/integrity.js';
import { toIsoSecond } from '../domain/datetime.js';
import {
  COLLECTION_TYPES,
  ENTITY_TYPE,
  STORAGE_ERROR_KIND,
  SETTINGS_KEY,
  StorageAdapter,
  StorageError,
  assertKnownType,
  createEmptyDataset,
  entityKeyOf,
  normalizeSaveEntries,
  toExportPayload,
} from './StorageAdapter.js';

function clone(value) {
  return structuredClone(value);
}

/**
 * ストアの中身を主キーの昇順で返す（`StorageAdapter.loadAll()` の契約）。
 *
 * IndexedDB の `getAll()` はキー昇順で返す。`Map` は挿入順なので、そのままでは
 * 2つの実装で並びが食い違う（レビュー指摘 C-9）。キーはすべて文字列である。
 *
 * @param {Map<string, object>} store
 * @returns {object[]}
 */
function sortedByKey(store) {
  return [...store.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, entity]) => entity);
}

/**
 * 案件グループの集まりに案件IDの重複が無いことを確かめる（仕様書8.2.6）。
 *
 * @param {Map<string, object>} groups
 */
function assertProjectIdsUnique(groups) {
  const seen = new Set();
  for (const group of groups.values()) {
    if (seen.has(group.projectId)) {
      throw new StorageError(
        STORAGE_ERROR_KIND.CONSTRAINT,
        `一意制約に違反しています（${ENTITY_TYPE.PROJECT_GROUPS} の保存）。`,
      );
    }
    seen.add(group.projectId);
  }
}

export class MemoryAdapter extends StorageAdapter {
  constructor() {
    super();
    /** @type {Map<string, Map<string, object>>} 種別 → キー → エンティティ */
    this.stores = new Map();
    for (const type of Object.values(ENTITY_TYPE)) {
      this.stores.set(type, new Map());
    }
    this.initialized = false;
  }

  async initialize() {
    // 冪等。既に設定があれば上書きしない。
    const settings = this.stores.get(ENTITY_TYPE.SETTINGS);
    if (!settings.has(SETTINGS_KEY)) {
      settings.set(SETTINGS_KEY, createDefaultSettings());
    }
    this.initialized = true;
  }

  async loadAll() {
    this.assertInitialized();
    const dataset = createEmptyDataset();
    // 設定が無ければ `null` を返す。`Map#get` の `undefined` をそのまま流すと
    // `IndexedDbAdapter`（`?? null`）と形が違い、呼び出し側が両方を書き分ける
    // ことになる（レビュー指摘 C-9）。
    const settings = this.stores.get(ENTITY_TYPE.SETTINGS).get(SETTINGS_KEY);
    dataset.settings = settings === undefined ? null : clone(settings);
    for (const type of COLLECTION_TYPES) {
      // 主キーの昇順で返す。`Map` の挿入順のままだと IndexedDB の `getAll()` と
      // 並びが違い、`MemoryAdapter` で書いたテストが通るのに実装では別の順に
      // なる差が残る（C-9）。
      dataset[type] = sortedByKey(this.stores.get(type)).map(clone);
    }
    return dataset;
  }

  async saveEntity(type, entity) {
    this.assertInitialized();
    assertKnownType(type);
    const key = entityKeyOf(type, entity);
    if (type === ENTITY_TYPE.PROJECT_GROUPS) {
      this.assertProjectIdUnique(entity, key);
    }
    this.stores.get(type).set(key, clone(entity));
  }

  async saveEntities(entries) {
    this.assertInitialized();
    const normalized = normalizeSaveEntries(entries);
    if (normalized.length === 0) {
      return;
    }

    // 関与するストアだけを写し取り、そこへ全件を適用してから検査する。
    // 検査を通ったあとに元へ差し替えるため、途中で失敗しても既存データは残る。
    const drafts = new Map();
    for (const { type } of normalized) {
      if (!drafts.has(type)) {
        drafts.set(type, new Map(this.stores.get(type)));
      }
    }
    for (const { type, entity, key } of normalized) {
      drafts.get(type).set(key, clone(entity));
    }

    // 案件IDの一意性は一括適用後の状態に対して見る。同じ案件グループの更新や、
    // 案件IDの入れ替えを含む一括保存を誤って弾かないため。
    const groupDraft = drafts.get(ENTITY_TYPE.PROJECT_GROUPS);
    if (groupDraft !== undefined) {
      assertProjectIdsUnique(groupDraft);
    }

    for (const [type, draft] of drafts) {
      this.stores.set(type, draft);
    }
  }

  /**
   * 案件IDの一意性を確かめる（仕様書8.2.6）。
   *
   * IndexedDbAdapter は `byProjectId` 索引の一意制約で同じ状況を弾く。両実装で
   * 同じ例外になるよう、こちらでも走査して検出する。
   *
   * @param {object} entity
   * @param {string} key
   */
  assertProjectIdUnique(entity, key) {
    for (const [existingKey, existing] of this.stores.get(ENTITY_TYPE.PROJECT_GROUPS)) {
      if (existingKey !== key && existing.projectId === entity.projectId) {
        throw new StorageError(
          STORAGE_ERROR_KIND.CONSTRAINT,
          `一意制約に違反しています（${ENTITY_TYPE.PROJECT_GROUPS} の保存）。`,
        );
      }
    }
  }

  async deleteEntity(type, id) {
    this.assertInitialized();
    assertKnownType(type);
    if (type === ENTITY_TYPE.SETTINGS) {
      throw new StorageError(
        STORAGE_ERROR_KIND.VALIDATION,
        '設定は削除できない。値の変更は saveEntity で行う。',
      );
    }
    // 存在しないキーでも失敗させない。
    this.stores.get(type).delete(id);
  }

  async exportAll(options = {}) {
    const dataset = await this.loadAll();
    const exportedAt = options.exportedAt ?? toIsoSecond(new Date());
    return toExportPayload(dataset, exportedAt);
  }

  async importAll(data) {
    this.assertInitialized();
    const result = validateImport(data);
    if (!result.ok) {
      // 検証失敗時は既存データを一切変更しない（仕様書9.3）。
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

    const next = new Map();
    for (const type of Object.values(ENTITY_TYPE)) {
      next.set(type, new Map());
    }
    next.get(ENTITY_TYPE.SETTINGS).set(SETTINGS_KEY, clone(data.settings));
    for (const type of COLLECTION_TYPES) {
      for (const entity of data[type]) {
        next.get(type).set(entityKeyOf(type, entity), clone(entity));
      }
    }
    // 全置換は最後の代入1回で行う。途中で失敗しても既存データは残る。
    this.stores = next;
  }

  /**
   * 対象種別・バリエーションの作業テンプレートを引く。
   *
   * `activeOnly` は取得後のメモリ上で絞り込む。IndexedDbAdapter が boolean を
   * 索引へ含められないため（実装計画3.1）、同じ絞り込み方に揃えてある。
   *
   * @param {string} targetType
   * @param {string} variant
   * @param {{activeOnly?: boolean}} [options]
   * @returns {Promise<object[]>}
   */
  async findTaskTemplates(targetType, variant, options = {}) {
    this.assertInitialized();
    const matched = [...this.stores.get(ENTITY_TYPE.TASK_TEMPLATES).values()].filter(
      (template) => template.targetType === targetType && template.variant === variant,
    );
    const filtered =
      options.activeOnly === true
        ? matched.filter((template) => template.active === true)
        : matched;
    return filtered.map(clone);
  }

  async findTemplateSeries(templateSeriesId) {
    this.assertInitialized();
    return [...this.stores.get(ENTITY_TYPE.TASK_TEMPLATES).values()]
      .filter((template) => template.templateSeriesId === templateSeriesId)
      .map(clone);
  }

  async findProjectGroupByProjectId(projectId) {
    this.assertInitialized();
    for (const group of this.stores.get(ENTITY_TYPE.PROJECT_GROUPS).values()) {
      if (group.projectId === projectId) {
        return clone(group);
      }
    }
    return null;
  }

  assertInitialized() {
    if (!this.initialized) {
      throw new StorageError(
        STORAGE_ERROR_KIND.UNAVAILABLE,
        'initialize() を先に呼ぶ必要がある',
      );
    }
  }
}
