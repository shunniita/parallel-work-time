/**
 * 案件IDの正規化の単体テスト（仕様書8.2.6、8.9.9）。
 *
 * 一意制約が空白の有無ですり抜けないことと、それ以外は畳み込まないことを固定する。
 */

import { describe, expect, it } from 'vitest';

import { normalizeProjectId } from '../../src/domain/projectId.js';

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
