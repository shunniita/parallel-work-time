/**
 * 作業テンプレートの組み立てと改訂の単体テスト（仕様書8.1、6.3）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeTaskDefinitions,
  activeTemplates,
  buildTemplate,
  deactivate,
  nextOrder,
  normalizeExternalCode,
  normalizeTaskDefinitions,
  nextTemplateVersion,
  reviseTemplate,
  sortTaskDefinitions,
} from '../../src/domain/templateOps.js';
import { resetIds, taskTemplate, templateTask } from '../fixtures/builders.js';
import { MAX_ORDINAL } from '../../src/config.js';

/** 採番を決定的にするためのID生成器。 */
function idGenerator(prefix = 'new') {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
}

const CREATED_AT = '2026-07-31T10:00:00+09:00';

beforeEach(() => {
  resetIds();
});

describe('buildTemplate()', () => {
  /** 名称のみを指定した最小の下書き。 */
  function draft(overrides = {}) {
    return {
      targetType: '対象種別A',
      variant: '標準',
      tasks: [{ name: '受入確認', externalCode: 'X-100', order: 1, active: true }],
      ...overrides,
    };
  }

  it('版1・有効のテンプレートを組む', () => {
    const template = buildTemplate(draft(), {
      createdAt: CREATED_AT,
      templateSeriesId: 'series-1',
      templateId: 'template-1',
      newId: idGenerator(),
    });

    expect(template).toMatchObject({
      templateSeriesId: 'series-1',
      templateId: 'template-1',
      targetType: '対象種別A',
      variant: '標準',
      version: 1,
      active: true,
      createdAt: CREATED_AT,
    });
  });

  it('対象種別とバリエーションの前後空白を落とす', () => {
    const template = buildTemplate(
      draft({ targetType: '  対象種別A  ', variant: ' 標準 ' }),
      { createdAt: CREATED_AT, templateSeriesId: 's', templateId: 't', newId: idGenerator() },
    );

    expect(template.targetType).toBe('対象種別A');
    expect(template.variant).toBe('標準');
  });

  it('識別子の無い作業項目へ採番する', () => {
    const template = buildTemplate(draft(), {
      createdAt: CREATED_AT,
      templateSeriesId: 's',
      templateId: 't',
      newId: idGenerator('taskDef'),
    });

    expect(template.tasks[0].taskDefinitionId).toBe('taskDef-1');
  });
});

describe('reviseTemplate()', () => {
  /** 版1の既存テンプレート。作業項目2件。 */
  function current() {
    return taskTemplate({
      templateSeriesId: 'series-1',
      templateId: 'template-v1',
      version: 1,
      active: true,
      tasks: [
        { taskDefinitionId: 'def-a', name: '受入確認', externalCode: 'X-100', order: 1, active: true },
        { taskDefinitionId: 'def-b', name: '前処理', externalCode: 'X-200', order: 2, active: true },
      ],
    });
  }

  it('版番号を繰り上げる（仕様書8.1.3）', () => {
    const revised = reviseTemplate(current(), { tasks: current().tasks }, {
      createdAt: CREATED_AT,
      templateId: 'template-v2',
      newId: idGenerator(),
    });

    expect(revised.version).toBe(2);
  });

  it('templateSeriesId は改訂しても変わらない（仕様書6.3）', () => {
    const revised = reviseTemplate(current(), { tasks: current().tasks }, {
      createdAt: CREATED_AT,
      templateId: 'template-v2',
      newId: idGenerator(),
    });

    expect(revised.templateSeriesId).toBe('series-1');
  });

  it('templateId は版ごとに新規発行する（仕様書6.3）', () => {
    const revised = reviseTemplate(current(), { tasks: current().tasks }, {
      createdAt: CREATED_AT,
      templateId: 'template-v2',
      newId: idGenerator(),
    });

    expect(revised.templateId).toBe('template-v2');
    expect(revised.templateId).not.toBe('template-v1');
  });

  it('新しい版も有効である', () => {
    const revised = reviseTemplate(current(), { tasks: current().tasks }, {
      createdAt: CREATED_AT,
      templateId: 'template-v2',
      newId: idGenerator(),
    });

    expect(revised.active).toBe(true);
  });

  it('taskDefinitionId を引き継ぐ（版をまたいだ追跡、仕様書6.3）', () => {
    const revised = reviseTemplate(
      current(),
      { tasks: [{ ...current().tasks[0], name: '受入確認（改）' }, current().tasks[1]] },
      { createdAt: CREATED_AT, templateId: 'template-v2', newId: idGenerator() },
    );

    expect(revised.tasks.map((task) => task.taskDefinitionId)).toEqual(['def-a', 'def-b']);
    expect(revised.tasks[0].name).toBe('受入確認（改）');
  });

  it('追加した行だけ新しい識別子を採番する', () => {
    const revised = reviseTemplate(
      current(),
      { tasks: [...current().tasks, { name: '追加加工', externalCode: 'X-300', order: 3 }] },
      { createdAt: CREATED_AT, templateId: 'template-v2', newId: idGenerator('def') },
    );

    expect(revised.tasks.map((task) => task.taskDefinitionId)).toEqual([
      'def-a',
      'def-b',
      'def-1',
    ]);
  });

  it('改訂元のオブジェクトを書き換えない（仕様書8.1.4 を支える）', () => {
    const original = current();
    const snapshot = structuredClone(original);

    reviseTemplate(
      original,
      { tasks: [{ ...original.tasks[0], name: '書き換え' }] },
      { createdAt: CREATED_AT, templateId: 'template-v2', newId: idGenerator() },
    );

    expect(original).toEqual(snapshot);
  });

  it('対象種別とバリエーションは下書きで上書きできる', () => {
    const revised = reviseTemplate(
      current(),
      { targetType: '対象種別B', variant: '拡張', tasks: current().tasks },
      { createdAt: CREATED_AT, templateId: 'template-v2', newId: idGenerator() },
    );

    expect(revised.targetType).toBe('対象種別B');
    expect(revised.variant).toBe('拡張');
  });

  it('下書きに対象種別が無ければ改訂元を引き継ぐ', () => {
    const revised = reviseTemplate(current(), { tasks: current().tasks }, {
      createdAt: CREATED_AT,
      templateId: 'template-v2',
      newId: idGenerator(),
    });

    expect(revised.targetType).toBe('対象種別A');
    expect(revised.variant).toBe('標準');
  });
});

describe('deactivate()', () => {
  it('active を false にした複製を返す', () => {
    const template = taskTemplate({ active: true });

    expect(deactivate(template).active).toBe(false);
  });

  it('元のテンプレートを書き換えない（旧版レコードは保持する）', () => {
    const template = taskTemplate({ active: true });
    deactivate(template);

    expect(template.active).toBe(true);
  });

  it('作業項目の内容は変えない', () => {
    const template = taskTemplate();

    expect(deactivate(template).tasks).toEqual(template.tasks);
  });
});

describe('normalizeTaskDefinitions()', () => {
  it('表示順を1から振り直す', () => {
    const tasks = [
      { taskDefinitionId: 'a', name: 'A', externalCode: 'X-1', order: 10 },
      { taskDefinitionId: 'b', name: 'B', externalCode: 'X-2', order: 30 },
      { taskDefinitionId: 'c', name: 'C', externalCode: 'X-3', order: 20 },
    ];

    const normalized = normalizeTaskDefinitions(tasks, idGenerator());

    expect(normalized.map((task) => [task.name, task.order])).toEqual([
      ['A', 1],
      ['C', 2],
      ['B', 3],
    ]);
  });

  it('表示順が重複していても一意な並びになる', () => {
    const tasks = [
      { taskDefinitionId: 'a', name: 'A', order: 1 },
      { taskDefinitionId: 'b', name: 'B', order: 1 },
    ];

    expect(normalizeTaskDefinitions(tasks, idGenerator()).map((task) => task.order)).toEqual([
      1, 2,
    ]);
  });

  it('表示順が未設定の行は末尾へ送る', () => {
    const tasks = [
      { taskDefinitionId: 'a', name: 'A' },
      { taskDefinitionId: 'b', name: 'B', order: 1 },
    ];

    expect(normalizeTaskDefinitions(tasks, idGenerator()).map((task) => task.name)).toEqual([
      'B',
      'A',
    ]);
  });

  it('名称の前後空白を落とす', () => {
    const normalized = normalizeTaskDefinitions(
      [{ taskDefinitionId: 'a', name: '  受入確認  ', order: 1 }],
      idGenerator(),
    );

    expect(normalized[0].name).toBe('受入確認');
  });

  it('active の指定が無ければ有効として扱う', () => {
    const normalized = normalizeTaskDefinitions(
      [{ taskDefinitionId: 'a', name: 'A', order: 1 }],
      idGenerator(),
    );

    expect(normalized[0].active).toBe(true);
  });

  it('active が false なら保つ', () => {
    const normalized = normalizeTaskDefinitions(
      [{ taskDefinitionId: 'a', name: 'A', order: 1, active: false }],
      idGenerator(),
    );

    expect(normalized[0].active).toBe(false);
  });
});

describe('normalizeExternalCode()', () => {
  it.each([
    ['X-100', 'X-100'],
    ['  X-100  ', 'X-100'],
    ['', null],
    ['   ', null],
  ])('%o を %o へ寄せる', (input, expected) => {
    expect(normalizeExternalCode(input)).toBe(expected);
  });

  it.each([null, undefined, 42])('文字列でない %o は null になる（仕様書8.7.4）', (input) => {
    expect(normalizeExternalCode(input)).toBeNull();
  });
});

describe('sortTaskDefinitions()', () => {
  it('表示順の昇順で並べる', () => {
    const tasks = [
      templateTask({ name: 'B', order: 2 }),
      templateTask({ name: 'A', order: 1 }),
    ];

    expect(sortTaskDefinitions(tasks).map((task) => task.name)).toEqual(['A', 'B']);
  });

  it('元の配列を書き換えない', () => {
    const tasks = [
      templateTask({ name: 'B', order: 2 }),
      templateTask({ name: 'A', order: 1 }),
    ];
    sortTaskDefinitions(tasks);

    expect(tasks.map((task) => task.name)).toEqual(['B', 'A']);
  });

  it('表示順が同値なら元の並びを保つ', () => {
    const tasks = [
      templateTask({ name: 'B', order: 1 }),
      templateTask({ name: 'A', order: 1 }),
    ];

    expect(sortTaskDefinitions(tasks).map((task) => task.name)).toEqual(['B', 'A']);
  });
});

describe('activeTaskDefinitions()', () => {
  it('無効な項目を除き表示順で返す（仕様書8.1.5）', () => {
    const template = taskTemplate({
      tasks: [
        templateTask({ name: 'C', order: 3, active: true }),
        templateTask({ name: 'B', order: 2, active: false }),
        templateTask({ name: 'A', order: 1, active: true }),
      ],
    });

    expect(activeTaskDefinitions(template).map((task) => task.name)).toEqual(['A', 'C']);
  });

  it('すべて無効なら空配列を返す', () => {
    const template = taskTemplate({
      tasks: [templateTask({ active: false }), templateTask({ active: false })],
    });

    expect(activeTaskDefinitions(template)).toEqual([]);
  });
});

describe('nextOrder()', () => {
  it('最大の表示順へ1を足す', () => {
    expect(nextOrder([templateTask({ order: 1 }), templateTask({ order: 5 })])).toBe(6);
  });

  it('空の一覧では1を返す', () => {
    expect(nextOrder([])).toBe(1);
  });

  it('表示順が未設定の行しか無ければ1を返す', () => {
    expect(nextOrder([{ name: 'A' }])).toBe(1);
  });
});

describe('nextTemplateVersion()', () => {
  it('版番号の保存上限へ達した系列はこれ以上採番しない', () => {
    const template = taskTemplate({ templateSeriesId: 'series-1', version: MAX_ORDINAL });
    expect(nextTemplateVersion([template], 'series-1')).toBeNull();
  });
});

describe('activeTemplates()', () => {
  it('有効版のみを対象種別・バリエーションの順で返す', () => {
    const templates = [
      taskTemplate({ targetType: '対象種別B', variant: '標準', active: true }),
      taskTemplate({ targetType: '対象種別A', variant: '拡張', active: true }),
      taskTemplate({ targetType: '対象種別A', variant: '標準', active: false }),
      taskTemplate({ targetType: '対象種別A', variant: '標準', active: true }),
    ];

    expect(
      activeTemplates(templates).map((template) => `${template.targetType}/${template.variant}`),
    ).toEqual(['対象種別A/拡張', '対象種別A/標準', '対象種別B/標準']);
  });

  it('有効版が無ければ空配列を返す', () => {
    expect(activeTemplates([taskTemplate({ active: false })])).toEqual([]);
  });
});
