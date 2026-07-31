/**
 * 案件グループと実施回の作成・修正（仕様書8.2、8.3）。
 *
 * 検証と組み立ては `src/domain/` の純関数へ委ね、ここは順序と保存だけを持つ。
 *
 * 累計超過は警告であって拒否ではない（仕様書8.9.7）。画面が確認を取ったうえで
 * `confirmedOverflow: true` を渡すと保存へ進む。確認なしで超過する場合は
 * `QuantityOverflowError` を投げ、画面は警告文を出して確認を求める。
 */

import { toIsoSecond } from '../../domain/datetime.js';
import { newId as defaultNewId } from '../../domain/ids.js';
import { previewQuantity } from '../../domain/quantity.js';
import {
  generatableTasks,
  instantiateProjectGroup,
  instantiateRun,
  normalizeProjectId,
} from '../../domain/templateInstantiate.js';
import { activeTemplates } from '../../domain/templateOps.js';
import {
  validateProjectGroupDraft,
  validateProjectIdAvailable,
  validateRunDraft,
  validateTotalQuantityChange,
} from '../../domain/validation.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import { ValidationError } from './templateActions.js';

/**
 * 案件IDが既に使われていることを表す例外（仕様書8.2.6）。
 *
 * 単なる検証エラーと分けてある。画面は既存案件の対象種別・バリエーションを示し、
 * その案件へ実施回を追加する導線を出す必要があるため、`conflict` を運ぶ。
 */
export class ProjectIdConflictError extends ValidationError {
  /**
   * @param {string[]} errors
   * @param {object} conflict 既存の案件グループ
   */
  constructor(errors, conflict) {
    super(errors);
    this.name = 'ProjectIdConflictError';
    this.conflict = conflict;
  }
}

/**
 * 累計が総予定数を超えることを表す例外（仕様書8.9.7）。
 *
 * 保存を禁止する意味ではない。確認を求めるための差し戻しであり、画面が
 * `confirmedOverflow: true` を付けて呼び直せば保存される。
 */
export class QuantityOverflowError extends Error {
  /**
   * @param {string[]} warnings
   * @param {object} preview {@link previewQuantity} の結果
   */
  constructor(warnings, preview) {
    super(warnings.join(' / '));
    this.name = 'QuantityOverflowError';
    this.warnings = warnings;
    this.preview = preview;
  }
}

function resolveDeps(deps) {
  return {
    adapter: deps.adapter,
    persistence: deps.persistence,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? defaultNewId,
  };
}

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

  const { projectGroups, taskTemplates } = await adapter.loadAll();

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

  const projectGroup = instantiateProjectGroup(draft, {
    createdAt: toIsoSecond(now()),
    projectGroupId: newId(),
  });

  const dataset = await persistence.run(() =>
    adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, projectGroup),
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
 * @returns {Promise<{dataset: object, workRun: object, warnings: string[]}>}
 */
export async function createWorkRun(deps, projectGroupId, draft) {
  const { adapter, persistence, now, newId } = resolveDeps(deps);

  const { projectGroups, workRuns, taskTemplates } = await adapter.loadAll();
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
  if (result.warnings.length > 0 && draft.confirmedOverflow !== true) {
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

  const dataset = await persistence.run(() =>
    adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun),
  );
  return { dataset, workRun, warnings: result.warnings };
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
 * @returns {Promise<{dataset: object, projectGroup: object, warnings: string[]}>}
 */
export async function updateTotalQuantity(deps, projectGroupId, change) {
  const { adapter, persistence, now } = resolveDeps(deps);

  const { projectGroups, workRuns } = await adapter.loadAll();
  const current = projectGroups.find((group) => group.projectGroupId === projectGroupId);
  if (current === undefined) {
    throw new ValidationError([`案件: 見つからない（${projectGroupId}）`]);
  }

  const runs = workRuns.filter((run) => run.projectGroupId === projectGroupId);
  const result = validateTotalQuantityChange(runs, change.totalQuantity);
  if (!result.ok) {
    throw new ValidationError(result.errors);
  }
  if (result.warnings.length > 0 && change.confirmedOverflow !== true) {
    throw new QuantityOverflowError(result.warnings, result.preview);
  }

  // 案件IDと対象種別・バリエーションは触らない（仕様書8.2.6）。
  const projectGroup = {
    ...current,
    totalQuantity: change.totalQuantity,
    updatedAt: toIsoSecond(now()),
  };

  const dataset = await persistence.run(() =>
    adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, projectGroup),
  );
  return { dataset, projectGroup, warnings: result.warnings };
}

/**
 * 今回数量を修正する（仕様書8.2.7）。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date}} deps
 * @param {string} runId
 * @param {{runQuantity: number, confirmedOverflow?: boolean}} change
 * @returns {Promise<{dataset: object, workRun: object, warnings: string[]}>}
 */
export async function updateRunQuantity(deps, runId, change) {
  const { adapter, persistence, now } = resolveDeps(deps);

  const { projectGroups, workRuns } = await adapter.loadAll();
  const current = workRuns.find((run) => run.runId === runId);
  if (current === undefined) {
    throw new ValidationError([`実施回: 見つからない（${runId}）`]);
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
  if (result.warnings.length > 0 && change.confirmedOverflow !== true) {
    throw new QuantityOverflowError(result.warnings, result.preview);
  }

  const workRun = {
    ...current,
    runQuantity: change.runQuantity,
    updatedAt: toIsoSecond(now()),
  };

  const dataset = await persistence.run(() =>
    adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun),
  );
  return { dataset, workRun, warnings: result.warnings };
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
 * 案件IDから案件グループを引く（仕様書8.2.6）。
 *
 * @param {object[]} projectGroups
 * @param {string} projectId
 * @returns {object|null}
 */
export function findProjectGroupByProjectId(projectGroups, projectId) {
  const normalized = normalizeProjectId(projectId);
  return projectGroups.find((group) => group.projectId === normalized) ?? null;
}
