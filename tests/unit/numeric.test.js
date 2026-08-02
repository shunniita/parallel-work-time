/**
 * 画面の数値入力変換の単体テスト（仕様書8.9.2）。
 *
 * `Number.parseInt()` が黙って通してしまう入力を、この層で `NaN` へ落とすことを
 * 固定する。数量が「1以上の整数」であることは要件であり、`1.5` が `1` として
 * 保存されると記録が静かに壊れる。
 */

import { describe, expect, it } from 'vitest';

import { toIntegerInput, toOptionalIntegerInput } from '../../src/ui/numeric.js';

describe('toIntegerInput()', () => {
  it('整数の文字列を数値へ直す', () => {
    expect(toIntegerInput('50')).toBe(50);
    expect(toIntegerInput('0')).toBe(0);
    expect(toIntegerInput('-3')).toBe(-3);
  });

  it('前後の空白を無視する', () => {
    expect(toIntegerInput('  50  ')).toBe(50);
  });

  it.each([
    ['小数', '1.5'],
    ['数字で始まる文字列', '12abc'],
    ['単位付き', '50件'],
    ['数値でない', 'abc'],
    ['空欄', ''],
    ['空白のみ', '   '],
    ['16進表記', '0x10'],
    ['2進表記', '0b11'],
    ['無限大', 'Infinity'],
  ])('%s は NaN にする', (_label, value) => {
    expect(toIntegerInput(value)).toBeNaN();
  });

  it('指数表記は値として受け取る（type="number" が受け付ける表記）', () => {
    // `parseInt('1e3')` は 1 を返す。ここで 1000 になることが parseInt との違い。
    expect(toIntegerInput('1e3')).toBe(1000);
  });

  it('null / undefined も NaN にする', () => {
    expect(toIntegerInput(null)).toBeNaN();
    expect(toIntegerInput(undefined)).toBeNaN();
  });

  it('数値をそのまま渡しても整数性を検査する', () => {
    expect(toIntegerInput(7)).toBe(7);
    expect(toIntegerInput(7.5)).toBeNaN();
  });
});

describe('toOptionalIntegerInput()', () => {
  it('空欄は未設定として undefined を返す', () => {
    expect(toOptionalIntegerInput('')).toBeUndefined();
    expect(toOptionalIntegerInput('   ')).toBeUndefined();
    expect(toOptionalIntegerInput(null)).toBeUndefined();
  });

  it('整数はそのまま返す', () => {
    expect(toOptionalIntegerInput('3')).toBe(3);
  });

  it('整数でない入力は undefined へ丸めず NaN を返す', () => {
    // undefined にすると「未入力」と区別できなくなり、検証をすり抜ける。
    expect(toOptionalIntegerInput('1.5')).toBeNaN();
  });
});
