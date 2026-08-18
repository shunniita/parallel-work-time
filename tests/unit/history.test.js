/**
 * 簡易変更履歴の組み立て（仕様書11章）。
 *
 * 理由の必須（仕様書11章）と、要約から削除内容を追えることを固定する。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  HISTORY_ENTITY,
  HISTORY_ENTITY_BY_OP,
  HISTORY_OP,
  buildHistoryEntry,
  describeInterval,
  formatIntervalRange,
  summarizeIntervalDeletion,
} from '../../src/domain/history.js';
import { formatIsoForHuman } from '../../src/domain/datetime.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import {
  MAX_SUMMARY_LENGTH,
  MAX_TEXT_LENGTH,
  SCHEMA_VERSION,
  createDefaultSettings,
} from '../../src/config.js';
import {
  breakInterval,
  resetIds,
  taskRecord,
  workInterval,
  workRun,
} from '../fixtures/builders.js';

const META = { historyId: 'history-1', timestamp: '2026-07-30T12:00:00+09:00' };

function deletionDraft(overrides = {}) {
  return {
    entityType: HISTORY_ENTITY.INTERVAL,
    targetId: 'interval-1',
    operation: HISTORY_OP.INTERVAL_DELETED,
    summary: '作業区間を削除',
    reason: '二重に記録していたため',
    ...overrides,
  };
}

describe('操作と対象種別の組み合わせ（過去のレビュー指摘）', () => {
  // 仕様書11章は対象種別と操作をそれぞれ列挙するが、組み合わせの表は無い。
  // 自由に組めると語義の通らない履歴が作れるため、契約として固定する。

  it.each([
    [HISTORY_OP.STATUS_REVERTED, HISTORY_ENTITY.WORK_RUN],
    [HISTORY_OP.INTERVAL_DELETED, HISTORY_ENTITY.INTERVAL],
    [HISTORY_OP.DIRECT_ENTRY_DELETED, HISTORY_ENTITY.DIRECT_ENTRY],
    [HISTORY_OP.WORK_RUN_DELETED, HISTORY_ENTITY.WORK_RUN],
    [HISTORY_OP.PROJECT_GROUP_DELETED, HISTORY_ENTITY.PROJECT_GROUP],
  ])('%s の対象種別は %s である', (operation, entityType) => {
    expect(HISTORY_ENTITY_BY_OP[operation]).toBe(entityType);

    const result = buildHistoryEntry(deletionDraft({ operation, entityType }), META);
    expect(result.ok).toBe(true);
  });

  it('対応しない組み合わせは組み立てない', () => {
    const result = buildHistoryEntry(
      deletionDraft({
        entityType: HISTORY_ENTITY.PROJECT_GROUP,
        operation: HISTORY_OP.INTERVAL_DELETED,
      }),
      META,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('対象種別');
    expect(result.entry).toBeNull();
  });

  it('操作が未知なら組み合わせの指摘は出さない', () => {
    // 操作そのものの指摘だけで足りる。対応表を引いても意味がない。
    const result = buildHistoryEntry(deletionDraft({ operation: 'unknown' }), META);

    expect(result.ok).toBe(false);
    expect(result.errors.filter((message) => message.startsWith('対象種別:'))).toEqual([]);
  });

  it('すべての操作に対応する対象種別がある', () => {
    for (const operation of Object.values(HISTORY_OP)) {
      expect(HISTORY_ENTITY_BY_OP[operation]).toBeTruthy();
    }
  });
});

describe('buildHistoryEntry（仕様書11章）', () => {
  it('仕様書11章の7項目を持つ履歴を作る', () => {
    const result = buildHistoryEntry(deletionDraft(), META);

    expect(result.ok).toBe(true);
    expect(Object.keys(result.entry).sort()).toEqual(
      ['entityType', 'historyId', 'operation', 'reason', 'summary', 'targetId', 'timestamp'],
    );
    expect(result.entry).toMatchObject({
      historyId: 'history-1',
      timestamp: '2026-07-30T12:00:00+09:00',
      entityType: 'interval',
      targetId: 'interval-1',
      operation: 'intervalDeleted',
      reason: '二重に記録していたため',
    });
  });

  it('保存できる形になっている（インポート検証を通る）', () => {
    const { entry } = buildHistoryEntry(deletionDraft(), META);

    const result = validateImportPayload({
      schemaVersion: SCHEMA_VERSION,
      settings: createDefaultSettings(),
      taskTemplates: [],
      projectGroups: [],
      workRuns: [],
      changeHistory: [entry],
    });

    expect(result.errors).toEqual([]);
  });

  it('理由が無ければ組み立てない', () => {
    const result = buildHistoryEntry(deletionDraft({ reason: undefined }), META);

    expect(result.ok).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.errors.join('\n')).toContain('理由');
  });

  it('空白のみの理由は未入力として扱う', () => {
    expect(buildHistoryEntry(deletionDraft({ reason: '   ' }), META).ok).toBe(false);
  });

  it('理由の前後空白を落として保存する', () => {
    const { entry } = buildHistoryEntry(deletionDraft({ reason: '  誤入力  ' }), META);

    expect(entry.reason).toBe('誤入力');
  });

  it('理由と要約の保存形式上限を超える履歴は組み立てない', () => {
    expect(buildHistoryEntry(
      deletionDraft({ reason: 'A'.repeat(MAX_TEXT_LENGTH + 1) }),
      META,
    ).ok).toBe(false);
    expect(buildHistoryEntry(
      deletionDraft({ summary: 'A'.repeat(MAX_SUMMARY_LENGTH + 1) }),
      META,
    ).ok).toBe(false);
  });

  it('未知の対象種別・操作種別を拒否する', () => {
    expect(buildHistoryEntry(deletionDraft({ entityType: 'task' }), META).ok).toBe(false);
    expect(buildHistoryEntry(deletionDraft({ operation: 'edited' }), META).ok).toBe(false);
  });

  it('対象の識別子が無ければ拒否する', () => {
    expect(buildHistoryEntry(deletionDraft({ targetId: '' }), META).ok).toBe(false);
  });

  it('記録日時の形式が不正なら拒否する', () => {
    const result = buildHistoryEntry(deletionDraft(), {
      historyId: 'history-1',
      timestamp: '2026-07-30 12:00',
    });

    expect(result.ok).toBe(false);
  });

  it('要約は空文字でもよい（内容は呼び出し側が決める）', () => {
    expect(buildHistoryEntry(deletionDraft({ summary: '' }), META).ok).toBe(true);
  });

  it('要約が文字列でなければ拒否する', () => {
    expect(buildHistoryEntry(deletionDraft({ summary: null }), META).ok).toBe(false);
  });

  it('履歴IDが無ければ拒否する', () => {
    const result = buildHistoryEntry(deletionDraft(), { ...META, historyId: '' });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('履歴ID');
  });
});

describe('区間の説明', () => {
  beforeEach(resetIds);

  it('日時を読める形へ直す', () => {
    expect(formatIsoForHuman('2026-07-30T09:00:00+09:00')).toBe('2026-07-30 09:00:00');
  });

  it('同日なら終了は時刻だけを出す', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T10:30:00+09:00');

    expect(formatIntervalRange(interval)).toBe('2026-07-30 09:00:00 〜 10:30:00');
  });

  it('日をまたぐ場合は終了にも日付を出す（仕様書8.4.8）', () => {
    const interval = workInterval('2026-07-30T23:30:00+09:00', '2026-07-31T01:15:00+09:00');

    expect(formatIntervalRange(interval)).toBe(
      '2026-07-30 23:30:00 〜 2026-07-31 01:15:00',
    );
  });

  it('未終了区間はその旨を出す（仕様書6.7）', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', null);

    expect(formatIntervalRange(interval)).toBe('2026-07-30 09:00:00 〜 未終了');
  });

  it('種別・時間帯・参加者・工数を1行にまとめる', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', [
      '甲',
      '乙',
    ]);

    // 20分 × 2人 = 2400秒（仕様書8.6.1）。
    expect(describeInterval(interval)).toBe(
      '作業 2026-07-30 09:00:00 〜 09:20:00 / 参加者: 甲、乙 / 工数: 2400秒',
    );
  });

  it('休憩は0秒として出す（仕様書8.6.2）', () => {
    const interval = breakInterval('2026-07-30T12:00:00+09:00', '2026-07-30T13:00:00+09:00', [
      '甲',
    ]);

    expect(describeInterval(interval)).toContain('休憩');
    expect(describeInterval(interval)).toContain('工数: 0秒');
  });

  it('参加者0人は「なし」と出す（仕様書8.9.4）', () => {
    const interval = breakInterval('2026-07-30T12:00:00+09:00', '2026-07-30T13:00:00+09:00', []);

    expect(describeInterval(interval)).toContain('参加者: なし');
  });
});

describe('summarizeIntervalDeletion（仕様書11章）', () => {
  beforeEach(resetIds);

  it('実施回・作業項目・区間の内容を要約へ含める', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00', [
      '甲',
    ]);
    const task = taskRecord({ name: '受入確認', intervals: [interval] });
    const run = workRun({ tasks: [task], workDate: '2026-07-30' });

    const summary = summarizeIntervalDeletion(run, task, interval);

    expect(summary).toContain('2026-07-30');
    expect(summary).toContain('受入確認');
    expect(summary).toContain('09:00:00');
    expect(summary).toContain('甲');
  });

  it('確認に出す説明と同じ文言を含む（食い違わせない）', () => {
    const interval = workInterval('2026-07-30T09:00:00+09:00', '2026-07-30T09:20:00+09:00');
    const task = taskRecord({ intervals: [interval] });
    const run = workRun({ tasks: [task] });

    expect(summarizeIntervalDeletion(run, task, interval)).toContain(
      describeInterval(interval),
    );
  });
});
