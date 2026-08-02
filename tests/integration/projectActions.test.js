/**
 * 案件・実施回の結合テスト（仕様書8.2、8.3、8.9.7）。
 *
 * A-09（テンプレート改訂が既存実施回へ自動反映しない）は独立した節で、
 * 作成 → 改訂 → 既存不変 → 新規は新内容の順に通しで確認する。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectGroup,
  createWorkRun,
  findActiveTemplate,
  findProjectGroupByProjectId,
  updateRunQuantity,
  updateTotalQuantity,
} from '../../src/app/actions/projectActions.js';
import {
  createTemplate,
  reviseTemplateAction,
  toDraft,
} from '../../src/app/actions/templateActions.js';
import {
  ProjectIdConflictError,
  QuantityOverflowError,
  RunNotEditableError,
  ValidationError,
} from '../../src/app/errors.js';
import { SAVE_STATE, createPersistence } from '../../src/app/persistence.js';
import { summarizeQuantity } from '../../src/domain/quantity.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { ENTITY_TYPE } from '../../src/storage/StorageAdapter.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';

const FIXED_NOW = new Date('2026-08-01T01:00:00Z');

function idGenerator() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `id-${sequence}`;
  };
}

/** 作業項目3件のテンプレート下書き。 */
function templateDraft(overrides = {}) {
  return {
    targetType: '対象種別A',
    variant: '標準',
    tasks: [
      { name: '受入確認', externalCode: 'X-100', order: 1, active: true },
      { name: '本作業', externalCode: 'X-200', order: 2, active: true },
      { name: '検査', externalCode: 'X-300', order: 3, active: true },
    ],
    ...overrides,
  };
}

function projectDraft(overrides = {}) {
  return {
    projectId: 'PJ-0001',
    targetType: '対象種別A',
    variant: '標準',
    totalQuantity: 100,
    ...overrides,
  };
}

describe('projectActions', () => {
  /** @type {MemoryAdapter} */
  let adapter;
  /** @type {ReturnType<typeof createPersistence>} */
  let persistence;
  /** @type {object} */
  let deps;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.initialize();
    persistence = createPersistence(adapter, { now: () => FIXED_NOW });
    deps = { adapter, persistence, now: () => FIXED_NOW, newId: idGenerator() };
  });

  /** テンプレートを1件登録する。 */
  async function seedTemplate(overrides = {}) {
    const { template } = await createTemplate(deps, templateDraft(overrides));
    return template;
  }

  /** テンプレートと案件を1件ずつ登録する。 */
  async function seedProject(overrides = {}) {
    await seedTemplate();
    const { projectGroup } = await createProjectGroup(deps, projectDraft(overrides));
    return projectGroup;
  }

  describe('createProjectGroup()', () => {
    it('案件グループを保存する（仕様書8.2.1）', async () => {
      await seedTemplate();

      const { dataset, projectGroup } = await createProjectGroup(deps, projectDraft());

      expect(projectGroup).toMatchObject({
        projectId: 'PJ-0001',
        targetType: '対象種別A',
        variant: '標準',
        totalQuantity: 100,
      });
      expect(dataset.projectGroups).toHaveLength(1);
    });

    it('保存できる形になっている（インポート検証を通る）', async () => {
      await seedTemplate();
      const { projectGroup } = await createProjectGroup(deps, projectDraft());

      const result = validateImportPayload({
        schemaVersion: SCHEMA_VERSION,
        settings: createDefaultSettings(),
        taskTemplates: [],
        projectGroups: [projectGroup],
        workRuns: [],
        changeHistory: [],
      });
      expect(result.errors).toEqual([]);
    });

    it('有効なテンプレートが無ければ拒否する（仕様書8.3.1）', async () => {
      const error = await createProjectGroup(deps, projectDraft()).catch((caught) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.errors.join('\n')).toContain('テンプレート');
    });

    it('総予定数が0なら拒否する（仕様書8.9.2）', async () => {
      await seedTemplate();

      await expect(
        createProjectGroup(deps, projectDraft({ totalQuantity: 0 })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('検証失敗時は保存を呼ばない', async () => {
      await seedTemplate();
      const spy = vi.spyOn(adapter, 'saveEntity');

      await expect(createProjectGroup(deps, projectDraft({ projectId: '' }))).rejects.toThrow();

      expect(spy).not.toHaveBeenCalled();
    });

    describe('案件IDの一意性（仕様書8.2.6）', () => {
      it('既存の案件IDでは登録できない', async () => {
        await seedProject();

        const error = await createProjectGroup(deps, projectDraft()).catch((caught) => caught);

        expect(error).toBeInstanceOf(ProjectIdConflictError);
        expect((await adapter.loadAll()).projectGroups).toHaveLength(1);
      });

      it('既存案件の対象種別とバリエーションを conflict で返す', async () => {
        await seedProject();

        const error = await createProjectGroup(deps, projectDraft()).catch((caught) => caught);

        expect(error.conflict).toMatchObject({
          projectId: 'PJ-0001',
          targetType: '対象種別A',
          variant: '標準',
        });
      });

      it('エラー文へ既存案件の内容と実施回追加の案内を含める', async () => {
        await seedProject();

        const error = await createProjectGroup(deps, projectDraft()).catch((caught) => caught);

        const message = error.errors.join('\n');
        expect(message).toContain('対象種別A');
        expect(message).toContain('標準');
        expect(message).toContain('実施回を追加');
      });

      it('異なる対象種別で同じ案件IDを登録しても既存を上書きしない', async () => {
        await seedProject();
        await createTemplate(deps, templateDraft({ targetType: '対象種別B' }));

        await expect(
          createProjectGroup(
            deps,
            projectDraft({ targetType: '対象種別B', totalQuantity: 999 }),
          ),
        ).rejects.toBeInstanceOf(ProjectIdConflictError);

        const { projectGroups } = await adapter.loadAll();
        expect(projectGroups).toHaveLength(1);
        expect(projectGroups[0]).toMatchObject({
          targetType: '対象種別A',
          variant: '標準',
          totalQuantity: 100,
        });
      });

      it('前後空白だけ違う案件IDも重複として扱う', async () => {
        await seedProject();

        await expect(
          createProjectGroup(deps, projectDraft({ projectId: '  PJ-0001  ' })),
        ).rejects.toBeInstanceOf(ProjectIdConflictError);
      });

      it('別の案件IDなら登録できる（仕様書8.2.1）', async () => {
        await seedProject();

        await expect(
          createProjectGroup(deps, projectDraft({ projectId: 'PJ-0002' })),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('createWorkRun()', () => {
    it('有効な作業項目が生成される（T-01、A-01）', async () => {
      const group = await seedProject();

      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 50,
      });

      expect(workRun.tasks.map((task) => task.name)).toEqual(['受入確認', '本作業', '検査']);
      expect(workRun.status).toBe('working');
    });

    it('無効な作業項目は生成しない（仕様書8.1.5）', async () => {
      await createTemplate(
        deps,
        templateDraft({
          targetType: '対象種別C',
          tasks: [
            { name: '有効', externalCode: 'C-1', order: 1, active: true },
            { name: '無効', externalCode: 'C-2', order: 2, active: false },
          ],
        }),
      );
      const { projectGroup: group } = await createProjectGroup(
        deps,
        projectDraft({ projectId: 'PJ-C', targetType: '対象種別C' }),
      );

      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 10,
      });

      expect(workRun.tasks.map((task) => task.name)).toEqual(['有効']);
    });

    it('除外指定した作業項目を生成しない（仕様書8.3.2）', async () => {
      const template = await seedTemplate();
      const { projectGroup: group } = await createProjectGroup(
        deps,
        projectDraft({ projectId: 'PJ-EX' }),
      );

      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 10,
        excludedTaskDefinitionIds: [template.tasks[1].taskDefinitionId],
      });

      expect(workRun.tasks.map((task) => task.name)).toEqual(['受入確認', '検査']);
    });

    it('すべて除外すると拒否する', async () => {
      const template = await seedTemplate();
      const { projectGroup: group } = await createProjectGroup(
        deps,
        projectDraft({ projectId: 'PJ-EX2' }),
      );

      await expect(
        createWorkRun(deps, group.projectGroupId, {
          workDate: '2026-08-01',
          runQuantity: 10,
          excludedTaskDefinitionIds: template.tasks.map((task) => task.taskDefinitionId),
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('同一案件へ複数の実施回を作れる（仕様書8.2.2）', async () => {
      const group = await seedProject();

      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 50,
      });
      const { dataset } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-02',
        runQuantity: 50,
      });

      expect(dataset.workRuns).toHaveLength(2);
    });

    it('同じ日付に複数の実施回を作れる（仕様書8.2.3）', async () => {
      const group = await seedProject();

      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 30,
      });
      const { dataset } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 30,
      });

      expect(dataset.workRuns.map((run) => run.workDate)).toEqual(['2026-08-01', '2026-08-01']);
    });

    it('案件が見つからなければ拒否する', async () => {
      await expect(
        createWorkRun(deps, 'group-missing', { workDate: '2026-08-01', runQuantity: 10 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('作業日の形式が不正なら拒否する', async () => {
      const group = await seedProject();

      await expect(
        createWorkRun(deps, group.projectGroupId, {
          workDate: '2026/08/01',
          runQuantity: 10,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('数量の集計（仕様書8.2.5、T-02、A-02）', () => {
    it('第1回50・第2回50で総数100・累計100・残数0', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 50,
      });
      const { dataset } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-02',
        runQuantity: 50,
      });

      const runs = dataset.workRuns.filter(
        (run) => run.projectGroupId === group.projectGroupId,
      );
      expect(summarizeQuantity(group, runs)).toMatchObject({
        totalQuantity: 100,
        accumulated: 100,
        remaining: 0,
      });
    });

    it('アーカイブ済みの実施回も累計へ含める', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      const { workRun: first } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 40,
      });
      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-02',
        runQuantity: 30,
      });

      // Step 10 でアーカイブ操作を実装するまでは直接書き換えて確かめる。
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, {
        ...first,
        status: 'archived',
        archivedAt: '2026-08-01T20:00:00+09:00',
      });

      const { workRuns } = await adapter.loadAll();
      const runs = workRuns.filter((run) => run.projectGroupId === group.projectGroupId);
      expect(summarizeQuantity(group, runs)).toMatchObject({
        accumulated: 70,
        remaining: 30,
      });
    });
  });

  describe('累計超過（仕様書8.9.7）', () => {
    it('確認なしでは差し戻す', async () => {
      const group = await seedProject({ totalQuantity: 100 });

      const error = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 150,
      }).catch((caught) => caught);

      expect(error).toBeInstanceOf(QuantityOverflowError);
      expect((await adapter.loadAll()).workRuns).toEqual([]);
    });

    it('超過分を warnings と preview で示す', async () => {
      const group = await seedProject({ totalQuantity: 100 });

      const error = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 150,
      }).catch((caught) => caught);

      expect(error.warnings.join('\n')).toContain('50');
      expect(error.preview).toMatchObject({ accumulated: 150, overBy: 50, exceeded: true });
    });

    it('確認後は保存できる', async () => {
      const group = await seedProject({ totalQuantity: 100 });

      const { dataset, warnings } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 150,
        confirmedOverflow: true,
      });

      expect(dataset.workRuns).toHaveLength(1);
      expect(warnings).not.toEqual([]);
    });

    it('超過して保存した後の残数は負になる', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      const { dataset } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 150,
        confirmedOverflow: true,
      });

      const runs = dataset.workRuns.filter(
        (run) => run.projectGroupId === group.projectGroupId,
      );
      expect(summarizeQuantity(group, runs).remaining).toBe(-50);
    });
  });

  describe('updateTotalQuantity()（仕様書8.2.7）', () => {
    it('総予定数を修正すると累計・残数が再計算される', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 60,
      });

      const { dataset, projectGroup } = await updateTotalQuantity(
        deps,
        group.projectGroupId,
        { totalQuantity: 200 },
      );

      const runs = dataset.workRuns.filter(
        (run) => run.projectGroupId === group.projectGroupId,
      );
      expect(summarizeQuantity(projectGroup, runs)).toMatchObject({
        totalQuantity: 200,
        accumulated: 60,
        remaining: 140,
      });
    });

    it('案件IDと対象種別は変えない（仕様書8.2.6）', async () => {
      const group = await seedProject();

      const { projectGroup } = await updateTotalQuantity(deps, group.projectGroupId, {
        totalQuantity: 200,
      });

      expect(projectGroup).toMatchObject({
        projectId: 'PJ-0001',
        targetType: '対象種別A',
        variant: '標準',
      });
    });

    it('累計より小さい値は確認なしでは差し戻す', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 80,
      });

      await expect(
        updateTotalQuantity(deps, group.projectGroupId, { totalQuantity: 50 }),
      ).rejects.toBeInstanceOf(QuantityOverflowError);
    });

    it('確認後は累計より小さい値へ修正できる', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 80,
      });

      const { projectGroup } = await updateTotalQuantity(deps, group.projectGroupId, {
        totalQuantity: 50,
        confirmedOverflow: true,
      });

      expect(projectGroup.totalQuantity).toBe(50);
    });

    it('0以下は拒否する（仕様書8.9.2）', async () => {
      const group = await seedProject();

      await expect(
        updateTotalQuantity(deps, group.projectGroupId, { totalQuantity: 0 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updateRunQuantity()（仕様書8.2.7）', () => {
    it('今回数量を修正すると累計・残数が再計算される', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 30,
      });

      const { dataset } = await updateRunQuantity(deps, workRun.runId, { runQuantity: 70 });

      const runs = dataset.workRuns.filter(
        (run) => run.projectGroupId === group.projectGroupId,
      );
      expect(summarizeQuantity(group, runs)).toMatchObject({
        accumulated: 70,
        remaining: 30,
      });
    });

    it('修正時は自身の古い数量を差し引いて超過判定する', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 90,
      });

      // 90 → 100 は累計100でちょうど。差し引かないと190と判定してしまう。
      await expect(
        updateRunQuantity(deps, workRun.runId, { runQuantity: 100 }),
      ).resolves.toBeDefined();
    });

    it('超過する修正は確認なしでは差し戻す', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 50,
      });
      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-02',
        runQuantity: 50,
      });

      await expect(
        updateRunQuantity(deps, workRun.runId, { runQuantity: 90 }),
      ).rejects.toBeInstanceOf(QuantityOverflowError);
    });

    it('作業項目の内容は変えない', async () => {
      const group = await seedProject();
      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 30,
      });

      const { workRun: updated } = await updateRunQuantity(deps, workRun.runId, {
        runQuantity: 40,
      });

      expect(updated.tasks).toEqual(workRun.tasks);
    });

    it('実施回が見つからなければ拒否する', async () => {
      await expect(
        updateRunQuantity(deps, 'run-missing', { runQuantity: 10 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    describe('状態ガード（仕様書7.2）', () => {
      /**
       * 実施回の状態を直接書き換える。状態遷移の操作は Step 10 で実装するため、
       * ここでは保存層へ直接書いて「転記済み／アーカイブ」を作る。
       */
      async function seedRunWithStatus(status) {
        const group = await seedProject({ totalQuantity: 100 });
        const { workRun } = await createWorkRun(deps, group.projectGroupId, {
          workDate: '2026-08-01',
          runQuantity: 30,
        });
        await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, { ...workRun, status });
        return workRun;
      }

      it('転記済みの実施回は数量を変更できない', async () => {
        const workRun = await seedRunWithStatus('transferred');

        await expect(
          updateRunQuantity(deps, workRun.runId, { runQuantity: 40 }),
        ).rejects.toBeInstanceOf(RunNotEditableError);

        const saved = (await adapter.loadAll()).workRuns.find(
          (run) => run.runId === workRun.runId,
        );
        expect(saved.runQuantity).toBe(30);
      });

      it('アーカイブ済みの実施回は数量を変更できない', async () => {
        const workRun = await seedRunWithStatus('archived');

        await expect(
          updateRunQuantity(deps, workRun.runId, { runQuantity: 40 }),
        ).rejects.toBeInstanceOf(RunNotEditableError);
      });

      it('集計済みの実施回は数量を変更できる', async () => {
        const workRun = await seedRunWithStatus('aggregated');

        await expect(
          updateRunQuantity(deps, workRun.runId, { runQuantity: 40 }),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('保存経路の直列化（lost update 対策）', () => {
    it('同時に実施回を作ると、2件目は1件目を見たうえで超過判定される', async () => {
      const group = await seedProject({ totalQuantity: 100 });

      // どちらも「読み込み → 累計を判定 → 書き戻し」である。直列化していないと
      // 2つとも累計0を読むため、どちらも超過に気づかず合計120が黙って通る。
      const results = await Promise.allSettled([
        createWorkRun(deps, group.projectGroupId, {
          workDate: '2026-08-01',
          runQuantity: 60,
        }),
        createWorkRun(deps, group.projectGroupId, {
          workDate: '2026-08-02',
          runQuantity: 60,
        }),
      ]);

      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect(results[1].reason).toBeInstanceOf(QuantityOverflowError);
      expect((await adapter.loadAll()).workRuns).toHaveLength(1);
    });

    it('実施回の追加と数量修正が同時でも累計判定が最新を見る', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      const { workRun } = await createWorkRun(deps, group.projectGroupId, {
        workDate: '2026-08-01',
        runQuantity: 40,
      });

      // 修正で90へ上げたあと、さらに30の実施回を足すと累計120で超過する。
      const results = await Promise.allSettled([
        updateRunQuantity(deps, workRun.runId, { runQuantity: 90 }),
        createWorkRun(deps, group.projectGroupId, {
          workDate: '2026-08-02',
          runQuantity: 30,
        }),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[1].reason).toBeInstanceOf(QuantityOverflowError);
    });

    it('1つ失敗しても後続の保存は止まらない', async () => {
      const group = await seedProject({ totalQuantity: 100 });

      await expect(
        updateTotalQuantity(deps, group.projectGroupId, { totalQuantity: 0 }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        updateTotalQuantity(deps, group.projectGroupId, { totalQuantity: 150 }),
      ).resolves.toBeDefined();
    });
  });

  describe('書き込み後の読み直しに失敗した場合（仕様書9.1）', () => {
    it('「保存に失敗」とは表示せず、注記を添えて成功として扱う', async () => {
      const group = await seedProject({ totalQuantity: 100 });
      let calls = 0;
      const loadAll = adapter.loadAll.bind(adapter);
      vi.spyOn(adapter, 'loadAll').mockImplementation(async () => {
        calls += 1;
        // 1回目（検証用の読み込み）は通し、書き込み後の読み直しだけ失敗させる。
        if (calls >= 2) {
          throw new Error('読み直しに失敗');
        }
        return loadAll();
      });

      const { dataset } = await updateTotalQuantity(deps, group.projectGroupId, {
        totalQuantity: 150,
      });

      // 書き込みは成功しているので、画面へ流す内容が無いだけである。
      expect(dataset).toBeNull();
      const status = persistence.getStatus();
      expect(status.state).toBe(SAVE_STATE.SAVED);
      expect(status.message).not.toContain('失敗');
      expect(status.details.join('')).toContain('読み直し');
    });
  });

  describe('findActiveTemplate()', () => {
    it('有効版を返す', async () => {
      const template = await seedTemplate();
      const { taskTemplates } = await adapter.loadAll();

      expect(findActiveTemplate(taskTemplates, '対象種別A', '標準').templateId).toBe(
        template.templateId,
      );
    });

    it('該当が無ければ null', async () => {
      await seedTemplate();
      const { taskTemplates } = await adapter.loadAll();

      expect(findActiveTemplate(taskTemplates, '対象種別Z', '標準')).toBeNull();
    });

    it('前後空白を除いて突き合わせる', async () => {
      await seedTemplate();
      const { taskTemplates } = await adapter.loadAll();

      expect(findActiveTemplate(taskTemplates, ' 対象種別A ', ' 標準 ')).not.toBeNull();
    });
  });

  describe('findProjectGroupByProjectId()', () => {
    it('案件IDで引ける', async () => {
      await seedProject();
      const { projectGroups } = await adapter.loadAll();

      expect(findProjectGroupByProjectId(projectGroups, 'PJ-0001')).not.toBeNull();
    });

    it('未登録なら null', async () => {
      expect(findProjectGroupByProjectId([], 'PJ-9999')).toBeNull();
    });
  });
});
