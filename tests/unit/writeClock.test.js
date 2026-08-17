/**
 * 書き込み時刻の単調性（受入基準 A-11、過去のレビュー指摘）。
 *
 * 取り込み検証が求める鎖（`createdAt <= transferredAt <= archivedAt <= updatedAt`）を、
 * 書き込み側が壊さないことを固定する。
 */

import { describe, expect, it } from 'vitest';

import { runWriteTime } from '../../src/domain/writeClock.js';

const CREATED = '2026-08-01T09:00:00+09:00';
const TRANSFERRED = '2026-08-02T09:00:00+09:00';
const ARCHIVED = '2026-08-03T09:00:00+09:00';

describe('runWriteTime', () => {
  it('時計が進んでいれば現在時刻をそのまま返す', () => {
    const run = { createdAt: CREATED, updatedAt: CREATED, transferredAt: null, archivedAt: null };

    expect(runWriteTime(run, '2026-08-05T09:00:00+09:00')).toBe('2026-08-05T09:00:00+09:00');
  });

  it('時計が巻き戻っていれば最も後の既存日時を返す', () => {
    const run = { createdAt: CREATED, updatedAt: CREATED, transferredAt: null, archivedAt: null };

    expect(runWriteTime(run, '2026-07-25T09:00:00+09:00')).toBe(CREATED);
  });

  it('転記・アーカイブ日時も比較に入れる', () => {
    const run = {
      createdAt: CREATED,
      updatedAt: TRANSFERRED,
      transferredAt: TRANSFERRED,
      archivedAt: ARCHIVED,
    };

    expect(runWriteTime(run, '2026-07-25T09:00:00+09:00')).toBe(ARCHIVED);
  });

  it('オフセットが違っても実時刻で比べる', () => {
    const run = { createdAt: '2026-08-01T00:00:00+00:00' };

    // JST の 08:00 は UTC の 00:00 と同時刻。より後の 09:00 が勝つ。
    expect(runWriteTime(run, '2026-08-01T09:00:00+09:00')).toBe('2026-08-01T09:00:00+09:00');
    expect(runWriteTime(run, '2026-08-01T07:00:00+09:00')).toBe('2026-08-01T00:00:00+00:00');
  });

  it('欠けた日時と読めない日時は無視する', () => {
    const now = '2026-08-05T09:00:00+09:00';

    expect(runWriteTime(null, now)).toBe(now);
    expect(runWriteTime({}, now)).toBe(now);
    expect(runWriteTime({ createdAt: 'こわれた日時' }, now)).toBe(now);
  });

  it('同時刻なら現在時刻を返す', () => {
    expect(runWriteTime({ createdAt: CREATED }, CREATED)).toBe(CREATED);
  });
});
