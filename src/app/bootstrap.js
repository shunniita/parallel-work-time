/**
 * 起動時の初期化とサンプルテンプレートの初回投入（仕様書5.2、8.1.6）。
 *
 * 保存先の詳細は知らない。{@link ../storage/StorageAdapter.js StorageAdapter} の
 * 操作のみを使うため、`IndexedDbAdapter` と `MemoryAdapter` のどちらでも動く。
 *
 * 現在日時と読み込んだサンプルJSONは引数で受け取る。`fetch` はここでは行わず、
 * 呼び出し側（`src/main.js`）の責務とする。テストで時刻とデータを固定するため。
 */

import { SCHEMA_VERSION } from '../config.js';
import { toIsoSecond } from '../domain/datetime.js';
import { newId } from '../domain/ids.js';
import { ENTITY_TYPE } from '../storage/StorageAdapter.js';

/**
 * 起動処理。
 *
 * サンプルテンプレートの投入は、テンプレートが1件も無いときだけ行う。利用者が
 * 全件削除した状態を復活させないため、件数0を唯一の条件とする。
 *
 * @param {import('../storage/StorageAdapter.js').StorageAdapter} adapter
 * @param {{sampleTemplates?: object|null, now?: Date}} [options]
 * @returns {Promise<{dataset: object, seededTemplateCount: number}>}
 */
export async function bootstrap(adapter, options = {}) {
  const { sampleTemplates = null, now = new Date() } = options;

  await adapter.initialize();
  let dataset = await adapter.loadAll();

  let seededTemplateCount = 0;
  if (dataset.taskTemplates.length === 0 && sampleTemplates !== null) {
    const templates = buildSeedTemplates(sampleTemplates, toIsoSecond(now));
    for (const template of templates) {
      await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, template);
    }
    seededTemplateCount = templates.length;
    if (seededTemplateCount > 0) {
      dataset = await adapter.loadAll();
    }
  }

  return { dataset, seededTemplateCount };
}

/**
 * サンプルJSONを保存できる TaskTemplate の配列へ変換する。
 *
 * `createdAt` はJSONへ持たせない。ファイル内の日付が古びると、初回起動が
 * いつだったのか分からなくなるため、投入時の日時を入れる。
 *
 * 識別子はJSONに書かれていればそれを使い、無ければ採番する。固定IDにしておくと
 * E2Eのフィクスチャが安定し、`taskDefinitionId` で版をまたいだ追跡もできる
 * （仕様書6.3）。
 *
 * @param {object} sample `data/sample-task-templates.json` の内容
 * @param {string} createdAt オフセット付きISO 8601
 * @returns {object[]}
 */
export function buildSeedTemplates(sample, createdAt) {
  if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new TypeError('サンプルテンプレートはオブジェクトである必要がある');
  }
  if (sample.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `サンプルテンプレートの schemaVersion が現行値 ${SCHEMA_VERSION} と一致しない: ${String(sample.schemaVersion)}`,
    );
  }
  if (!Array.isArray(sample.templates)) {
    throw new TypeError('サンプルテンプレートの templates は配列である必要がある');
  }

  return sample.templates.map((template) => {
    const templateSeriesId = template.templateSeriesId ?? newId();
    return {
      templateSeriesId,
      // 初版のサンプルは版1のみ。系列IDと版IDが同じ値でも、改訂時には
      // 新しい templateId が発行され系列IDは据え置かれる（仕様書6.3）。
      templateId: template.templateId ?? templateSeriesId,
      targetType: template.targetType,
      variant: template.variant,
      version: template.version ?? 1,
      active: template.active ?? true,
      createdAt,
      tasks: (template.tasks ?? []).map((task) => ({
        taskDefinitionId: task.taskDefinitionId ?? newId(),
        name: task.name,
        externalCode: task.externalCode ?? null,
        order: task.order,
        active: task.active ?? true,
      })),
    };
  });
}
