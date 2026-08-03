import { describe, expect, it } from 'vitest';

import {
  addSeconds,
  compareIso,
  dateKeyOf,
  diffMs,
  diffSeconds,
  formatOffset,
  fromDateTimeLocal,
  isValidDateKey,
  isValidDateTimeLocal,
  isValidIsoSecond,
  localOffsetMinutes,
  offsetMinutesOf,
  parseIso,
  toDateKey,
  toDateTimeLocal,
  toIsoSecond,
} from '../../src/domain/datetime.js';

describe('formatOffset', () => {
  it('ISO 8601 と同じ符号（東が正）で表記する（レビュー指摘 F-25）', () => {
    expect(formatOffset(540)).toBe('+09:00');
    expect(formatOffset(-540)).toBe('-09:00');
  });

  it('UTC を +00:00 と表記する', () => {
    expect(formatOffset(0)).toBe('+00:00');
  });

  it('30分単位のオフセットを扱える', () => {
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(-345)).toBe('-05:45');
  });

  it('分が整数でない場合は拒否する', () => {
    expect(() => formatOffset(1.5)).toThrow(TypeError);
  });
});

describe('localOffsetMinutes', () => {
  it('getTimezoneOffset の符号を反転して返す', () => {
    const date = new Date(2026, 6, 30, 9, 0, 0);
    expect(localOffsetMinutes(date)).toBe(-date.getTimezoneOffset());
  });

  it('toIsoSecond の出力と符号が一致する', () => {
    const date = new Date(2026, 6, 30, 9, 0, 0);
    expect(toIsoSecond(date).slice(19)).toBe(formatOffset(localOffsetMinutes(date)));
  });

  it('無効な Date を拒否する', () => {
    expect(() => localOffsetMinutes(new Date('無効'))).toThrow(TypeError);
  });
});

describe('offsetMinutesOf', () => {
  it('ISO のオフセットを東が正の分で返す', () => {
    expect(offsetMinutesOf('2026-07-30T09:00:00+09:00')).toBe(540);
    expect(offsetMinutesOf('2026-07-30T09:00:00-05:30')).toBe(-330);
    expect(offsetMinutesOf('2026-07-30T09:00:00Z')).toBe(0);
  });

  it('無効な値を拒否する', () => {
    expect(() => offsetMinutesOf('2026-07-30T09:00:00')).toThrow(TypeError);
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

describe('compareIso', () => {
  it('前後を符号で返す', () => {
    expect(compareIso('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00')).toBe(-1);
    expect(compareIso('2026-07-30T09:20:00+09:00', '2026-07-30T09:00:00+09:00')).toBe(1);
  });

  it('同一日時は0（仕様書8.9.3）', () => {
    expect(compareIso('2026-07-30T09:00:00+09:00', '2026-07-30T09:00:00+09:00')).toBe(0);
  });

  it('オフセットが違っても実時刻で比べる', () => {
    // 09:00+09:00 と 01:00+01:00 は同じ瞬間。
    expect(compareIso('2026-07-30T09:00:00+09:00', '2026-07-30T01:00:00+01:00')).toBe(0);
    // 09:00+09:00 は 00:00Z。01:00Z より1時間前になる。
    expect(compareIso('2026-07-30T09:00:00+09:00', '2026-07-30T01:00:00Z')).toBe(-1);
  });

  it('無効な値を拒否する', () => {
    expect(() => compareIso('2026-07-30', '2026-07-30T09:00:00+09:00')).toThrow(TypeError);
  });
});

describe('addSeconds', () => {
  it('秒を足しても元のオフセットを保つ', () => {
    expect(addSeconds('2026-07-30T09:00:00+09:00', 90)).toBe('2026-07-30T09:01:30+09:00');
  });

  it('負数で過去へ戻せる', () => {
    expect(addSeconds('2026-07-30T09:00:00+09:00', -3600)).toBe(
      '2026-07-30T08:00:00+09:00',
    );
  });

  it('日をまたぐと日付が繰り上がる（仕様書8.4.8）', () => {
    expect(addSeconds('2026-07-30T23:30:00+09:00', 105 * 60)).toBe(
      '2026-07-31T01:15:00+09:00',
    );
  });

  it('月末・年末をまたげる', () => {
    expect(addSeconds('2026-12-31T23:59:59+09:00', 1)).toBe('2027-01-01T00:00:00+09:00');
  });

  it('Z 表記は +00:00 になるが同じ瞬間を指す', () => {
    const result = addSeconds('2026-07-30T00:00:00Z', 60);
    expect(result).toBe('2026-07-30T00:01:00+00:00');
    expect(parseIso(result)).toBe(parseIso('2026-07-30T09:01:00+09:00'));
  });

  it('整数以外の秒を拒否する', () => {
    expect(() => addSeconds('2026-07-30T09:00:00+09:00', 1.5)).toThrow(TypeError);
  });
});

describe('toDateTimeLocal / fromDateTimeLocal', () => {
  it('入力欄の値へオフセットを落として渡す（仕様書8.4.4）', () => {
    expect(toDateTimeLocal('2026-07-30T09:00:00+09:00')).toBe('2026-07-30T09:00:00');
  });

  it('入力欄の値とオフセットから保存形式へ戻す', () => {
    expect(fromDateTimeLocal('2026-07-30T09:00:00', 540)).toBe(
      '2026-07-30T09:00:00+09:00',
    );
  });

  it('秒が省略された値は0秒として補う', () => {
    expect(fromDateTimeLocal('2026-07-30T09:00', 540)).toBe('2026-07-30T09:00:00+09:00');
  });

  it('往復しても値が変わらない', () => {
    const iso = '2026-07-31T01:15:30-05:00';
    expect(fromDateTimeLocal(toDateTimeLocal(iso), offsetMinutesOf(iso))).toBe(iso);
  });

  it('実在しない日付を拒否する', () => {
    expect(() => fromDateTimeLocal('2026-02-30T09:00:00', 540)).toThrow(TypeError);
  });

  it('形式が違う値を拒否する', () => {
    expect(() => fromDateTimeLocal('2026/07/30 09:00', 540)).toThrow(TypeError);
    expect(() => fromDateTimeLocal('2026-07-30T09:00:00+09:00', 540)).toThrow(TypeError);
    expect(() => fromDateTimeLocal(null, 540)).toThrow(TypeError);
  });

  describe('オフセットを省略した場合（レビュー指摘 SOL-1）', () => {
    it('入力された壁時計日時に対応するローカルオフセットを使う', () => {
      // 現在日時のオフセットではなく、入力日そのもののオフセットで保存する。
      // 夏時間のある環境で、入力日と現在日の適用状態が違っても瞬間がずれない。
      expect(fromDateTimeLocal('2026-01-15T09:00:00')).toBe(
        toIsoSecond(new Date(2026, 0, 15, 9, 0, 0)),
      );
      expect(fromDateTimeLocal('2026-08-15T09:00:00')).toBe(
        toIsoSecond(new Date(2026, 7, 15, 9, 0, 0)),
      );
    });

    it('壁時計の値は入力どおりに保たれる', () => {
      expect(fromDateTimeLocal('2026-01-15T09:00:00').slice(0, 19)).toBe(
        '2026-01-15T09:00:00',
      );
    });

    it('解析し直すと入力した壁時計の瞬間へ戻る', () => {
      const iso = fromDateTimeLocal('2026-01-15T09:00:00');

      expect(parseIso(iso)).toBe(new Date(2026, 0, 15, 9, 0, 0).getTime());
    });
  });

  describe('妥当性判定と変換の一致（レビュー指摘 SOL-3）', () => {
    const values = [
      '2026-07-30T09:00',
      '2026-07-30T09:00:00',
      '2026-02-30T09:00',
      '2026-13-01T09:00',
      '2026-07-30T25:00',
      '2026-07-30',
      '2026/07/30 09:00',
      '',
      null,
      undefined,
    ];

    it.each(values)('%o の判定と変換可否が一致する', (value) => {
      let converted = true;
      try {
        fromDateTimeLocal(value, 540);
      } catch {
        converted = false;
      }

      expect(isValidDateTimeLocal(value)).toBe(converted);
    });

    it('実在しない日付を妥当としない', () => {
      expect(isValidDateTimeLocal('2026-02-30T09:00')).toBe(false);
      expect(isValidDateTimeLocal('2026-02-29T09:00')).toBe(false);
      expect(isValidDateTimeLocal('2028-02-29T09:00')).toBe(true);
    });

    it('形式が妥当な値を受け付ける', () => {
      expect(isValidDateTimeLocal('2026-07-30T09:00')).toBe(true);
      expect(isValidDateTimeLocal('2026-07-30T09:00:00')).toBe(true);
      expect(isValidDateTimeLocal('2026-07-30')).toBe(false);
      expect(isValidDateTimeLocal(undefined)).toBe(false);
    });
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
