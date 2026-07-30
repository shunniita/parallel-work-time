import { describe, expect, it } from 'vitest';

import {
  dateKeyOf,
  diffMs,
  diffSeconds,
  formatOffset,
  isValidDateKey,
  isValidIsoSecond,
  parseIso,
  toDateKey,
  toIsoSecond,
} from '../../src/domain/datetime.js';

describe('formatOffset', () => {
  it('Date#getTimezoneOffset の符号を反転して表記する', () => {
    // JST は getTimezoneOffset() が -540 を返す。
    expect(formatOffset(-540)).toBe('+09:00');
    expect(formatOffset(540)).toBe('-09:00');
  });

  it('UTC を +00:00 と表記する', () => {
    expect(formatOffset(0)).toBe('+00:00');
  });

  it('30分単位のオフセットを扱える', () => {
    expect(formatOffset(-330)).toBe('+05:30');
    expect(formatOffset(345)).toBe('-05:45');
  });

  it('分が整数でない場合は拒否する', () => {
    expect(() => formatOffset(1.5)).toThrow(TypeError);
  });
});

describe('toIsoSecond', () => {
  it('秒精度のISO 8601へ変換し、ミリ秒を切り捨てる（仕様書8.4.4）', () => {
    const date = new Date(2026, 6, 30, 9, 0, 0, 999);
    const iso = toIsoSecond(date);

    expect(iso).toMatch(/^2026-07-30T09:00:00(Z|[+-]\d{2}:\d{2})$/);
    // ミリ秒を落としているため、再解析すると999ミリ秒分だけ元より前になる。
    expect(date.getTime() - parseIso(iso)).toBe(999);
  });

  it('解析し直すと同じ時刻へ戻る', () => {
    const date = new Date(2026, 11, 31, 23, 59, 59, 0);
    expect(parseIso(toIsoSecond(date))).toBe(date.getTime());
  });

  it('無効な Date を拒否する', () => {
    expect(() => toIsoSecond(new Date('無効'))).toThrow(TypeError);
    expect(() => toIsoSecond('2026-07-30T09:00:00+09:00')).toThrow(TypeError);
  });
});

describe('isValidIsoSecond', () => {
  it('オフセット付き秒精度を受け付ける', () => {
    expect(isValidIsoSecond('2026-07-30T09:00:00+09:00')).toBe(true);
    expect(isValidIsoSecond('2026-07-30T00:00:00Z')).toBe(true);
    expect(isValidIsoSecond('2026-07-30T09:00:00-05:00')).toBe(true);
  });

  it('オフセットのない形式を拒否する', () => {
    expect(isValidIsoSecond('2026-07-30T09:00:00')).toBe(false);
  });

  it('ミリ秒を含む形式を拒否する', () => {
    expect(isValidIsoSecond('2026-07-30T09:00:00.500+09:00')).toBe(false);
  });

  it('日付のみの形式を拒否する', () => {
    expect(isValidIsoSecond('2026-07-30')).toBe(false);
  });

  it('実在しない日付を拒否する', () => {
    expect(isValidIsoSecond('2026-02-30T09:00:00+09:00')).toBe(false);
    expect(isValidIsoSecond('2026-13-01T09:00:00+09:00')).toBe(false);
  });

  it('うるう日を受け付ける', () => {
    expect(isValidIsoSecond('2028-02-29T09:00:00+09:00')).toBe(true);
    expect(isValidIsoSecond('2026-02-29T09:00:00+09:00')).toBe(false);
  });

  it('文字列以外を拒否する', () => {
    expect(isValidIsoSecond(null)).toBe(false);
    expect(isValidIsoSecond(1_780_000_000_000)).toBe(false);
  });
});

describe('parseIso', () => {
  it('オフセットを考慮してエポックミリ秒へ変換する', () => {
    // 同一時刻をJSTとUTCで表した場合、9時間ずれる。
    expect(parseIso('2026-07-30T09:00:00+09:00')).toBe(parseIso('2026-07-30T00:00:00Z'));
  });

  it('無効な値を拒否する', () => {
    expect(() => parseIso('2026-07-30T09:00:00')).toThrow(TypeError);
  });
});

describe('diffMs / diffSeconds', () => {
  it('20分の差を求める', () => {
    expect(diffSeconds('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00')).toBe(1200);
  });

  it('日をまたぐ区間を扱える（仕様書8.4.8、T-13）', () => {
    // 23時30分から翌1時15分は105分。
    const seconds = diffSeconds('2026-07-30T23:30:00+09:00', '2026-07-31T01:15:00+09:00');
    expect(seconds).toBe(105 * 60);
  });

  it('同一日時は0秒（仕様書8.9.3）', () => {
    expect(diffSeconds('2026-07-30T09:00:00+09:00', '2026-07-30T09:00:00+09:00')).toBe(0);
  });

  it('オフセットが異なる区間でも実時間で計算する', () => {
    // 09:00+09:00 と 01:00+01:00 は同じ瞬間。
    expect(diffMs('2026-07-30T09:00:00+09:00', '2026-07-30T01:00:00+01:00')).toBe(0);
  });

  it('終了が開始より前なら負の値を返す', () => {
    expect(diffSeconds('2026-07-30T09:20:00+09:00', '2026-07-30T09:00:00+09:00')).toBe(-1200);
  });
});

describe('toDateKey / dateKeyOf / isValidDateKey', () => {
  it('Date をローカル日付へ変換する', () => {
    expect(toDateKey(new Date(2026, 6, 30, 23, 59, 59))).toBe('2026-07-30');
  });

  it('ISO 8601 の日付部分を取り出す', () => {
    expect(dateKeyOf('2026-07-31T01:15:00+09:00')).toBe('2026-07-31');
  });

  it('日付のみの形式を検証する', () => {
    expect(isValidDateKey('2026-07-30')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-7-30')).toBe(false);
    expect(isValidDateKey('2026-07-30T09:00:00+09:00')).toBe(false);
  });
});
