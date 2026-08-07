/**
 * テンプレートから実施回への値複製（仕様書6.3、8.3）。
 *
 * これが A-09（テンプレート改訂が既存実施回へ自動反映しない、仕様書8.1.4）を
 * 成立させる仕組みである。実施回作成時にその時点の作業項目定義を**値として
 * 複製**するため、後からテンプレートを改訂しても既存の実施回は変化しない。
 *
 * 参照ではなく値を持つことが要件なので、複製は必ず新しいオブジェクトを作る。
 * `taskDefinitionId` だけは由来を辿るために引き継ぐが、これは識別子であって
 * 内容ではないため、改訂しても意味が変わらない。
 *
 * 純関数のみ。現在時刻と識別子は引数で受け取る。
 */

import { normalizeProjectId } from './projectId.js';
import { RUN_STATUS } from './schema.js';
import { activeTaskDefinitions } from './templateOps.js';

/**
 * 実施回の初期状態（仕様書7.1「新規 → 作業中」）。
 *
 * 文字列を書かず `RUN_STATUS` から取る。「初期状態」という意味は残しつつ、
 * `'working'` の正を1か所に保つ（レビュー指摘 F-26）。
 */
export const INITIAL_RUN_STATUS = RUN_STATUS.WORKING;

/**
 * 実施回へ生成する候補の作業項目を返す（仕様書8.3.1）。
 *
 * 対象種別とバリエーションを選択したときに画面へ出す一覧である。無効化した
 * 項目は候補にも含めない（仕様書8.1.5）。
 *
 * @param {{tasks: object[]}} template
 * @returns {object[]} テンプレート内の作業項目定義（表示順）
 */
export function generatableTasks(template) {
  return activeTaskDefinitions(template);
}

/**
 * 作業項目実績を組む（仕様書6.6）。
 *
 * テンプレートの定義値を複製する。`intervals` と `directEntries` は空で始める。
 *
 * `manuallyAdded` は常に false。実施回作成後の作業項目手動追加（仕様書8.3.3）は
 * 任意要件であり初版では見送っている（実装計画1.6）。
 *
 * @param {object} definition テンプレート内の作業項目定義
 * @param {{taskRecordId: string}} context
 * @returns {object}
 */
export function instantiateTask(definition, context) {
  return {
    taskRecordId: context.taskRecordId,
    // 由来を辿るための識別子。版をまたいで同一項目を指す（仕様書6.3）。
    taskDefinitionId: definition.taskDefinitionId,
    // 以下はテンプレートからの複製値。参照は持たない（仕様書6.3、8.1.4）。
    name: definition.name,
    externalCode: definition.externalCode,
    order: definition.order,
    manuallyAdded: false,
    intervals: [],
    directEntries: [],
  };
}

/**
 * 実施回を組む（仕様書6.5、8.2.4、8.3）。
 *
 * `excludedTaskDefinitionIds` に含まれる作業項目は生成しない（仕様書8.3.2）。
 * 実施回作成前に生成対象を確認し、不要な項目を除外できるという要件に対応する。
 *
 * @param {{template: object, projectGroupId: string, workDate: string,
 *          runQuantity: number, excludedTaskDefinitionIds?: string[]}} input
 * @param {{createdAt: string, runId: string, newId: () => string}} context
 * @returns {object} WorkRun
 */
export function instantiateRun(input, context) {
  const {
    template,
    projectGroupId,
    workDate,
    runQuantity,
    excludedTaskDefinitionIds = [],
  } = input;
  const { createdAt, runId, newId } = context;

  const excluded = new Set(excludedTaskDefinitionIds);
  const tasks = generatableTasks(template)
    .filter((definition) => !excluded.has(definition.taskDefinitionId))
    .map((definition) => instantiateTask(definition, { taskRecordId: newId() }));

  return {
    runId,
    projectGroupId,
    workDate,
    runQuantity,
    status: INITIAL_RUN_STATUS,
    // 生成元の版を記録する。どの版から複製したかを後から辿れるようにする
    // （仕様書8.1.4、A-09）。実施回の内容はこの版へ追随しない。
    templateId: template.templateId,
    templateVersion: template.version,
    createdAt,
    updatedAt: createdAt,
    transferredAt: null,
    archivedAt: null,
    tasks,
  };
}

/**
 * 案件グループを組む（仕様書6.4、8.2.1）。
 *
 * 対象種別とバリエーションは案件グループが持ち、実施回は持たない。同一案件IDへ
 * 異なる対象種別を登録できないのはこのためである（仕様書8.2.6）。
 *
 * @param {{projectId: string, targetType: string, variant: string,
 *          totalQuantity: number}} draft
 * @param {{createdAt: string, projectGroupId: string}} context
 * @returns {object} ProjectGroup
 */
export function instantiateProjectGroup(draft, context) {
  return {
    projectGroupId: context.projectGroupId,
    projectId: normalizeProjectId(draft.projectId),
    targetType: draft.targetType.trim(),
    variant: draft.variant.trim(),
    totalQuantity: draft.totalQuantity,
    createdAt: context.createdAt,
    updatedAt: context.createdAt,
  };
}
