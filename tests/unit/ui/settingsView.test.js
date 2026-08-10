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
  // 排他区間の用意と、区間内で使うアクションを閉じ込めるのは `main.js` の役目で
  // ある（GAR-1、F12-18）。ここでは順序だけを持つ本体（`runDestructiveAction`）へ
  // 同じ形でモックを差し込む。
  const runDestructive = options.runDestructive ?? (({ backup, confirmedWithoutBackup, destructiveAction }) =>
    runDestructiveAction({
      backup,
      confirmedWithoutBackup,
      exportData: actions.exportData,
      destructiveAction: () => destructiveAction(actions),
    }));
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

  it('退避なしの全置換が失敗してもエラーを表示し再試行できる', async () => {
    const mounted = mount({
      runDestructive: vi.fn(async () => {
        throw new ValidationError(['取り込み: 保存に失敗しました']);
      }),
    });
    await mounted.view.selectFile({ name: 'backup.json' });
    mounted.query('import-without-backup').click();
    mounted.query('import-skip-accept').click();

    await vi.waitFor(() => expect(mounted.query('settings-errors')).not.toBeNull());
    expect(mounted.query('settings-errors').textContent).toContain('保存に失敗');
    expect(mounted.query('import-choice')).not.toBeNull();
    expect(mounted.query('import-with-backup').disabled).toBe(false);
    expect(mounted.query('import-file').disabled).toBe(false);
  });

  /**
   * 利用者の1回の操作意図に対して破壊的操作は1回だけ（レビュー指摘 F12-06）。
   *
   * 排他区間の途中で退避エクスポートが `store.setState` を呼び、その購読が画面を
   * 描き直す。busy を持たないとボタンが活性のまま戻り、区間が2つ直列に並んで
   * 全置換が2回走る。区間の隙間に入った保存は2回目の置換で消える。
   */
  describe('取り込みの二重実行を防ぐ（F12-06）', () => {
    /** 退避の完了を試験側から握る。区間の途中で再クリックできる状況を作る。 */
    function deferred() {
      let resolve;
      const promise = new Promise((settle) => { resolve = settle; });
      return { promise, resolve };
    }

    it('連打しても全置換は1回だけ走る', async () => {
      const mounted = mount();
      const backup = deferred();
      mounted.actions.exportData.mockImplementation(() => backup.promise);
      await mounted.view.selectFile({ name: 'backup.json' });

      mounted.query('import-with-backup').click();
      mounted.query('import-with-backup').click();
      mounted.query('import-with-backup').click();
      backup.resolve({ dataset: null });

      await vi.waitFor(() => expect(mounted.actions.importData).toHaveBeenCalledOnce());
      expect(mounted.actions.exportData).toHaveBeenCalledOnce();
    });

    it('実行中は取り込みボタンを押せない', async () => {
      const mounted = mount();
      const backup = deferred();
      mounted.actions.exportData.mockImplementation(() => backup.promise);
      await mounted.view.selectFile({ name: 'backup.json' });

      mounted.query('import-with-backup').click();

      await vi.waitFor(() => expect(mounted.query('import-with-backup').disabled).toBe(true));
      expect(mounted.query('import-without-backup').disabled).toBe(true);
      expect(mounted.query('import-cancel').disabled).toBe(true);
      expect(mounted.query('import-file').disabled).toBe(true);

      backup.resolve({ dataset: null });
      await vi.waitFor(() => expect(mounted.actions.importData).toHaveBeenCalledOnce());
    });

    it('退避せず進む経路でも二重実行しない', async () => {
      const mounted = mount();
      const replace = deferred();
      mounted.actions.importData.mockImplementation(() => replace.promise);
      await mounted.view.selectFile({ name: 'backup.json' });
      mounted.query('import-without-backup').click();

      mounted.query('import-skip-accept').click();
      await vi.waitFor(() => expect(mounted.query('import-skip-accept').disabled).toBe(true));
      mounted.query('import-skip-accept').click();
      replace.resolve({ dataset: null });

      await vi.waitFor(() =>
        expect(mounted.query('settings-message')?.textContent).toContain('置き換えました'),
      );
      expect(mounted.actions.importData).toHaveBeenCalledOnce();
    });
  });

  /**
   * ファイルを選び直したときは、最後の選択だけを採用する（レビュー指摘 F12-30）。
   *
   * 読込は非同期であり、完了の順序は選択の順序と一致しない。
   */
  describe('選び直したファイルの読込順が逆転しても最後の選択を採る（F12-30）', () => {
    /** ファイル名ごとに完了を握れる `readFile` を作る。 */
    function controlledReader() {
      const pending = new Map();
      const readFile = (file) =>
        new Promise((resolve, reject) => {
          pending.set(file.name, { resolve, reject });
        });
      return { readFile, settle: (name) => pending.get(name) };
    }

    it('先に選んだファイルが後から完了しても採用しない', async () => {
      const reader = controlledReader();
      const mounted = mount({ readFile: reader.readFile });

      const slow = mounted.view.selectFile({ name: 'old.json' });
      const fast = mounted.view.selectFile({ name: 'new.json' });
      reader.settle('new.json').resolve({ schemaVersion: 1, marker: 'new' });
      await fast;
      reader.settle('old.json').resolve({ schemaVersion: 1, marker: 'old' });
      await slow;

      expect(mounted.query('import-choice').textContent).toContain('new.json');
      expect(mounted.query('import-choice').textContent).not.toContain('old.json');
    });

    it('先に選んだファイルの失敗も、後の選択の表示を壊さない', async () => {
      const reader = controlledReader();
      const mounted = mount({ readFile: reader.readFile });

      const slow = mounted.view.selectFile({ name: 'broken.json' });
      const fast = mounted.view.selectFile({ name: 'good.json' });
      reader.settle('good.json').resolve({ schemaVersion: 1 });
      await fast;
      reader.settle('broken.json').reject(new ValidationError(['ファイル: 壊れています']));
      await slow;

      expect(mounted.query('settings-errors')).toBeNull();
      expect(mounted.query('import-choice').textContent).toContain('good.json');
    });
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
