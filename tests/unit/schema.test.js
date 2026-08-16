/**
 * インポートJSON検証の単体テスト（仕様書9.3、実装計画8.2）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_DIRECT_ENTRY_SECONDS,
  MAX_LONG_RUNNING_THRESHOLD_HOURS,
  MAX_PARTICIPANTS,
  MAX_QUANTITY,
  MAX_RETENTION_DAYS,
  MAX_TEXT_LENGTH,
  SCHEMA_VERSION,
  createDefaultSettings,
} from '../../src/config.js';
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

    it('retentionDays が上限を超えると失敗する（レビュー指摘 S10-5）', () => {
      // 取り込みも保存の入口と同じ範囲を課す。ここを通ると、画面が開けない
      // 設定を外部ファイルから流し込めてしまう。
      const result = validateImportPayload(
        validPayload({ settings: { ...createDefaultSettings(), retentionDays: 1e20 } }),
      );

      expect(result.errors.join('\n')).toContain('settings.retentionDays');
    });

    it('longRunningThresholdHours が上限を超えると失敗する', () => {
      const result = validateImportPayload(
        validPayload({
          settings: {
            ...createDefaultSettings(),
            longRunningThresholdHours: MAX_LONG_RUNNING_THRESHOLD_HOURS + 1,
          },
        }),
      );

      expect(result.errors.join('\n')).toContain('settings.longRunningThresholdHours');
    });

    it('上限ちょうどは通る', () => {
      expect(
        validateImportPayload(
          validPayload({
            settings: { ...createDefaultSettings(), retentionDays: MAX_RETENTION_DAYS },
          }),
        ).ok,
      ).toBe(true);
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
      `projectGroups[1].totalQuantity: 1以上 ${MAX_QUANTITY} 以下の整数である必要がある`,
    );
  });

  /**
   * 通常の書き込み経路が保存しない形の値を拒む（レビュー指摘 F12-01）。
   *
   * 受理してしまうと、画面の検索と重複判定は正規化した入力と保存済みの生値を
   * 比べるため、取り込んだ案件・テンプレートを引けなくなる。
   */
  describe('正規化されていない文字列を拒否する（F12-01）', () => {
    /** 1件だけ書き換えて、その項目のエラーだけを取り出す。 */
    function errorsFor(path, mutate) {
      const payload = validPayload();
      mutate(payload);
      return validateImportPayload(payload).errors.filter((message) =>
        message.startsWith(`${path}:`),
      );
    }

    it('テンプレートの対象種別', () => {
      expect(
        errorsFor('taskTemplates[0].targetType', (p) => {
          p.taskTemplates[0].targetType = ' 対象種別A ';
        }),
      ).toHaveLength(1);
    });

    it('テンプレートのバリエーション', () => {
      expect(
        errorsFor('taskTemplates[0].variant', (p) => {
          p.taskTemplates[0].variant = '標準 ';
        }),
      ).toHaveLength(1);
    });

    it('案件ID', () => {
      expect(
        errorsFor('projectGroups[0].projectId', (p) => {
          p.projectGroups[0].projectId = '  PJ-0001  ';
        }),
      ).toHaveLength(1);
    });

    it('作業項目名', () => {
      expect(
        errorsFor('workRuns[0].tasks[0].name', (p) => {
          p.workRuns[0].tasks[0].name = '作業項目A ';
        }),
      ).toHaveLength(1);
    });

    it('外部項目コード（null は許す）', () => {
      expect(
        errorsFor('taskTemplates[0].tasks[0].externalCode', (p) => {
          p.taskTemplates[0].tasks[0].externalCode = ' X-100';
        }),
      ).toHaveLength(1);

      const payload = validPayload();
      payload.taskTemplates[0].tasks[0].externalCode = null;
      expect(validateImportPayload(payload).ok).toBe(true);
    });

    it('直接入力の備考', () => {
      expect(
        errorsFor('workRuns[0].tasks[0].directEntries[0].note', (p) => {
          p.workRuns[0].tasks[0].directEntries[0].note = '計測漏れ分を追加 ';
        }),
      ).toHaveLength(1);
    });

    it('変更履歴の理由', () => {
      expect(
        errorsFor('changeHistory[0].reason', (p) => {
          p.changeHistory[0].reason = ' 転記先の誤りに気づいたため';
        }),
      ).toHaveLength(1);
    });
  });

  /**
   * 安全整数の外にある値を拒む（レビュー指摘 F12-05）。
   *
   * `9007199254740993` は `Number` へ変換された時点で1つ下の値へ丸められ、
   * `Number.isInteger()` は丸めた後の値を整数と判定する。入力した値と保存される
   * 値が違うことに利用者が気づけない。
   */
  describe('数値の安全な範囲（F12-05）', () => {
    it('安全整数を超える数量を拒否する', () => {
      const payload = validPayload();
      payload.projectGroups[0].totalQuantity = 9007199254740993;

      expect(validateImportPayload(payload).ok).toBe(false);
    });

    it('上限を超える数量を拒否する', () => {
      const payload = validPayload();
      payload.workRuns[0].runQuantity = MAX_QUANTITY + 1;

      expect(validateImportPayload(payload).ok).toBe(false);
    });

    it('上限を超える直接入力の秒数を拒否する', () => {
      const payload = validPayload();
      payload.workRuns[0].tasks[0].directEntries[0].seconds = MAX_DIRECT_ENTRY_SECONDS + 1;

      expect(validateImportPayload(payload).ok).toBe(false);
    });

    it('上限ちょうどは通す', () => {
      const payload = validPayload();
      payload.projectGroups[0].totalQuantity = MAX_QUANTITY;
      payload.workRuns[0].tasks[0].directEntries[0].seconds = MAX_DIRECT_ENTRY_SECONDS;

      expect(validateImportPayload(payload).ok).toBe(true);
    });
  });

  /** 取り込みの規模上限（仕様書9.3、公開前チェックリスト3章）。 */
  describe('取り込みの規模上限', () => {
    it('参加者数の上限を超える区間を拒否する', () => {
      const payload = validPayload();
      payload.workRuns[0].tasks[0].intervals[0].participants = Array.from(
        { length: MAX_PARTICIPANTS + 1 },
        (_, index) => `参加者${index}`,
      );

      expect(validateImportPayload(payload).ok).toBe(false);
    });

    it('極端に長い文字列を拒否する', () => {
      const payload = validPayload();
      payload.projectGroups[0].projectId = 'A'.repeat(MAX_TEXT_LENGTH + 1);

      expect(validateImportPayload(payload).ok).toBe(false);
    });

    it('内部識別子にも同じ長さの上限を適用する（F12-32）', () => {
      // 識別子はDOMのid属性や変更履歴の `targetId` として使い回される。
      // 形は問わないが、長さは他の文字列と同じ上限に収める。
      const overLong = 'A'.repeat(MAX_TEXT_LENGTH + 1);
      const cases = [
        ['taskTemplates[0].templateId', (p) => { p.taskTemplates[0].templateId = overLong; }],
        ['projectGroups[0].projectGroupId', (p) => { p.projectGroups[0].projectGroupId = overLong; }],
        ['workRuns[0].runId', (p) => { p.workRuns[0].runId = overLong; }],
        ['workRuns[0].tasks[0].taskRecordId', (p) => { p.workRuns[0].tasks[0].taskRecordId = overLong; }],
        [
          'workRuns[0].tasks[0].intervals[0].intervalId',
          (p) => { p.workRuns[0].tasks[0].intervals[0].intervalId = overLong; },
        ],
        ['changeHistory[0].historyId', (p) => { p.changeHistory[0].historyId = overLong; }],
      ];

      for (const [path, mutate] of cases) {
        const payload = validPayload();
        mutate(payload);
        const errors = validateImportPayload(payload).errors;
        expect(errors.some((message) => message.startsWith(`${path}:`)), path).toBe(true);
      }
    });

    it('上限ちょうどの識別子は通す', () => {
      const payload = validPayload();
      payload.workRuns[0].runId = 'A'.repeat(MAX_TEXT_LENGTH);

      expect(validateImportPayload(payload).ok).toBe(true);
    });
  });
});
