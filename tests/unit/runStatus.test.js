/**
 * 実施回の状態と遷移の単体テスト（仕様書7.1、7.2）。
 *
 * 仕様書7.1 の遷移表のうち、状態どうしの辺をすべて持つ。「削除候補」は保存しない
 * 派生状態なので含めず（`retention.js`）、完全削除はレコードごと消す操作であり
 * 遷移ではない。
 */

import { describe, expect, it } from 'vitest';

import {
  RUN_STATUS_LABEL,
  canTransition,
  describeNotEditable,
  isRunEditable,
  isStatusRetreat,
  nextStatuses,
  timestampsForStatus,
} from '../../src/domain/runStatus.js';
import { RUN_STATUS } from '../../src/domain/schema.js';

describe('isRunEditable()（仕様書7.2）', () => {
  it.each([
    [RUN_STATUS.WORKING, true],
    [RUN_STATUS.AGGREGATED, true],
    [RUN_STATUS.TRANSFERRED, false],
    [RUN_STATUS.ARCHIVED, false],
  ])('%s は %s', (status, expected) => {
    expect(isRunEditable({ status })).toBe(expected);
  });

  it('状態が無ければ書き換えられないものとして扱う', () => {
    expect(isRunEditable({})).toBe(false);
    expect(isRunEditable(null)).toBe(false);
  });
});

describe('describeNotEditable()', () => {
  it('アーカイブと転記済みを言い分ける', () => {
    expect(describeNotEditable({ status: RUN_STATUS.ARCHIVED })).toContain('アーカイブ');
    expect(describeNotEditable({ status: RUN_STATUS.TRANSFERRED })).toContain('転記済み');
  });
});

describe('canTransition()（仕様書7.1）', () => {
  describe('許される遷移', () => {
    it.each([
      [RUN_STATUS.WORKING, RUN_STATUS.AGGREGATED],
      [RUN_STATUS.AGGREGATED, RUN_STATUS.WORKING],
      [RUN_STATUS.AGGREGATED, RUN_STATUS.TRANSFERRED],
      [RUN_STATUS.TRANSFERRED, RUN_STATUS.AGGREGATED],
      [RUN_STATUS.TRANSFERRED, RUN_STATUS.ARCHIVED],
    ])('%s → %s', (from, to) => {
      expect(canTransition(from, to)).toEqual({ ok: true, reason: null });
    });
  });

  describe('許されない遷移', () => {
    it('作業中から転記済みへは飛べない', () => {
      // 集計を経ずに転記済みにはできない（仕様書7.1 の進行）。
      const result = canTransition(RUN_STATUS.WORKING, RUN_STATUS.TRANSFERRED);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('作業中');
      expect(result.reason).toContain('転記済み');
    });

    it('転記済みから作業中へは戻せない', () => {
      expect(canTransition(RUN_STATUS.TRANSFERRED, RUN_STATUS.WORKING).ok).toBe(false);
    });

    it('アーカイブからはどこへも戻せない（仕様書7.1 に辺が無い）', () => {
      // 通常一覧から分離する操作であり、戻す必要があるなら分離していない。
      for (const to of Object.values(RUN_STATUS)) {
        expect(canTransition(RUN_STATUS.ARCHIVED, to).ok).toBe(false);
      }
    });

    it('集計済みからアーカイブへは飛べない（転記済みを経る）', () => {
      expect(canTransition(RUN_STATUS.AGGREGATED, RUN_STATUS.ARCHIVED).ok).toBe(false);
    });

    it('作業中からアーカイブへは飛べない', () => {
      expect(canTransition(RUN_STATUS.WORKING, RUN_STATUS.ARCHIVED).ok).toBe(false);
    });

    it('同じ状態への遷移は拒む', () => {
      const result = canTransition(RUN_STATUS.WORKING, RUN_STATUS.WORKING);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('既に');
    });

    it('知らない状態は拒む', () => {
      expect(canTransition(RUN_STATUS.WORKING, 'unknown').ok).toBe(false);
    });

    it('進める先を理由に添える', () => {
      const result = canTransition(RUN_STATUS.WORKING, RUN_STATUS.TRANSFERRED);

      expect(result.reason).toContain('集計済み');
    });
  });
});

describe('nextStatuses()', () => {
  it('状態から進める先を返す', () => {
    expect(nextStatuses({ status: RUN_STATUS.AGGREGATED })).toEqual([
      RUN_STATUS.WORKING,
      RUN_STATUS.TRANSFERRED,
    ]);
  });

  it('転記済みからは集計済みとアーカイブへ進める', () => {
    expect(nextStatuses({ status: RUN_STATUS.TRANSFERRED })).toEqual([
      RUN_STATUS.AGGREGATED,
      RUN_STATUS.ARCHIVED,
    ]);
  });

  it('アーカイブからは空である', () => {
    expect(nextStatuses({ status: RUN_STATUS.ARCHIVED })).toEqual([]);
  });

  it('返した配列を書き換えても内部に影響しない', () => {
    const list = nextStatuses({ status: RUN_STATUS.AGGREGATED });
    list.push('archived');

    expect(nextStatuses({ status: RUN_STATUS.AGGREGATED })).toHaveLength(2);
  });
});

describe('isStatusRetreat()（仕様書11章）', () => {
  it('転記済みから集計済みへ戻すときだけ true', () => {
    expect(isStatusRetreat(RUN_STATUS.TRANSFERRED, RUN_STATUS.AGGREGATED)).toBe(true);
  });

  it.each([
    [RUN_STATUS.WORKING, RUN_STATUS.AGGREGATED],
    [RUN_STATUS.AGGREGATED, RUN_STATUS.TRANSFERRED],
    [RUN_STATUS.AGGREGATED, RUN_STATUS.WORKING],
  ])('%s → %s は後退ではない', (from, to) => {
    expect(isStatusRetreat(from, to)).toBe(false);
  });
});

describe('timestampsForStatus()（仕様書6.5、7.1、10.1）', () => {
  const transferredAt = '2026-08-07T10:00:00+09:00';
  const now = '2026-08-07T12:00:00+09:00';

  it('転記済みへ進むと転記完了日時を記録し、アーカイブ日時は空にする', () => {
    expect(timestampsForStatus({}, RUN_STATUS.TRANSFERRED, now)).toEqual({
      transferredAt: now,
      archivedAt: null,
    });
  });

  it('アーカイブへ進むと転記完了日時を保ち、アーカイブ日時を記録する', () => {
    expect(timestampsForStatus({ transferredAt }, RUN_STATUS.ARCHIVED, now)).toEqual({
      transferredAt,
      archivedAt: now,
    });
  });

  it.each([RUN_STATUS.WORKING, RUN_STATUS.AGGREGATED])(
    '%s へ戻ると転記・アーカイブ日時を消す',
    (status) => {
      expect(timestampsForStatus({ transferredAt }, status, now)).toEqual({
        transferredAt: null,
        archivedAt: null,
      });
    },
  );
});

describe('RUN_STATUS_LABEL', () => {
  it('すべての状態に表示名がある', () => {
    for (const status of Object.values(RUN_STATUS)) {
      expect(RUN_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
