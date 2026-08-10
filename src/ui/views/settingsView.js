/** 設定・バックアップ画面（仕様書9.2〜9.5、12.2）。 */

import { toErrorMessages } from '../../app/errors.js';
import {
  MAX_LONG_RUNNING_THRESHOLD_HOURS,
  MAX_RETENTION_DAYS,
  createDefaultSettings,
} from '../../config.js';
import { readImportFile } from '../../io/importJson.js';
import { el, field, replaceChildren } from '../dom.js';
import { toIntegerInput } from '../numeric.js';
import { createConfirmPanel } from '../components/confirmPanel.js';

/**
 * `runDestructive` は必須である。退避と全置換を1つの排他区間へ入れるのは呼び出し元
 * （`main.js`）の役目であり（GAR-1）、既定値を置くと注入を忘れた画面が排他区間の
 * 外で全置換を走らせる。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {updateSettings: Function, exportData: Function},
 *          runDestructive: Function, readFile?: Function,
 *          isActive?: () => boolean}} options
 */
export function createSettingsView({
  container,
  store,
  actions,
  runDestructive,
  readFile = readImportFile,
  isActive = () => true,
}) {
  const local = {
    importPayload: null,
    importFileName: '',
    phase: 'idle',
    errors: [],
    message: '',
    /**
     * 排他区間の実行中か（レビュー指摘 F12-06）。
     *
     * 区間の途中で退避エクスポートが `store.setState` を呼び、その購読が画面を
     * 描き直す。busy を持たないと取り込みボタンが活性のまま再構築され、ダブル
     * クリックや退避ダウンロード後の再クリックで排他区間が2つ直列に並ぶ。
     * 区間の隙間に入った保存は2回目の置換で消える（GAR-1 と同種の喪失）。
     */
    busy: false,
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

  /**
   * ファイルを選び直したときに、古い読込の結果を捨てるための通し番号。
   *
   * 読込は非同期であり、完了の順序は選択の順序と一致しない。大きいファイルを
   * 選んだ直後に小さいファイルを選ぶと、先に選んだ方が後から完了して、確認画面の
   * 内容とファイル名を上書きする。利用者の最新の操作と食い違う（F12-30）。
   */
  let selectionToken = 0;

  async function selectFile(file) {
    resetImport();
    selectionToken += 1;
    const token = selectionToken;
    local.phase = 'reading';
    render();

    try {
      const payload = await readFile(file);
      if (token !== selectionToken) {
        return;
      }
      local.importPayload = payload;
      local.importFileName = file?.name ?? '選択したファイル';
      local.phase = 'ready';
    } catch (error) {
      // 待っている間に選び直されていれば、この失敗も採用しない。
      if (token !== selectionToken) {
        return;
      }
      local.errors = toErrorMessages(error);
      local.phase = 'idle';
    }
    render();
  }

  async function executeImport(backup) {
    // 利用者の1回の操作意図に対して、破壊的操作は1回だけ走らせる。
    if (local.busy) {
      return;
    }
    const payload = local.importPayload;
    local.busy = true;
    local.errors = [];
    render();
    try {
      const result = await runDestructive({
        backup,
        confirmedWithoutBackup: !backup,
        // 退避と全置換は1つの排他区間で行う。別々に積むと、退避JSONを取った後・
        // 全置換の前に別の保存が割り込み、その内容が退避にも置換後にも残らない
        // （敵対的レビュー GAR-1）。
        destructiveAction: (scoped) => scoped.importData(payload),
      });
      if (result.executed) {
        resetImport();
        local.message = 'JSONを取り込み、全データを置き換えました。';
      }
    } catch (error) {
      local.errors = toErrorMessages(error);
      // 確認パネルは再描画で外れるため、選択肢へ戻して再試行可能にする。
      local.phase = payload === null ? 'idle' : 'ready';
    } finally {
      local.busy = false;
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
            disabled: local.busy,
            on: { click: () => executeImport(true) },
          }),
          el('button', {
            type: 'button',
            class: 'button button--danger',
            text: '退避せずに進む',
            dataset: { testid: 'import-without-backup' },
            disabled: local.busy,
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
            disabled: local.busy,
            on: { click: () => { resetImport(); render(); } },
          }),
        ]),
      ],
    );
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
      busy: local.busy,
      onConfirm: () => executeImport(false),
      onCancel: () => {
        local.phase = 'ready';
        render();
      },
    }).element;
  }

  function render() {
    // 非同期処理の完了後に呼ばれることがある。その間に利用者が別画面へ移って
    // いれば、共有している詳細ペインを奪い返してはいけない（GAR-4）。
    if (!isActive()) {
      return;
    }
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
      disabled: local.busy,
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
