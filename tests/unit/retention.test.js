/**
 * 保持期間と削除候補の単体テスト（仕様書10.2、10.3、A-10）。
 *
 * 起算日は `archivedAt` であり、判定は現在日時から導出する。境界（29日／30日／
 * 31日）を明示的に固定する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  classifyArchived,
  daysUntilDeletable,
  deletableFrom,
  isDeletable,
} from '../../src/domain/retention.js';
import { RUN_STATUS } from '../../src/domain/schema.js';
import { resetIds, workRun } from '../fixtures/builders.js';

beforeEach(resetIds);

const ARCHIVED_AT = '2026-08-01T10:00:00+09:00';
const OPTIONS = { retentionDays: 30 };

/**
 * アーカイブ済みの実施回。
 *
 * @param {{archivedAt?: string|null, status?: string}} [overrides]
 */
function archivedRun(overrides = {}) {
  return workRun({
    status: RUN_STATUS.ARCHIVED,
    transferredAt: '2026-07-31T10:00:00+09:00',
    archivedAt: ARCHIVED_AT,
    ...overrides,
  });
}

/** `ARCHIVED_AT` から n 日後のISO。 */
function daysAfter(days, extraSeconds = 0) {
  const base = Date.parse(ARCHIVED_AT) + days * 24 * 60 * 60 * 1000 + extraSeconds * 1000;
  return new Date(base).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

describe('deletableFrom()（仕様書10.2）', () => {
  it('アーカイブ日時から保持期間ぶん進めた日時を返す', () => {
    expect(Date.parse(deletableFrom(ARCHIVED_AT, 30))).toBe(Date.parse(daysAfter(30)));
  });

  it('保持期間が1日でも求まる', () => {
    expect(Date.parse(deletableFrom(ARCHIVED_AT, 1))).toBe(Date.parse(daysAfter(1)));
  });
});

describe('isDeletable()（仕様書10.3、A-10）', () => {
  describe('保持期間30日の境界', () => {
    it('29日後はまだ候補にならない', () => {
      expect(isDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(29) })).toBe(false);
    });

    it('ちょうど30日後はまだ候補にならない', () => {
      // 「30日間は保つ」という意味であり、30日目のうちはまだ保つ。
      expect(isDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(30) })).toBe(false);
    });

    it('30日を1秒でも過ぎれば候補になる', () => {
      expect(isDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(30, 1) })).toBe(true);
    });

    it('31日後は候補になる', () => {
      expect(isDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(31) })).toBe(true);
    });
  });

  describe('アーカイブ以外は候補にしない', () => {
    it.each([RUN_STATUS.WORKING, RUN_STATUS.AGGREGATED, RUN_STATUS.TRANSFERRED])(
      '%s はどれだけ古くても候補にならない',
      (status) => {
        const run = workRun({ status, archivedAt: null });

        expect(isDeletable(run, { ...OPTIONS, now: daysAfter(999) })).toBe(false);
      },
    );
  });

  it('アーカイブ日時が無ければ候補にしない', () => {
    // 起算日が無い以上、経過を数えられない。
    const run = archivedRun({ archivedAt: null });

    expect(isDeletable(run, { ...OPTIONS, now: daysAfter(999) })).toBe(false);
  });

  it('保持期間を短くすると候補が増える（仕様書10.2 の設定変更）', () => {
    const run = archivedRun();
    const now = daysAfter(10);

    expect(isDeletable(run, { retentionDays: 30, now })).toBe(false);
    expect(isDeletable(run, { retentionDays: 7, now })).toBe(true);
  });

  it('異なるオフセットで記録されていても実時刻で数える', () => {
    const run = archivedRun({ archivedAt: '2026-08-01T01:00:00+00:00' });

    // +00:00 の 01:00 は +09:00 の 10:00 と同じ瞬間。
    expect(isDeletable(run, { ...OPTIONS, now: daysAfter(30) })).toBe(false);
    expect(isDeletable(run, { ...OPTIONS, now: daysAfter(30, 1) })).toBe(true);
  });
});

describe('daysUntilDeletable()', () => {
  it('アーカイブ直後は保持期間ぶん残っている', () => {
    expect(daysUntilDeletable(archivedRun(), { ...OPTIONS, now: ARCHIVED_AT })).toBe(30);
  });

  it('10日経てば残りは20日', () => {
    expect(daysUntilDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(10) })).toBe(20);
  });

  it('端数は切り上げる', () => {
    // 残り0.5日を「あと0日」と出すと今日中に消えるように読める。
    const now = daysAfter(29, 12 * 60 * 60);

    expect(daysUntilDeletable(archivedRun(), { ...OPTIONS, now })).toBe(1);
  });

  it('既に候補なら0を返す', () => {
    expect(daysUntilDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(31) })).toBe(0);
  });

  it('アーカイブ済みでなければ null を返す', () => {
    const run = workRun({ status: RUN_STATUS.TRANSFERRED });

    expect(daysUntilDeletable(run, { ...OPTIONS, now: daysAfter(31) })).toBeNull();
  });
});

describe('classifyArchived()', () => {
  it('アーカイブ済みだけを対象にし、候補と保持中へ分ける', () => {
    const runs = [
      workRun({ status: RUN_STATUS.WORKING }),
      archivedRun(),
      archivedRun({ archivedAt: '2026-06-01T10:00:00+09:00' }),
    ];

    const result = classifyArchived(runs, { ...OPTIONS, now: daysAfter(10) });

    expect(result.archived).toHaveLength(2);
    expect(result.deletable).toHaveLength(1);
    expect(result.keeping).toHaveLength(1);
    expect(result.deletable[0].archivedAt).toBe('2026-06-01T10:00:00+09:00');
  });

  it('アーカイブ済みが無ければすべて空になる', () => {
    const result = classifyArchived([workRun({ status: RUN_STATUS.WORKING })], {
      ...OPTIONS,
      now: daysAfter(999),
    });

    expect(result).toEqual({ archived: [], deletable: [], keeping: [] });
  });

  it('候補と保持中を足すとアーカイブ済みの件数になる', () => {
    const runs = [
      archivedRun(),
      archivedRun({ archivedAt: '2026-06-01T10:00:00+09:00' }),
      archivedRun({ archivedAt: '2026-07-01T10:00:00+09:00' }),
    ];

    const result = classifyArchived(runs, { ...OPTIONS, now: daysAfter(10) });

    expect(result.deletable.length + result.keeping.length).toBe(result.archived.length);
  });
});
