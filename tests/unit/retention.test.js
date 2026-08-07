/**
 * 保持期間と削除候補の単体テスト（仕様書10.2、10.3、A-10）。
 *
 * 起算日は `archivedAt` であり、判定は現在日時から導出する。境界（29日／30日／
 * 31日）を明示的に固定する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  canDeleteProjectGroup,
  canDeleteRun,
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

    it('30日に1秒足りなければ候補にならない', () => {
      expect(isDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(30, -1) })).toBe(false);
    });

    it('ちょうど30日後は候補になる', () => {
      // 「30日間保つ」であり、30日が満了した瞬間に保つ義務は終わる。
      expect(isDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(30) })).toBe(true);
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
    expect(isDeletable(run, { ...OPTIONS, now: daysAfter(30, -1) })).toBe(false);
    expect(isDeletable(run, { ...OPTIONS, now: daysAfter(30) })).toBe(true);
  });

  describe('残り日数と判定が食い違わない（レビュー指摘 S10-4）', () => {
    // 別々の比較を持つと、境界のちょうど1点で「残り0日と出ているのに候補では
    // ない」という説明できない状態ができる。
    it.each([
      ['期限の1秒前', daysAfter(30, -1)],
      ['期限ちょうど', daysAfter(30)],
      ['期限の1秒後', daysAfter(30, 1)],
      ['アーカイブ直後', ARCHIVED_AT],
      ['大幅に経過', daysAfter(999)],
    ])('%s：残り0日であることと候補であることが一致する', (_label, now) => {
      const options = { ...OPTIONS, now };

      expect(daysUntilDeletable(archivedRun(), options) === 0).toBe(
        isDeletable(archivedRun(), options),
      );
    });
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

  it('期限ちょうども0を返す', () => {
    expect(daysUntilDeletable(archivedRun(), { ...OPTIONS, now: daysAfter(30) })).toBe(0);
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

describe('canDeleteRun()（仕様書7.1、10.3、10.4）', () => {
  it('削除候補なら削除できる', () => {
    const result = canDeleteRun(archivedRun(), { ...OPTIONS, now: daysAfter(31) });

    expect(result).toEqual({ ok: true, reason: null });
  });

  it('保持期間内は削除できない', () => {
    // 仕様書7.1 の遷移表は アーカイブ → 削除候補 → 完全削除 であり、
    // アーカイブ済みから直接消す辺は無い。
    const result = canDeleteRun(archivedRun(), { ...OPTIONS, now: daysAfter(10) });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('保持期間');
  });

  it('拒否の理由に残り日数を添える', () => {
    const result = canDeleteRun(archivedRun(), { ...OPTIONS, now: daysAfter(10) });

    expect(result.reason).toContain('あと20日');
  });

  it('保持期限ちょうどは削除できる（レビュー指摘 S10-4）', () => {
    expect(canDeleteRun(archivedRun(), { ...OPTIONS, now: daysAfter(30) }).ok).toBe(true);
  });

  it.each([RUN_STATUS.WORKING, RUN_STATUS.AGGREGATED, RUN_STATUS.TRANSFERRED])(
    '%s は削除できない',
    (status) => {
      const result = canDeleteRun(workRun({ status }), { ...OPTIONS, now: daysAfter(999) });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('アーカイブ済み');
    },
  );

  it('保持期間を短くすれば削除できるようになる（仕様書10.2）', () => {
    const run = archivedRun();
    const now = daysAfter(10);

    expect(canDeleteRun(run, { retentionDays: 30, now }).ok).toBe(false);
    expect(canDeleteRun(run, { retentionDays: 7, now }).ok).toBe(true);
  });
});

describe('canDeleteProjectGroup()（仕様書10.4）', () => {
  const LATE = { ...OPTIONS, now: daysAfter(31) };

  it('配下がすべて削除候補なら削除できる', () => {
    const result = canDeleteProjectGroup([archivedRun(), archivedRun()], LATE);

    expect(result).toEqual({ ok: true, reason: null });
  });

  it('実施回が0件の案件は削除できる（レビュー指摘 S10-2）', () => {
    // 消える記録が無いので、保持期間が守る対象も無い。登録しただけの案件を
    // 消す唯一の経路である。
    expect(canDeleteProjectGroup([], LATE)).toEqual({ ok: true, reason: null });
  });

  it('アーカイブ済みでない実施回があれば削除できない', () => {
    const result = canDeleteProjectGroup(
      [archivedRun(), workRun({ status: RUN_STATUS.TRANSFERRED })],
      LATE,
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('1 件');
  });

  it('保持期間内の実施回があれば削除できない', () => {
    // 1件ずつ消せない記録を、案件ごとならまとめて消せる抜け道を作らない。
    const result = canDeleteProjectGroup([archivedRun()], { ...OPTIONS, now: daysAfter(10) });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('保持期間が残っている実施回が 1 件');
  });

  it('アーカイブ済みでないことを保持期間より先に伝える', () => {
    // 先に案内すべきなのは「アーカイブしてください」の方である。
    const result = canDeleteProjectGroup([workRun({ status: RUN_STATUS.WORKING })], LATE);

    expect(result.reason).toContain('アーカイブ済みでない');
  });
});
