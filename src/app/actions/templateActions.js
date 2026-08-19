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
  activate,
  activeTemplates,
  buildTemplate,
  deactivate,
  latestOfSeries,
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
    // なる（`integrity.js` が拒む）ため、ここで止める（過去の敵対的レビュー）。
    //
    // 改訂元自身は同じ書き込みで無効化するので、衝突の相手から外す。
    const conflict = validateTemplateIsNew(
      activeTemplates(taskTemplates).filter(
        (template) => template.templateId !== current.templateId,
      ),
      {
        targetType: draft.targetType ?? current.targetType,
        variant: draft.variant ?? current.variant,
      },
    );
    if (!conflict.ok) {
      throw new ValidationError(conflict.errors);
    }

    const version = nextTemplateVersion(taskTemplates, current.templateSeriesId);
    if (version === null) {
      throw new ValidationError(['テンプレート: 版番号が保存可能な上限に達している']);
    }
    const built = reviseTemplate(current, draft, {
      createdAt: toIsoSecond(now()),
      templateId: newId(),
      // 系列内の最大版を基準にする。改訂元の版に1を足すだけでは版番号が重複しうる。
      version,
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
 * テンプレートをアーカイブする（仕様書8.1.9）。
 *
 * 有効版を無効にするだけで、版番号は繰り上げず、レコードも消さない。系列に有効版
 * が1つも無い状態がアーカイブ済みである（仕様書6.3）。
 *
 * 実施回は作業項目定義を値として複製済みなので、アーカイブしても既存の実施回は
 * 変化しない。
 *
 * @param {{adapter: object, persistence: object}} deps
 * @param {string} templateId アーカイブする有効版の識別子
 * @returns {Promise<{dataset: object, template: object}>}
 */
export async function archiveTemplateAction(deps, templateId) {
  const { adapter, persistence } = resolveDeps(deps);

  const { dataset, value: archived } = await persistence.run(async ({ taskTemplates }) => {
    const current = taskTemplates.find((template) => template.templateId === templateId);
    if (current === undefined) {
      throw new ValidationError([`テンプレート: 対象が見つからない（${templateId}）`]);
    }
    if (current.active !== true) {
      throw new ValidationError([
        `テンプレート: ${current.targetType} / ${current.variant} は既にアーカイブ済みである`,
      ]);
    }

    const built = deactivate(current);
    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, built),
      value: built,
    };
  });

  return { dataset, template: archived };
}

/**
 * アーカイブしたテンプレートを再び有効にする（仕様書8.1.10）。
 *
 * 戻すのは系列の最新版である。アーカイブ中に同じ対象種別×バリエーションで別の
 * テンプレートを作られていると、戻した瞬間に有効版が2つ並ぶ。どちらから実施回を
 * 生成するかが決まらなくなるため、入口で拒む。
 *
 * @param {{adapter: object, persistence: object}} deps
 * @param {string} templateSeriesId 戻す系列の識別子
 * @returns {Promise<{dataset: object, template: object}>}
 */
export async function restoreTemplateAction(deps, templateSeriesId) {
  const { adapter, persistence } = resolveDeps(deps);

  const { dataset, value: restored } = await persistence.run(async ({ taskTemplates }) => {
    const latest = latestOfSeries(taskTemplates, templateSeriesId);
    if (latest === null) {
      throw new ValidationError([`テンプレート: 対象が見つからない（${templateSeriesId}）`]);
    }
    if (taskTemplates.some(
      (template) =>
        template.templateSeriesId === templateSeriesId && template.active === true,
    )) {
      throw new ValidationError([
        `テンプレート: ${latest.targetType} / ${latest.variant} はアーカイブされていない`,
      ]);
    }

    const conflict = validateTemplateIsNew(activeTemplates(taskTemplates), {
      targetType: latest.targetType,
      variant: latest.variant,
    });
    if (!conflict.ok) {
      throw new ValidationError(conflict.errors);
    }

    const built = activate(latest);
    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, built),
      value: built,
    };
  });

  return { dataset, template: restored };
}

/**
 * テンプレートを系列ごと削除する（仕様書8.1.11）。
 *
 * 実施回は `templateId` でテンプレートを参照し続ける。参照先を消すと、書き出した
 * JSONを取り込めなくなる（`integrity.js` の `checkRunReferences`）。1版でも参照
 * されている系列は削除せず、アーカイブへ誘導する。
 *
 * 系列の全版をまとめて消す。一部の版だけ残すと版番号に穴が空き、系列を辿れなく
 * なる。
 *
 * @param {{adapter: object, persistence: object}} deps
 * @param {string} templateSeriesId 削除する系列の識別子
 * @returns {Promise<{dataset: object, removed: number}>}
 */
export async function deleteTemplateAction(deps, templateSeriesId) {
  const { adapter, persistence } = resolveDeps(deps);

  const { dataset, value: removed } = await persistence.run(
    async ({ taskTemplates, workRuns }) => {
      const series = taskTemplates.filter(
        (template) => template.templateSeriesId === templateSeriesId,
      );
      if (series.length === 0) {
        throw new ValidationError([`テンプレート: 対象が見つからない（${templateSeriesId}）`]);
      }

      const seriesIds = new Set(series.map((template) => template.templateId));
      const referencing = workRuns.filter((run) => seriesIds.has(run.templateId));
      if (referencing.length > 0) {
        const sample = series[0];
        throw new ValidationError([
          `テンプレート: ${sample.targetType} / ${sample.variant} は実施回${referencing.length}件から参照されている。` +
            '削除せずアーカイブする。',
        ]);
      }

      return {
        write: () =>
          adapter.saveEntities(
            series.map((template) => ({
              type: ENTITY_TYPE.TASK_TEMPLATES,
              entity: template,
              remove: true,
            })),
          ),
        value: series.length,
      };
    },
  );

  return { dataset, removed };
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

/**
 * テンプレートを複製元とした新規登録の下書きへ写す（仕様書8.1.7）。
 *
 * `taskDefinitionId` を落とす。これは版をまたいで同一項目を追跡する識別子であり
 * （仕様書6.3）、引き継ぐと別系列の項目どうしが同じものとして辿れてしまう。保存
 * 時に採番し直す（`normalizeTaskDefinitions`）。
 *
 * 対象種別とバリエーションは複製元のまま返す。そのままでは有効版が重複して保存
 * できないが、どこを変えるのかは利用者が決めることなので、画面で書き換えさせる。
 *
 * @param {object} template
 * @returns {{targetType: string, variant: string, tasks: object[]}}
 */
export function toCopyDraft(template) {
  return {
    targetType: template.targetType,
    variant: template.variant,
    tasks: template.tasks.map(({ taskDefinitionId, ...task }) => ({ ...task })),
  };
}
