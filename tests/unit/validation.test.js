/**
 * 入力検証の単体テスト（仕様書8.9、8.1、8.2）。
 *
 * 以降のStepで検証が増えるたび、この節へ追加する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { warningMessages } from '../../src/domain/problems.js';
import {
  VALIDATION_WARNING,
  validateProjectGroupDraft,
  validateProjectIdAvailable,
  validateRunDraft,
  validateTemplateDraft,
  validateTemplateIsNew,
  validateTotalQuantityChange,
} from '../../src/domain/validation.js';
import { projectGroup, resetIds, taskTemplate, workRun } from '../fixtures/builders.js';

beforeEach(() => {
  resetIds();
});

/** 警告の文言をまとめて1つの文字列にする。 */
function warningText(result) {
  return warningMessages(result.warnings).join('\n');
}

describe('validateTemplateDraft()', () => {
  /** 検証を通る最小の下書き。 */
  function draft(overrides = {}) {
    return {
      targetType: '対象種別A',
      variant: '標準',
      tasks: [{ name: '受入確認', externalCode: 'X-100', order: 1, active: true }],
      ...overrides,
    };
  }

  it('正常な下書きを受け付ける', () => {
    const result = validateTemplateDraft(draft());

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each([null, undefined, '文字列', []])('%o は読み取れない', (value) => {
    expect(validateTemplateDraft(value).ok).toBe(false);
  });

  describe('対象種別とバリエーション（仕様書8.9.1）', () => {
    it.each(['', '   ', undefined, null, 42])('対象種別が %o なら失敗する', (targetType) => {
      const result = validateTemplateDraft(draft({ targetType }));

      expect(result.errors.join('\n')).toContain('対象種別');
    });

    it.each(['', '   ', undefined])('バリエーションが %o なら失敗する', (variant) => {
      const result = validateTemplateDraft(draft({ variant }));

      expect(result.errors.join('\n')).toContain('バリエーション');
    });
  });

  describe('作業項目', () => {
    it('0件なら失敗する', () => {
      const result = validateTemplateDraft(draft({ tasks: [] }));

      expect(result.errors.join('\n')).toContain('1件以上');
    });

    it('配列でなければ失敗する', () => {
      expect(validateTemplateDraft(draft({ tasks: {} })).ok).toBe(false);
    });

    it('名称が空なら失敗し、何件目かが分かる', () => {
      const result = validateTemplateDraft(
        draft({
          tasks: [
            { name: '受入確認', order: 1 },
            { name: '  ', order: 2 },
          ],
        }),
      );

      expect(result.errors).toContain('作業項目2の名称: 必須項目である');
    });

    it('外部項目コードが未設定でも通る（仕様書8.7.4）', () => {
      expect(
        validateTemplateDraft(draft({ tasks: [{ name: '後片付け', order: 1 }] })).ok,
      ).toBe(true);
    });

    it('外部項目コードが null でも通る', () => {
      expect(
        validateTemplateDraft(
          draft({ tasks: [{ name: '後片付け', externalCode: null, order: 1 }] }),
        ).ok,
      ).toBe(true);
    });

    it('外部項目コードが文字列以外なら失敗する', () => {
      const result = validateTemplateDraft(
        draft({ tasks: [{ name: 'A', externalCode: 100, order: 1 }] }),
      );

      expect(result.errors.join('\n')).toContain('外部項目コード');
    });

    it('表示順が小数なら失敗する', () => {
      const result = validateTemplateDraft(
        draft({ tasks: [{ name: 'A', order: 1.5 }] }),
      );

      expect(result.errors.join('\n')).toContain('表示順');
    });

    it('表示順が未設定でも通る（保存時に振り直すため）', () => {
      expect(validateTemplateDraft(draft({ tasks: [{ name: 'A' }] })).ok).toBe(true);
    });

    it('有効状態が真偽値以外なら失敗する', () => {
      const result = validateTemplateDraft(
        draft({ tasks: [{ name: 'A', order: 1, active: 'true' }] }),
      );

      expect(result.errors.join('\n')).toContain('有効状態');
    });

    it('作業項目名の重複は妨げない（仕様書8.9.9）', () => {
      expect(
        validateTemplateDraft(
          draft({
            tasks: [
              { name: '本作業', order: 1 },
              { name: '本作業', order: 2 },
            ],
          }),
        ).ok,
      ).toBe(true);
    });

    it('不備を複数まとめて返す', () => {
      const result = validateTemplateDraft({
        targetType: '',
        variant: '',
        tasks: [{ name: '' }],
      });

      expect(result.errors).toHaveLength(3);
    });
  });
});

describe('validateTemplateIsNew()', () => {
  it('同じ対象種別・バリエーションの有効版が無ければ通る', () => {
    const existing = [taskTemplate({ targetType: '対象種別A', variant: '標準' })];

    expect(
      validateTemplateIsNew(existing, { targetType: '対象種別B', variant: '標準' }).ok,
    ).toBe(true);
  });

  it('既に有効版があれば拒否し、版番号を示す', () => {
    const existing = [
      taskTemplate({ targetType: '対象種別A', variant: '標準', version: 3 }),
    ];

    const result = validateTemplateIsNew(existing, {
      targetType: '対象種別A',
      variant: '標準',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('版3');
    expect(result.errors.join('\n')).toContain('改訂');
  });

  it('前後空白を除いて突き合わせる', () => {
    const existing = [taskTemplate({ targetType: '対象種別A', variant: '標準' })];

    expect(
      validateTemplateIsNew(existing, { targetType: '  対象種別A ', variant: ' 標準  ' }).ok,
    ).toBe(false);
  });

  it('バリエーションが違えば通る', () => {
    const existing = [taskTemplate({ targetType: '対象種別A', variant: '標準' })];

    expect(
      validateTemplateIsNew(existing, { targetType: '対象種別A', variant: '拡張' }).ok,
    ).toBe(true);
  });

  it('既存が空なら通る', () => {
    expect(validateTemplateIsNew([], { targetType: '対象種別A', variant: '標準' }).ok).toBe(
      true,
    );
  });
});

describe('validateProjectGroupDraft()', () => {
  /** 検証を通る最小の下書き。 */
  function draft(overrides = {}) {
    return {
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
      totalQuantity: 100,
      ...overrides,
    };
  }

  it('正常な下書きを受け付ける', () => {
    const result = validateProjectGroupDraft(draft());

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each([null, undefined, '文字列', []])('%o は読み取れない', (value) => {
    expect(validateProjectGroupDraft(value).ok).toBe(false);
  });

  describe('必須項目（仕様書8.9.1）', () => {
    it.each([
      ['projectId', '案件ID'],
      ['targetType', '対象種別'],
      ['variant', 'バリエーション'],
    ])('%s が空なら失敗する', (key, label) => {
      const result = validateProjectGroupDraft(draft({ [key]: '   ' }));

      expect(result.errors.join('\n')).toContain(label);
    });

    it('総予定数が未設定なら失敗する', () => {
      const result = validateProjectGroupDraft(draft({ totalQuantity: undefined }));

      expect(result.errors.join('\n')).toContain('総予定数');
    });
  });

  describe('総予定数は1以上の整数（仕様書8.9.2）', () => {
    it.each([0, -1, 1.5, Number.NaN])('%o は失敗する', (totalQuantity) => {
      expect(validateProjectGroupDraft(draft({ totalQuantity })).ok).toBe(false);
    });

    it('文字列の "100" は受け付けない', () => {
      expect(validateProjectGroupDraft(draft({ totalQuantity: '100' })).ok).toBe(false);
    });

    it('1は通る', () => {
      expect(validateProjectGroupDraft(draft({ totalQuantity: 1 })).ok).toBe(true);
    });
  });
});

describe('validateProjectIdAvailable()', () => {
  /** 既存の案件グループ1件。 */
  function existing() {
    return [
      projectGroup({ projectId: 'PJ-0001', targetType: '対象種別A', variant: '標準' }),
    ];
  }

  it('未使用の案件IDは通る', () => {
    const result = validateProjectIdAvailable(existing(), 'PJ-0002');

    expect(result.ok).toBe(true);
    expect(result.conflict).toBeNull();
  });

  it('既存の案件IDは登録を禁止する（仕様書8.2.6）', () => {
    expect(validateProjectIdAvailable(existing(), 'PJ-0001').ok).toBe(false);
  });

  it('既存案件の対象種別とバリエーションをエラー文へ含める', () => {
    const message = validateProjectIdAvailable(existing(), 'PJ-0001').errors.join('\n');

    expect(message).toContain('対象種別A');
    expect(message).toContain('標準');
  });

  it('既存案件へ実施回を追加する導線を案内する', () => {
    const message = validateProjectIdAvailable(existing(), 'PJ-0001').errors.join('\n');

    expect(message).toContain('実施回を追加');
  });

  it('画面が導線を出せるよう conflict へ既存案件を返す', () => {
    const result = validateProjectIdAvailable(existing(), 'PJ-0001');

    expect(result.conflict).toMatchObject({
      projectId: 'PJ-0001',
      targetType: '対象種別A',
      variant: '標準',
    });
  });

  it('前後空白を除いて突き合わせる', () => {
    expect(validateProjectIdAvailable(existing(), '  PJ-0001  ').ok).toBe(false);
  });

  it('対象種別が違っても案件IDが同じなら禁止する（上書きさせない）', () => {
    const result = validateProjectIdAvailable(existing(), 'PJ-0001');

    // 案件IDが一意なので、対象種別を変えて登録し直す経路は作らない。
    expect(result.ok).toBe(false);
    expect(result.conflict.targetType).toBe('対象種別A');
  });

  it('大文字小文字が違えば別のIDとして扱う（仕様書8.9.9 と揃える）', () => {
    expect(validateProjectIdAvailable(existing(), 'pj-0001').ok).toBe(true);
  });

  it('空の案件IDでは重複判定を行わない（必須検証が受け持つ）', () => {
    const result = validateProjectIdAvailable(existing(), '   ');

    expect(result.ok).toBe(true);
    expect(result.conflict).toBeNull();
  });

  it('既存が空なら通る', () => {
    expect(validateProjectIdAvailable([], 'PJ-0001').ok).toBe(true);
  });
});

describe('validateRunDraft()', () => {
  /** 総予定数100・既存実施回50件の案件。 */
  function context(overrides = {}) {
    const group = projectGroup({ totalQuantity: 100 });
    return {
      projectGroup: group,
      runs: [workRun({ projectGroupId: group.projectGroupId, runQuantity: 50 })],
      generatableCount: 4,
      ...overrides,
    };
  }

  function draft(overrides = {}) {
    return { workDate: '2026-08-01', runQuantity: 50, ...overrides };
  }

  it('正常な下書きを受け付ける', () => {
    const result = validateRunDraft(draft(), context());

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each([null, undefined, '文字列'])('%o は読み取れない', (value) => {
    expect(validateRunDraft(value, context()).ok).toBe(false);
  });

  describe('作業日（仕様書8.2.4）', () => {
    it.each(['2026/08/01', '2026-8-1', '', '2026-02-30'])('%o は失敗する', (workDate) => {
      const result = validateRunDraft(draft({ workDate }), context());

      expect(result.errors.join('\n')).toContain('作業日');
    });

    it('同じ日付でも既存実施回があっても通る（仕様書8.2.3）', () => {
      const group = projectGroup({ totalQuantity: 200 });
      const same = context({
        projectGroup: group,
        runs: [
          workRun({ projectGroupId: group.projectGroupId, runQuantity: 50, workDate: '2026-08-01' }),
        ],
      });

      expect(validateRunDraft(draft({ workDate: '2026-08-01' }), same).ok).toBe(true);
    });
  });

  describe('今回数量は1以上の整数（仕様書8.9.2）', () => {
    it.each([0, -1, 1.5, undefined, '50'])('%o は失敗する', (runQuantity) => {
      expect(validateRunDraft(draft({ runQuantity }), context()).ok).toBe(false);
    });

    it('数量が不正なときは累計の先読みを行わない', () => {
      expect(validateRunDraft(draft({ runQuantity: 0 }), context()).preview).toBeNull();
    });
  });

  describe('累計超過（仕様書8.9.7）', () => {
    it('超過しても保存は止めない', () => {
      const result = validateRunDraft(draft({ runQuantity: 80 }), context());

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('超過を警告する', () => {
      const result = validateRunDraft(draft({ runQuantity: 80 }), context());

      expect(warningText(result)).toContain('総予定数');
      expect(warningText(result)).toContain('続行できる');
    });

    it('警告に累計超過の種別コードを付ける（レビュー指摘 D-15）', () => {
      const result = validateRunDraft(draft({ runQuantity: 80 }), context());

      expect(result.warnings).toEqual([
        {
          code: VALIDATION_WARNING.QUANTITY_OVERFLOW,
          path: '今回数量',
          message: expect.stringContaining('総予定数'),
        },
      ]);
    });

    it('超過分の数を示す', () => {
      const result = validateRunDraft(draft({ runQuantity: 80 }), context());

      // 既存50 + 今回80 = 130。総予定数100を30超える。
      expect(warningText(result)).toContain('30');
      expect(result.preview).toMatchObject({ accumulated: 130, overBy: 30, exceeded: true });
    });

    it('ちょうど総予定数に達しても警告しない', () => {
      const result = validateRunDraft(draft({ runQuantity: 50 }), context());

      expect(result.warnings).toEqual([]);
      expect(result.preview.remaining).toBe(0);
    });

    it('既存実施回の修正では古い数量を差し引いて判定する（仕様書8.2.7）', () => {
      const base = context();
      const target = base.runs[0];

      // 50 → 100 へ修正。累計は100でちょうど。超過しない。
      const result = validateRunDraft(draft({ runQuantity: 100 }), {
        ...base,
        excludeRunId: target.runId,
      });

      expect(result.warnings).toEqual([]);
      expect(result.preview.accumulated).toBe(100);
    });
  });

  describe('生成対象の作業項目（仕様書8.3.2）', () => {
    it('すべて除外すると失敗する', () => {
      const result = validateRunDraft(
        draft({ excludedTaskDefinitionIds: ['a', 'b', 'c', 'd'] }),
        context({ generatableCount: 4 }),
      );

      expect(result.errors.join('\n')).toContain('1件以上');
    });

    it('1件残れば通る', () => {
      const result = validateRunDraft(
        draft({ excludedTaskDefinitionIds: ['a', 'b', 'c'] }),
        context({ generatableCount: 4 }),
      );

      expect(result.ok).toBe(true);
    });

    it('生成可能な項目が0件なら失敗する', () => {
      const result = validateRunDraft(draft(), context({ generatableCount: 0 }));

      expect(result.errors.join('\n')).toContain('作業項目');
    });

    it('generatableCount を渡さなければ検査しない', () => {
      const base = context();
      delete base.generatableCount;

      expect(validateRunDraft(draft({ excludedTaskDefinitionIds: ['a'] }), base).ok).toBe(true);
    });
  });
});

describe('validateTotalQuantityChange()', () => {
  /** 累計80（50 + 30）。 */
  function runs() {
    return [workRun({ runQuantity: 50 }), workRun({ runQuantity: 30 })];
  }

  it('累計より大きい値へ修正すれば警告しない', () => {
    const result = validateTotalQuantityChange(runs(), 120);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.preview).toMatchObject({ accumulated: 80, remaining: 40 });
  });

  it('累計と同じ値なら警告しない', () => {
    expect(validateTotalQuantityChange(runs(), 80).warnings).toEqual([]);
  });

  it('累計より小さい値へ修正すると警告するが保存できる（仕様書8.9.7）', () => {
    const result = validateTotalQuantityChange(runs(), 60);

    expect(result.ok).toBe(true);
    expect(warningText(result)).toContain('続行できる');
    expect(result.warnings[0].code).toBe(VALIDATION_WARNING.QUANTITY_OVERFLOW);
    expect(result.preview).toMatchObject({ remaining: -20, overBy: 20, exceeded: true });
  });

  it.each([0, -1, 1.5, '100', undefined])('%o は失敗する（仕様書8.9.2）', (value) => {
    const result = validateTotalQuantityChange(runs(), value);

    expect(result.ok).toBe(false);
    expect(result.preview).toBeNull();
  });

  it('実施回が無ければ残数は総予定数そのもの', () => {
    expect(validateTotalQuantityChange([], 100).preview).toMatchObject({
      accumulated: 0,
      remaining: 100,
    });
  });
});
