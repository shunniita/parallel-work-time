/**
 * 作業テンプレートの登録と改訂（仕様書8.1、6.3）。
 *
 * 検証と組み立ては `src/domain/` の純関数へ委ね、ここは順序と保存だけを持つ。
 * 依存は引数で受け取り、テストで時刻とID生成を固定できるようにする。
 *
 * 検証に失敗した場合は保存を呼ばない。`ValidationError` を投げるので、画面は
 * `errors` をそのまま表示できる。例外の定義は `src/app/errors.js` にある。
 *
 * 読み込みから書き込みまでは `persistence.run()` の中で行う。読み込んだ内容を
 * もとに検証してから書き戻すため、その間に別の操作が割り込むと判断の前提が
 * 崩れる（`src/app/persistence.js`）。
 */

import { toIsoSecond } from '../../domain/datetime.js';
import {
  activeTemplates,
  buildTemplate,
  deactivate,
  nextTemplateVersion,
  reviseTemplate,
} from '../../domain/templateOps.js';
import {
  validateTemplateDraft,
  validateTemplateIsNew,
} from '../../domain/validation.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import { ValidationError } from '../errors.js';
import { resolveDeps } from './deps.js';

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

  const { dataset, value: template } = await persistence.run(async ({ taskTemplates }) => {
    const uniqueness = validateTemplateIsNew(activeTemplates(taskTemplates), draft);
    if (!uniqueness.ok) {
      throw new ValidationError(uniqueness.errors);
    }

    // 版1では版系列の識別子と版の識別子を別々に採番する。改訂で templateId だけが
    // 変わり、templateSeriesId は据え置かれる（仕様書6.3）。
    const built = buildTemplate(draft, {
      createdAt: toIsoSecond(now()),
      templateSeriesId: newId(),
      templateId: newId(),
      newId,
    });

    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, built),
      value: built,
    };
  });

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
 * 改訂元は有効版でなければならない。旧版を指定できてしまうと、本当の有効版が
 * 残ったまま新版も有効として保存され、同一の対象種別 × バリエーションに有効版が
 * 2つ並ぶ。この不変条件は `findActiveTemplate` と `activeTemplates` が暗黙に
 * 前提としており、壊れるとどちらが選ばれるかは実装依存になる。画面が旧版のIDを
 * 渡さない作りであっても、入口で確かめる。
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

  const { dataset, value: revised } = await persistence.run(async ({ taskTemplates }) => {
    const current = taskTemplates.find((template) => template.templateId === templateId);
    if (current === undefined) {
      throw new ValidationError([`テンプレート: 改訂元が見つからない（${templateId}）`]);
    }
    if (current.active !== true) {
      throw new ValidationError([
        `テンプレート: 改訂元が有効版でない（${current.targetType} / ${current.variant} 版${current.version}）。` +
          '有効版から改訂する。',
      ]);
    }

    // 改訂で対象種別・バリエーションを直せる（`reviseTemplate`）。別の有効版と
    // 同じ組み合わせにすると有効版が2つ並び、実施回作成時にどちらから生成される
    // かが決まらなくなる。保存自体は通るが、直後のエクスポートを取り込めなく
    // なる（`integrity.js` が拒む）ため、ここで止める（敵対的レビュー GAR-6）。
    //
    // 改訂元自身は同じ書き込みで無効化するので、衝突の相手から外す。
    const conflict = validateTemplateIsNew(
      taskTemplates.filter(
        (template) => template.active === true && template.templateId !== current.templateId,
      ),
      {
        targetType: draft.targetType ?? current.targetType,
        variant: draft.variant ?? current.variant,
      },
    );
    if (!conflict.ok) {
      throw new ValidationError(conflict.errors);
    }

    const built = reviseTemplate(current, draft, {
      createdAt: toIsoSecond(now()),
      templateId: newId(),
      // 系列内の最大版を基準にする。改訂元の版に1を足すだけでは版番号が重複しうる。
      version: nextTemplateVersion(taskTemplates, current.templateSeriesId),
      newId,
    });

    return {
      write: () =>
        adapter.saveEntities([
          { type: ENTITY_TYPE.TASK_TEMPLATES, entity: deactivate(current) },
          { type: ENTITY_TYPE.TASK_TEMPLATES, entity: built },
        ]),
      value: built,
    };
  });

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
