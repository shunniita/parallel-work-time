/**
 * 数量の集計（仕様書8.2.5）。
 *
 *   累計数量 = Σ runQuantity
 *   残数     = 総予定数 - 累計数量
 *
 * 累計にはアーカイブ済みの実施回も含める。数量は「その案件で何個やったか」の
 * 記録であり、アーカイブは通常一覧から分離する操作にすぎない（仕様書10.1）。
 * 除いてしまうと、アーカイブした途端に残数が増えて実態と合わなくなる。
 *
 * 削除された実施回は当然含まれない。完全削除は利用者の明示操作であり
 * （仕様書10.4）、その時点で記録そのものが無くなる。
 *
 * 純関数のみ。
 */

/**
 * 案件グループの数量サマリを求める（仕様書8.2.5）。
 *
 * `remaining` は負値を許す。累計が総予定数を超えることは警告のうえ続行できる
 * ため（仕様書8.9.7）、超過した状態を数値として表せる必要がある。0で止めると
 * どれだけ超えたか分からなくなる。
 *
 * @param {{totalQuantity: number}} projectGroup
 * @param {{runQuantity: number}[]} runs 当該案件グループの実施回すべて
 * @returns {{totalQuantity: number, accumulated: number, remaining: number,
 *            runCount: number, exceeded: boolean}}
 */
export function summarizeQuantity(projectGroup, runs) {
  const accumulated = runs.reduce((total, run) => total + run.runQuantity, 0);
  const totalQuantity = projectGroup.totalQuantity;
  const remaining = totalQuantity - accumulated;

  return {
    totalQuantity,
    accumulated,
    remaining,
    runCount: runs.length,
    exceeded: remaining < 0,
  };
}

/**
 * 実施回を案件グループごとに束ねる。
 *
 * @param {object[]} runs
 * @returns {Map<string, object[]>} projectGroupId → 実施回
 */
export function groupRunsByProject(runs) {
  const byProject = new Map();
  for (const run of runs) {
    const list = byProject.get(run.projectGroupId);
    if (list === undefined) {
      byProject.set(run.projectGroupId, [run]);
    } else {
      list.push(run);
    }
  }
  return byProject;
}

/**
 * 実施回を追加または修正したときの累計を先読みする（仕様書8.9.7）。
 *
 * 保存前に累計超過を警告するために使う。既存の実施回を修正する場合は
 * `excludeRunId` にその実施回を指定し、古い数量を差し引いてから足す。
 *
 * @param {{totalQuantity: number}} projectGroup
 * @param {{runId: string, runQuantity: number}[]} runs 当該案件グループの実施回
 * @param {{runQuantity: number, excludeRunId?: string|null}} change
 * @returns {{accumulated: number, remaining: number, exceeded: boolean, overBy: number}}
 */
export function previewQuantity(projectGroup, runs, change) {
  const { runQuantity, excludeRunId = null } = change;
  const others = excludeRunId === null ? runs : runs.filter((run) => run.runId !== excludeRunId);
  const accumulated = others.reduce((total, run) => total + run.runQuantity, 0) + runQuantity;
  const remaining = projectGroup.totalQuantity - accumulated;

  return {
    accumulated,
    remaining,
    exceeded: remaining < 0,
    overBy: remaining < 0 ? -remaining : 0,
  };
}

/**
 * 総予定数を修正したときの影響を先読みする（仕様書8.2.7）。
 *
 * 総予定数を累計より小さくすると超過状態になる。数量の修正でも 8.9.7 と同じ
 * 警告を出すため、判定をここへ置く。
 *
 * @param {{runQuantity: number}[]} runs
 * @param {number} nextTotalQuantity
 * @returns {{accumulated: number, remaining: number, exceeded: boolean, overBy: number}}
 */
export function previewTotalQuantity(runs, nextTotalQuantity) {
  const accumulated = runs.reduce((total, run) => total + run.runQuantity, 0);
  const remaining = nextTotalQuantity - accumulated;

  return {
    accumulated,
    remaining,
    exceeded: remaining < 0,
    overBy: remaining < 0 ? -remaining : 0,
  };
}
