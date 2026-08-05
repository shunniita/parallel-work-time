/**
 * 実施回の状態と遷移の単体テスト（仕様書7.1、7.2）。
 *
 * Step 8 の範囲は集計済み・転記済みまわりの4遷移である。アーカイブと完全削除は
 * Step 10 で足す。
 */

import { describe, expect, it } from 'vitest';

import {
  RUN_STATUS_LABEL,
  canTransition,
  describeNotEditable,
  isRunEditable,
  isStatusRetreat,
  nextStatuses,
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

    it('アーカイブからはどこへも進めない（Step 10 で足す）', () => {
      for (const to of Object.values(RUN_STATUS)) {
        expect(canTransition(RUN_STATUS.ARCHIVED, to).ok).toBe(false);
      }
    });

    it('アーカイブへの遷移はまだ許していない（Step 10）', () => {
      expect(canTransition(RUN_STATUS.TRANSFERRED, RUN_STATUS.ARCHIVED).ok).toBe(false);
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

describe('RUN_STATUS_LABEL', () => {
  it('すべての状態に表示名がある', () => {
    for (const status of Object.values(RUN_STATUS)) {
      expect(RUN_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
