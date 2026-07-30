/**
 * インポートJSON検証の単体テスト（仕様書9.3、実装計画8.2）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';
import { validateImportPayload } from '../../src/domain/schema.js';
import {
  historyEntry,
  projectGroup,
  resetIds,
  taskTemplate,
  workRun,
} from '../fixtures/builders.js';

/** 検証を通る最小のエクスポートJSON。 */
function validPayload(overrides = {}) {
  const group = projectGroup();
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: '2026-07-30T12:34:56+09:00',
    settings: createDefaultSettings(),
    taskTemplates: [taskTemplate()],
    projectGroups: [group],
    workRuns: [workRun({ projectGroupId: group.projectGroupId, withTaskDetail: true })],
    changeHistory: [historyEntry()],
    ...overrides,
  };
}

beforeEach(() => {
  resetIds();
});

describe('validateImportPayload()', () => {
  it('正常なJSONを受け付ける', () => {
    const result = validateImportPayload(validPayload());

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.schemaMismatch).toBe(false);
  });

  it('exportedAt が無くても受け付ける', () => {
    const payload = validPayload();
    delete payload.exportedAt;

    expect(validateImportPayload(payload).ok).toBe(true);
  });

  it('オブジェクトでない値を拒否する', () => {
    for (const value of ['文字列', 42, null, [], undefined]) {
      const result = validateImportPayload(value);
      expect(result.ok).toBe(false);
      expect(result.schemaMismatch).toBe(false);
    }
  });

  describe('schemaVersion（決定事項S）', () => {
    it('現行値と一致しなければ schemaMismatch を立てる', () => {
      const result = validateImportPayload(
        validPayload({ schemaVersion: SCHEMA_VERSION + 1 }),
      );

      expect(result.ok).toBe(false);
      expect(result.schemaMismatch).toBe(true);
    });

    it('欠けている場合も schemaMismatch として扱う', () => {
      const payload = validPayload();
      delete payload.schemaVersion;

      expect(validateImportPayload(payload).schemaMismatch).toBe(true);
    });

    it('文字列の "1" は受け付けない', () => {
      expect(
        validateImportPayload(validPayload({ schemaVersion: String(SCHEMA_VERSION) }))
          .schemaMismatch,
      ).toBe(true);
    });

    it('不一致のときは他の不備を列挙しない（移行処理を行わないため）', () => {
      const result = validateImportPayload({
        schemaVersion: SCHEMA_VERSION + 1,
        settings: '壊れている',
      });

      expect(result.errors).toHaveLength(1);
    });
  });

  describe('必須キー', () => {
    it.each(['settings', 'taskTemplates', 'projectGroups', 'workRuns', 'changeHistory'])(
      '%s が欠けていると失敗する',
      (key) => {
        const payload = validPayload();
        delete payload[key];

        const result = validateImportPayload(payload);
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain(key);
      },
    );

    it.each(['taskTemplates', 'projectGroups', 'workRuns', 'changeHistory'])(
      '%s が配列でないと失敗する',
      (key) => {
        expect(validateImportPayload(validPayload({ [key]: {} })).ok).toBe(false);
      },
    );
  });

  describe('設定（仕様書6.2）', () => {
    it('retentionDays が0以下だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ settings: { ...createDefaultSettings(), retentionDays: 0 } }),
      );

      expect(result.errors.join('\n')).toContain('settings.retentionDays');
    });

    it('lastExportedAt は null を許す', () => {
      expect(
        validateImportPayload(
          validPayload({ settings: { ...createDefaultSettings(), lastExportedAt: null } }),
        ).ok,
      ).toBe(true);
    });

    it('lastExportedAt がISO 8601でないと失敗する', () => {
      const result = validateImportPayload(
        validPayload({
          settings: { ...createDefaultSettings(), lastExportedAt: '2026-07-30' },
        }),
      );

      expect(result.errors.join('\n')).toContain('settings.lastExportedAt');
    });
  });

  describe('作業テンプレート（仕様書6.3）', () => {
    it('active が真偽値でないと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ taskTemplates: [{ ...taskTemplate(), active: 'true' }] }),
      );

      expect(result.errors.join('\n')).toContain('taskTemplates[0].active');
    });

    it('version が0以下だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ taskTemplates: [{ ...taskTemplate(), version: 0 }] }),
      );

      expect(result.errors.join('\n')).toContain('taskTemplates[0].version');
    });

    it('作業項目定義の externalCode は null を許す（仕様書8.7.4）', () => {
      const template = taskTemplate();
      template.tasks[0].externalCode = null;

      expect(validateImportPayload(validPayload({ taskTemplates: [template] })).ok).toBe(
        true,
      );
    });

    it('作業項目定義の externalCode が空文字だと失敗する', () => {
      const template = taskTemplate();
      template.tasks[0].externalCode = '';

      const result = validateImportPayload(validPayload({ taskTemplates: [template] }));
      expect(result.errors.join('\n')).toContain('taskTemplates[0].tasks[0].externalCode');
    });
  });

  describe('案件グループ（仕様書6.4、8.9.2）', () => {
    it('totalQuantity が小数だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ projectGroups: [{ ...projectGroup(), totalQuantity: 1.5 }] }),
      );

      expect(result.errors.join('\n')).toContain('projectGroups[0].totalQuantity');
    });

    it('projectId が空文字だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ projectGroups: [{ ...projectGroup(), projectId: '  ' }] }),
      );

      expect(result.errors.join('\n')).toContain('projectGroups[0].projectId');
    });
  });

  describe('実施回（仕様書6.5）', () => {
    it('status が既定の4値以外だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ workRuns: [workRun({ status: 'deletionCandidate' })] }),
      );

      // 削除候補は保存しない導出値である（仕様書6.5）。
      expect(result.errors.join('\n')).toContain('workRuns[0].status');
    });

    it.each(['working', 'aggregated', 'transferred', 'archived'])(
      'status が %s なら受け付ける',
      (status) => {
        expect(validateImportPayload(validPayload({ workRuns: [workRun({ status })] })).ok).toBe(
          true,
        );
      },
    );

    it('workDate が YYYY-MM-DD でないと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ workRuns: [workRun({ workDate: '2026/07/30' })] }),
      );

      expect(result.errors.join('\n')).toContain('workRuns[0].workDate');
    });

    it('archivedAt は null を許す（アーカイブ前）', () => {
      expect(
        validateImportPayload(validPayload({ workRuns: [workRun({ archivedAt: null })] })).ok,
      ).toBe(true);
    });

    it('archivedAt にISO 8601を入れられる（保持期間の起算日）', () => {
      expect(
        validateImportPayload(
          validPayload({
            workRuns: [
              workRun({ status: 'archived', archivedAt: '2026-07-30T20:00:00+09:00' }),
            ],
          }),
        ).ok,
      ).toBe(true);
    });
  });

  describe('作業区間（仕様書6.7、8.9.4）', () => {
    /** 1区間だけを持つ実施回を作る。 */
    function runWithInterval(interval) {
      const run = workRun({ withTaskDetail: true });
      run.tasks[0].intervals = [interval];
      return run;
    }

    const baseInterval = {
      intervalId: 'interval-x',
      type: 'work',
      startAt: '2026-07-30T09:00:00+09:00',
      endAt: '2026-07-30T09:20:00+09:00',
      participants: ['甲'],
      createdAt: '2026-07-30T09:00:00+09:00',
      updatedAt: '2026-07-30T09:00:00+09:00',
    };

    it('endAt が null の未終了区間を受け付ける', () => {
      expect(
        validateImportPayload(
          validPayload({ workRuns: [runWithInterval({ ...baseInterval, endAt: null })] }),
        ).ok,
      ).toBe(true);
    });

    it('work 区間の参加者0人を拒否する', () => {
      const result = validateImportPayload(
        validPayload({
          workRuns: [runWithInterval({ ...baseInterval, type: 'work', participants: [] })],
        }),
      );

      expect(result.errors.join('\n')).toContain('participants');
    });

    it('break 区間の参加者0人は受け付ける', () => {
      expect(
        validateImportPayload(
          validPayload({
            workRuns: [runWithInterval({ ...baseInterval, type: 'break', participants: [] })],
          }),
        ).ok,
      ).toBe(true);
    });

    it('type が work / break 以外だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ workRuns: [runWithInterval({ ...baseInterval, type: 'idle' })] }),
      );

      expect(result.errors.join('\n')).toContain('type');
    });

    it('startAt にミリ秒が付いていると失敗する（秒精度、仕様書8.4.4）', () => {
      const result = validateImportPayload(
        validPayload({
          workRuns: [runWithInterval({ ...baseInterval, startAt: '2026-07-30T09:00:00.500+09:00' })],
        }),
      );

      expect(result.errors.join('\n')).toContain('startAt');
    });

    it('オフセットが無いと失敗する', () => {
      const result = validateImportPayload(
        validPayload({
          workRuns: [runWithInterval({ ...baseInterval, startAt: '2026-07-30T09:00:00' })],
        }),
      );

      expect(result.errors.join('\n')).toContain('startAt');
    });
  });

  describe('直接入力（仕様書6.8、8.5.4、8.5.5）', () => {
    /** 1件だけ直接入力を持つ実施回を作る。 */
    function runWithEntry(entry) {
      const run = workRun({ withTaskDetail: true });
      run.tasks[0].directEntries = [entry];
      return run;
    }

    const baseEntry = {
      entryId: 'entry-x',
      seconds: 1200,
      participants: ['甲'],
      note: '計測漏れ分を追加',
      createdAt: '2026-07-30T10:00:00+09:00',
      updatedAt: '2026-07-30T10:00:00+09:00',
    };

    it('seconds が0でも受け付ける', () => {
      expect(
        validateImportPayload(validPayload({ workRuns: [runWithEntry({ ...baseEntry, seconds: 0 })] }))
          .ok,
      ).toBe(true);
    });

    it('seconds が負だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ workRuns: [runWithEntry({ ...baseEntry, seconds: -1 })] }),
      );

      expect(result.errors.join('\n')).toContain('seconds');
    });

    it('note が空だと失敗する（備考必須）', () => {
      const result = validateImportPayload(
        validPayload({ workRuns: [runWithEntry({ ...baseEntry, note: '   ' })] }),
      );

      expect(result.errors.join('\n')).toContain('note');
    });
  });

  describe('簡易変更履歴（仕様書11章、決定事項F・G）', () => {
    it('reason が空だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ changeHistory: [{ ...historyEntry(), reason: '' }] }),
      );

      expect(result.errors.join('\n')).toContain('changeHistory[0].reason');
    });

    it('operation が11章の5種以外だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ changeHistory: [{ ...historyEntry(), operation: 'quantityChanged' }] }),
      );

      // 数量変更は記録対象外である（仕様書11章）。
      expect(result.errors.join('\n')).toContain('changeHistory[0].operation');
    });

    it('entityType が4種以外だと失敗する', () => {
      const result = validateImportPayload(
        validPayload({ changeHistory: [{ ...historyEntry(), entityType: 'taskTemplate' }] }),
      );

      expect(result.errors.join('\n')).toContain('changeHistory[0].entityType');
    });

    it('changeHistory は空配列でよい', () => {
      expect(validateImportPayload(validPayload({ changeHistory: [] })).ok).toBe(true);
    });
  });

  it('不備の位置が何件目のどのフィールドか分かる形で返る', () => {
    const group = projectGroup();
    const result = validateImportPayload(
      validPayload({
        projectGroups: [group, { ...projectGroup(), totalQuantity: 0 }],
      }),
    );

    expect(result.errors).toContain(
      'projectGroups[1].totalQuantity: 1以上の整数である必要がある（仕様書8.9.2）',
    );
  });
});
