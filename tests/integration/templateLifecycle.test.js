/**
 * テンプレートの複製・アーカイブ・復元・削除の結合テスト（仕様書8.1.7〜8.1.11）。
 *
 * 登録と改訂は `templateActions.test.js` が持つ。こちらは版を増やさずに有効版を
 * 出し入れする経路と、レコードを消す経路を扱う。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  archiveTemplateAction,
  createTemplate,
  deleteTemplateAction,
  restoreTemplateAction,
  reviseTemplateAction,
  toCopyDraft,
} from '../../src/app/actions/templateActions.js';
import { ValidationError } from '../../src/app/errors.js';
import { createPersistence } from '../../src/app/persistence.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { ENTITY_TYPE } from '../../src/storage/StorageAdapter.js';
import { toIsoSecond } from '../../src/domain/datetime.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import { activeTemplates, archivedTemplates } from '../../src/domain/templateOps.js';
import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';

const FIXED_NOW = new Date('2026-07-31T01:00:00Z');

function idGenerator() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `id-${sequence}`;
  };
}

function draft(overrides = {}) {
  return {
    targetType: '対象種別X',
    variant: '標準',
    tasks: [
      { name: '受入確認', externalCode: 'X-100', order: 1, active: true },
      { name: '本作業', externalCode: 'X-200', order: 2, active: true },
    ],
    ...overrides,
  };
}

function workRun(templateId, version) {
  return {
    runId: 'run-1',
    projectGroupId: 'group-1',
    templateId,
    templateVersion: version,
    workDate: '2026-07-31',
    quantity: 1,
    status: 'open',
    transferred: false,
    createdAt: toIsoSecond(FIXED_NOW),
    tasks: [],
  };
}

describe('テンプレートの複製・アーカイブ・削除', () => {
  /** @type {MemoryAdapter} */
  let adapter;
  /** @type {object} */
  let deps;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.initialize();
    const persistence = createPersistence(adapter, { now: () => FIXED_NOW });
    deps = { adapter, persistence, now: () => FIXED_NOW, newId: idGenerator() };
  });

  describe('toCopyDraft()', () => {
    it('作業項目の識別子を落とす', async () => {
      const { template } = await createTemplate(deps, draft());

      const copy = toCopyDraft(template);

      expect(template.tasks.every((task) => task.taskDefinitionId !== undefined)).toBe(true);
      expect(copy.tasks.every((task) => task.taskDefinitionId === undefined)).toBe(true);
    });

    it('名称と外部項目コードは引き継ぐ', async () => {
      const { template } = await createTemplate(deps, draft());

      expect(toCopyDraft(template).tasks).toMatchObject([
        { name: '受入確認', externalCode: 'X-100' },
        { name: '本作業', externalCode: 'X-200' },
      ]);
    });

    it('複製先の作業項目識別子は複製元と重ならない（仕様書6.3）', async () => {
      const { template } = await createTemplate(deps, draft());

      const copy = toCopyDraft(template);
      copy.variant = '短縮';
      const { template: created } = await createTemplate(deps, copy);

      const origin = new Set(template.tasks.map((task) => task.taskDefinitionId));
      expect(created.tasks.some((task) => origin.has(task.taskDefinitionId))).toBe(false);
    });

    it('複製先は別系列の版1になる', async () => {
      const { template } = await createTemplate(deps, draft());

      const copy = toCopyDraft(template);
      copy.variant = '短縮';
      const { template: created } = await createTemplate(deps, copy);

      expect(created.templateSeriesId).not.toBe(template.templateSeriesId);
      expect(created.version).toBe(1);
    });
  });

  describe('archiveTemplateAction()', () => {
    it('有効版から外すが、レコードは残る', async () => {
      const { template } = await createTemplate(deps, draft());

      const { dataset } = await archiveTemplateAction(deps, template.templateId);

      expect(activeTemplates(dataset.taskTemplates)).toHaveLength(0);
      expect(dataset.taskTemplates).toHaveLength(1);
    });

    it('版番号を繰り上げない', async () => {
      const { template } = await createTemplate(deps, draft());

      const result = await archiveTemplateAction(deps, template.templateId);

      expect(result.template.version).toBe(template.version);
    });

    it('アーカイブ済みを重ねてアーカイブしようとすると拒む', async () => {
      const { template } = await createTemplate(deps, draft());
      await archiveTemplateAction(deps, template.templateId);

      await expect(archiveTemplateAction(deps, template.templateId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('存在しない版は拒む', async () => {
      await expect(archiveTemplateAction(deps, 'missing')).rejects.toBeInstanceOf(ValidationError);
    });

    it('アーカイブ後は同じ組み合わせを新規登録できる', async () => {
      const { template } = await createTemplate(deps, draft());
      await archiveTemplateAction(deps, template.templateId);

      const { template: created } = await createTemplate(deps, draft());

      expect(created.version).toBe(1);
      expect(created.templateSeriesId).not.toBe(template.templateSeriesId);
    });

    it('アーカイブしたデータセットは取り込める', async () => {
      const { template } = await createTemplate(deps, draft());
      const { dataset } = await archiveTemplateAction(deps, template.templateId);

      const result = validateImportPayload({
        schemaVersion: SCHEMA_VERSION,
        settings: createDefaultSettings(),
        taskTemplates: dataset.taskTemplates,
        projectGroups: [],
        workRuns: [],
        changeHistory: [],
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('restoreTemplateAction()', () => {
    it('系列の最新版を有効へ戻す', async () => {
      const { template } = await createTemplate(deps, draft());
      const { template: revised } = await reviseTemplateAction(deps, template.templateId, draft());
      await archiveTemplateAction(deps, revised.templateId);

      const { dataset, template: restored } = await restoreTemplateAction(
        deps,
        revised.templateSeriesId,
      );

      expect(restored.templateId).toBe(revised.templateId);
      expect(restored.version).toBe(2);
      expect(activeTemplates(dataset.taskTemplates)).toHaveLength(1);
    });

    it('戻すときに版番号を繰り上げない', async () => {
      const { template } = await createTemplate(deps, draft());
      await archiveTemplateAction(deps, template.templateId);

      const { dataset } = await restoreTemplateAction(deps, template.templateSeriesId);

      expect(dataset.taskTemplates).toHaveLength(1);
      expect(dataset.taskTemplates[0].version).toBe(1);
    });

    it('同じ組み合わせが埋まっていると拒む', async () => {
      const { template } = await createTemplate(deps, draft());
      await archiveTemplateAction(deps, template.templateId);
      await createTemplate(deps, draft());

      await expect(restoreTemplateAction(deps, template.templateSeriesId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('アーカイブされていない系列は拒む', async () => {
      const { template } = await createTemplate(deps, draft());

      await expect(restoreTemplateAction(deps, template.templateSeriesId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('存在しない系列は拒む', async () => {
      await expect(restoreTemplateAction(deps, 'missing')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('deleteTemplateAction()', () => {
    it('参照されていない系列を全版まとめて消す', async () => {
      const { template } = await createTemplate(deps, draft());
      await reviseTemplateAction(deps, template.templateId, draft());

      const { dataset, removed } = await deleteTemplateAction(deps, template.templateSeriesId);

      expect(removed).toBe(2);
      expect(dataset.taskTemplates).toHaveLength(0);
    });

    it('別系列は消さない', async () => {
      const { template } = await createTemplate(deps, draft());
      const { template: other } = await createTemplate(
        deps,
        draft({ variant: '短縮' }),
      );

      const { dataset } = await deleteTemplateAction(deps, template.templateSeriesId);

      expect(dataset.taskTemplates).toHaveLength(1);
      expect(dataset.taskTemplates[0].templateId).toBe(other.templateId);
    });

    it('実施回から参照されていると拒む', async () => {
      const { template } = await createTemplate(deps, draft());
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun(template.templateId, 1));

      await expect(deleteTemplateAction(deps, template.templateSeriesId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('参照されているのが旧版でも拒む', async () => {
      const { template } = await createTemplate(deps, draft());
      const { template: revised } = await reviseTemplateAction(deps, template.templateId, draft());
      // 実施回は生成時の版を指し続ける。改訂しても参照は旧版のままである。
      await adapter.saveEntity(ENTITY_TYPE.WORK_RUNS, workRun(template.templateId, 1));

      await expect(deleteTemplateAction(deps, revised.templateSeriesId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('存在しない系列は拒む', async () => {
      await expect(deleteTemplateAction(deps, 'missing')).rejects.toBeInstanceOf(ValidationError);
    });

    it('削除後のデータセットは取り込める', async () => {
      const { template } = await createTemplate(deps, draft());
      const { dataset } = await deleteTemplateAction(deps, template.templateSeriesId);

      const result = validateImportPayload({
        schemaVersion: SCHEMA_VERSION,
        settings: createDefaultSettings(),
        taskTemplates: dataset.taskTemplates,
        projectGroups: [],
        workRuns: [],
        changeHistory: [],
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('archivedTemplates()', () => {
    it('アーカイブ済みの系列を最新版1件で返す', async () => {
      const { template } = await createTemplate(deps, draft());
      const { template: revised } = await reviseTemplateAction(deps, template.templateId, draft());
      const { dataset } = await archiveTemplateAction(deps, revised.templateId);

      const list = archivedTemplates(dataset.taskTemplates);

      expect(list).toHaveLength(1);
      expect(list[0].version).toBe(2);
    });

    it('有効版が残っている系列は含めない', async () => {
      const { template } = await createTemplate(deps, draft());
      await reviseTemplateAction(deps, template.templateId, draft());

      const dataset = await adapter.loadAll();

      expect(archivedTemplates(dataset.taskTemplates)).toHaveLength(0);
    });
  });
});
