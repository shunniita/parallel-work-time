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
