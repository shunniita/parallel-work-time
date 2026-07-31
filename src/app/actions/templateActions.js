/**
 * 作業テンプレートの登録と改訂（仕様書8.1、6.3）。
 *
 * 検証と組み立ては `src/domain/` の純関数へ委ね、ここは順序と保存だけを持つ。
 * 依存は引数で受け取り、テストで時刻とID生成を固定できるようにする。
 *
 * 検証に失敗した場合は保存を呼ばない。`ValidationError` を投げるので、画面は
 * `errors` をそのまま表示できる。
 */

import { newId as defaultNewId } from '../../domain/ids.js';
import { toIsoSecond } from '../../domain/datetime.js';
import {
  activeTemplates,
  buildTemplate,
  deactivate,
  reviseTemplate,
} from '../../domain/templateOps.js';
import {
  validateTemplateDraft,
  validateTemplateIsNew,
} from '../../domain/validation.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';

/**
 * 入力検証で保存を拒否したことを表す例外。
 *
 * 保存層の `StorageError` とは別にしてある。保存領域の問題と入力の問題は
 * 画面での扱いが違い、後者は入力を保持したまま直させたいため。
 */
export class ValidationError extends Error {
  /**
   * @param {string[]} errors 「場所: 説明」形式
   */
  constructor(errors) {
    super(errors.join(' / '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * 依存を既定値で補う。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date,
 *          newId?: () => string}} deps
 */
function resolveDeps(deps) {
  return {
    adapter: deps.adapter,
    persistence: deps.persistence,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? defaultNewId,
  };
}

/**
 * 新しい作業テンプレートを登録する（仕様書8.1.1、8.1.2）。
 *
 * 同一の対象種別 × バリエーションに有効版が既にある場合は拒否する。内容を
 * 変えたいときは改訂して版を繰り上げる経路を使う。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date, newId?: () => string}} deps
 * @param {{targetType: string, variant: string, tasks: object[]}} draft
 * @returns {Promise<{dataset: object, template: object}>}
 */
export async function createTemplate(deps, draft) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const shape = validateTemplateDraft(draft);
  if (!shape.ok) {
    throw new ValidationError(shape.errors);
  }

  const { taskTemplates } = await adapter.loadAll();
  const uniqueness = validateTemplateIsNew(activeTemplates(taskTemplates), draft);
  if (!uniqueness.ok) {
    throw new ValidationError(uniqueness.errors);
  }

  // 版1では版系列の識別子と版の識別子を別々に採番する。改訂で templateId だけが
  // 変わり、templateSeriesId は据え置かれる（仕様書6.3）。
  const template = buildTemplate(draft, {
    createdAt: toIsoSecond(now()),
    templateSeriesId: newId(),
    templateId: newId(),
    newId,
  });

  const dataset = await persistence.run(() =>
    adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, template),
  );
  return { dataset, template };
}

/**
 * 既存のテンプレートを改訂する（仕様書8.1.3、8.1.4）。
 *
 * 新版の追加と旧版の無効化は同時に成立しなければ整合しない。片方だけ書き込まれ
 * ると有効版が2つ並ぶか0個になるため、`saveEntities` で同一トランザクションへ
 * まとめる（仕様書9.1）。
 *
 * 旧版のレコードは削除せず保持する。既存の実施回は作業項目定義を値として
 * 複製しているため、改訂しても変化しない（仕様書8.1.4、A-09）。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date, newId?: () => string}} deps
 * @param {string} templateId 改訂元の版の識別子
 * @param {{targetType?: string, variant?: string, tasks: object[]}} draft
 * @returns {Promise<{dataset: object, template: object}>}
 */
export async function reviseTemplateAction(deps, templateId, draft) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const shape = validateTemplateDraft({
    targetType: draft.targetType,
    variant: draft.variant,
    tasks: draft.tasks,
  });
  if (!shape.ok) {
    throw new ValidationError(shape.errors);
  }

  const { taskTemplates } = await adapter.loadAll();
  const current = taskTemplates.find((template) => template.templateId === templateId);
  if (current === undefined) {
    throw new ValidationError([`テンプレート: 改訂元が見つからない（${templateId}）`]);
  }

  const revised = reviseTemplate(current, draft, {
    createdAt: toIsoSecond(now()),
    templateId: newId(),
    newId,
  });

  const dataset = await persistence.run(() =>
    adapter.saveEntities([
      { type: ENTITY_TYPE.TASK_TEMPLATES, entity: deactivate(current) },
      { type: ENTITY_TYPE.TASK_TEMPLATES, entity: revised },
    ]),
  );
  return { dataset, template: revised };
}

/**
 * テンプレートを画面の下書き形へ写す。
 *
 * 保存済みのオブジェクトをそのまま編集させると、保存に失敗したときに画面と
 * 保存内容が食い違う。編集は必ず複製に対して行う。
 *
 * @param {object} template
 * @returns {{targetType: string, variant: string, tasks: object[]}}
 */
export function toDraft(template) {
  return {
    targetType: template.targetType,
    variant: template.variant,
    tasks: template.tasks.map((task) => ({ ...task })),
  };
}
