/**
 * 起動処理とサンプルテンプレート初回投入の結合テスト
 * （仕様書5.2、8.1.6）。
 */

import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';
import { toIsoSecond } from '../../src/domain/datetime.js';
import { bootstrap, buildSeedTemplates } from '../../src/app/bootstrap.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { IndexedDbAdapter } from '../../src/storage/IndexedDbAdapter.js';
import { ENTITY_TYPE } from '../../src/storage/StorageAdapter.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import { taskTemplate } from '../fixtures/builders.js';

const SAMPLE_PATH = new URL('../../data/sample-task-templates.json', import.meta.url);
const FIXED_NOW = new Date('2026-07-30T09:00:00Z');

/** @returns {Promise<object>} */
async function readSample() {
  return JSON.parse(await readFile(SAMPLE_PATH, 'utf8'));
}

let dbSequence = 0;

const implementations = [
  { name: 'MemoryAdapter', create: () => new MemoryAdapter() },
  {
    name: 'IndexedDbAdapter',
    create: () => {
      dbSequence += 1;
      return new IndexedDbAdapter({ dbName: `pwt-bootstrap-${dbSequence}` });
    },
  },
];

describe.each(implementations)('bootstrap() / $name', ({ create }) => {
  /** @type {import('../../src/storage/StorageAdapter.js').StorageAdapter} */
  let adapter;
  /** @type {object} */
  let sample;

  beforeEach(async () => {
    adapter = create();
    sample = await readSample();
    return () => adapter.close();
  });

  it('初回起動で設定の既定値とサンプルテンプレートが入る', async () => {
    const { dataset, seededTemplateCount } = await bootstrap(adapter, {
      sampleTemplates: sample,
      now: FIXED_NOW,
    });

    expect(dataset.settings).toEqual({
      ...createDefaultSettings(),
      sampleTemplatesSeededAt: toIsoSecond(FIXED_NOW),
    });
    expect(seededTemplateCount).toBe(sample.templates.length);
    expect(dataset.taskTemplates).toHaveLength(sample.templates.length);
  });

  it('サンプルを投入したら、投入済みの印を残す', async () => {
    const { dataset } = await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });

    expect(dataset.settings.sampleTemplatesSeededAt).toBe(toIsoSecond(FIXED_NOW));
  });

  it('既にテンプレートを持つ利用者へは投入しないが、印は残す', async () => {
    await adapter.initialize();
    await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, taskTemplate());

    const { dataset, seededTemplateCount } = await bootstrap(adapter, {
      sampleTemplates: sample,
      now: FIXED_NOW,
    });

    expect(seededTemplateCount).toBe(0);
    expect(dataset.settings.sampleTemplatesSeededAt).toBe(toIsoSecond(FIXED_NOW));
  });

  it('2回目の起動では投入せず、件数も増えない', async () => {
    await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });
    const second = await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });

    expect(second.seededTemplateCount).toBe(0);
    expect(second.dataset.taskTemplates).toHaveLength(sample.templates.length);
  });

  it('投入済みの印があれば、テンプレート0件でも投入しない', async () => {
    await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });
    const before = await adapter.loadAll();
    for (const template of before.taskTemplates) {
      await adapter.deleteEntity(ENTITY_TYPE.TASK_TEMPLATES, template.templateId);
    }

    const { seededTemplateCount } = await bootstrap(adapter, {
      sampleTemplates: sample,
      now: FIXED_NOW,
    });

    expect(seededTemplateCount).toBe(0);
  });

  it('全テンプレートを削除しても、次の起動でサンプルを再投入しない', async () => {
    const first = await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });
    for (const template of first.dataset.taskTemplates) {
      await adapter.deleteEntity(ENTITY_TYPE.TASK_TEMPLATES, template.templateId);
    }
    expect((await adapter.loadAll()).taskTemplates).toHaveLength(0);

    const second = await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });

    expect(second.seededTemplateCount).toBe(0);
    expect(second.dataset.taskTemplates).toHaveLength(0);
  });

  it('テンプレートが1件でもあればサンプルを投入しない', async () => {
    await adapter.initialize();
    await adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, taskTemplate());

    const { seededTemplateCount, dataset } = await bootstrap(adapter, {
      sampleTemplates: sample,
      now: FIXED_NOW,
    });

    expect(seededTemplateCount).toBe(0);
    expect(dataset.taskTemplates).toHaveLength(1);
  });

  it('sampleTemplates を渡さなければ初期化のみ行う', async () => {
    const { dataset, seededTemplateCount } = await bootstrap(adapter);

    expect(seededTemplateCount).toBe(0);
    expect(dataset.taskTemplates).toEqual([]);
    expect(dataset.settings).toEqual(createDefaultSettings());
  });

  it('投入したテンプレートを [targetType, variant] の索引で引ける', async () => {
    await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });

    const found = await adapter.findTaskTemplates('対象種別A', '標準', {
      activeOnly: true,
    });
    expect(found).toHaveLength(1);
    expect(found[0].variant).toBe('標準');
    // T-01 の前提。対象種別A・標準に作業項目定義が入っていること。
    expect(found[0].tasks.length).toBeGreaterThan(0);
  });

  it('投入後のテンプレートは無効な作業項目定義も保持する（絞り込みは利用側で行う）', async () => {
    await bootstrap(adapter, { sampleTemplates: sample, now: FIXED_NOW });

    const [extended] = await adapter.findTaskTemplates('対象種別A', '拡張');
    // 実施回へ生成しないのは無効項目（仕様書8.1.5）だが、定義自体は残す。
    expect(extended.tasks.some((task) => task.active === false)).toBe(true);
  });
});

describe('buildSeedTemplates()', () => {
  it('createdAt に投入時刻を入れる', async () => {
    const templates = buildSeedTemplates(await readSample(), '2026-07-30T18:00:00+09:00');

    for (const template of templates) {
      expect(template.createdAt).toBe('2026-07-30T18:00:00+09:00');
    }
  });

  it('JSONに書かれた識別子をそのまま使う', async () => {
    const sample = await readSample();
    const templates = buildSeedTemplates(sample, '2026-07-30T18:00:00+09:00');

    expect(templates.map((template) => template.templateId)).toEqual(
      sample.templates.map((template) => template.templateId),
    );
  });

  it('サンプルの作業項目には確認用の externalCode がすべて設定されている', async () => {
    const templates = buildSeedTemplates(await readSample(), '2026-07-30T18:00:00+09:00');
    const codes = templates.flatMap((template) =>
      template.tasks.map((task) => task.externalCode),
    );

    expect(codes.every((code) => typeof code === 'string' && code !== '')).toBe(true);
  });

  it('schemaVersion が現行値と違うサンプルは拒否する', () => {
    expect(() =>
      buildSeedTemplates(
        { schemaVersion: SCHEMA_VERSION + 1, templates: [] },
        '2026-07-30T18:00:00+09:00',
      ),
    ).toThrow(/schemaVersion/);
  });

  it('templates が配列でないサンプルは拒否する', () => {
    expect(() =>
      buildSeedTemplates({ schemaVersion: SCHEMA_VERSION }, '2026-07-30T18:00:00+09:00'),
    ).toThrow(/templates/);
  });
});

describe('data/sample-task-templates.json', () => {
  it('投入した内容がインポート検証を通る形になっている', async () => {
    const templates = buildSeedTemplates(await readSample(), '2026-07-30T18:00:00+09:00');

    const result = validateImportPayload({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-30T18:00:00+09:00',
      settings: createDefaultSettings(),
      taskTemplates: templates,
      projectGroups: [],
      workRuns: [],
      changeHistory: [],
    });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('T-01 が使う対象種別A・標準を含む', async () => {
    const sample = await readSample();

    expect(
      sample.templates.some(
        (template) =>
          template.targetType === '対象種別A' &&
          template.variant === '標準' &&
          template.active === true,
      ),
    ).toBe(true);
  });

  it('同じ対象種別・バリエーションに有効版が重複しない', async () => {
    const sample = await readSample();
    const activeKeys = sample.templates
      .filter((template) => template.active === true)
      .map((template) => `${template.targetType}/${template.variant}`);

    expect(new Set(activeKeys).size).toBe(activeKeys.length);
  });
});
