/**
 * 入力検証の単体テスト（仕様書8.9、8.1）。
 *
 * Step 4 の時点では作業テンプレートの下書きのみを扱う。以降のStepで検証が
 * 増えるたび、この節へ追加する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  validateTemplateDraft,
  validateTemplateIsNew,
} from '../../src/domain/validation.js';
import { resetIds, taskTemplate } from '../fixtures/builders.js';

beforeEach(() => {
  resetIds();
});

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
