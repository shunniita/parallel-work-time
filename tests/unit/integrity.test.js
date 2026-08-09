import { describe, expect, it } from 'vitest';

import { createDefaultSettings, SCHEMA_VERSION } from '../../src/config.js';
import { validateImport } from '../../src/domain/integrity.js';
import {
  historyEntry,
  projectGroup,
  resetIds,
  taskRecord,
  taskTemplate,
  workInterval,
  workRun,
} from '../fixtures/builders.js';

function validPayload() {
  resetIds();
  const template = taskTemplate();
  const group = projectGroup({ projectId: 'PJ-0001' });
  const task = {
    ...taskRecord({
      intervals: [
        workInterval('2026-08-01T09:00:00+09:00', '2026-08-01T10:00:00+09:00'),
      ],
    }),
    taskDefinitionId: template.tasks[0].taskDefinitionId,
  };
  const run = {
    ...workRun({ projectGroupId: group.projectGroupId, tasks: [task] }),
    templateId: template.templateId,
    templateVersion: template.version,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: '2026-08-01T12:00:00+09:00',
    settings: createDefaultSettings(),
    taskTemplates: [template],
    projectGroups: [group],
    workRuns: [run],
    changeHistory: [],
  };
}

function errorsOf(mutator) {
  const payload = validPayload();
  mutator(payload);
  return validateImport(payload).errors.join('\n');
}

describe('validateImport（構造＋業務整合性）', () => {
  it('関係が整ったエクスポートデータを通す', () => {
    expect(validateImport(validPayload())).toEqual({ ok: true, schemaMismatch: false, errors: [] });
  });

  it('主キーの重複を拒否する', () => {
    expect(errorsOf((p) => p.workRuns.push(structuredClone(p.workRuns[0])))).toContain(
      '実施回の識別子が重複',
    );
  });

  it('前後空白を除いた案件IDの重複を拒否する', () => {
    expect(
      errorsOf((p) => p.projectGroups.push({
        ...p.projectGroups[0],
        projectGroupId: 'group-2',
        projectId: '  PJ-0001  ',
      })),
    ).toContain('案件IDが重複');
  });

  it('対象種別とバリエーションに有効版が2つあると拒否する', () => {
    expect(errorsOf((p) => p.taskTemplates.push({
      ...structuredClone(p.taskTemplates[0]),
      templateId: 'template-2',
      templateSeriesId: 'series-2',
      version: 2,
    }))).toContain('有効版が2つ以上');
  });

  it('同一系列の版番号重複を拒否する', () => {
    expect(errorsOf((p) => p.taskTemplates.push({
      ...structuredClone(p.taskTemplates[0]),
      templateId: 'template-2',
      active: false,
    }))).toContain('版番号が重複');
  });

  it('存在しない案件グループ参照を拒否する', () => {
    expect(errorsOf((p) => { p.workRuns[0].projectGroupId = 'missing'; })).toContain(
      '案件グループが見つからない',
    );
  });

  it('存在しないテンプレート参照を拒否する', () => {
    expect(errorsOf((p) => { p.workRuns[0].templateId = 'missing'; })).toContain(
      '作業テンプレートが見つからない',
    );
  });

  it('参照テンプレートに無い作業項目定義を拒否する', () => {
    expect(errorsOf((p) => { p.workRuns[0].tasks[0].taskDefinitionId = 'missing'; })).toContain(
      '作業項目定義が見つからない',
    );
  });

  it('終了が開始より前の区間を拒否する', () => {
    expect(errorsOf((p) => {
      p.workRuns[0].tasks[0].intervals[0].endAt = '2026-08-01T08:59:59+09:00';
    })).toContain('終了日時が開始日時より前');
  });

  it('転記済みと未終了区間の同居を拒否する', () => {
    expect(errorsOf((p) => {
      p.workRuns[0].status = 'transferred';
      p.workRuns[0].transferredAt = '2026-08-01T12:00:00+09:00';
      p.workRuns[0].tasks[0].intervals[0].endAt = null;
    })).toContain('未終了の作業区間');
  });

  it('アーカイブ日時と状態の不一致を拒否する', () => {
    expect(errorsOf((p) => {
      p.workRuns[0].archivedAt = '2026-08-01T12:00:00+09:00';
    })).toContain('working なのにアーカイブ日時');
  });

  it('転記日時を保持しアーカイブ日時を持つアーカイブ済み実施回を通す', () => {
    const payload = validPayload();
    payload.workRuns[0].status = 'archived';
    payload.workRuns[0].transferredAt = '2026-08-01T11:00:00+09:00';
    payload.workRuns[0].archivedAt = '2026-08-07T12:00:00+09:00';
    // アーカイブは `updatedAt` も同時に進める（`archiveRun`）。
    payload.workRuns[0].updatedAt = '2026-08-07T12:00:00+09:00';

    expect(validateImport(payload)).toEqual({
      ok: true,
      schemaMismatch: false,
      errors: [],
    });
  });

  it('変更履歴の操作と対象種別の不一致を拒否する', () => {
    expect(errorsOf((p) => p.changeHistory.push(historyEntry({
      entityType: 'projectGroup',
      operation: 'intervalDeleted',
    })))).toContain('intervalDeleted の対象種別は interval');
  });

  it('削除履歴の対象が現存しなくても通す', () => {
    const payload = validPayload();
    payload.changeHistory.push(historyEntry({
      entityType: 'interval',
      targetId: 'already-deleted',
      operation: 'intervalDeleted',
    }));

    expect(validateImport(payload).ok).toBe(true);
  });
});

describe('参加者の意味を通常入力と一致させる（GAR-2）', () => {
  it('同じ参加者が重複していると拒否する', () => {
    // 工数は participants.length を人数として掛けるため、1人の作業が2人分になる。
    expect(errorsOf((p) => {
      p.workRuns[0].tasks[0].intervals[0].participants = ['甲', '甲'];
    })).toContain('同じ参加者が重複している');
  });

  it('前後空白だけが違う名前も重複として拒否する', () => {
    // 通常入力は trim してから重複を落とす（`normalizeParticipants`）。
    expect(errorsOf((p) => {
      p.workRuns[0].tasks[0].intervals[0].participants = ['甲', ' 甲 '];
    })).toContain('同じ参加者が重複している');
  });

  it('空の参加者名を拒否する', () => {
    expect(errorsOf((p) => {
      p.workRuns[0].tasks[0].intervals[0].participants = ['甲', '  '];
    })).toContain('空の参加者名');
  });

  it('空白名だけの作業区間は0人として拒否する', () => {
    const errors = errorsOf((p) => {
      p.workRuns[0].tasks[0].intervals[0].participants = ['   '];
    });

    expect(errors).toContain('空の参加者名');
    expect(errors).toContain('参加者が1名以上必要');
  });

  it('休憩区間は0人を許す（仕様書8.9.4）', () => {
    const payload = validPayload();
    payload.workRuns[0].tasks[0].intervals.push({
      ...structuredClone(payload.workRuns[0].tasks[0].intervals[0]),
      intervalId: 'interval-break',
      type: 'break',
      participants: [],
    });

    expect(validateImport(payload).ok).toBe(true);
  });

  it('直接入力の参加者重複も拒否する', () => {
    // `seconds` は人数を含む（8.5.6）ので工数は変わらないが、重複候補の判定
    // （8.9.8）が参加者一覧の一致で行われる。
    expect(errorsOf((p) => {
      p.workRuns[0].tasks[0].directEntries.push({
        entryId: 'entry-dup',
        seconds: 600,
        participants: ['甲', '甲'],
        note: '重複',
        createdAt: '2026-08-01T10:00:00+09:00',
        updatedAt: '2026-08-01T10:00:00+09:00',
      });
    })).toContain('同じ参加者が重複している');
  });

  it('異なる参加者は通す', () => {
    const payload = validPayload();
    payload.workRuns[0].tasks[0].intervals[0].participants = ['甲', '乙', '丙'];

    expect(validateImport(payload).ok).toBe(true);
  });
});

describe('状態日時の前後関係（GAR-3）', () => {
  /** アーカイブ済みとして筋の通った実施回にする。 */
  function archived(payload, overrides = {}) {
    Object.assign(payload.workRuns[0], {
      status: 'archived',
      transferredAt: '2026-08-01T11:00:00+09:00',
      archivedAt: '2026-08-02T12:00:00+09:00',
      updatedAt: '2026-08-02T12:00:00+09:00',
      ...overrides,
    });
  }

  it('作成前にアーカイブされた実施回を拒否する', () => {
    // 保持期間は archivedAt を起算日とする（10.2）。過去日を入れると、
    // 保持期間内の記録が経過済みとして削除候補になる。
    expect(errorsOf((p) => archived(p, { archivedAt: '2020-01-01T00:00:00+09:00' }))).toContain(
      'アーカイブ日時が作成日時より前',
    );
  });

  it('アーカイブ後に転記された実施回を拒否する', () => {
    expect(errorsOf((p) => archived(p, { transferredAt: '2099-01-01T00:00:00+09:00' }))).toContain(
      'アーカイブ日時が転記完了日時より前',
    );
  });

  it('更新日時が作成日時より前の実施回を拒否する', () => {
    expect(errorsOf((p) => { p.workRuns[0].updatedAt = '2020-01-01T00:00:00+09:00'; })).toContain(
      '更新日時が作成日時より前',
    );
  });

  it('転記完了日時が作成日時より前の実施回を拒否する', () => {
    expect(errorsOf((p) => {
      p.workRuns[0].status = 'transferred';
      p.workRuns[0].transferredAt = '2020-01-01T00:00:00+09:00';
    })).toContain('転記完了日時が作成日時より前');
  });

  it('同秒は許す', () => {
    const payload = validPayload();
    const at = payload.workRuns[0].createdAt;
    archived(payload, { transferredAt: at, archivedAt: at, updatedAt: at });

    expect(validateImport(payload).ok).toBe(true);
  });

  it('筋の通った時系列は通す', () => {
    const payload = validPayload();
    archived(payload);

    expect(validateImport(payload).ok).toBe(true);
  });
});
