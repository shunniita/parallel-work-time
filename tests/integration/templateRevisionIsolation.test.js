/**
 * A-09 の通し確認（仕様書8.1.4、6.3、受入試験T-09）。
 *
 * 次の一連の流れを1本のテストで辿る。
 *
 *   1. テンプレートから実施回を作成する
 *   2. 元テンプレートを改訂する
 *   3. 改訂前に作成した実施回の構成が変化しないことを確認する
 *      （作業項目名・外部項目コード・表示順・有効状態由来の構成）
 *   4. 改訂後に新しく作成した実施回には新しいテンプレート内容が反映される
 *
 * 個々の部品は `tests/unit/templateInstantiate.test.js` と
 * `tests/unit/templateOps.test.js` で固定してある。ここで見たいのは、保存を
 * 挟んだ通しの流れで不変性が保たれることである。IndexedDB でも同じ結果になる
 * ことを確かめるため、両アダプターへ同一のスイートを通す。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createProjectGroup,
  createWorkRun,
} from '../../src/app/actions/projectActions.js';
import {
  createTemplate,
  reviseTemplateAction,
  toDraft,
} from '../../src/app/actions/templateActions.js';
import { createPersistence } from '../../src/app/persistence.js';
import { activeTemplates } from '../../src/domain/templateOps.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { IndexedDbAdapter } from '../../src/storage/IndexedDbAdapter.js';

const FIXED_NOW = new Date('2026-08-01T01:00:00Z');

function idGenerator() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `id-${sequence}`;
  };
}

let dbSequence = 0;

const implementations = [
  { name: 'MemoryAdapter', create: () => new MemoryAdapter() },
  {
    name: 'IndexedDbAdapter',
    create: () => {
      dbSequence += 1;
      return new IndexedDbAdapter({ dbName: `pwt-a09-${dbSequence}` });
    },
  },
];

/** 版1の作業項目。有効3件・無効1件。 */
const VERSION_1_TASKS = [
  { name: '受入確認', externalCode: 'X-100', order: 1, active: true },
  { name: '本作業', externalCode: 'X-200', order: 2, active: true },
  { name: '検査', externalCode: 'X-300', order: 3, active: true },
  { name: '旧手順', externalCode: 'X-900', order: 4, active: false },
];

/**
 * 実施回の作業項目を、比較しやすい形へ写す。
 *
 * 識別子は実行ごとに変わるため含めない。名称・外部項目コード・表示順を並び順の
 * まま取り出す。無効状態は「生成されたかどうか」として構成へ現れる。
 *
 * @param {object} workRun
 * @returns {{name: string, externalCode: string|null, order: number}[]}
 */
function taskShape(workRun) {
  return workRun.tasks.map((task) => ({
    name: task.name,
    externalCode: task.externalCode,
    order: task.order,
  }));
}

describe.each(implementations)('A-09 テンプレート改訂の分離 / $name', ({ create }) => {
  /** @type {import('../../src/storage/StorageAdapter.js').StorageAdapter} */
  let adapter;
  /** @type {object} */
  let deps;

  beforeEach(async () => {
    adapter = create();
    await adapter.initialize();
    const persistence = createPersistence(adapter, { now: () => FIXED_NOW });
    deps = { adapter, persistence, now: () => FIXED_NOW, newId: idGenerator() };
    return () => adapter.close();
  });

  /**
   * 手順1〜2を実行し、比較に必要なものを返す。
   *
   * 改訂の内容は、名称の変更・外部項目コードの変更・表示順の入れ替え・
   * 有効状態の反転・項目の追加をひととおり含める。どれか1種類だけでは、
   * 他の経路で漏れがあっても気づけない。
   */
  async function createRunThenRevise() {
    // 1. テンプレートを登録し、そこから実施回を作る
    const { template: v1 } = await createTemplate(deps, {
      targetType: '対象種別A',
      variant: '標準',
      tasks: VERSION_1_TASKS,
    });
    const { projectGroup } = await createProjectGroup(deps, {
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
      totalQuantity: 500,
    });
    const { workRun: runBefore } = await createWorkRun(deps, projectGroup.projectGroupId, {
      workDate: '2026-08-01',
      runQuantity: 50,
    });

    // 2. 元テンプレートを改訂する
    const draft = toDraft(v1);
    const revisedTasks = [
      // 名称と外部項目コードを変える
      { ...draft.tasks[0], name: '受入確認（改）', externalCode: 'X-101' },
      // 表示順を入れ替える（本作業を検査の後へ）
      { ...draft.tasks[1], order: 30 },
      { ...draft.tasks[2], order: 20 },
      // 無効だった項目を有効にする。表示順は入れ替えの影響を受けない位置へ置く
      { ...draft.tasks[3], order: 35, active: true },
      // 項目を追加する
      { name: '追加加工', externalCode: 'X-400', order: 40, active: true },
    ];
    const { template: v2 } = await reviseTemplateAction(deps, v1.templateId, {
      ...draft,
      tasks: revisedTasks,
    });

    return { v1, v2, projectGroup, runBefore };
  }

  it('手順1: テンプレートの有効項目から実施回が生成される（A-01）', async () => {
    const { runBefore } = await createRunThenRevise();

    // 無効だった「旧手順」は生成されない（仕様書8.1.5）。
    expect(taskShape(runBefore)).toEqual([
      { name: '受入確認', externalCode: 'X-100', order: 1 },
      { name: '本作業', externalCode: 'X-200', order: 2 },
      { name: '検査', externalCode: 'X-300', order: 3 },
    ]);
  });

  it('手順2: 改訂で版が繰り上がり、旧版レコードが残る（仕様書6.3、8.1.3）', async () => {
    const { v1, v2 } = await createRunThenRevise();
    const { taskTemplates } = await adapter.loadAll();

    expect(v2.version).toBe(2);
    expect(v2.templateSeriesId).toBe(v1.templateSeriesId);
    expect(taskTemplates.map((template) => template.version).sort()).toEqual([1, 2]);
    expect(activeTemplates(taskTemplates)).toHaveLength(1);
  });

  it('手順3: 改訂前に作成した実施回の構成が変化しない（仕様書8.1.4、T-09）', async () => {
    const { runBefore } = await createRunThenRevise();

    // 保存済みの実施回を読み直して確かめる。メモリ上の参照ではなく、
    // 保存された内容が変わっていないことを見たい。
    const { workRuns } = await adapter.loadAll();
    const reloaded = workRuns.find((run) => run.runId === runBefore.runId);

    expect(taskShape(reloaded)).toEqual([
      { name: '受入確認', externalCode: 'X-100', order: 1 },
      { name: '本作業', externalCode: 'X-200', order: 2 },
      { name: '検査', externalCode: 'X-300', order: 3 },
    ]);
  });

  it('手順3: 作業項目名が改訂前のままである', async () => {
    const { runBefore } = await createRunThenRevise();
    const { workRuns } = await adapter.loadAll();
    const reloaded = workRuns.find((run) => run.runId === runBefore.runId);

    expect(reloaded.tasks.map((task) => task.name)).toEqual(['受入確認', '本作業', '検査']);
    expect(reloaded.tasks.map((task) => task.name)).not.toContain('受入確認（改）');
  });

  it('手順3: 外部項目コードが改訂前のままである', async () => {
    const { runBefore } = await createRunThenRevise();
    const { workRuns } = await adapter.loadAll();
    const reloaded = workRuns.find((run) => run.runId === runBefore.runId);

    expect(reloaded.tasks.map((task) => task.externalCode)).toEqual([
      'X-100',
      'X-200',
      'X-300',
    ]);
  });

  it('手順3: 表示順が改訂前のままである', async () => {
    const { runBefore } = await createRunThenRevise();
    const { workRuns } = await adapter.loadAll();
    const reloaded = workRuns.find((run) => run.runId === runBefore.runId);

    // 改訂では本作業と検査の順を入れ替えたが、既存実施回は元の順を保つ。
    expect(reloaded.tasks.map((task) => [task.name, task.order])).toEqual([
      ['受入確認', 1],
      ['本作業', 2],
      ['検査', 3],
    ]);
  });

  it('手順3: 有効状態の変更が既存実施回の構成へ及ばない', async () => {
    const { runBefore } = await createRunThenRevise();
    const { workRuns } = await adapter.loadAll();
    const reloaded = workRuns.find((run) => run.runId === runBefore.runId);

    // 改訂で有効化した「旧手順」と、追加した「追加加工」は既存実施回へ現れない。
    expect(reloaded.tasks.map((task) => task.name)).not.toContain('旧手順');
    expect(reloaded.tasks.map((task) => task.name)).not.toContain('追加加工');
    expect(reloaded.tasks).toHaveLength(3);
  });

  it('手順3: 生成元の版の記録も変わらない', async () => {
    const { runBefore } = await createRunThenRevise();
    const { workRuns } = await adapter.loadAll();
    const reloaded = workRuns.find((run) => run.runId === runBefore.runId);

    expect(reloaded.templateVersion).toBe(1);
    expect(reloaded.templateId).toBe(runBefore.templateId);
  });

  it('手順4: 改訂後に作成した実施回へ新しい内容が反映される', async () => {
    const { projectGroup } = await createRunThenRevise();

    const { workRun: runAfter } = await createWorkRun(deps, projectGroup.projectGroupId, {
      workDate: '2026-08-02',
      runQuantity: 50,
    });

    expect(taskShape(runAfter)).toEqual([
      // 名称と外部項目コードの変更が反映される
      { name: '受入確認（改）', externalCode: 'X-101', order: 1 },
      // 表示順の入れ替えが反映される（検査が本作業より前へ）
      { name: '検査', externalCode: 'X-300', order: 2 },
      { name: '本作業', externalCode: 'X-200', order: 3 },
      // 有効化した項目が生成される
      { name: '旧手順', externalCode: 'X-900', order: 4 },
      // 追加した項目が生成される
      { name: '追加加工', externalCode: 'X-400', order: 5 },
    ]);
  });

  it('手順4: 新しい実施回は版2から生成されたと記録する', async () => {
    const { projectGroup, v2 } = await createRunThenRevise();

    const { workRun: runAfter } = await createWorkRun(deps, projectGroup.projectGroupId, {
      workDate: '2026-08-02',
      runQuantity: 50,
    });

    expect(runAfter.templateId).toBe(v2.templateId);
    expect(runAfter.templateVersion).toBe(2);
  });

  it('改訂前と改訂後の実施回が同時に別々の内容で共存する', async () => {
    const { projectGroup, runBefore } = await createRunThenRevise();
    await createWorkRun(deps, projectGroup.projectGroupId, {
      workDate: '2026-08-02',
      runQuantity: 50,
    });

    const { workRuns } = await adapter.loadAll();
    const before = workRuns.find((run) => run.runId === runBefore.runId);
    const after = workRuns.find((run) => run.runId !== runBefore.runId);

    expect(before.tasks).toHaveLength(3);
    expect(after.tasks).toHaveLength(5);
    expect(before.templateVersion).toBe(1);
    expect(after.templateVersion).toBe(2);
  });

  it('同じ taskDefinitionId で版をまたいだ対応が辿れる（仕様書6.3）', async () => {
    const { projectGroup, runBefore, v1 } = await createRunThenRevise();
    const { workRun: runAfter } = await createWorkRun(deps, projectGroup.projectGroupId, {
      workDate: '2026-08-02',
      runQuantity: 50,
    });

    // 「受入確認」は改訂で名称が変わったが、同一項目として辿れる。
    const definitionId = v1.tasks[0].taskDefinitionId;
    const beforeTask = runBefore.tasks.find(
      (task) => task.taskDefinitionId === definitionId,
    );
    const afterTask = runAfter.tasks.find((task) => task.taskDefinitionId === definitionId);

    expect(beforeTask.name).toBe('受入確認');
    expect(afterTask.name).toBe('受入確認（改）');
  });

  it('2回改訂しても改訂前の実施回は最初の内容を保つ', async () => {
    const { v2, runBefore } = await createRunThenRevise();

    await reviseTemplateAction(deps, v2.templateId, {
      ...toDraft(v2),
      tasks: toDraft(v2).tasks.map((task) => ({ ...task, name: `${task.name}【v3】` })),
    });

    const { workRuns } = await adapter.loadAll();
    const reloaded = workRuns.find((run) => run.runId === runBefore.runId);

    expect(reloaded.tasks.map((task) => task.name)).toEqual(['受入確認', '本作業', '検査']);
  });
});
