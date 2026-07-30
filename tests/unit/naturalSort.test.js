import { describe, expect, it } from 'vitest';

import {
  compareExternalCode,
  compareNatural,
  isExternalCodeMissing,
  sortByExternalCode,
} from '../../src/domain/naturalSort.js';

describe('compareNatural', () => {
  it('数値部分を数値として比較する（仕様書8.7.3）', () => {
    // 辞書順では X-10 が X-2 より前になってしまう。
    expect(compareNatural('X-2', 'X-10')).toBeLessThan(0);
    expect(compareNatural('X-10', 'X-2')).toBeGreaterThan(0);
  });

  it('同一の文字列は0を返す', () => {
    expect(compareNatural('X-100', 'X-100')).toBe(0);
  });

  it('接頭辞が異なる場合は文字列として比較する', () => {
    expect(compareNatural('A-100', 'B-1')).toBeLessThan(0);
  });

  it('0埋めの差は桁数の少ない方を前へ置く', () => {
    expect(compareNatural('X-01', 'X-1')).toBeGreaterThan(0);
    expect(compareNatural('X-1', 'X-01')).toBeLessThan(0);
  });

  it('前方が一致する場合は短い方を前へ置く', () => {
    expect(compareNatural('X-1', 'X-1-A')).toBeLessThan(0);
  });

  it('複数の数値部分を順に比較する', () => {
    expect(compareNatural('X-1-9', 'X-1-10')).toBeLessThan(0);
    expect(compareNatural('X-2-1', 'X-1-99')).toBeGreaterThan(0);
  });

  it('並べ替えに使うと数値順になる', () => {
    const sorted = ['X-10', 'X-2', 'X-1', 'X-20'].sort(compareNatural);
    expect(sorted).toEqual(['X-1', 'X-2', 'X-10', 'X-20']);
  });
});

describe('isExternalCodeMissing', () => {
  it('null・undefined・空白のみを未設定とみなす', () => {
    expect(isExternalCodeMissing(null)).toBe(true);
    expect(isExternalCodeMissing(undefined)).toBe(true);
    expect(isExternalCodeMissing('')).toBe(true);
    expect(isExternalCodeMissing('   ')).toBe(true);
    expect(isExternalCodeMissing('X-100')).toBe(false);
  });
});

describe('compareExternalCode', () => {
  it('未設定を末尾へ置く（仕様書8.7.3、8.7.4）', () => {
    expect(compareExternalCode(null, 'X-100')).toBeGreaterThan(0);
    expect(compareExternalCode('X-100', null)).toBeLessThan(0);
  });

  it('未設定どうしは同順とする', () => {
    expect(compareExternalCode(null, '')).toBe(0);
  });
});

describe('sortByExternalCode', () => {
  it('外部項目コードの自然順に並べ、未設定を末尾へ置く', () => {
    const tasks = [
      { name: '作業項目C', externalCode: null, order: 3 },
      { name: '作業項目B', externalCode: 'X-200', order: 2 },
      { name: '作業項目A', externalCode: 'X-100', order: 1 },
      { name: '作業項目D', externalCode: 'X-30', order: 4 },
    ];

    expect(sortByExternalCode(tasks).map((task) => task.name)).toEqual([
      '作業項目D',
      '作業項目A',
      '作業項目B',
      '作業項目C',
    ]);
  });

  it('コードが同順の場合は表示順で安定させる', () => {
    const tasks = [
      { name: '後', externalCode: null, order: 9 },
      { name: '先', externalCode: null, order: 1 },
    ];

    expect(sortByExternalCode(tasks).map((task) => task.name)).toEqual(['先', '後']);
  });

  it('元の配列を変更しない', () => {
    const tasks = [
      { name: '作業項目B', externalCode: 'X-200', order: 2 },
      { name: '作業項目A', externalCode: 'X-100', order: 1 },
    ];
    const snapshot = [...tasks];

    sortByExternalCode(tasks);

    expect(tasks).toEqual(snapshot);
  });
});
