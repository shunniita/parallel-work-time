// @vitest-environment happy-dom

/**
 * アーカイブ画面の単体テスト（仕様書10章）。
 *
 * 削除候補の表示、理由→退避の2段確認、案件削除の可否を固定する。判定そのものは
 * `retention.test.js` と `retentionActions.test.js` が持つ。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultSettings } from '../../../src/config.js';
import { summarizeArchive } from '../../../src/app/actions/retentionActions.js';
import { runDestructiveAction } from '../../../src/io/safetyExport.js';
import { RUN_STATUS } from '../../../src/domain/schema.js';
import { createArchiveView } from '../../../src/ui/views/archiveView.js';
import { projectGroup, resetIds, workRun } from '../../fixtures/builders.js';

const FIXED_NOW = new Date('2026-08-01T10:00:00+09:00');

beforeEach(resetIds);

/**
 * 画面を描いて操作の口を返す。
 *
 * @param {{runs?: object[], groups?: object[], retentionDays?: number,
 *          runDestructive?: Function}} [options]
 */
function mount(options = {}) {
  const group = options.group ?? projectGroup({ projectId: 'PJ-0001' });
  const groups = options.groups ?? [group];
  const runs = options.runs ?? [];
  const container = document.createElement('div');
  document.body.replaceChildren(container);

  const state = {
    dataset: {
      settings: { ...createDefaultSettings(), retentionDays: options.retentionDays ?? 30 },
      taskTemplates: [],
      projectGroups: groups,
      workRuns: runs,
      changeHistory: [],
    },
  };
  const actions = {
    summarizeArchive,
    deleteRun: vi.fn(async () => ({ dataset: null })),
    deleteProjectGroup: vi.fn(async () => ({ dataset: null })),
    exportData: vi.fn(async () => ({ dataset: null })),
  };
  // 排他区間の用意と、区間内で使うアクションを閉じ込めるのは `main.js` の役目で
  // ある（過去のレビュー指摘）。ここでは順序だけを持つ本体（`runDestructiveAction`）へ
  // 同じ形でモックを差し込む。
  const runDestructive =
    options.runDestructive ??
    (({ backup, confirmedWithoutBackup, destructiveAction }) =>
      runDestructiveAction({
        backup,
        confirmedWithoutBackup,
        exportData: actions.exportData,
        destructiveAction: () => destructiveAction(actions),
      }));
  const view = createArchiveView({
    container,
    store: { getState: () => state },
    actions,
    now: () => FIXED_NOW,
    runDestructive,
  });
  view.render();

  return {
    view,
    group,
    actions,
    container,
    query: (testid) => container.querySelector(`[data-testid="${testid}"]`),
    all: (testid) => [...container.querySelectorAll(`[data-testid="${testid}"]`)],
  };
}

/** アーカイブ済みの実施回。 */
function archived(archivedAt, overrides = {}) {
  return workRun({
    status: RUN_STATUS.ARCHIVED,
    transferredAt: '2026-07-01T10:00:00+09:00',
    archivedAt,
    ...overrides,
  });
}

describe('createArchiveView', () => {
  it('案件が1つも無ければ案内を出す', () => {
    const view = mount({ groups: [] });

    expect(view.query('archive-empty')).not.toBeNull();
    expect(view.query('archive-list')).toBeNull();
  });

  it('通常の実施回だけを持つ案件は出さない', () => {
    const group = projectGroup({ projectId: 'PJ-0001' });
    const view = mount({
      group,
      runs: [workRun({ status: RUN_STATUS.TRANSFERRED, projectGroupId: group.projectGroupId })],
    });

    expect(view.query('archive-empty')).not.toBeNull();
  });

  describe('削除候補の表示（仕様書10.3）', () => {
    it('保持期間内は残り日数を出す', () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-07-22T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      // 7/22 の30日後は 8/21。8/1 時点で残り20日。
      expect(view.query('archive-remaining').textContent).toBe('あと20日');
    });

    it('保持期間を過ぎたら削除候補と出す', () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-06-01T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      expect(view.query('archive-remaining').textContent).toBe('削除候補');
    });

    it('件数と保持期間を見出しへ出す', () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-06-01T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
          archived('2026-07-22T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      const summary = view.query('archive-summary').textContent;
      expect(summary).toContain('アーカイブ済み 2件');
      expect(summary).toContain('削除候補 1件');
      expect(summary).toContain('保持期間 30日');
    });

    it('自動削除しない旨を明記する（仕様書10.6）', () => {
      const view = mount();

      expect(view.container.textContent).toContain('自動では削除しません');
    });
  });

  describe('実施回の削除（仕様書10.4、10.5、11章）', () => {
    /** 削除候補を1件持つ画面。 */
    function mountWithDeletable(extra = {}) {
      const group = projectGroup({ projectId: 'PJ-0001' });
      return mount({
        group,
        runs: [
          archived('2026-06-01T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
        ...extra,
      });
    }

    it('理由を入力するまで退避の確認へ進まない', () => {
      const view = mountWithDeletable();

      view.query('delete-run').click();

      expect(view.query('archive-delete-confirm-panel')).not.toBeNull();
      expect(view.query('backup-choice')).toBeNull();
    });

    it('理由が空なら進めない（仕様書11章）', () => {
      const view = mountWithDeletable();
      view.query('delete-run').click();

      view.query('archive-delete-confirm').click();

      expect(view.query('backup-choice')).toBeNull();
      expect(view.actions.deleteRun).not.toHaveBeenCalled();
    });

    it('理由を入れると退避の確認へ進む（仕様書10.5）', async () => {
      const view = mountWithDeletable();
      view.query('delete-run').click();
      view.query('archive-delete-reason').value = '保持期間を過ぎたため';

      view.query('archive-delete-confirm').click();
      await vi.waitFor(() => expect(view.query('backup-choice')).not.toBeNull());

      // まだ削除していない。
      expect(view.actions.deleteRun).not.toHaveBeenCalled();
    });

    it('退避してから削除すると、退避が先に走る', async () => {
      const view = mountWithDeletable();
      view.query('delete-run').click();
      view.query('archive-delete-reason').value = '保持期間を過ぎたため';
      view.query('archive-delete-confirm').click();
      await vi.waitFor(() => expect(view.query('backup-choice')).not.toBeNull());

      view.query('delete-with-backup').click();
      await vi.waitFor(() => expect(view.actions.deleteRun).toHaveBeenCalled());

      // 退避が先。順序は `runDestructiveAction` が持つので、偽物で組み直さず
      // 実物の呼び出し順を見る。
      expect(view.actions.exportData.mock.invocationCallOrder[0]).toBeLessThan(
        view.actions.deleteRun.mock.invocationCallOrder[0],
      );
    });

    it('退避せずに削除すると退避を呼ばない', async () => {
      const view = mountWithDeletable();
      view.query('delete-run').click();
      view.query('archive-delete-reason').value = '保持期間を過ぎたため';
      view.query('archive-delete-confirm').click();
      await vi.waitFor(() => expect(view.query('backup-choice')).not.toBeNull());

      view.query('delete-without-backup').click();
      await vi.waitFor(() => expect(view.actions.deleteRun).toHaveBeenCalled());

      expect(view.actions.exportData).not.toHaveBeenCalled();
    });

    it('削除では理由を添えて呼ぶ', async () => {
      const view = mountWithDeletable();
      const runId = view.container
        .querySelector('[data-testid="archive-row"]')
        .getAttribute('data-run-id');
      view.query('delete-run').click();
      view.query('archive-delete-reason').value = '保持期間を過ぎたため';
      view.query('archive-delete-confirm').click();
      await vi.waitFor(() => expect(view.query('backup-choice')).not.toBeNull());

      view.query('delete-without-backup').click();
      await vi.waitFor(() => expect(view.actions.deleteRun).toHaveBeenCalled());

      expect(view.actions.deleteRun).toHaveBeenCalledWith(runId, {
        reason: '保持期間を過ぎたため',
      });
    });

    it('やめると何も呼ばずに閉じる', async () => {
      const view = mountWithDeletable();
      view.query('delete-run').click();
      view.query('archive-delete-reason').value = '誤り';
      view.query('archive-delete-confirm').click();
      await vi.waitFor(() => expect(view.query('backup-choice')).not.toBeNull());

      view.query('delete-cancel-all').click();

      expect(view.query('backup-choice')).toBeNull();
      expect(view.actions.deleteRun).not.toHaveBeenCalled();
    });

    it('保持期間内は押せず、理由を添える（過去のレビュー指摘）', () => {
      // 仕様書7.1 の遷移表は アーカイブ → 削除候補 → 完全削除 である。
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-07-22T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      const button = view.query('delete-run');
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('あと20日');
    });

    it('保持期限ちょうどは押せて、削除候補と出る（過去のレビュー指摘）', () => {
      // 表示と可否を別の述語から導くと、この1点だけ食い違う。
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        // 30日前ちょうど。FIXED_NOW は 2026-08-01T10:00:00+09:00。
        runs: [
          archived('2026-07-02T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      expect(view.query('archive-remaining').textContent).toBe('削除候補');
      expect(view.query('delete-run').disabled).toBe(false);
    });
  });

  describe('案件の削除（仕様書10.4）', () => {
    it('すべてアーカイブ済みなら押せる', () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-06-01T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      expect(view.query('delete-group').disabled).toBe(false);
    });

    it('運用中の実施回が残っていれば押せず、理由を添える', () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-06-01T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
          workRun({
            status: RUN_STATUS.TRANSFERRED,
            projectGroupId: group.projectGroupId,
          }),
        ],
      });

      const button = view.query('delete-group');
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('1 件');
    });

    it('保持期間内の実施回が残っていれば押せない（過去のレビュー指摘）', () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-07-22T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      const button = view.query('delete-group');
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('保持期間が残っている実施回が 1 件');
    });

    describe('実施回が0件の案件（過去のレビュー指摘）', () => {
      it('一覧へ出て削除できる', () => {
        // ここが案件削除を呼べる唯一の画面なので、出さないと通常操作では
        // 二度と消せなくなる。
        const view = mount({ group: projectGroup({ projectId: 'PJ-EMPTY' }) });

        expect(view.query('archive-empty')).toBeNull();
        expect(view.query('archive-group-title').textContent).toBe('PJ-EMPTY');
        expect(view.query('delete-group').disabled).toBe(false);
      });

      it('表がわりに案内を出す', () => {
        const view = mount();

        expect(view.query('archive-list')).toBeNull();
        expect(view.query('archive-group-empty').textContent).toContain('実施回がありません');
      });

      it('確認の文面に実施回の件数を書かない', async () => {
        const view = mount({ group: projectGroup({ projectId: 'PJ-EMPTY' }) });

        view.query('delete-group').click();

        expect(view.query('archive-delete-confirm-panel').textContent).toContain(
          '案件 PJ-EMPTY を完全に削除します',
        );
      });
    });

    it('案件削除も理由と退避の2段を通る', async () => {
      const group = projectGroup({ projectId: 'PJ-0001' });
      const view = mount({
        group,
        runs: [
          archived('2026-06-01T10:00:00+09:00', { projectGroupId: group.projectGroupId }),
        ],
      });

      view.query('delete-group').click();
      view.query('archive-delete-reason').value = '案件が中止になったため';
      view.query('archive-delete-confirm').click();
      await vi.waitFor(() => expect(view.query('backup-choice')).not.toBeNull());
      view.query('delete-without-backup').click();
      await vi.waitFor(() => expect(view.actions.deleteProjectGroup).toHaveBeenCalled());

      expect(view.actions.deleteProjectGroup).toHaveBeenCalledWith(group.projectGroupId, {
        reason: '案件が中止になったため',
      });
    });
  });

  it('削除に失敗したら理由を画面へ出す', async () => {
    const group = projectGroup({ projectId: 'PJ-0001' });
    const view = mount({
      group,
      runs: [archived('2026-06-01T10:00:00+09:00', { projectGroupId: group.projectGroupId })],
    });
    view.actions.deleteRun.mockRejectedValue(new Error('保存できない'));
    view.query('delete-run').click();
    view.query('archive-delete-reason').value = '誤り';
    view.query('archive-delete-confirm').click();
    await vi.waitFor(() => expect(view.query('backup-choice')).not.toBeNull());

    view.query('delete-without-backup').click();
    await vi.waitFor(() => expect(view.query('archive-errors')).not.toBeNull());

    expect(view.query('archive-errors').textContent).toContain('保存できない');
  });
});
