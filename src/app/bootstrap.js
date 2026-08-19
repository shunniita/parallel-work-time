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
 * サンプルテンプレートを投入するのは、まだ一度も投入していないときだけである。
 * 投入したかどうかは `settings.sampleTemplatesSeededAt` に持つ。
 *
 * テンプレートの件数では判定しない。利用者はテンプレートを削除できるため
 * （仕様書8.1.11）、件数0を条件にすると全件削除した状態が次の起動で元へ戻る。
 * 件数は「今そこに何があるか」であって「投入済みかどうか」ではない。
 *
 * 印が無い既存の利用者は、この版を最初に起動した時点で押す。投入せずに押すこと
 * になるが、その利用者は既にサンプルを受け取っている（この版より前は件数0で
 * 判定しており、初回に必ず投入されていた）。
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
  const seeded = dataset.settings?.sampleTemplatesSeededAt ?? null;
  if (seeded === null && sampleTemplates !== null) {
    const seededAt = toIsoSecond(now);
    // 印だけは常に押す。既にテンプレートを持っている利用者へ投入はしないが、
    // 印が無いままだと全件削除したときに投入条件へ戻ってしまう。
    const templates =
      dataset.taskTemplates.length === 0 ? buildSeedTemplates(sampleTemplates, seededAt) : [];

    // 1トランザクションで全か無かにする。投入と印が別々に書かれると、印だけが
    // 残ってサンプルを二度と受け取れない状態や、投入だけが残って次回また
    // 投入される状態が作れてしまう。
    await adapter.saveEntities([
      ...templates.map((template) => ({ type: ENTITY_TYPE.TASK_TEMPLATES, entity: template })),
      {
        type: ENTITY_TYPE.SETTINGS,
        entity: { ...dataset.settings, sampleTemplatesSeededAt: seededAt },
      },
    ]);
    seededTemplateCount = templates.length;
    dataset = await adapter.loadAll();
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
