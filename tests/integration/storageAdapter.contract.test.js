/**
 * 保存アダプターの契約テスト（実装計画8.2「アダプター契約」）。
 *
 * 仕様書5.3 の6操作を `MemoryAdapter` と `IndexedDbAdapter` の両方へ同一の
 * スイートで通す。片方だけ通る差異を残さないため、実装ごとに書き分けない。
 *
 * `fake-indexeddb/auto` は globalThis.indexedDB を差し替える。IndexedDbAdapter は
 * 構築時に globalThis から取るため、この import より後に生成する必要がある。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { IndexedDbAdapter } from '../../src/storage/IndexedDbAdapter.js';
import {
  ENTITY_TYPE,
  STORAGE_ERROR_KIND,
  StorageError,
} from '../../src/storage/StorageAdapter.js';
import {
  historyEntry,
  projectGroup,
  taskTemplate,
  workRun,
} from '../fixtures/builders.js';

// 各テストで新しいデータベースを使い、テスト間で状態が漏れないようにする。
// Math.random は使わず連番にして、失敗時の再現性を保つ。
let dbSequence = 0;

const implementations = [
  {
    name: 'MemoryAdapter',
    create: () => new MemoryAdapter(),
  },
  {
    name: 'IndexedDbAdapter',
    create: () => {
      dbSequence += 1;
      return new IndexedDbAdapter({ dbName: `pwt-contract-${dbSequence}` });
    },
  },
];

describe.each(implementations)('$name（仕様書5.3 の6操作）', ({ create }) => {
  /** @type {import('../../src/storage/StorageAdapter.js').StorageAdapter} */
  let adapter;

  beforeEach(async () => {
    adapter = create();
    await adapter.initialize();
    return () => adapter.close();
  });

  describe('initialize()', () => {
    it('設定が未保存なら既定値を書き込む（仕様書6.2）', async () => {
      const { settings } = await adapter.loadAll();
      expect(settings).toEqual(createDefaultSettings());
    });

    it('複数回呼んでも既存の設定を上書きしない', async () => {
      await adapter.saveEntity(ENTITY_TYPE.SETTINGS, {
        ...createDefaultSettings(),
        retentionDays: 7,
      });
      await adapter.initialize();

      const { settings } = await adapter.loadAll();
      expect(settings.retentionDays).toBe(7);
    });
  });

  describe('loadAll()', () => {
    it('初期状態では設定のみを持ち、他は空配列を返す', async () => {
      const dataset = await adapter.loadAll();
      expect(dataset.taskTemplates).toEqual([]);
      expect(dataset.projectGroups).toEqual([]);
      expect(dataset.workRuns).toEqual([]);
      expect(dataset.changeHistory).toEqual([]);
    });

    it('保存した内容を再読込で復元する（仕様書9.1）', async () => {
      const template = taskTemplate();
      const group = projectGroup();
      const run = workRun({ projectGroupId: group.projectGroupId });
      const history = historyEntry();

      await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, template);
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, group);
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, run);
      await adapter.saveEntity(ENTITY_TYPE.CHANGE_HISTORY, history);

      const dataset = await adapter.loadAll();
      expect(dataset.taskTemplates).toEqual([template]);
      expect(dataset.projectGroups).toEqual([group]);
      expect(dataset.workRuns).toEqual([run]);
      expect(dataset.changeHistory).toEqual([history]);
    });

    it('入れ子の tasks / intervals / directEntries をそのまま復元する（仕様書6.5〜6.8）', async () => {
      const run = workRun({ withTaskDetail: true });
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, run);

      const dataset = await adapter.loadAll();
      expect(dataset.workRuns[0].tasks[0].intervals).toHaveLength(2);
      expect(dataset.workRuns[0].tasks[0].directEntries).toHaveLength(1);
      expect(dataset.workRuns[0].tasks[0].intervals[1].endAt).toBeNull();
    });

    describe('並び順の契約（レビュー指摘 C-9）', () => {
      /** 主キーを明示した案件グループ。ビルダーは採番を握るためここでは使わない。 */
      function groupWithId(projectGroupId, projectId, overrides = {}) {
        return { ...projectGroup({ projectId }), projectGroupId, ...overrides };
      }

      it('コレクションを主キーの昇順で返す', async () => {
        // 保存した順ではなくキーの順で返す。片方が挿入順、片方がキー順だと、
        // `MemoryAdapter` で書いたテストが通るのに実装では別の順になる。
        for (const group of [
          groupWithId('g-3', 'PJ-3'),
          groupWithId('g-1', 'PJ-1'),
          groupWithId('g-2', 'PJ-2'),
        ]) {
          await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, group);
        }

        const dataset = await adapter.loadAll();

        expect(dataset.projectGroups.map((group) => group.projectGroupId)).toEqual([
          'g-1',
          'g-2',
          'g-3',
        ]);
      });

      it('置き換えても主キーの昇順のままになる', async () => {
        await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, groupWithId('g-1', 'PJ-1'));
        await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, groupWithId('g-2', 'PJ-2'));
        // 先に入れた方を上書きする。挿入順を保つ実装では末尾へ移りうる。
        await adapter.saveEntity(
          ENTITY_TYPE.PROJECT_GROUPS,
          groupWithId('g-1', 'PJ-1', { totalQuantity: 200 }),
        );

        const dataset = await adapter.loadAll();

        expect(dataset.projectGroups.map((group) => group.projectGroupId)).toEqual(['g-1', 'g-2']);
        expect(dataset.projectGroups[0].totalQuantity).toBe(200);
      });

      it('削除しても残りは主キーの昇順のままになる', async () => {
        for (const group of [
          groupWithId('g-1', 'PJ-1'),
          groupWithId('g-2', 'PJ-2'),
          groupWithId('g-3', 'PJ-3'),
        ]) {
          await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, group);
        }

        await adapter.deleteEntity(ENTITY_TYPE.PROJECT_GROUPS, 'g-2');

        const dataset = await adapter.loadAll();
        expect(dataset.projectGroups.map((group) => group.projectGroupId)).toEqual(['g-1', 'g-3']);
      });
    });
  });

  describe('saveEntity()', () => {
    it('同じキーの保存は置き換えになる', async () => {
      const template = taskTemplate({ targetType: '対象種別A' });
      await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, template);
      await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, {
        ...template,
        targetType: '対象種別B',
      });

      const dataset = await adapter.loadAll();
      expect(dataset.taskTemplates).toHaveLength(1);
      expect(dataset.taskTemplates[0].targetType).toBe('対象種別B');
    });

    it('保存後に元のオブジェクトを書き換えても保存内容は変わらない', async () => {
      const group = projectGroup({ totalQuantity: 100 });
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, group);
      group.totalQuantity = 999;

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups[0].totalQuantity).toBe(100);
    });

    it('未知の種別は validation で失敗する', async () => {
      await expect(adapter.saveEntity('unknownStore', {})).rejects.toMatchObject({
        kind: STORAGE_ERROR_KIND.VALIDATION,
      });
    });

    it('主キーが無いエンティティは validation で失敗する', async () => {
      const { projectGroupId, ...withoutKey } = projectGroup();
      await expect(
        adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, withoutKey),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.VALIDATION });
    });

    it('案件IDの重複は constraint で失敗する（仕様書8.2.6）', async () => {
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, projectGroup({ projectId: 'PJ-0001' }));

      await expect(
        adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, projectGroup({ projectId: 'PJ-0001' })),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.CONSTRAINT });

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups).toHaveLength(1);
    });

    it('同じ案件グループの更新は一意制約に触れない', async () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, group);
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, {
        ...group,
        totalQuantity: 200,
      });

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups).toHaveLength(1);
      expect(dataset.projectGroups[0].totalQuantity).toBe(200);
    });
  });

  describe('saveEntities()', () => {
    it('複数種別をまとめて保存する（仕様書9.1）', async () => {
      const group = projectGroup();
      const run = workRun({ projectGroupId: group.projectGroupId });

      await adapter.saveEntities([
        { type: ENTITY_TYPE.PROJECT_GROUPS, entity: group },
        { type: ENTITY_TYPE.WORK_RUNS, entity: run },
        { type: ENTITY_TYPE.TASK_TEMPLATES, entity: taskTemplate() },
      ]);

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups).toHaveLength(1);
      expect(dataset.workRuns).toHaveLength(1);
      expect(dataset.taskTemplates).toHaveLength(1);
    });

    it('同一ストアへの複数件も保存できる（テンプレート改訂の形）', async () => {
      const v1 = taskTemplate({ templateId: 'template-v1', version: 1, active: true });
      const v2 = {
        ...v1,
        templateId: 'template-v2',
        version: 2,
        active: true,
      };

      await adapter.saveEntities([
        { type: ENTITY_TYPE.TASK_TEMPLATES, entity: { ...v1, active: false } },
        { type: ENTITY_TYPE.TASK_TEMPLATES, entity: v2 },
      ]);

      const dataset = await adapter.loadAll();
      expect(dataset.taskTemplates).toHaveLength(2);
      const active = dataset.taskTemplates.filter((template) => template.active);
      expect(active.map((template) => template.templateId)).toEqual(['template-v2']);
    });

    it('実施回と変更履歴をまとめて保存できる（区間削除の形、仕様書11章）', async () => {
      // 区間削除は「区間を除いた実施回」と「履歴1件」を同時に成立させる必要が
      // ある。片方だけ書かれると、履歴の無い削除か、削除されていない履歴が残る。
      const run = workRun({ withTaskDetail: true });

      await adapter.saveEntities([
        { type: ENTITY_TYPE.WORK_RUNS, entity: { ...run, tasks: [] } },
        {
          type: ENTITY_TYPE.CHANGE_HISTORY,
          entity: historyEntry({ entityType: 'interval', operation: 'intervalDeleted' }),
        },
      ]);

      const dataset = await adapter.loadAll();
      expect(dataset.workRuns[0].tasks).toEqual([]);
      expect(dataset.changeHistory).toHaveLength(1);
    });

    it('実施回と変更履歴のどちらかが不正なら両方とも反映しない', async () => {
      const run = workRun({ withTaskDetail: true });
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, run);
      const { historyId, ...withoutKey } = historyEntry();

      await expect(
        adapter.saveEntities([
          { type: ENTITY_TYPE.WORK_RUNS, entity: { ...run, tasks: [] } },
          { type: ENTITY_TYPE.CHANGE_HISTORY, entity: withoutKey },
        ]),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.VALIDATION });

      const dataset = await adapter.loadAll();
      expect(dataset.workRuns[0].tasks).toHaveLength(1);
      expect(dataset.changeHistory).toEqual([]);
    });

    it('空配列は何もしない', async () => {
      await expect(adapter.saveEntities([])).resolves.toBeUndefined();
      expect((await adapter.loadAll()).taskTemplates).toEqual([]);
    });

    it('1件でも主キーが無ければ全件を反映しない', async () => {
      const { templateId, ...withoutKey } = taskTemplate();

      await expect(
        adapter.saveEntities([
          { type: ENTITY_TYPE.TASK_TEMPLATES, entity: taskTemplate() },
          { type: ENTITY_TYPE.TASK_TEMPLATES, entity: withoutKey },
        ]),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.VALIDATION });

      expect((await adapter.loadAll()).taskTemplates).toEqual([]);
    });

    it('1件でも未知の種別があれば全件を反映しない', async () => {
      await expect(
        adapter.saveEntities([
          { type: ENTITY_TYPE.TASK_TEMPLATES, entity: taskTemplate() },
          { type: 'unknownStore', entity: {} },
        ]),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.VALIDATION });

      expect((await adapter.loadAll()).taskTemplates).toEqual([]);
    });

    it('案件IDが重複すれば全件を取り消す（仕様書8.2.6）', async () => {
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, projectGroup({ projectId: 'PJ-0001' }));

      await expect(
        adapter.saveEntities([
          { type: ENTITY_TYPE.TASK_TEMPLATES, entity: taskTemplate() },
          { type: ENTITY_TYPE.PROJECT_GROUPS, entity: projectGroup({ projectId: 'PJ-0001' }) },
        ]),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.CONSTRAINT });

      const dataset = await adapter.loadAll();
      expect(dataset.projectGroups).toHaveLength(1);
      // 同じ一括保存に含めたテンプレートも反映されない。
      expect(dataset.taskTemplates).toEqual([]);
    });

    it('配列でない引数は validation で失敗する', async () => {
      await expect(adapter.saveEntities(undefined)).rejects.toMatchObject({
        kind: STORAGE_ERROR_KIND.VALIDATION,
      });
    });
  });

  describe('deleteEntity()', () => {
    it('指定したキーだけを削除する', async () => {
      const kept = workRun();
      const removed = workRun();
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, kept);
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, removed);

      await adapter.deleteEntity(ENTITY_TYPE.WORK_RUNS, removed.runId);

      const dataset = await adapter.loadAll();
      expect(dataset.workRuns.map((run) => run.runId)).toEqual([kept.runId]);
    });

    it('存在しないキーの削除は失敗しない（冪等）', async () => {
      await expect(
        adapter.deleteEntity(ENTITY_TYPE.WORK_RUNS, 'run-missing'),
      ).resolves.toBeUndefined();
    });

    it('設定は削除できない', async () => {
      await expect(
        adapter.deleteEntity(ENTITY_TYPE.SETTINGS, 'singleton'),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.VALIDATION });

      const { settings } = await adapter.loadAll();
      expect(settings).not.toBeNull();
    });
  });

  describe('exportAll()', () => {
    it('仕様書9.2 のキーをすべて含む', async () => {
      const payload = await adapter.exportAll({
        exportedAt: '2026-07-30T12:34:56+09:00',
      });

      expect(Object.keys(payload).sort()).toEqual(
        [
          'changeHistory',
          'exportedAt',
          'projectGroups',
          'schemaVersion',
          'settings',
          'taskTemplates',
          'workRuns',
        ].sort(),
      );
      expect(payload.schemaVersion).toBe(SCHEMA_VERSION);
      expect(payload.exportedAt).toBe('2026-07-30T12:34:56+09:00');
    });

    it('changeHistory をエクスポート対象へ含む（仕様書9.2、決定事項G）', async () => {
      const history = historyEntry({ reason: '入力誤りのため取り消した' });
      await adapter.saveEntity(ENTITY_TYPE.CHANGE_HISTORY, history);

      const payload = await adapter.exportAll({ exportedAt: '2026-07-30T12:34:56+09:00' });
      expect(payload.changeHistory).toEqual([history]);
    });

    it('exportedAt を渡さなくても妥当なISO 8601を入れる', async () => {
      const payload = await adapter.exportAll();
      expect(payload.exportedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/,
      );
    });
  });

  describe('importAll()', () => {
    /** エクスポート往復で使う、全ストアに1件ずつ入ったデータ。 */
    async function seedAll() {
      const group = projectGroup();
      const template = taskTemplate();
      const run = workRun({ projectGroupId: group.projectGroupId, withTaskDetail: true });
      run.templateId = template.templateId;
      run.templateVersion = template.version;
      run.tasks = run.tasks.map((task, index) => ({
        ...task,
        taskDefinitionId: template.tasks[index % template.tasks.length].taskDefinitionId,
      }));
      await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, template);
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, group);
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, run);
      await adapter.saveEntity(ENTITY_TYPE.CHANGE_HISTORY, historyEntry());
    }

    it('エクスポート→インポートで全データが一致する（T-11）', async () => {
      await seedAll();
      const exported = await adapter.exportAll({ exportedAt: '2026-07-30T12:34:56+09:00' });

      const fresh = create();
      await fresh.initialize();
      await fresh.importAll(exported);
      const roundTrip = await fresh.exportAll({ exportedAt: '2026-07-30T12:34:56+09:00' });
      await fresh.close();

      expect(roundTrip).toEqual(exported);
    });

    it('差分マージではなく全置換である（仕様書9.3）', async () => {
      await seedAll();
      const empty = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: '2026-07-30T12:34:56+09:00',
        settings: createDefaultSettings(),
        taskTemplates: [],
        projectGroups: [],
        workRuns: [],
        changeHistory: [],
      };

      await adapter.importAll(empty);

      const dataset = await adapter.loadAll();
      expect(dataset.taskTemplates).toEqual([]);
      expect(dataset.projectGroups).toEqual([]);
      expect(dataset.workRuns).toEqual([]);
      expect(dataset.changeHistory).toEqual([]);
    });

    it('schemaVersion 不一致は schemaMismatch で拒否する（仕様書9.3、決定事項S）', async () => {
      await seedAll();
      const before = await adapter.loadAll();

      const error = await adapter
        .importAll({
          schemaVersion: SCHEMA_VERSION + 1,
          settings: createDefaultSettings(),
          taskTemplates: [],
          projectGroups: [],
          workRuns: [],
          changeHistory: [],
        })
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(StorageError);
      expect(error.kind).toBe(STORAGE_ERROR_KIND.SCHEMA_MISMATCH);
      expect(await adapter.loadAll()).toEqual(before);
    });

    it('必須キーが欠けたJSONは既存データを変えない（T-12、A-12）', async () => {
      await seedAll();
      const before = await adapter.loadAll();

      await expect(
        adapter.importAll({
          schemaVersion: SCHEMA_VERSION,
          settings: createDefaultSettings(),
          taskTemplates: [],
          // projectGroups と workRuns が欠けている
          changeHistory: [],
        }),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.VALIDATION });

      expect(await adapter.loadAll()).toEqual(before);
    });

    it('内容が不正な1件があると全体を取り込まない（T-12）', async () => {
      await seedAll();
      const before = await adapter.loadAll();
      const exported = await adapter.exportAll({ exportedAt: '2026-07-30T12:34:56+09:00' });
      // 数量を0にする。1以上の整数が必須（仕様書8.9.2）。
      exported.workRuns[0].runQuantity = 0;

      const error = await adapter.importAll(exported).catch((caught) => caught);

      expect(error.kind).toBe(STORAGE_ERROR_KIND.VALIDATION);
      expect(error.details.join('\n')).toContain('runQuantity');
      expect(await adapter.loadAll()).toEqual(before);
    });

    it('案件IDが重複していると実装共通のvalidationで拒否し既存データを変えない', async () => {
      await seedAll();
      const before = await adapter.loadAll();
      const exported = await adapter.exportAll({ exportedAt: '2026-07-30T12:34:56+09:00' });
      exported.projectGroups.push({
        ...exported.projectGroups[0],
        projectGroupId: 'another-group',
      });

      await expect(adapter.importAll(exported)).rejects.toMatchObject({
        kind: STORAGE_ERROR_KIND.VALIDATION,
      });
      expect(await adapter.loadAll()).toEqual(before);
    });

    it('オブジェクトでない値は validation で拒否する', async () => {
      await expect(adapter.importAll('壊れたJSON')).rejects.toMatchObject({
        kind: STORAGE_ERROR_KIND.VALIDATION,
      });
    });
  });

  describe('作業テンプレートの検索（active はメモリ上で絞り込む）', () => {
    /**
     * 同じ対象種別・バリエーションに有効版と旧版を置く。
     *
     * 旧版レコードは保持する（仕様書6.3）ため、索引で引いた結果には
     * 無効な版も含まれる。
     */
    async function seedTemplateVersions() {
      const seriesId = 'series-A-標準';
      await adapter.saveEntity(
        ENTITY_TYPE.TASK_TEMPLATES,
        taskTemplate({
          templateSeriesId: seriesId,
          templateId: 'template-v1',
          targetType: '対象種別A',
          variant: '標準',
          version: 1,
          active: false,
        }),
      );
      await adapter.saveEntity(
        ENTITY_TYPE.TASK_TEMPLATES,
        taskTemplate({
          templateSeriesId: seriesId,
          templateId: 'template-v2',
          targetType: '対象種別A',
          variant: '標準',
          version: 2,
          active: true,
        }),
      );
      // 別のバリエーション。索引の絞り込みに含まれてはいけない。
      await adapter.saveEntity(
        ENTITY_TYPE.TASK_TEMPLATES,
        taskTemplate({
          templateSeriesId: 'series-A-拡張',
          templateId: 'template-other',
          targetType: '対象種別A',
          variant: '拡張',
          version: 1,
          active: true,
        }),
      );
      return seriesId;
    }

    it('[targetType, variant] で引くと既定では全版を返す', async () => {
      await seedTemplateVersions();

      const found = await adapter.findTaskTemplates('対象種別A', '標準');
      expect(found.map((template) => template.templateId).sort()).toEqual([
        'template-v1',
        'template-v2',
      ]);
    });

    it('activeOnly で有効版だけへ絞り込む', async () => {
      await seedTemplateVersions();

      const found = await adapter.findTaskTemplates('対象種別A', '標準', {
        activeOnly: true,
      });
      expect(found).toHaveLength(1);
      expect(found[0].templateId).toBe('template-v2');
      expect(found[0].version).toBe(2);
    });

    it('active が true の版が無ければ空配列を返す', async () => {
      await adapter.saveEntity(
        ENTITY_TYPE.TASK_TEMPLATES,
        taskTemplate({
          templateId: 'template-retired',
          targetType: '対象種別C',
          variant: '標準',
          active: false,
        }),
      );

      expect(
        await adapter.findTaskTemplates('対象種別C', '標準', { activeOnly: true }),
      ).toEqual([]);
      // 索引自体は boolean を含まないため、無効版も引ける。
      expect(await adapter.findTaskTemplates('対象種別C', '標準')).toHaveLength(1);
    });

    it('バリエーションが違うものは含めない', async () => {
      await seedTemplateVersions();

      const found = await adapter.findTaskTemplates('対象種別A', '拡張', {
        activeOnly: true,
      });
      expect(found.map((template) => template.templateId)).toEqual(['template-other']);
    });

    it('該当が無ければ空配列を返す', async () => {
      await seedTemplateVersions();
      expect(await adapter.findTaskTemplates('対象種別Z', '標準')).toEqual([]);
    });

    it('版系列は templateSeriesId で辿れる（仕様書6.3）', async () => {
      const seriesId = await seedTemplateVersions();

      const series = await adapter.findTemplateSeries(seriesId);
      expect(series.map((template) => template.version).sort()).toEqual([1, 2]);
    });
  });

  describe('案件IDの検索（仕様書8.2.6）', () => {
    it('登録済みの案件IDを引ける', async () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      await adapter.saveEntity(ENTITY_TYPE.PROJECT_GROUPS, group);

      expect(await adapter.findProjectGroupByProjectId('PJ-0001')).toEqual(group);
    });

    it('未登録の案件IDは null を返す', async () => {
      expect(await adapter.findProjectGroupByProjectId('PJ-9999')).toBeNull();
    });
  });
});
