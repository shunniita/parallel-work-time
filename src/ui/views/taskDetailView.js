/**
 * 作業項目詳細（仕様書12.2、12.3、12.4、8.4、11章）。
 *
 * 一つの作業項目について、区間履歴・直接入力・工数内訳を出し、状態に応じた操作を
 * 置く。実施回詳細の作業項目行からも一部の操作ができるが（`runView.js`）、
 * こちらは記録した区間と直接入力を1件ずつ確かめ、追加・編集・削除できる点が違う。
 *
 * 仕様書12.4 の操作はすべて結線済みである（開始・休憩・再開・終了・参加者変更・
 * 直接入力・区間追加・履歴編集）。
 *
 * ## 画面内で開くフォームは1つ
 *
 * `local.activeForm` が、上部の操作ボタンから開くフォーム（開始・休憩・…・
 * 直接入力・区間追加）と、区間履歴・直接入力一覧の行から開く編集フォームを
 * 1つのスロットで持つ。別の操作を開くと前のフォームは自動的に閉じる。同時に
 * 複数の入力が開いたままだと、確定したときにどれを保存したのか分かりにくく
 * なるためである。削除確認（`local.deleteTarget`）も同様に単一である。
 *
 * `deleteTarget` は種別つき（`{kind, id}`）である。区間と直接入力で同じIDが
 * 出ることはないが、種別を持たないと「どちらの一覧の行を開いているか」を
 * 描画側が判断できない。
 *
 * ## 保存中は外側の操作を止める
 *
 * フォーム自身は送信中に自分の確定・取消を無効にするが、それだけでは足りない。
 * 保存を待つ間に上部のボタンや別の行から次のフォームを開けてしまうと、先の
 * 保存の完了処理が `activeForm` を畳み、開いたばかりの入力を消す
 * （過去のレビュー指摘）。`local.busy` の間は外側のボタンをすべて無効にし、
 * 開いているフォームが常に1つだけという前提を保存中も崩さない。
 *
 * 無効化は `render()` ではなく {@link applyBusy} で行う。保存中に描き直すと、
 * まさに送信中のフォームが作り直され、入力内容と「保存中」の表示が失われる。
 *
 * 経過時間の1分ごとの再評価（仕様書8.8）は警告領域（`src/ui/warningBar.js`）が
 * 持つ。ここでは未終了区間であることを表示するにとどめる（過去の設計メモ）。
 */

import { compareIso, formatIsoForHuman } from '../../domain/datetime.js';
import {
  INTERVAL_TYPE,
  INTERVAL_TYPE_LABEL,
  intervalEffortSeconds,
  isOpenInterval,
  summarizeTask,
} from '../../domain/effort.js';
import { formatSeconds } from '../../domain/directEntryOps.js';
import { collectParticipants } from '../../domain/participants.js';
import { RUN_STATUS_LABEL, describeNotEditable, isRunEditable } from '../../domain/runStatus.js';
import {
  TASK_OPERATION,
  TASK_OPERATION_LABEL,
  TASK_STATE_LABEL,
  availableOperations,
  taskState,
} from '../../domain/taskState.js';
import { ResumeConfirmationRequiredError } from '../../app/errors.js';
import { createConfirmPanel } from '../components/confirmPanel.js';
import { createReasonConfirm } from '../components/reasonConfirm.js';
import { createDirectEntryForm } from '../components/directEntryForm.js';
import { createIntervalEntryForm } from '../components/intervalEntryForm.js';
import { createIntervalOperationForm } from '../components/intervalOperationForm.js';
import { el, replaceChildren } from '../dom.js';
import { toMinutesLabel } from '../labels.js';
import { VIEW } from '../shell.js';

/** 区間履歴の表の列数。編集モード中は「操作」列が1つ増える。 */
const BASE_COLUMN_COUNT = 5;

/** 直接入力一覧の表の列数。編集モード中は「操作」列が1つ増える。 */
const DIRECT_COLUMN_COUNT = 3;

/**
 * 作業項目詳細を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {recordStart: Function, recordBreak: Function,
 *                    recordResume: Function, recordFinish: Function,
 *                    recordParticipantChange: Function,
 *                    addIntervalManually: Function, updateInterval: Function,
 *                    deleteInterval: Function, previewIntervalDeletion: Function,
 *                    createDirectEntry: Function, updateDirectEntry: Function,
 *                    deleteDirectEntry: Function,
 *                    previewDirectEntryDeletion: Function},
 *          handlers: {onBackToRun: Function},
 *          now?: () => Date}} options
 * @returns {{render: () => void, reset: () => void}}
 */
export function createTaskDetailView({
  container,
  store,
  actions,
  handlers,
  now,
  isActive = () => true,
}) {
  /**
   * ビュー内部の状態（`src/app/store.js` の規約2）。
   *
   * - `activeForm`: 開いているフォーム。`{kind:'operation', operation}` /
   *   `{kind:'addInterval'}` / `{kind:'editInterval', intervalId}` /
   *   `{kind:'directEntry'}` / `{kind:'editDirectEntry', entryId}` / `null`。
   * - `historyEditMode`: 区間履歴と直接入力の行に編集・削除ボタンを出すかどうか
   *   （「履歴編集」の押下で切り替える）。
   * - `deleteTarget`: 削除確認を開いている対象。`{kind:'interval'|'directEntry',
   *   id}` または `null`。
   * - `resumeConfirm`: 集計済みからの作業再開の確認（仕様書7.1）。`{retry}` または
   *   `null`。承諾されたら同じ入力で呼び直す。
   * - `warnings`: 直前の保存で出た警告（区間の重複は仕様書8.9.5、直接入力の
   *   重複候補は8.9.8）。
   * - `busy`: 保存中かどうか。外側のボタンを止める（過去のレビュー指摘）。
   *
   * 保存を拒否したエラーは各フォーム自身が出す。
   */
  const local = {
    activeForm: null,
    historyEditMode: false,
    deleteTarget: null,
    resumeConfirm: null,
    warnings: [],
    busy: false,
  };

  function reset() {
    local.activeForm = null;
    local.historyEditMode = false;
    local.deleteTarget = null;
    local.resumeConfirm = null;
    local.warnings = [];
    local.busy = false;
  }

  /**
   * 保存中に押せてはいけない外側のボタン。描き直すたびに作り直す。
   *
   * `baseDisabled` は保存とは無関係な無効化（状態が許さない操作、未実装の操作）
   * である。保存が終わったときにこの値へ戻す。
   *
   * @type {{button: HTMLButtonElement, baseDisabled: boolean}[]}
   */
  let outerControls = [];

  /**
   * 外側のボタンを保存中の無効化の対象に加える。
   *
   * @param {HTMLButtonElement} button
   * @param {boolean} baseDisabled
   * @returns {HTMLButtonElement}
   */
  function trackOuter(button, baseDisabled) {
    outerControls.push({ button, baseDisabled });
    return button;
  }

  /** 保存中かどうかを、いま画面にあるボタンへ反映する（過去のレビュー指摘）。 */
  function applyBusy() {
    for (const { button, baseDisabled } of outerControls) {
      button.disabled = baseDisabled || local.busy;
    }
  }

  /**
   * 選択中の実施回と作業項目を引く。
   *
   * @returns {{run: object, task: object}|null}
   */
  function selected() {
    const { dataset, selection = {} } = store.getState();
    const run = dataset.workRuns.find((candidate) => candidate.runId === selection.runId);
    if (run === undefined) {
      return null;
    }
    const task = run.tasks.find(
      (candidate) => candidate.taskRecordId === selection.taskRecordId,
    );
    return task === undefined ? null : { run, task };
  }

  function projectOf(run) {
    return (
      store
        .getState()
        .dataset.projectGroups.find(
          (group) => group.projectGroupId === run.projectGroupId,
        ) ?? null
    );
  }

  /**
   * この作業項目がいま案件画面の中で表示されているかを確かめる。
   *
   * 保存を待つあいだに利用者が別の作業項目・別の実施回・別の画面へ移った場合、
   * ここでの局所描画は `detailPane` を上書きしてしまう（過去のレビュー指摘）。
   * `wrap()` の `store.setState()` が既にストア購読経由で現在の画面を正しく
   * 描いているため、対象が変わっていれば局所描画をしない。
   *
   * @param {string} runId
   * @param {string} taskRecordId
   * @returns {boolean}
   */
  function isShowingTask(runId, taskRecordId) {
    const { view, selection } = store.getState();
    return (
      view === VIEW.PROJECTS && selection.runId === runId && selection.taskRecordId === taskRecordId
    );
  }

  /**
   * 対象を確定してから保存する共通処理。3つの入口（操作・区間編集・削除）が
   * 「対象を選ぶ→保存する→ローカル状態を畳む→対象がいまも表示中なら描き直す」
   * という同じ形をとる。差は呼び出す保存処理だけである。
   *
   * @param {(target: {runId: string, taskRecordId: string},
   *          confirmedResume: boolean) => Promise<object>} perform
   * @param {boolean} [confirmedResume] 集計済みからの再開を承諾済みか（仕様書7.1）
   */
  async function withCurrentTarget(perform, confirmedResume = false) {
    const { selection } = store.getState();
    const target = { runId: selection.runId, taskRecordId: selection.taskRecordId };
    // 保存中は外側のボタンを止める。押せたままだと、この await の間に次の
    // フォームが開き、下の畳み込みがそれを消す（過去のレビュー指摘）。
    local.busy = true;
    applyBusy();

    let result;
    try {
      result = await perform(target, confirmedResume);
    } catch (error) {
      local.busy = false;
      if (error instanceof ResumeConfirmationRequiredError) {
        // 拒否ではなく確認待ちである（仕様書7.1）。フォームを畳んで確認パネルへ
        // 差し替え、承諾されたら同じ入力で呼び直す。フォーム内のエラー欄へ出すと
        // 「入力が誤っている」ように読めるため、そちらの経路へは流さない。
        local.activeForm = null;
        local.deleteTarget = null;
        local.resumeConfirm = { retry: () => withCurrentTarget(perform, true) };
        if (isShowingTask(target.runId, target.taskRecordId)) {
          render();
          resumePanel?.focus();
        }
        return;
      }
      // 保存を拒否された。フォームは開いたままにする。送信元のフォームが自分で
      // エラーを出し、利用者は入力を直して押し直せる（`intervalEntryForm` の
      // `submit()`）。ここで描き直すとその表示ごと消えるため、戻すのは外側の
      // ボタンだけにする。
      applyBusy();
      throw error;
    }

    // 保存できたので、開いていた入力を畳む。あとで再びこの作業項目を表示した
    // ときに古いフォームが残らないようにするためで、描画するかどうかとは別に
    // 必ず行う。
    local.busy = false;
    local.activeForm = null;
    local.deleteTarget = null;
    local.resumeConfirm = null;
    local.warnings = (result.warnings ?? []).map((warning) => warning.message);
    // 保存が成功するとストア購読の再描画が走るが、それはこの行より前、まだ
    // ローカル状態が残っている時点で起きる。閉じた状態を映すために、対象が
    // いまも表示中であればここで描き直す（`src/app/store.js` の規約2、
    // 過去のレビュー指摘）。
    if (isShowingTask(target.runId, target.taskRecordId)) {
      render();
    }
  }

  /**
   * 開始・休憩・再開・終了・参加者変更・区間追加を実行する。
   *
   * 集計済みからの再開で差し戻された場合は、確認後に同じ入力で呼び直す。入力を
   * 覚えておくのではなく、この関数ごと `retry` として保持する（仕様書7.1）。
   *
   * @param {Function} action
   * @param {object} input
   */
  function runOperation(action, input) {
    return withCurrentTarget((target, confirmedResume) =>
      action(target, { ...input, confirmedResume }),
    );
  }

  /**
   * 区間を編集する（仕様書8.4.5）。
   *
   * @param {string} intervalId
   * @param {object} changes
   */
  function runIntervalEdit(intervalId, changes) {
    return withCurrentTarget((target) => actions.updateInterval(target, intervalId, changes));
  }

  /**
   * 区間を削除する（仕様書11章）。理由は呼び出し側（削除確認）が必須にする。
   *
   * @param {string} intervalId
   * @param {{reason: string}} input
   */
  function runIntervalDelete(intervalId, input) {
    return withCurrentTarget((target) => actions.deleteInterval(target, intervalId, input));
  }

  /**
   * 直接入力を追加する（仕様書8.5）。
   *
   * @param {object} input
   */
  function runDirectEntryCreate(input) {
    return withCurrentTarget((target) => actions.createDirectEntry(target, input));
  }

  /**
   * 直接入力を編集する（仕様書8.5）。
   *
   * @param {string} entryId
   * @param {object} changes
   */
  function runDirectEntryEdit(entryId, changes) {
    return withCurrentTarget((target) => actions.updateDirectEntry(target, entryId, changes));
  }

  /**
   * 直接入力を削除する（仕様書11章）。理由は呼び出し側（削除確認）が必須にする。
   *
   * @param {string} entryId
   * @param {{reason: string}} input
   */
  function runDirectEntryDelete(entryId, input) {
    return withCurrentTarget((target) => actions.deleteDirectEntry(target, entryId, input));
  }

  /**
   * 削除確認をいま開いているか。
   *
   * @param {string} kind `interval` / `directEntry`
   * @param {string} id
   * @returns {boolean}
   */
  function isDeleting(kind, id) {
    return local.deleteTarget?.kind === kind && local.deleteTarget.id === id;
  }

  /**
   * @param {string} operation
   * @returns {Function}
   */
  function actionFor(operation) {
    switch (operation) {
      case TASK_OPERATION.START:
        return actions.recordStart;
      case TASK_OPERATION.BREAK:
        return actions.recordBreak;
      case TASK_OPERATION.RESUME:
        return actions.recordResume;
      case TASK_OPERATION.CHANGE_PARTICIPANTS:
        return actions.recordParticipantChange;
      default:
        return actions.recordFinish;
    }
  }

  /**
   * 押した操作に対応する `activeForm` を決める。
   *
   * @param {string} operation
   * @returns {object}
   */
  function formFor(operation) {
    switch (operation) {
      case TASK_OPERATION.ADD_INTERVAL:
        return { kind: 'addInterval' };
      case TASK_OPERATION.DIRECT_ENTRY:
        return { kind: 'directEntry' };
      default:
        return { kind: 'operation', operation };
    }
  }

  /**
   * 操作ボタンを1つ作る。
   *
   * 「履歴編集」だけは他と違い、フォームを開くのではなく区間履歴・直接入力の行に
   * 編集・削除ボタンを出す・消すトグルである。
   *
   * @param {string} operation
   * @param {string[]} allowed
   */
  function operationButton(operation, allowed) {
    const enabled = allowed.includes(operation);
    const isHistoryToggle = operation === TASK_OPERATION.EDIT_HISTORY;
    const pressed = isHistoryToggle && local.historyEditMode;
    return trackOuter(
      el('button', {
        type: 'button',
        class: pressed ? 'button button--active' : 'button',
        text: TASK_OPERATION_LABEL[operation],
        dataset: { testid: `op-${operation}` },
        disabled: !enabled || local.busy,
        'aria-pressed': isHistoryToggle ? String(local.historyEditMode) : undefined,
        on: {
          click: () => {
            if (isHistoryToggle) {
              local.historyEditMode = !local.historyEditMode;
              if (!local.historyEditMode) {
                // 一覧を畳むときは、行から開いていた編集・削除も一緒に畳む。
                // ボタン自体が消えるため、開いたままだと閉じる手段が無くなる。
                if (
                  local.activeForm?.kind === 'editInterval' ||
                  local.activeForm?.kind === 'editDirectEntry'
                ) {
                  local.activeForm = null;
                }
                local.deleteTarget = null;
              }
              render();
              return;
            }
            local.warnings = [];
            local.deleteTarget = null;
            local.activeForm = formFor(operation);
            render();
            // 開いた入力欄へ移す。押したボタンは再描画で作り直されるため、
            // フォーカスを戻す先が無くなる（過去のレビュー指摘の (a) と同じ形）。
            form?.focus();
          },
        },
      }),
      !enabled,
    );
  }

  /** 直近に描いた上部フォーム。フォーカス移動のために持つ。 */
  let form = null;

  /** 直近に描いた再開確認パネル。フォーカス移動のために持つ。 */
  let resumePanel = null;

  /**
   * 集計済みからの作業再開の確認（仕様書7.1）。
   *
   * 集計済みは「未終了区間がない」状態なので、再開すると実施回を作業中へ戻す
   * ことになる。黙って戻さず、何が起きるかを示してから続ける。
   */
  function renderResumeConfirm() {
    resumePanel = null;
    if (local.resumeConfirm === null) {
      return null;
    }
    resumePanel = createConfirmPanel({
      title: '集計済みを解除して作業を再開しますか',
      description:
        'この実施回は集計済みです。作業を再開すると未終了の区間ができるため、' +
        '実施回を作業中へ戻します。',
      note: '転記値は作業を終了するまで未確定になります。',
      confirmLabel: '再開する',
      testidPrefix: 'resume',
      onConfirm: () => local.resumeConfirm.retry(),
      onCancel: () => {
        local.resumeConfirm = null;
        render();
      },
    });
    return resumePanel.element;
  }

  /**
   * 直近に描いた行内フォーム（区間・直接入力の編集と削除確認）。
   *
   * 上部の `form` と同じくフォーカス移動のために持つ。行の中で作るため、
   * 呼び出し側からは局所変数へ届かない（過去のレビュー指摘）。
   */
  let rowForm = null;

  /** 行から開くフォームの種別。上部フォームの描画対象から外す。 */
  const ROW_FORM_KINDS = new Set(['editInterval', 'editDirectEntry']);

  /**
   * フォームを閉じて描き直す。取消ボタンの共通の受け皿。
   */
  function closeForm() {
    local.activeForm = null;
    render();
  }

  /**
   * 上部の操作フォーム（開始・休憩・…・直接入力・区間追加）。行の編集フォームは
   * {@link renderIntervalRow} / {@link renderDirectEntryRow} が別に持つ。
   *
   * @param {object} task
   */
  function renderOperationForm(task) {
    form = null;
    if (local.activeForm === null || ROW_FORM_KINDS.has(local.activeForm.kind)) {
      return null;
    }
    const { dataset, selection } = store.getState();
    const candidates = collectParticipants(dataset.workRuns, { runId: selection.runId });

    if (local.activeForm.kind === 'addInterval') {
      form = createIntervalEntryForm({
        mode: 'add',
        candidates,
        now,
        idPrefix: 'task-add',
        onSubmit: (input) => runOperation(actions.addIntervalManually, input),
        onCancel: closeForm,
      });
      return form.element;
    }

    if (local.activeForm.kind === 'directEntry') {
      form = createDirectEntryForm({
        mode: 'add',
        candidates,
        idPrefix: 'task-direct-add',
        onSubmit: (input) => runDirectEntryCreate(input),
        onCancel: closeForm,
      });
      return form.element;
    }

    const operation = local.activeForm.operation;
    form = createIntervalOperationForm({
      operation,
      taskRecord: task,
      candidates,
      now,
      idPrefix: 'task-op',
      onSubmit: (input) => runOperation(actionFor(operation), input),
      onCancel: closeForm,
    });
    return form.element;
  }

  /**
   * 一覧の行に出す編集・削除ボタン。区間履歴と直接入力で作りが同じなので、
   * どちらの行からも同じ関数で作る。
   *
   * 押した後に開いたフォームへフォーカスを移す。押したボタン自体が再描画で
   * 捨てられるため、移さないとフォーカスが画面先頭側へ戻る（過去のレビュー指摘）。
   *
   * @param {{editTestid: string, deleteTestid: string,
   *          onEdit: () => void, onDelete: () => void}} options
   * @returns {HTMLElement}
   */
  function rowActions({ editTestid, deleteTestid, onEdit, onDelete }) {
    return el('div', { class: 'actions actions--inline' }, [
      trackOuter(
        el('button', {
          type: 'button',
          class: 'button button--compact',
          text: '編集',
          dataset: { testid: editTestid },
          disabled: local.busy,
          on: {
            click: () => {
              onEdit();
              render();
              rowForm?.focus();
            },
          },
        }),
        false,
      ),
      trackOuter(
        el('button', {
          type: 'button',
          class: 'button button--compact button--danger',
          text: '削除',
          dataset: { testid: deleteTestid },
          disabled: local.busy,
          on: {
            click: () => {
              onDelete();
              render();
              rowForm?.focus();
            },
          },
        }),
        false,
      ),
    ]);
  }

  /**
   * 区間履歴の1行。編集・削除ボタンは「履歴編集」がオンのときだけ出す。
   *
   * 開始・終了とも日付を省略しない。日をまたぐ区間があるため（仕様書8.4.8）、
   * 時刻だけでは前後が読めない行が混ざる。
   *
   * @param {object} run
   * @param {object} task
   * @param {object} interval
   * @returns {HTMLElement[]} 表示行と、開いていれば編集・削除フォームの行
   */
  function renderIntervalRow(run, task, interval) {
    const open = isOpenInterval(interval);
    const editingThis =
      local.historyEditMode &&
      local.activeForm?.kind === 'editInterval' &&
      local.activeForm.intervalId === interval.intervalId;
    const deletingThis = local.historyEditMode && isDeleting('interval', interval.intervalId);

    const cells = [
      el('td', {}, [
        el('span', {
          class: `badge badge--${interval.type === INTERVAL_TYPE.BREAK ? 'onBreak' : 'working'}`,
          dataset: { testid: 'interval-type' },
          text: INTERVAL_TYPE_LABEL[interval.type] ?? interval.type,
        }),
      ]),
      el('td', {
        dataset: { testid: 'interval-start' },
        text: formatIsoForHuman(interval.startAt),
      }),
      el('td', {
        dataset: { testid: 'interval-end' },
        class: open ? 'cell--warn' : '',
        text: open ? '進行中' : formatIsoForHuman(interval.endAt),
      }),
      el('td', {
        dataset: { testid: 'interval-participants' },
        text: interval.participants.length === 0 ? 'なし' : interval.participants.join('、'),
      }),
      el('td', {
        class: 'table__num',
        dataset: { testid: 'interval-effort' },
        text: toMinutesLabel(intervalEffortSeconds(interval)),
      }),
    ];
    if (local.historyEditMode) {
      cells.push(
        el('td', {}, [
          rowActions({
            editTestid: 'interval-edit',
            deleteTestid: 'interval-delete',
            onEdit: () => {
              local.deleteTarget = null;
              local.activeForm = { kind: 'editInterval', intervalId: interval.intervalId };
            },
            onDelete: () => {
              local.activeForm = null;
              local.deleteTarget = { kind: 'interval', id: interval.intervalId };
            },
          }),
        ]),
      );
    }

    const rows = [el('tr', { dataset: { testid: 'interval-row', intervalId: interval.intervalId } }, cells)];
    const columnCount = BASE_COLUMN_COUNT + (local.historyEditMode ? 1 : 0);

    if (editingThis) {
      const { dataset } = store.getState();
      const entry = createIntervalEntryForm({
        mode: 'edit',
        interval,
        candidates: collectParticipants(dataset.workRuns, { runId: run.runId }),
        now,
        idPrefix: `task-edit-${interval.intervalId}`,
        onSubmit: (changes) => runIntervalEdit(interval.intervalId, changes),
        onCancel: closeForm,
      });
      rowForm = entry;
      rows.push(
        el('tr', { dataset: { testid: 'interval-edit-row' } }, [
          el('td', { colspan: String(columnCount) }, [entry.element]),
        ]),
      );
    }

    if (deletingThis) {
      const { dataset } = store.getState();
      const preview = actions.previewIntervalDeletion(
        dataset.workRuns,
        { runId: run.runId, taskRecordId: task.taskRecordId },
        interval.intervalId,
      );
      if (preview.ok) {
        const confirm = createReasonConfirm({
          preview,
          subject: '区間',
          idPrefix: `task-delete-${interval.intervalId}`,
          onConfirm: (reason) => runIntervalDelete(interval.intervalId, { reason }),
          onCancel: () => {
            local.deleteTarget = null;
            render();
          },
        });
        rowForm = confirm;
        rows.push(
          el('tr', { dataset: { testid: 'interval-delete-row' } }, [
            el('td', { colspan: String(columnCount) }, [confirm.element]),
          ]),
        );
      }
    }

    return rows;
  }

  function renderIntervals(run, task) {
    if (task.intervals.length === 0) {
      return el('p', {
        class: 'placeholder',
        dataset: { testid: 'interval-empty' },
        text: 'まだ作業区間がありません。「開始」で記録を始めます。',
      });
    }
    // 開始が早い順に並べる。記録した順ではなく時間の順で読む。文字列の辞書順
    // ではなく実時刻で比べる（過去のレビュー指摘）。記録経路は常にローカル
    // オフセットで書くため実害は無いが、インポートJSON（仕様書9.3）は異なる
    // オフセットの区間を許すため、`compareIso` を通す。
    const ordered = [...task.intervals].sort((left, right) =>
      compareIso(left.startAt, right.startAt),
    );
    const headerCells = [
      el('th', { scope: 'col', text: '種別' }),
      el('th', { scope: 'col', text: '開始' }),
      el('th', { scope: 'col', text: '終了' }),
      el('th', { scope: 'col', text: '参加者' }),
      el('th', { scope: 'col', class: 'table__num', text: '工数' }),
      local.historyEditMode ? el('th', { scope: 'col', text: '操作' }) : null,
    ];
    return el('table', { class: 'table', dataset: { testid: 'interval-list' } }, [
      el('thead', {}, [el('tr', {}, headerCells)]),
      el('tbody', {}, ordered.flatMap((interval) => renderIntervalRow(run, task, interval))),
    ]);
  }

  /**
   * 直接入力一覧の1行（仕様書8.5）。編集・削除ボタンは区間履歴と同じく
   * 「履歴編集」がオンのときだけ出す。
   *
   * 工数は分と秒の両方を出す。転記値は分へ切り上げるが（仕様書8.6.4）、それは
   * 作業項目の合計に対して一度だけ行うものであり、ここで丸めた値を見せると
   * 内訳の足し算が合わなくなる。
   *
   * @param {object} run
   * @param {object} task
   * @param {object} entry
   * @returns {HTMLElement[]} 表示行と、開いていれば編集・削除フォームの行
   */
  function renderDirectEntryRow(run, task, entry) {
    const editable = isRunEditable(run);
    const editingThis =
      local.activeForm?.kind === 'editDirectEntry' && local.activeForm.entryId === entry.entryId;
    const deletingThis = isDeleting('directEntry', entry.entryId);

    const cells = [
      el('td', {
        class: 'table__num',
        dataset: { testid: 'direct-effort' },
        text: formatSeconds(entry.seconds),
      }),
      el('td', {
        dataset: { testid: 'direct-participants' },
        text: entry.participants.length === 0 ? 'なし' : entry.participants.join('、'),
      }),
      el('td', { dataset: { testid: 'direct-note' }, text: entry.note }),
    ];
    if (editable) {
      cells.push(
        el('td', {}, [
          rowActions({
            editTestid: 'direct-edit',
            deleteTestid: 'direct-delete',
            onEdit: () => {
              local.deleteTarget = null;
              local.activeForm = { kind: 'editDirectEntry', entryId: entry.entryId };
            },
            onDelete: () => {
              local.activeForm = null;
              local.deleteTarget = { kind: 'directEntry', id: entry.entryId };
            },
          }),
        ]),
      );
    }

    const rows = [
      el('tr', { dataset: { testid: 'direct-row', entryId: entry.entryId } }, cells),
    ];
    const columnCount = DIRECT_COLUMN_COUNT + (editable ? 1 : 0);

    if (editingThis) {
      const { dataset } = store.getState();
      const editForm = createDirectEntryForm({
        mode: 'edit',
        entry,
        candidates: collectParticipants(dataset.workRuns, { runId: run.runId }),
        idPrefix: `task-direct-edit-${entry.entryId}`,
        onSubmit: (changes) => runDirectEntryEdit(entry.entryId, changes),
        onCancel: closeForm,
      });
      rowForm = editForm;
      rows.push(
        el('tr', { dataset: { testid: 'direct-edit-row' } }, [
          el('td', { colspan: String(columnCount) }, [editForm.element]),
        ]),
      );
    }

    if (deletingThis) {
      const { dataset } = store.getState();
      const preview = actions.previewDirectEntryDeletion(
        dataset.workRuns,
        { runId: run.runId, taskRecordId: task.taskRecordId },
        entry.entryId,
      );
      if (preview.ok) {
        const confirm = createReasonConfirm({
          preview,
          subject: '直接入力',
          idPrefix: `task-direct-delete-${entry.entryId}`,
          onConfirm: (reason) => runDirectEntryDelete(entry.entryId, { reason }),
          onCancel: () => {
            local.deleteTarget = null;
            render();
          },
        });
        rowForm = confirm;
        rows.push(
          el('tr', { dataset: { testid: 'direct-delete-row' } }, [
            el('td', { colspan: String(columnCount) }, [confirm.element]),
          ]),
        );
      }
    }

    return rows;
  }

  /**
   * 直接入力一覧（仕様書8.5、12.2）。
   *
   * 並べ替えない。区間は時刻を持つため開始順に並べるが、直接入力には順序を
   * 決める値が無い。登録した順で読めるほうが、後から足した分を見つけやすい。
   *
   * ## 「履歴編集」で隠さない
   *
   * 区間履歴の編集・削除はトグルの内側にあるが、直接入力の編集・削除は実施回が
   * 書き換えられる限り常に出す。仕様書12.4 の「履歴編集」は未着手では無効で
   * あり、そこへ寄せると「区間は無いが直接入力だけある作業項目」で編集も削除も
   * できなくなる。直接入力は全状態で追加できるため（12.4）、この組み合わせは
   * 普通に起きる。
   *
   * @param {object} run
   * @param {object} task
   */
  function renderDirectEntries(run, task) {
    if (task.directEntries.length === 0) {
      return el('p', {
        class: 'placeholder',
        dataset: { testid: 'direct-empty' },
        text: 'まだ直接入力がありません。「直接入力」で計測漏れ分を足せます。',
      });
    }
    const headerCells = [
      el('th', { scope: 'col', class: 'table__num', text: '追加工数' }),
      el('th', { scope: 'col', text: '参加者' }),
      el('th', { scope: 'col', text: '備考' }),
      isRunEditable(run) ? el('th', { scope: 'col', text: '操作' }) : null,
    ];
    return el('table', { class: 'table', dataset: { testid: 'direct-list' } }, [
      el('thead', {}, [el('tr', {}, headerCells)]),
      el('tbody', {}, task.directEntries.flatMap((entry) => renderDirectEntryRow(run, task, entry))),
    ]);
  }

  /**
   * 工数内訳（仕様書12.3、8.6.5）。
   *
   * @param {object} task
   */
  function renderSummary(task) {
    const summary = summarizeTask(task);
    return el('dl', { class: 'summary', dataset: { testid: 'task-summary' } }, [
      el('dt', { text: '時刻入力分' }),
      el('dd', { dataset: { testid: 'summary-time' }, text: toMinutesLabel(summary.timeSeconds) }),
      el('dt', { text: '直接入力分' }),
      el('dd', {
        dataset: { testid: 'summary-direct' },
        text: toMinutesLabel(summary.directSeconds),
      }),
      el('dt', { text: '合計' }),
      el('dd', {
        dataset: { testid: 'summary-total' },
        text: toMinutesLabel(summary.totalSeconds),
      }),
      el('dt', { text: '転記値' }),
      el('dd', {
        dataset: { testid: 'summary-transfer' },
        class: summary.confirmed ? '' : 'summary__warn',
        // 未終了区間があるうちは転記値が未確定になる（仕様書8.6.5）。
        text: summary.confirmed
          ? `${summary.transferMinutes}分`
          : `未確定（進行中${summary.openCount}件）`,
      }),
    ]);
  }

  /**
   * 直前の保存で出た警告を出す（仕様書8.9.5）。
   *
   * 保存は済んでいる。確認を求めて差し戻すのではなく、記録したうえで知らせる。
   * 固定警告領域（仕様書8.8.1）は別に持つため、ここでは画面内に出す。
   */
  function renderWarnings() {
    if (local.warnings.length === 0) {
      return null;
    }
    return el(
      'div',
      { class: 'card card--warn', role: 'status', dataset: { testid: 'task-warnings' } },
      [
        el('p', { class: 'errors__title', text: '記録しました（確認してください）' }),
        el(
          'ul',
          {},
          local.warnings.map((message) => el('li', { text: message })),
        ),
      ],
    );
  }

  function render() {
    // 非同期処理の完了後に呼ばれることがある。その間に利用者が別画面へ移って
    // いれば、共有している詳細ペインを奪い返してはいけない（過去のレビュー指摘）。
    if (!isActive()) {
      return;
    }
    // 描き直すと前回のボタンとフォームは捨てられる。参照を先に空にしておかないと、
    // 画面に無い要素へフォーカスや無効化を当てることになる。
    outerControls = [];
    rowForm = null;

    const found = selected();
    if (found === null) {
      replaceChildren(container, [
        el('p', {
          class: 'placeholder',
          dataset: { testid: 'task-detail-empty' },
          text: '左の一覧から作業項目を選んでください。',
        }),
      ]);
      return;
    }

    const { run, task } = found;
    const group = projectOf(run);
    const state = taskState(task);
    const editable = isRunEditable(run);
    // 実施回が閲覧のみへ変わったら、開いていた入力をすべて閉じる
    // （過去のレビュー指摘）。フォームを開いたまま同じ画面の
    // 操作で転記済みへ進めるためである。保存はアクション層が
    // 拒むので誤記録にはならないが、「閲覧のみ」の注記と入力欄が同居して見えるのは
    // それ自体が矛盾した表示である。区間の追加・編集、直接入力、削除確認のいずれも
    // 対象にする。
    if (!editable) {
      local.activeForm = null;
      local.deleteTarget = null;
      local.resumeConfirm = null;
      local.historyEditMode = false;
    }
    const allowed = availableOperations(task, { runEditable: editable });

    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('div', {}, [
          el('h2', {
            class: 'view__title',
            dataset: { testid: 'task-detail-title' },
            text: task.name,
          }),
          el('p', { class: 'note' }, [
            el('span', {
              dataset: { testid: 'task-detail-context' },
              text: `${group === null ? '' : group.projectId} ／ ${run.workDate} ／ `,
            }),
            el('span', {
              dataset: { testid: 'task-detail-code' },
              class: task.externalCode === null ? 'cell--warn' : '',
              text: task.externalCode ?? '外部項目コード未設定',
            }),
            el('span', { text: ' ／ ' }),
            el('span', { text: '作業項目 ' }),
            el('span', {
              class: `badge badge--${state}`,
              dataset: { testid: 'task-detail-state' },
              text: TASK_STATE_LABEL[state],
            }),
            el('span', { text: ' ／ ' }),
            el('span', { text: '実施回 ' }),
            el('span', {
              class: `badge badge--${run.status}`,
              dataset: { testid: 'task-detail-run-status' },
              text: RUN_STATUS_LABEL[run.status] ?? run.status,
            }),
          ]),
        ]),
        el('button', {
          type: 'button',
          class: 'button',
          text: '実施回へ戻る',
          dataset: { testid: 'back-to-run' },
          on: { click: () => handlers.onBackToRun(run.runId) },
        }),
      ]),

      renderWarnings(),

      editable
        ? el(
            'div',
            { class: 'actions', dataset: { testid: 'task-operations' } },
            Object.values(TASK_OPERATION).map((operation) => operationButton(operation, allowed)),
          )
        : el('p', {
            class: 'note note--warn',
            dataset: { testid: 'task-not-editable' },
            text: describeNotEditable(run),
          }),

      renderResumeConfirm(),

      renderOperationForm(task),

      el('section', { class: 'card' }, [
        el('h3', { class: 'card__title', text: '工数内訳' }),
        renderSummary(task),
      ]),

      el('section', { class: 'card' }, [
        el('h3', { class: 'card__title', text: '区間履歴' }),
        renderIntervals(run, task),
      ]),

      el('section', { class: 'card' }, [
        el('h3', { class: 'card__title', text: '直接入力' }),
        renderDirectEntries(run, task),
      ]),
    ]);
  }

  return { render, reset };
}
