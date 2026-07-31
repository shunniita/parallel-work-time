/**
 * テンプレート→実施回の値複製の単体テスト（仕様書6.3、8.1.4、8.3）。
 *
 * A-09（テンプレート改訂が既存実施回へ自動反映しない）の土台にあたる。ここでは
 * 「複製が参照を持たないこと」を固定し、通しの流れは
 * `tests/integration/projectActions.test.js` で確認する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  INITIAL_RUN_STATUS,
  generatableTasks,
  instantiateProjectGroup,
  instantiateRun,
  instantiateTask,
  normalizeProjectId,
} from '../../src/domain/templateInstantiate.js';
import { resetIds, taskTemplate, templateTask } from '../fixtures/builders.js';

const CREATED_AT = '2026-08-01T09:00:00+09:00';

function idGenerator(prefix = 'task') {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
}

/** 有効4件・無効1件のテンプレート。 */
function template() {
  return taskTemplate({
    templateId: 'template-v1',
    version: 1,
    tasks: [
      templateTask({ name: '受入確認', externalCode: 'X-100', order: 1, active: true }),
      templateTask({ name: '前処理', externalCode: 'X-200', order: 2, active: true }),
      templateTask({ name: '旧手順', externalCode: 'X-900', order: 3, active: false }),
      templateTask({ name: '本作業', externalCode: 'X-1000', order: 4, active: true }),
      templateTask({ name: '後片付け', externalCode: null, order: 5, active: true }),
    ],
  });
}

beforeEach(() => {
  resetIds();
});

describe('generatableTasks()', () => {
  it('有効な作業項目のみを表示順で返す（仕様書8.1.5、8.3.1）', () => {
    expect(generatableTasks(template()).map((task) => task.name)).toEqual([
      '受入確認',
      '前処理',
      '本作業',
      '後片付け',
    ]);
  });

  it('無効な作業項目は候補に含めない', () => {
    expect(generatableTasks(template()).map((task) => task.name)).not.toContain('旧手順');
  });
});

describe('instantiateTask()', () => {
  it('テンプレートの定義値を複製する（仕様書6.6）', () => {
    const definition = templateTask({ name: '本作業', externalCode: 'X-1000', order: 4 });

    const task = instantiateTask(definition, { taskRecordId: 'task-1' });

    expect(task).toEqual({
      taskRecordId: 'task-1',
      taskDefinitionId: definition.taskDefinitionId,
      name: '本作業',
      externalCode: 'X-1000',
      order: 4,
      manuallyAdded: false,
      intervals: [],
      directEntries: [],
    });
  });

  it('外部項目コード未設定を null のまま複製する（仕様書8.7.4）', () => {
    const task = instantiateTask(templateTask({ externalCode: null }), {
      taskRecordId: 'task-1',
    });

    expect(task.externalCode).toBeNull();
  });

  it('manuallyAdded は常に false（仕様書8.3.3 は初版見送り）', () => {
    expect(instantiateTask(templateTask(), { taskRecordId: 't' }).manuallyAdded).toBe(false);
  });

  it('テンプレート定義を後から書き換えても複製は変わらない', () => {
    const definition = templateTask({ name: '本作業', externalCode: 'X-1000' });
    const task = instantiateTask(definition, { taskRecordId: 'task-1' });

    definition.name = '書き換え';
    definition.externalCode = 'Z-999';

    expect(task.name).toBe('本作業');
    expect(task.externalCode).toBe('X-1000');
  });
});

describe('instantiateRun()', () => {
  /** 既定の入力。 */
  function input(overrides = {}) {
    return {
      template: template(),
      projectGroupId: 'group-1',
      workDate: '2026-08-01',
      runQuantity: 50,
      ...overrides,
    };
  }

  function context(overrides = {}) {
    return {
      createdAt: CREATED_AT,
      runId: 'run-1',
      newId: idGenerator(),
      ...overrides,
    };
  }

  it('作業中で始まる（仕様書7.1「新規 → 作業中」）', () => {
    expect(instantiateRun(input(), context()).status).toBe(INITIAL_RUN_STATUS);
    expect(instantiateRun(input(), context()).status).toBe('working');
  });

  it('有効な作業項目のみを生成する（仕様書8.1.5、A-01）', () => {
    const run = instantiateRun(input(), context());

    expect(run.tasks.map((task) => task.name)).toEqual([
      '受入確認',
      '前処理',
      '本作業',
      '後片付け',
    ]);
  });

  it('生成元の版を記録する（仕様書8.1.4、A-09）', () => {
    const run = instantiateRun(input(), context());

    expect(run.templateId).toBe('template-v1');
    expect(run.templateVersion).toBe(1);
  });

  it('転記日時とアーカイブ日時は null で始まる（仕様書6.5）', () => {
    const run = instantiateRun(input(), context());

    expect(run.transferredAt).toBeNull();
    expect(run.archivedAt).toBeNull();
  });

  it('区間と直接入力は空で始まる', () => {
    const run = instantiateRun(input(), context());

    for (const task of run.tasks) {
      expect(task.intervals).toEqual([]);
      expect(task.directEntries).toEqual([]);
    }
  });

  it('作業項目実績へ一意な識別子を採番する', () => {
    const run = instantiateRun(input(), context());

    expect(new Set(run.tasks.map((task) => task.taskRecordId)).size).toBe(run.tasks.length);
  });

  describe('生成対象の除外（仕様書8.3.2）', () => {
    it('指定した作業項目を生成しない', () => {
      const source = template();
      const excludedId = source.tasks[1].taskDefinitionId;

      const run = instantiateRun(
        input({ template: source, excludedTaskDefinitionIds: [excludedId] }),
        context(),
      );

      expect(run.tasks.map((task) => task.name)).toEqual(['受入確認', '本作業', '後片付け']);
    });

    it('複数を除外できる', () => {
      const source = template();
      const excluded = [source.tasks[0].taskDefinitionId, source.tasks[3].taskDefinitionId];

      const run = instantiateRun(
        input({ template: source, excludedTaskDefinitionIds: excluded }),
        context(),
      );

      expect(run.tasks.map((task) => task.name)).toEqual(['前処理', '後片付け']);
    });

    it('無効な作業項目を除外指定しても影響しない', () => {
      const source = template();
      const inactiveId = source.tasks[2].taskDefinitionId;

      const run = instantiateRun(
        input({ template: source, excludedTaskDefinitionIds: [inactiveId] }),
        context(),
      );

      expect(run.tasks).toHaveLength(4);
    });

    it('除外指定が空なら全有効項目を生成する', () => {
      const run = instantiateRun(input({ excludedTaskDefinitionIds: [] }), context());

      expect(run.tasks).toHaveLength(4);
    });
  });

  it('生成後にテンプレートを書き換えても実施回は変わらない（仕様書8.1.4）', () => {
    const source = template();
    const run = instantiateRun(input({ template: source }), context());
    const snapshot = structuredClone(run.tasks);

    source.tasks[0].name = '書き換え';
    source.tasks[0].externalCode = 'Z-999';
    source.tasks[0].order = 99;
    source.tasks[0].active = false;
    source.version = 2;

    expect(run.tasks).toEqual(snapshot);
    expect(run.templateVersion).toBe(1);
  });
});

describe('instantiateProjectGroup()', () => {
  function draft(overrides = {}) {
    return {
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
      totalQuantity: 100,
      ...overrides,
    };
  }

  it('案件グループを組む（仕様書6.4）', () => {
    const group = instantiateProjectGroup(draft(), {
      createdAt: CREATED_AT,
      projectGroupId: 'group-1',
    });

    expect(group).toEqual({
      projectGroupId: 'group-1',
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
      totalQuantity: 100,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('案件IDと対象種別の前後空白を落とす', () => {
    const group = instantiateProjectGroup(
      draft({ projectId: '  PJ-0001  ', targetType: ' 対象種別A ', variant: ' 標準 ' }),
      { createdAt: CREATED_AT, projectGroupId: 'group-1' },
    );

    expect(group.projectId).toBe('PJ-0001');
    expect(group.targetType).toBe('対象種別A');
    expect(group.variant).toBe('標準');
  });
});

describe('normalizeProjectId()', () => {
  it.each([
    ['PJ-0001', 'PJ-0001'],
    ['  PJ-0001  ', 'PJ-0001'],
    ['', ''],
    ['   ', ''],
  ])('%o を %o へ寄せる', (input, expected) => {
    expect(normalizeProjectId(input)).toBe(expected);
  });

  it.each([null, undefined])('%o は空文字になる', (input) => {
    expect(normalizeProjectId(input)).toBe('');
  });

  it('全角半角と大文字小文字は畳み込まない（仕様書8.9.9 と揃える）', () => {
    expect(normalizeProjectId('ＰＪ-0001')).toBe('ＰＪ-0001');
    expect(normalizeProjectId('pj-0001')).toBe('pj-0001');
  });

  it('内部の空白は保つ', () => {
    expect(normalizeProjectId(' PJ 0001 ')).toBe('PJ 0001');
  });
});
