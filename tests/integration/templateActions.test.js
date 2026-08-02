/**
 * テンプレート登録・改訂の結合テスト（仕様書8.1、6.3、9.1）。
 *
 * アダプターは差し替えられる契約なので、既定は MemoryAdapter で回し、
 * 保存の往復が絡む節だけ IndexedDbAdapter も通す。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTemplate,
  reviseTemplateAction,
  toDraft,
} from '../../src/app/actions/templateActions.js';
import { ValidationError } from '../../src/app/errors.js';
import { SAVE_STATE, createPersistence } from '../../src/app/persistence.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { IndexedDbAdapter } from '../../src/storage/IndexedDbAdapter.js';
import { ENTITY_TYPE, STORAGE_ERROR_KIND, StorageError } from '../../src/storage/StorageAdapter.js';
import { activeTemplates } from '../../src/domain/templateOps.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';

const FIXED_NOW = new Date('2026-07-31T01:00:00Z');

/** 決定的な採番。 */
function idGenerator() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `id-${sequence}`;
  };
}

/** 検証を通る下書き。 */
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

describe('templateActions', () => {
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

  describe('createTemplate()', () => {
    it('版1・有効で保存する', async () => {
      const { dataset, template } = await createTemplate(deps, draft());

      expect(template.version).toBe(1);
      expect(template.active).toBe(true);
      expect(dataset.taskTemplates).toHaveLength(1);
    });

    it('版系列の識別子と版の識別子を別々に採番する（仕様書6.3）', async () => {
      const { template } = await createTemplate(deps, draft());

      expect(template.templateSeriesId).not.toBe(template.templateId);
    });

    it('createdAt に現在日時を入れる', async () => {
      const { template } = await createTemplate(deps, draft());

      expect(template.createdAt).toBe('2026-07-31T10:00:00+09:00');
    });

    it('保存成功を通知する（仕様書9.1）', async () => {
      await createTemplate(deps, draft());

      expect(persistence.getStatus()).toMatchObject({
        state: SAVE_STATE.SAVED,
        message: '保存しました',
      });
    });

    it('索引で有効版として引ける', async () => {
      await createTemplate(deps, draft());

      const found = await adapter.findTaskTemplates('対象種別X', '標準', { activeOnly: true });
      expect(found).toHaveLength(1);
    });

    it('保存できる形になっている（インポート検証を通る）', async () => {
      const { template } = await createTemplate(deps, draft());

      const result = validateImportPayload({
        schemaVersion: SCHEMA_VERSION,
        settings: createDefaultSettings(),
        taskTemplates: [template],
        projectGroups: [],
        workRuns: [],
        changeHistory: [],
      });
      expect(result.errors).toEqual([]);
    });

    describe('検証で拒否する場合', () => {
      it('対象種別が空なら ValidationError を投げる', async () => {
        await expect(createTemplate(deps, draft({ targetType: '' }))).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it('作業項目0件なら ValidationError を投げる', async () => {
        await expect(createTemplate(deps, draft({ tasks: [] }))).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it('検証失敗時は保存を呼ばない', async () => {
        const spy = vi.spyOn(adapter, 'saveEntity');

        await expect(createTemplate(deps, draft({ targetType: '' }))).rejects.toThrow();

        expect(spy).not.toHaveBeenCalled();
        expect((await adapter.loadAll()).taskTemplates).toEqual([]);
      });

      it('検証失敗時は保存状態を変えない', async () => {
        await expect(createTemplate(deps, draft({ targetType: '' }))).rejects.toThrow();

        expect(persistence.getStatus().state).toBe(SAVE_STATE.IDLE);
      });

      it('errors に場所と説明が入る', async () => {
        const error = await createTemplate(deps, draft({ targetType: '' })).catch((caught) => caught);

        expect(error.errors.join('\n')).toContain('対象種別');
      });
    });

    it('同一の対象種別×バリエーションへの重複登録を拒否する', async () => {
      await createTemplate(deps, draft());

      const error = await createTemplate(deps, draft()).catch((caught) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.errors.join('\n')).toContain('改訂');
      expect((await adapter.loadAll()).taskTemplates).toHaveLength(1);
    });

    it('無効版があれば同じ組み合わせで新規登録できる', async () => {
      const { template } = await createTemplate(deps, draft());
      await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, { ...template, active: false });

      await expect(createTemplate(deps, draft())).resolves.toBeDefined();
    });

    it('バリエーションが違えば登録できる', async () => {
      await createTemplate(deps, draft());

      await expect(createTemplate(deps, draft({ variant: '拡張' }))).resolves.toBeDefined();
    });
  });

  describe('reviseTemplateAction()', () => {
    /** 版1を登録し、その版を返す。 */
    async function seedVersion1() {
      const { template } = await createTemplate(deps, draft());
      return template;
    }

    it('版を繰り上げて保存する（仕様書8.1.3）', async () => {
      const v1 = await seedVersion1();

      const { template: v2 } = await reviseTemplateAction(deps, v1.templateId, {
        ...toDraft(v1),
        tasks: [...toDraft(v1).tasks, { name: '追加加工', externalCode: 'X-300', order: 3 }],
      });

      expect(v2.version).toBe(2);
      expect(v2.templateSeriesId).toBe(v1.templateSeriesId);
      expect(v2.templateId).not.toBe(v1.templateId);
    });

    it('旧版のレコードが残る（仕様書6.3）', async () => {
      const v1 = await seedVersion1();

      const { dataset } = await reviseTemplateAction(deps, v1.templateId, toDraft(v1));

      expect(dataset.taskTemplates).toHaveLength(2);
      expect(
        dataset.taskTemplates.find((template) => template.templateId === v1.templateId),
      ).toBeDefined();
    });

    it('有効版が2つ並ばない', async () => {
      const v1 = await seedVersion1();

      const { dataset } = await reviseTemplateAction(deps, v1.templateId, toDraft(v1));

      const active = activeTemplates(dataset.taskTemplates);
      expect(active).toHaveLength(1);
      expect(active[0].version).toBe(2);
    });

    it('旧版は active が false になる', async () => {
      const v1 = await seedVersion1();

      const { dataset } = await reviseTemplateAction(deps, v1.templateId, toDraft(v1));

      const old = dataset.taskTemplates.find(
        (template) => template.templateId === v1.templateId,
      );
      expect(old.active).toBe(false);
      // 作業項目の内容は旧版のまま保持される。
      expect(old.tasks).toEqual(v1.tasks);
    });

    it('3回改訂すると版3が有効で、版1・2が残る', async () => {
      const v1 = await seedVersion1();
      const { template: v2 } = await reviseTemplateAction(deps, v1.templateId, toDraft(v1));
      const { dataset } = await reviseTemplateAction(deps, v2.templateId, toDraft(v2));

      expect(dataset.taskTemplates.map((template) => template.version).sort()).toEqual([1, 2, 3]);
      expect(activeTemplates(dataset.taskTemplates)[0].version).toBe(3);
    });

    it('taskDefinitionId を引き継ぐ（版をまたいだ追跡）', async () => {
      const v1 = await seedVersion1();

      const { template: v2 } = await reviseTemplateAction(deps, v1.templateId, {
        ...toDraft(v1),
        tasks: toDraft(v1).tasks.map((task) => ({ ...task, name: `${task.name}（改）` })),
      });

      expect(v2.tasks.map((task) => task.taskDefinitionId)).toEqual(
        v1.tasks.map((task) => task.taskDefinitionId),
      );
    });

    it('作業項目を無効化できる（仕様書8.1.2）', async () => {
      const v1 = await seedVersion1();

      const { template: v2 } = await reviseTemplateAction(deps, v1.templateId, {
        ...toDraft(v1),
        tasks: [{ ...v1.tasks[0] }, { ...v1.tasks[1], active: false }],
      });

      expect(v2.tasks.map((task) => task.active)).toEqual([true, false]);
    });

    it('改訂元が見つからなければ ValidationError を投げる', async () => {
      await expect(
        reviseTemplateAction(deps, 'template-missing', draft()),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('旧版からは改訂できない（有効版が2つ並ばない）', async () => {
      const v1 = await seedVersion1();
      await reviseTemplateAction(deps, v1.templateId, toDraft(v1));

      // 版1は無効化済み。ここから改訂できると、本当の有効版（版2）が残ったまま
      // 新版も active: true で保存され、同一の対象種別×バリエーションに有効版が
      // 2つ並ぶ。
      await expect(
        reviseTemplateAction(deps, v1.templateId, toDraft(v1)),
      ).rejects.toBeInstanceOf(ValidationError);

      const dataset = await adapter.loadAll();
      expect(activeTemplates(dataset.taskTemplates)).toHaveLength(1);
      expect(dataset.taskTemplates).toHaveLength(2);
    });

    it('版番号は系列内の最大版を基準に繰り上げる', async () => {
      const v1 = await seedVersion1();
      const { template: v2 } = await reviseTemplateAction(deps, v1.templateId, toDraft(v1));
      const { template: v3 } = await reviseTemplateAction(deps, v2.templateId, toDraft(v2));

      expect(v3.version).toBe(3);
      const versions = (await adapter.loadAll()).taskTemplates
        .map((template) => template.version)
        .sort();
      expect(new Set(versions).size).toBe(versions.length);
    });

    it('検証失敗時は保存を呼ばない', async () => {
      const v1 = await seedVersion1();
      const spy = vi.spyOn(adapter, 'saveEntities');

      await expect(
        reviseTemplateAction(deps, v1.templateId, { ...toDraft(v1), tasks: [] }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(spy).not.toHaveBeenCalled();
      expect((await adapter.loadAll()).taskTemplates).toHaveLength(1);
    });

    it('保存が途中で失敗すれば改訂が反映されない（仕様書9.1）', async () => {
      const v1 = await seedVersion1();
      vi.spyOn(adapter, 'saveEntities').mockRejectedValue(
        new StorageError(STORAGE_ERROR_KIND.QUOTA, '保存領域が不足'),
      );

      await expect(
        reviseTemplateAction(deps, v1.templateId, toDraft(v1)),
      ).rejects.toMatchObject({ kind: STORAGE_ERROR_KIND.QUOTA });

      const dataset = await adapter.loadAll();
      expect(dataset.taskTemplates).toHaveLength(1);
      expect(dataset.taskTemplates[0].active).toBe(true);
      expect(dataset.taskTemplates[0].version).toBe(1);
    });

    it('容量超過はエクスポートと削除を促す文言で通知する（仕様書9.1）', async () => {
      const v1 = await seedVersion1();
      vi.spyOn(adapter, 'saveEntities').mockRejectedValue(
        new StorageError(STORAGE_ERROR_KIND.QUOTA, '保存領域が不足'),
      );

      await expect(reviseTemplateAction(deps, v1.templateId, toDraft(v1))).rejects.toThrow();

      const status = persistence.getStatus();
      expect(status.state).toBe(SAVE_STATE.FAILED);
      expect(status.message).toContain('エクスポート');
    });
  });

  describe('toDraft()', () => {
    it('作業項目を複製し、下書きの編集が元へ及ばない', async () => {
      const { template } = await createTemplate(deps, draft());

      const editable = toDraft(template);
      editable.tasks[0].name = '書き換え';

      expect(template.tasks[0].name).toBe('受入確認');
    });
  });
});

describe('templateActions / IndexedDbAdapter での往復', () => {
  it('改訂結果が再読込後も保たれる（仕様書9.1）', async () => {
    const adapter = new IndexedDbAdapter({ dbName: 'pwt-template-actions' });
    await adapter.initialize();
    const persistence = createPersistence(adapter, { now: () => FIXED_NOW });
    const deps = { adapter, persistence, now: () => FIXED_NOW, newId: idGenerator() };

    const { template: v1 } = await createTemplate(deps, draft());
    await reviseTemplateAction(deps, v1.templateId, {
      ...toDraft(v1),
      tasks: [{ ...v1.tasks[0], name: '受入確認（改）' }],
    });
    await adapter.close();

    const reopened = new IndexedDbAdapter({ dbName: 'pwt-template-actions' });
    await reopened.initialize();
    const active = await reopened.findTaskTemplates('対象種別X', '標準', { activeOnly: true });
    const series = await reopened.findTemplateSeries(v1.templateSeriesId);
    await reopened.close();

    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);
    expect(active[0].tasks[0].name).toBe('受入確認（改）');
    // 旧版レコードは保持される（仕様書6.3）。
    expect(series.map((template) => template.version).sort()).toEqual([1, 2]);
  });
});
