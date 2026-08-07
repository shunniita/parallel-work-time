/** 設定・バックアップ画面（仕様書9.2〜9.5、12.2）。 */

import { toErrorMessages } from '../../app/errors.js';
import {
  MAX_LONG_RUNNING_THRESHOLD_HOURS,
  MAX_RETENTION_DAYS,
  createDefaultSettings,
} from '../../config.js';
import { readImportFile } from '../../io/importJson.js';
import { runDestructiveAction } from '../../io/safetyExport.js';
import { el, field, replaceChildren } from '../dom.js';
import { toIntegerInput } from '../numeric.js';
import { createConfirmPanel } from '../components/confirmPanel.js';

/**
 * @param {{container: HTMLElement, store: object,
 *          actions: {updateSettings: Function, exportData: Function, importData: Function},
 *          readFile?: Function, runDestructive?: Function}} options
 */
export function createSettingsView({
  container,
  store,
  actions,
  readFile = readImportFile,
  runDestructive = runDestructiveAction,
}) {
  const local = {
    importPayload: null,
    importFileName: '',
    phase: 'idle',
    errors: [],
    message: '',
  };

  function resetImport() {
    local.importPayload = null;
    local.importFileName = '';
    local.phase = 'idle';
    local.errors = [];
    local.message = '';
  }

  function errorBox() {
    if (local.errors.length === 0) {
      return null;
    }
    return el('div', { class: 'errors', role: 'alert', dataset: { testid: 'settings-errors' } }, [
      el('p', { class: 'errors__title', text: '処理できません' }),
      el('ul', {}, local.errors.map((message) => el('li', { text: message }))),
    ]);
  }

  async function saveSettings(retentionInput, thresholdInput) {
    local.errors = [];
    local.message = '';
    try {
      await actions.updateSettings({
        retentionDays: toIntegerInput(retentionInput.value),
        longRunningThresholdHours: toIntegerInput(thresholdInput.value),
      });
      local.message = '設定を保存しました。';
      render();
    } catch (error) {
      local.errors = toErrorMessages(error);
      render();
    }
  }

  async function exportNow() {
    local.errors = [];
    local.message = '';
    try {
      await actions.exportData();
      local.message = 'JSONをダウンロードしました。';
      render();
    } catch (error) {
      local.errors = toErrorMessages(error);
      render();
    }
  }

  async function selectFile(file) {
    resetImport();
    local.phase = 'reading';
    render();
    try {
      local.importPayload = await readFile(file);
      local.importFileName = file?.name ?? '選択したファイル';
      local.phase = 'ready';
    } catch (error) {
      local.errors = toErrorMessages(error);
      local.phase = 'idle';
    }
    render();
  }

  async function executeImport(backup) {
    const payload = local.importPayload;
    const result = await runDestructive({
      backup,
      confirmedWithoutBackup: !backup,
      exportData: () => actions.exportData(),
      destructiveAction: () => actions.importData(payload),
    });
    if (result.executed) {
      resetImport();
      local.message = 'JSONを取り込み、全データを置き換えました。';
      render();
    }
  }

  function importChoice() {
    if (local.phase !== 'ready') {
      return null;
    }
    return el(
      'section',
      {
        class: 'card card--warn',
        role: 'alertdialog',
        'aria-label': '全データの置換確認',
        dataset: { testid: 'import-choice' },
      },
      [
        el('h3', { class: 'card__title', text: '全データを置き換えます' }),
        el('p', {
          text: `${local.importFileName} を取り込むと、現在のデータはすべて置き換わります。`,
        }),
        el('div', { class: 'actions' }, [
          el('button', {
            type: 'button',
            class: 'button button--primary',
            text: '現在のデータを退避して取り込む',
            dataset: { testid: 'import-with-backup' },
            on: { click: () => executeImport(true).catch(showImportError) },
          }),
          el('button', {
            type: 'button',
            class: 'button button--danger',
            text: '退避せずに進む',
            dataset: { testid: 'import-without-backup' },
            on: {
              click: () => {
                local.phase = 'skip-confirm';
                render();
              },
            },
          }),
          el('button', {
            type: 'button',
            class: 'button',
            text: 'やめる',
            dataset: { testid: 'import-cancel' },
            on: { click: () => { resetImport(); render(); } },
          }),
        ]),
      ],
    );
  }

  function showImportError(error) {
    local.errors = toErrorMessages(error);
    render();
  }

  function skipConfirmation() {
    if (local.phase !== 'skip-confirm') {
      return null;
    }
    return createConfirmPanel({
      title: '退避せずに全置換しますか',
      description: '現在のデータは失われ、この操作は取り消せません。',
      note: '必要なら「やめる」で戻り、退避してから取り込んでください。',
      confirmLabel: '退避せず全置換する',
      testidPrefix: 'import-skip',
      onConfirm: () => executeImport(false),
      onCancel: () => {
        local.phase = 'ready';
        render();
      },
    }).element;
  }

  function render() {
    // loadAll() は設定欠落時に null を返す契約である。通常は initialize() が既定値を
    // 保存するが、欠落した保存領域やMemoryAdapterの呼び出しでも画面を落とさない。
    const settings = store.getState().dataset.settings ?? createDefaultSettings();
    const retentionInput = el('input', {
      class: 'input input--num',
      type: 'number',
      min: 1,
      max: MAX_RETENTION_DAYS,
      step: 1,
      value: settings.retentionDays,
      dataset: { testid: 'retention-days' },
    });
    const thresholdInput = el('input', {
      class: 'input input--num',
      type: 'number',
      min: 1,
      max: MAX_LONG_RUNNING_THRESHOLD_HOURS,
      step: 1,
      value: settings.longRunningThresholdHours,
      dataset: { testid: 'long-running-threshold' },
    });
    const fileInput = el('input', {
      class: 'input',
      type: 'file',
      accept: '.json,application/json',
      dataset: { testid: 'import-file' },
      on: { change: (event) => selectFile(event.target.files?.[0]) },
    });

    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('h2', { class: 'view__title', text: '設定・バックアップ' }),
      ]),
      errorBox(),
      local.message !== '' && el('p', {
        class: 'card card--info',
        role: 'status',
        dataset: { testid: 'settings-message' },
        text: local.message,
      }),
      el('section', { class: 'card', dataset: { testid: 'settings-form' } }, [
        el('h3', { class: 'card__title', text: '設定' }),
        el('div', { class: 'field-row' }, [
          field({ id: 'retention-days', label: '保持期間（日）', input: retentionInput }),
          field({
            id: 'long-running-threshold',
            label: '未終了しきい値（時間）',
            input: thresholdInput,
          }),
        ]),
        el('div', { class: 'actions' }, [
          el('button', {
            type: 'button',
            class: 'button button--primary',
            text: '設定を保存',
            dataset: { testid: 'save-settings' },
            on: { click: () => saveSettings(retentionInput, thresholdInput) },
          }),
        ]),
      ]),
      el('section', { class: 'card', dataset: { testid: 'export-card' } }, [
        el('h3', { class: 'card__title', text: 'JSONエクスポート' }),
        el('p', { text: '設定・テンプレート・案件・実施回・変更履歴を1ファイルへ保存します。' }),
        el('p', {
          class: 'note',
          dataset: { testid: 'last-exported-at' },
          text: settings.lastExportedAt === null
            ? 'まだエクスポートしていません。'
            : `最終エクスポート: ${settings.lastExportedAt}`,
        }),
        el('div', { class: 'actions' }, [
          el('button', {
            type: 'button',
            class: 'button button--primary',
            text: 'JSONをエクスポート',
            dataset: { testid: 'export-json' },
            on: { click: exportNow },
          }),
        ]),
      ]),
      el('section', { class: 'card', dataset: { testid: 'import-card' } }, [
        el('h3', { class: 'card__title', text: 'JSONインポート（全置換）' }),
        el('p', { text: '差分マージは行いません。ファイルを検証してから置換確認を表示します。' }),
        field({ id: 'import-file', label: '取り込むJSONファイル', input: fileInput }),
        local.phase === 'reading' && el('p', { class: 'note', text: 'ファイルを検証中…' }),
        importChoice(),
        skipConfirmation(),
      ]),
      el('section', { class: 'card card--info' }, [
        el('h3', { class: 'card__title', text: '定期的な退避をおすすめします' }),
        el('p', {
          text: 'ブラウザデータを削除すると記録も失われます。必要な頻度でJSONを保管してください。',
        }),
      ]),
    ]);
  }

  return { render, reset: resetImport, selectFile };
}
