// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/app/errors.js';
import { createDefaultSettings } from '../../../src/config.js';
import { createSettingsView } from '../../../src/ui/views/settingsView.js';
import { runDestructiveAction } from '../../../src/io/safetyExport.js';

function mount(options = {}) {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const state = {
    dataset: {
      settings: Object.hasOwn(options, 'settings') ? options.settings : createDefaultSettings(),
      taskTemplates: [],
      projectGroups: [],
      workRuns: [],
      changeHistory: [],
    },
  };
  const actions = {
    updateSettings: vi.fn(async () => ({ dataset: state.dataset })),
    exportData: vi.fn(async () => ({ dataset: state.dataset })),
    importData: vi.fn(async () => ({ dataset: state.dataset })),
  };
  const payload = { schemaVersion: 1 };
  const readFile = options.readFile ?? vi.fn(async () => payload);
  // 排他区間の用意は `main.js` の役目なので、ここでは順序だけを持つ本体
  // （`runDestructiveAction`）へモックを差し込む（GAR-1）。
  const runDestructive = (input) =>
    runDestructiveAction({ ...input, exportData: actions.exportData, scoped: actions });
  const view = createSettingsView({
    container,
    store: { getState: () => state },
    actions,
    readFile,
    runDestructive,
    isActive: options.isActive,
  });
  view.render();
  return {
    container,
    actions,
    readFile,
    payload,
    view,
    query: (testid) => container.querySelector(`[data-testid="${testid}"]`),
  };
}

describe('createSettingsView', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('保存済み設定とJSON入出力を表示する', () => {
    const mounted = mount({
      settings: {
        ...createDefaultSettings(),
        retentionDays: 45,
        longRunningThresholdHours: 8,
      },
    });

    expect(mounted.query('retention-days').value).toBe('45');
    expect(mounted.query('long-running-threshold').value).toBe('8');
    expect(mounted.query('export-json')).not.toBeNull();
    expect(mounted.query('import-file')).not.toBeNull();
  });

  it('設定が無い場合は既定値で表示する（loadAll契約）', () => {
    const mounted = mount({ settings: null });
    const defaults = createDefaultSettings();

    expect(mounted.query('retention-days').value).toBe(String(defaults.retentionDays));
    expect(mounted.query('long-running-threshold').value).toBe(
      String(defaults.longRunningThresholdHours),
    );
    expect(mounted.query('last-exported-at').textContent).toContain('まだエクスポートしていません');
  });

  it('設定を整数として保存する', async () => {
    const mounted = mount();
    mounted.query('retention-days').value = '60';
    mounted.query('long-running-threshold').value = '6';

    mounted.query('save-settings').click();

    await vi.waitFor(() => expect(mounted.actions.updateSettings).toHaveBeenCalledWith({
      retentionDays: 60,
      longRunningThresholdHours: 6,
    }));
  });

  it('エクスポート操作を呼ぶ', async () => {
    const mounted = mount();

    mounted.query('export-json').click();

    await vi.waitFor(() => expect(mounted.actions.exportData).toHaveBeenCalledOnce());
    expect(mounted.query('settings-message').textContent).toContain('ダウンロード');
  });

  it('ファイル検証後に全置換の選択肢を出す', async () => {
    const mounted = mount();

    await mounted.view.selectFile({ name: 'backup.json', text: async () => '{}' });

    expect(mounted.query('import-choice').textContent).toContain('backup.json');
  });

  it('退避して取り込むとエクスポートの後にインポートする', async () => {
    const mounted = mount();
    const order = [];
    mounted.actions.exportData.mockImplementation(async () => { order.push('backup'); });
    mounted.actions.importData.mockImplementation(async () => { order.push('import'); });
    await mounted.view.selectFile({ name: 'backup.json' });

    mounted.query('import-with-backup').click();

    await vi.waitFor(() => expect(mounted.actions.importData).toHaveBeenCalledWith(mounted.payload));
    expect(order).toEqual(['backup', 'import']);
    expect(mounted.query('settings-message').textContent).toContain('置き換えました');
  });

  it('退避なしは取り消せない旨を再確認してから取り込む', async () => {
    const mounted = mount();
    await mounted.view.selectFile({ name: 'backup.json' });

    mounted.query('import-without-backup').click();
    expect(mounted.query('import-skip-panel').textContent).toContain('取り消せません');
    expect(mounted.actions.importData).not.toHaveBeenCalled();

    mounted.query('import-skip-accept').click();
    await vi.waitFor(() => expect(mounted.actions.importData).toHaveBeenCalledWith(mounted.payload));
    expect(mounted.actions.exportData).not.toHaveBeenCalled();
  });

  it('壊れたファイルは置換確認を出さずエラーを表示する', async () => {
    const mounted = mount({
      readFile: vi.fn(async () => { throw new ValidationError(['ファイル: 壊れています']); }),
    });

    await mounted.view.selectFile({ name: 'broken.json' });

    expect(mounted.query('import-choice')).toBeNull();
    expect(mounted.query('settings-errors').textContent).toContain('壊れています');
    expect(mounted.actions.importData).not.toHaveBeenCalled();
  });

  it('新しいファイル検証を始めると以前の成功通知を消す', async () => {
    const mounted = mount({
      readFile: vi.fn(async () => { throw new ValidationError(['ファイル: 壊れています']); }),
    });
    mounted.query('export-json').click();
    await vi.waitFor(() => expect(mounted.query('settings-message')).not.toBeNull());

    await mounted.view.selectFile({ name: 'broken.json' });

    expect(mounted.query('settings-message')).toBeNull();
    expect(mounted.query('settings-errors').textContent).toContain('壊れています');
  });

  it('画面を離れると成功通知を消す', async () => {
    const mounted = mount();
    mounted.query('export-json').click();
    await vi.waitFor(() => expect(mounted.query('settings-message')).not.toBeNull());

    mounted.view.reset();
    mounted.view.render();

    expect(mounted.query('settings-message')).toBeNull();
  });

  describe('別画面へ移った後は詳細ペインを奪い返さない（GAR-4）', () => {
    it('非アクティブになったビューは描かない', async () => {
      // すべてのビューが詳細ペインを共有する。非同期保存の完了後に自分の
      // render() を呼ぶため、その間に画面が変わっていると表示が食い違う。
      let active = true;
      const mounted = mount({ isActive: () => active });
      expect(mounted.query('settings-form')).not.toBeNull();

      // 保存を保留したまま別画面へ移った状況を作る。
      active = false;
      mounted.container.replaceChildren();

      await mounted.view.render();

      expect(mounted.container.children).toHaveLength(0);
    });

    it('アクティブなら従来どおり描く', () => {
      const mounted = mount({ isActive: () => true });
      mounted.container.replaceChildren();

      mounted.view.render();

      expect(mounted.query('settings-form')).not.toBeNull();
    });
  });
});
