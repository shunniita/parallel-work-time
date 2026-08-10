/**
 * 工数直接入力の単体テスト（仕様書8.5、8.9.8）。
 *
 * 参加者数を掛けないこと（8.5.6）は `effort.test.js` が計算側で見る。ここは
 * 入力の可否と重複候補の警告を固定する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DIRECT_ENTRY_WARNING,
  addDirectEntry,
  editDirectEntry,
  findDirectEntry,
  findDuplicateCandidates,
  formatSeconds,
  removeDirectEntry,
} from '../../src/domain/directEntryOps.js';
import { directEntry, resetIds, taskRecord } from '../fixtures/builders.js';
import { MAX_TEXT_LENGTH } from '../../src/config.js';

const NOW = '2026-08-01T12:00:00+09:00';

beforeEach(resetIds);

/** ID採番と現在時刻を固定した文脈。 */
function context() {
  let count = 0;
  return {
    now: NOW,
    newId: () => {
      count += 1;
      return `new-entry-${count}`;
    },
  };
}

/** 検証を通る最小の入力。 */
function input(overrides = {}) {
  return { seconds: 1200, participants: ['甲'], note: '計測漏れ分を追加', ...overrides };
}

describe('addDirectEntry()', () => {
  it('直接入力を1件足す（仕様書8.5.1）', () => {
    const task = taskRecord({});

    const result = addDirectEntry(task, input(), context());

    expect(result.ok).toBe(true);
    expect(result.directEntries).toHaveLength(1);
    expect(result.created).toMatchObject({
      entryId: 'new-entry-1',
      seconds: 1200,
      participants: ['甲'],
      note: '計測漏れ分を追加',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('元の作業項目実績を書き換えない', () => {
    const task = taskRecord({});

    addDirectEntry(task, input(), context());

    expect(task.directEntries).toEqual([]);
  });

  it('既存の直接入力の後ろへ足す', () => {
    const task = taskRecord({ directEntries: [directEntry(600)] });

    const result = addDirectEntry(task, input({ seconds: 300 }), context());

    expect(result.directEntries.map((entry) => entry.seconds)).toEqual([600, 300]);
  });

  describe('追加工数の検証（仕様書8.5.5）', () => {
    it('負の値は登録できない', () => {
      const result = addDirectEntry(taskRecord({}), input({ seconds: -1 }), context());

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('負の値');
      expect(result.directEntries).toBeNull();
    });

    it('0秒は登録できない', () => {
      // 工数を1秒も足さず備考だけが残る。分・秒の入力漏れである可能性が高い。
      const result = addDirectEntry(taskRecord({}), input({ seconds: 0 }), context());

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('1秒以上');
    });

    it.each([1.5, '1200', null, undefined, Number.NaN])('%o は整数でないため拒否する', (value) => {
      const result = addDirectEntry(taskRecord({}), input({ seconds: value }), context());

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('整数');
    });

    it('1秒は登録できる', () => {
      const result = addDirectEntry(taskRecord({}), input({ seconds: 1 }), context());

      expect(result.ok).toBe(true);
    });
  });

  describe('備考の検証（仕様書8.5.4）', () => {
    it('備考が無ければ登録できない', () => {
      const result = addDirectEntry(taskRecord({}), input({ note: '' }), context());

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('備考');
    });

    it('空白だけの備考は未入力として扱う', () => {
      const result = addDirectEntry(taskRecord({}), input({ note: '   ' }), context());

      expect(result.ok).toBe(false);
    });

    it('前後の空白を落として保存する', () => {
      const result = addDirectEntry(taskRecord({}), input({ note: '  移動時間  ' }), context());

      expect(result.created.note).toBe('移動時間');
    });

    it('保存形式の文字数上限を超える備考は拒否する', () => {
      const result = addDirectEntry(
        taskRecord({}),
        input({ note: 'A'.repeat(MAX_TEXT_LENGTH + 1) }),
        context(),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('参加者の扱い', () => {
    it('0人でも登録できる（人数を掛けないため）', () => {
      // 直接入力は既に人数を含んだ総工数であり（仕様書8.5.6）、work 区間の
      // ように0人を禁じる理由（仕様書8.9.4）が無い。
      const result = addDirectEntry(taskRecord({}), input({ participants: [] }), context());

      expect(result.ok).toBe(true);
      expect(result.created.participants).toEqual([]);
    });

    it('前後空白・空文字・重複を整える', () => {
      const result = addDirectEntry(
        taskRecord({}),
        input({ participants: [' 甲 ', '', '乙', '甲'] }),
        context(),
      );

      expect(result.created.participants).toEqual(['甲', '乙']);
    });

    it('表記ゆれは区別したまま残す（仕様書8.9.9）', () => {
      const result = addDirectEntry(
        taskRecord({}),
        input({ participants: ['甲', '甲 太郎'] }),
        context(),
      );

      expect(result.created.participants).toEqual(['甲', '甲 太郎']);
    });

    it('配列でなければ拒否する', () => {
      const result = addDirectEntry(taskRecord({}), input({ participants: '甲' }), context());

      expect(result.ok).toBe(false);
    });

    it('保存形式の文字数上限を超える参加者名は拒否する', () => {
      const result = addDirectEntry(
        taskRecord({}),
        input({ participants: ['A'.repeat(MAX_TEXT_LENGTH + 1)] }),
        context(),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('重複候補の警告（仕様書8.9.8）', () => {
    it('同一参加者・同一秒数があれば警告する', () => {
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲'] })],
      });

      const result = addDirectEntry(task, input({ seconds: 1200 }), context());

      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([
        {
          code: DIRECT_ENTRY_WARNING.DUPLICATE_CANDIDATE,
          path: '直接入力',
          message: expect.stringContaining('二重登録'),
        },
      ]);
    });

    it('警告しても保存は止めない', () => {
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲'] })],
      });

      const result = addDirectEntry(task, input({ seconds: 1200 }), context());

      expect(result.directEntries).toHaveLength(2);
    });

    it('秒数が違えば警告しない', () => {
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲'] })],
      });

      const result = addDirectEntry(task, input({ seconds: 1201 }), context());

      expect(result.warnings).toEqual([]);
    });

    it('参加者が違えば警告しない', () => {
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲'] })],
      });

      const result = addDirectEntry(task, input({ seconds: 1200, participants: ['乙'] }), context());

      expect(result.warnings).toEqual([]);
    });

    it('区切り位置が違えば別の顔ぶれとして扱う（レビュー指摘 S7-3）', () => {
      // 参加者名は自由入力なので、名前の中に空白が入りうる。単純な区切り文字で
      // 連結して比べると `['甲 太郎']` と `['甲', '太郎']` が同じキーになる。
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲 太郎'] })],
      });

      const result = addDirectEntry(
        task,
        input({ seconds: 1200, participants: ['甲', '太郎'] }),
        context(),
      );

      expect(result.warnings).toEqual([]);
    });

    it('参加者の並び順が違うだけなら警告する', () => {
      // 「甲、乙」と「乙、甲」は同じ顔ぶれである。入力した順で判定が変わるのは
      // 利用者から見て理解できない。
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲', '乙'] })],
      });

      const result = addDirectEntry(
        task,
        input({ seconds: 1200, participants: ['乙', '甲'] }),
        context(),
      );

      expect(result.warnings).toHaveLength(1);
    });

    it('備考が違っても警告する', () => {
      // 同じ工数を二度登録したとき、備考の書き方まで一致するとは限らない。
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲'], note: '移動時間' })],
      });

      const result = addDirectEntry(task, input({ seconds: 1200, note: '別の理由' }), context());

      expect(result.warnings).toHaveLength(1);
    });

    it('参加者0人どうしでも警告する', () => {
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: [] })],
      });

      const result = addDirectEntry(task, input({ seconds: 1200, participants: [] }), context());

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain('なし');
    });

    it('件数を警告文へ入れる', () => {
      const task = taskRecord({
        directEntries: [
          directEntry(1200, { participants: ['甲'] }),
          directEntry(1200, { participants: ['甲'] }),
        ],
      });

      const result = addDirectEntry(task, input({ seconds: 1200 }), context());

      expect(result.warnings[0].message).toContain('2 件');
    });

    it('検証に失敗した入力では警告を出さない', () => {
      const task = taskRecord({
        directEntries: [directEntry(1200, { participants: ['甲'] })],
      });

      const result = addDirectEntry(task, input({ seconds: 1200, note: '' }), context());

      expect(result.ok).toBe(false);
      expect(result.warnings).toEqual([]);
    });
  });
});

describe('editDirectEntry()', () => {
  /** 直接入力を1件持つ作業項目実績。 */
  function taskWithEntry(overrides = {}) {
    return taskRecord({
      directEntries: [directEntry(1200, { participants: ['甲'], note: '移動時間', ...overrides })],
    });
  }

  it('渡した項目だけを差し替える', () => {
    const task = taskWithEntry();
    const entryId = task.directEntries[0].entryId;

    const result = editDirectEntry(task, entryId, { seconds: 600 }, { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.updated).toMatchObject({
      entryId,
      seconds: 600,
      participants: ['甲'],
      note: '移動時間',
      updatedAt: NOW,
    });
  });

  it('createdAt は変えない', () => {
    const task = taskWithEntry();
    const before = task.directEntries[0].createdAt;

    const result = editDirectEntry(task, task.directEntries[0].entryId, { seconds: 60 }, { now: NOW });

    expect(result.updated.createdAt).toBe(before);
  });

  it('元の作業項目実績を書き換えない', () => {
    const task = taskWithEntry();

    editDirectEntry(task, task.directEntries[0].entryId, { seconds: 60 }, { now: NOW });

    expect(task.directEntries[0].seconds).toBe(1200);
  });

  it('見つからないIDは拒否する', () => {
    const result = editDirectEntry(taskWithEntry(), 'missing', { seconds: 60 }, { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('見つからない');
  });

  it('備考を空にはできない（仕様書8.5.4）', () => {
    const task = taskWithEntry();

    const result = editDirectEntry(task, task.directEntries[0].entryId, { note: '' }, { now: NOW });

    expect(result.ok).toBe(false);
  });

  it('負の値へは変えられない（仕様書8.5.5）', () => {
    const task = taskWithEntry();

    const result = editDirectEntry(task, task.directEntries[0].entryId, { seconds: -1 }, { now: NOW });

    expect(result.ok).toBe(false);
  });

  it('1秒以上のものを0秒へは変えられない', () => {
    const task = taskWithEntry();

    const result = editDirectEntry(task, task.directEntries[0].entryId, { seconds: 0 }, { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('1秒以上');
  });

  describe('取り込んだ0秒レコード（レビュー指摘 S7-2）', () => {
    // `schema.js` のインポート検証は0秒を通す。「取り込めるが直せない」
    // レコードを作らないため、0秒のままの保存は編集でも通す。
    function taskWithZeroEntry() {
      return taskRecord({
        directEntries: [directEntry(0, { participants: ['甲'], note: '取り込んだ記録' })],
      });
    }

    it('備考だけを直せる', () => {
      const task = taskWithZeroEntry();

      const result = editDirectEntry(
        task,
        task.directEntries[0].entryId,
        { note: '内容を確認して補記' },
        { now: NOW },
      );

      expect(result.ok).toBe(true);
      expect(result.updated).toMatchObject({ seconds: 0, note: '内容を確認して補記' });
    });

    it('参加者だけを直せる', () => {
      const task = taskWithZeroEntry();

      const result = editDirectEntry(
        task,
        task.directEntries[0].entryId,
        { participants: ['乙'] },
        { now: NOW },
      );

      expect(result.ok).toBe(true);
      expect(result.updated.participants).toEqual(['乙']);
    });

    it('画面が0秒をそのまま送り返しても通る', () => {
      // 編集フォームは分・秒を常に送る。0秒のレコードを開くと 0 が戻ってくる。
      const task = taskWithZeroEntry();

      const result = editDirectEntry(
        task,
        task.directEntries[0].entryId,
        { seconds: 0, participants: ['甲'], note: '内容を確認して補記' },
        { now: NOW },
      );

      expect(result.ok).toBe(true);
    });

    it('1秒以上へ直すこともできる', () => {
      const task = taskWithZeroEntry();

      const result = editDirectEntry(
        task,
        task.directEntries[0].entryId,
        { seconds: 600 },
        { now: NOW },
      );

      expect(result.ok).toBe(true);
      expect(result.updated.seconds).toBe(600);
    });

    it('新規追加では引き続き0秒を拒む', () => {
      const result = addDirectEntry(taskWithZeroEntry(), input({ seconds: 0 }), context());

      expect(result.ok).toBe(false);
    });
  });

  it('自分自身は重複候補にしない（仕様書8.9.8）', () => {
    // 値を変えずに保存し直しただけで警告が出ると、利用者は消しようのない警告を
    // 見続けることになる。
    const task = taskWithEntry();

    const result = editDirectEntry(task, task.directEntries[0].entryId, {}, { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('他の直接入力と同じ内容へ変えると警告する（仕様書8.9.8）', () => {
    const task = taskRecord({
      directEntries: [
        directEntry(1200, { participants: ['甲'] }),
        directEntry(600, { participants: ['甲'] }),
      ],
    });
    const second = task.directEntries[1].entryId;

    const result = editDirectEntry(task, second, { seconds: 1200 }, { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.warnings[0].code).toBe(DIRECT_ENTRY_WARNING.DUPLICATE_CANDIDATE);
  });
});

describe('removeDirectEntry()', () => {
  it('指定した直接入力を取り除き、削除した内容を返す', () => {
    const task = taskRecord({
      directEntries: [directEntry(1200), directEntry(600)],
    });
    const entryId = task.directEntries[0].entryId;

    const result = removeDirectEntry(task, entryId);

    expect(result.ok).toBe(true);
    expect(result.directEntries).toHaveLength(1);
    expect(result.removed.entryId).toBe(entryId);
  });

  it('元の作業項目実績を書き換えない', () => {
    const task = taskRecord({ directEntries: [directEntry(1200)] });

    removeDirectEntry(task, task.directEntries[0].entryId);

    expect(task.directEntries).toHaveLength(1);
  });

  it('見つからないIDは拒否する', () => {
    const result = removeDirectEntry(taskRecord({ directEntries: [] }), 'missing');

    expect(result.ok).toBe(false);
    expect(result.directEntries).toBeNull();
  });

  it('重複の警告は出さない', () => {
    // 削除で重複が増えることはない。
    const task = taskRecord({
      directEntries: [directEntry(1200, { participants: ['甲'] }), directEntry(1200, { participants: ['甲'] })],
    });

    const result = removeDirectEntry(task, task.directEntries[0].entryId);

    expect(result.warnings).toEqual([]);
  });
});

describe('findDuplicateCandidates()', () => {
  it('同一参加者・同一秒数のものだけを返す（仕様書8.9.8）', () => {
    const task = taskRecord({
      directEntries: [
        directEntry(1200, { participants: ['甲'] }),
        directEntry(1200, { participants: ['乙'] }),
        directEntry(600, { participants: ['甲'] }),
        directEntry(1200, { participants: ['甲'] }),
      ],
    });

    const found = findDuplicateCandidates(task, { seconds: 1200, participants: ['甲'] });

    expect(found).toHaveLength(2);
  });

  it('除外指定したIDは含めない', () => {
    const task = taskRecord({
      directEntries: [directEntry(1200, { participants: ['甲'] })],
    });
    const entryId = task.directEntries[0].entryId;

    const found = findDuplicateCandidates(task, { seconds: 1200, participants: ['甲'] }, entryId);

    expect(found).toEqual([]);
  });
});

describe('findDirectEntry()', () => {
  it('IDで1件引く', () => {
    const task = taskRecord({ directEntries: [directEntry(1200)] });
    const entryId = task.directEntries[0].entryId;

    expect(findDirectEntry(task, entryId).entryId).toBe(entryId);
  });

  it('無ければ null', () => {
    expect(findDirectEntry(taskRecord({ directEntries: [] }), 'missing')).toBeNull();
  });
});

describe('formatSeconds()', () => {
  it.each([
    [0, '0分0秒'],
    [1, '0分1秒'],
    [59, '0分59秒'],
    [60, '1分0秒'],
    [1200, '20分0秒'],
    [1230, '20分30秒'],
    [3600, '60分0秒'],
  ])('%i秒 は %s', (seconds, expected) => {
    expect(formatSeconds(seconds)).toBe(expected);
  });
});
