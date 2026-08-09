/**
 * 案件グループと実施回の作成・修正（仕様書8.2、8.3）。
 *
 * 検証と組み立ては `src/domain/` の純関数へ委ね、ここは順序と保存だけを持つ。
 * 例外の定義は `src/app/errors.js` にある。
 *
 * 累計超過は警告であって拒否ではない（仕様書8.9.7）。画面が確認を取ったうえで
 * `confirmedOverflow: true` を渡すと保存へ進む。確認なしで超過する場合は
 * `QuantityOverflowError` を投げ、画面は警告文を出して確認を求める。
 *
 * 差し戻すのは累計超過の警告だけである。警告があること自体を確認要求とみなすと、
 * 別種の警告を足した瞬間に無関係な確認ダイアログが出る（レビュー指摘 D-15）。
 * 種別コードで絞り込み、それ以外の警告は返り値へ載せて画面へ渡す。
 *
 * 読み込みから書き込みまでは `persistence.run()` の中で行う。累計の判定は他の
 * 実施回の内容に依存するため、読み込んだ後に別の操作が割り込むと判断の前提が
 * 崩れる（`src/app/persistence.js`）。
 */

import { toIsoSecond } from '../../domain/datetime.js';
import { hasWarning } from '../../domain/problems.js';
import { normalizeProjectId } from '../../domain/projectId.js';
import { describeNotEditable, isRunEditable } from '../../domain/runStatus.js';
import {
  generatableTasks,
  instantiateProjectGroup,
  instantiateRun,
} from '../../domain/templateInstantiate.js';
import { activeTemplates } from '../../domain/templateOps.js';
import {
  VALIDATION_WARNING,
  validateProjectGroupDraft,
  validateProjectIdAvailable,
  validateRunDraft,
  validateTotalQuantityChange,
} from '../../domain/validation.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import {
  ProjectIdConflictError,
  QuantityOverflowError,
  RunNotEditableError,
  ValidationError,
} from '../errors.js';
import { resolveDeps } from './deps.js';

/**
 * 案件グループを登録する（仕様書8.2.1、8.2.6）。
 *
 * 対象種別とバリエーションは案件グループへ保存し、以後変更しない。実施回は
 * 作成時にテンプレートから作業項目を複製しているため、後から案件の対象種別が
 * 変わると過去の実施回と食い違う。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date, newId?: () => string}} deps
 * @param {{projectId: string, targetType: string, variant: string,
 *          totalQuantity: number}} draft
 * @returns {Promise<{dataset: object, projectGroup: object}>}
 */
export async function createProjectGroup(deps, draft) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const shape = validateProjectGroupDraft(draft);
  if (!shape.ok) {
    throw new ValidationError(shape.errors);
  }

  const { dataset, value: projectGroup } = await persistence.run(
    async ({ projectGroups, taskTemplates }) => {
      const availability = validateProjectIdAvailable(projectGroups, draft.projectId);
      if (!availability.ok) {
        throw new ProjectIdConflictError(availability.errors, availability.conflict);
      }

      // 対象種別×バリエーションに有効なテンプレートが無いと実施回を作れない
      // （仕様書8.3.1）。案件登録の時点で気づけるようにする。
      const template = findActiveTemplate(taskTemplates, draft.targetType, draft.variant);
      if (template === null) {
        throw new ValidationError([
          `対象種別とバリエーション: ${draft.targetType.trim()} / ${draft.variant.trim()} の` +
            '有効なテンプレートが無い。テンプレート画面で登録する。',
        ]);
      }

      const built = instantiateProjectGroup(draft, {
        createdAt: toIsoSecond(now()),
        projectGroupId: newId(),
      });

      return {
        write: () => adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, built),
        value: built,
      };
    },
  );

  return { dataset, projectGroup };
}

/**
 * 実施回を作成する（仕様書8.2.2、8.2.3、8.2.4、8.3）。
 *
 * 作業項目はその時点の有効版テンプレートから値として複製する。これにより
 * 後のテンプレート改訂は既存実施回へ影響しない（仕様書8.1.4、A-09）。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date, newId?: () => string}} deps
 * @param {string} projectGroupId
 * @param {{workDate: string, runQuantity: number,
 *          excludedTaskDefinitionIds?: string[], confirmedOverflow?: boolean}} draft
 * @returns {Promise<{dataset: object, workRun: object, warnings: object[]}>}
 */
export async function createWorkRun(deps, projectGroupId, draft) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(
    async ({ projectGroups, workRuns, taskTemplates }) => {
      const projectGroup = projectGroups.find(
        (group) => group.projectGroupId === projectGroupId,
      );
      if (projectGroup === undefined) {
        throw new ValidationError([`案件: 見つからない（${projectGroupId}）`]);
      }

      const template = findActiveTemplate(
        taskTemplates,
        projectGroup.targetType,
        projectGroup.variant,
      );
      if (template === null) {
        throw new ValidationError([
          `対象種別とバリエーション: ${projectGroup.targetType} / ${projectGroup.variant} の` +
            '有効なテンプレートが無い。テンプレート画面で登録する。',
        ]);
      }

      const runs = workRuns.filter((run) => run.projectGroupId === projectGroupId);
      const result = validateRunDraft(draft, {
        projectGroup,
        runs,
        generatableCount: generatableTasks(template).length,
      });
      if (!result.ok) {
        throw new ValidationError(result.errors);
      }
      // 超過は確認を取れば続行できる（仕様書8.9.7）。
      if (
        hasWarning(result.warnings, VALIDATION_WARNING.QUANTITY_OVERFLOW) &&
        draft.confirmedOverflow !== true
      ) {
        throw new QuantityOverflowError(result.warnings, result.preview);
      }

      const workRun = instantiateRun(
        {
          template,
          projectGroupId,
          workDate: draft.workDate,
          runQuantity: draft.runQuantity,
          excludedTaskDefinitionIds: draft.excludedTaskDefinitionIds ?? [],
        },
        { createdAt: toIsoSecond(now()), runId: newId(), newId },
      );

      return {
        write: () => adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun),
        value: { workRun, warnings: result.warnings },
      };
    },
  );

  return { dataset, workRun: value.workRun, warnings: value.warnings };
}

/**
 * 総予定数を修正する（仕様書8.2.7）。
 *
 * 累計と残数は保存しない導出値なので（実装計画3.4）、総予定数を書き換えるだけで
 * 表示は再計算される。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date}} deps
 * @param {string} projectGroupId
 * @param {{totalQuantity: number, confirmedOverflow?: boolean}} change
 * @returns {Promise<{dataset: object, projectGroup: object, warnings: object[]}>}
 */
export async function updateTotalQuantity(deps, projectGroupId, change) {
  const { adapter, persistence, now } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ projectGroups, workRuns }) => {
    const current = projectGroups.find((group) => group.projectGroupId === projectGroupId);
    if (current === undefined) {
      throw new ValidationError([`案件: 見つからない（${projectGroupId}）`]);
    }

    const runs = workRuns.filter((run) => run.projectGroupId === projectGroupId);
    const result = validateTotalQuantityChange(runs, change.totalQuantity);
    if (!result.ok) {
      throw new ValidationError(result.errors);
    }
    if (
      hasWarning(result.warnings, VALIDATION_WARNING.QUANTITY_OVERFLOW) &&
      change.confirmedOverflow !== true
    ) {
      throw new QuantityOverflowError(result.warnings, result.preview);
    }

    // 総予定数は案件グループの値であり、実施回の状態ガード（仕様書7.2）の対象で
    // はない。転記済みの実施回があっても案件の予定数そのものは修正できる。

    // 案件IDと対象種別・バリエーションは触らない（仕様書8.2.6）。
    const projectGroup = {
      ...current,
      totalQuantity: change.totalQuantity,
      updatedAt: toIsoSecond(now()),
    };

    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, projectGroup),
      value: { projectGroup, warnings: result.warnings },
    };
  });

  return { dataset, projectGroup: value.projectGroup, warnings: value.warnings };
}

/**
 * 今回数量を修正する（仕様書8.2.7）。
 *
 * 実施回の内容を書き換えるため、状態ガードを通す（仕様書7.2、`runStatus.js`）。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date}} deps
 * @param {string} runId
 * @param {{runQuantity: number, confirmedOverflow?: boolean}} change
 * @returns {Promise<{dataset: object, workRun: object, warnings: object[]}>}
 */
export async function updateRunQuantity(deps, runId, change) {
  const { adapter, persistence, now } = resolveDeps(deps);

  const { dataset, value } = await persistence.run(async ({ projectGroups, workRuns }) => {
    const current = workRuns.find((run) => run.runId === runId);
    if (current === undefined) {
      throw new ValidationError([`実施回: 見つからない（${runId}）`]);
    }
    if (!isRunEditable(current)) {
      throw new RunNotEditableError(describeNotEditable(current), current.status);
    }
    const projectGroup = projectGroups.find(
      (group) => group.projectGroupId === current.projectGroupId,
    );
    if (projectGroup === undefined) {
      throw new ValidationError([`案件: 見つからない（${current.projectGroupId}）`]);
    }

    const runs = workRuns.filter((run) => run.projectGroupId === current.projectGroupId);
    const result = validateRunDraft(
      { workDate: current.workDate, runQuantity: change.runQuantity },
      { projectGroup, runs, excludeRunId: runId },
    );
    if (!result.ok) {
      throw new ValidationError(result.errors);
    }
    if (
      hasWarning(result.warnings, VALIDATION_WARNING.QUANTITY_OVERFLOW) &&
      change.confirmedOverflow !== true
    ) {
      throw new QuantityOverflowError(result.warnings, result.preview);
    }

    const workRun = {
      ...current,
      runQuantity: change.runQuantity,
      updatedAt: toIsoSecond(now()),
    };

    return {
      write: () => adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun),
      value: { workRun, warnings: result.warnings },
    };
  });

  return { dataset, workRun: value.workRun, warnings: value.warnings };
}

/**
 * 対象種別×バリエーションの有効版テンプレートを返す（仕様書8.3.1）。
 *
 * 有効版は1つだけ存在する（実装計画3.1）。見つからなければ null。
 *
 * @param {object[]} taskTemplates
 * @param {string} targetType
 * @param {string} variant
 * @returns {object|null}
 */
export function findActiveTemplate(taskTemplates, targetType, variant) {
  const wantedType = String(targetType ?? '').trim();
  const wantedVariant = String(variant ?? '').trim();
  return (
    activeTemplates(taskTemplates).find(
      (template) =>
        template.targetType === wantedType && template.variant === wantedVariant,
    ) ?? null
  );
}

/**
 * 読み込み済みの一覧から案件IDで引く（仕様書8.2.6）。
 *
 * `StorageAdapter.findProjectGroupByProjectId()` と役割が似ているが別物である。
 * あちらは索引を引き直すため、`persistence.run()` が渡すデータセットの外を読む。
 * 検証と書き込みの間に別の操作が割り込む隙間ができるので、アクション層は
 * 受け取った一覧の中だけで判断する。名前を分けて取り違えを防ぐ
 * （レビュー指摘 F-28）。
 *
 * @param {object[]} projectGroups `persistence.run()` が渡した一覧
 * @param {string} projectId
 * @returns {object|null}
 */
export function findLoadedProjectGroup(projectGroups, projectId) {
  const normalized = normalizeProjectId(projectId);
  return projectGroups.find((group) => group.projectId === normalized) ?? null;
}
