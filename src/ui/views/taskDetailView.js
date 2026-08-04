/**
 * 作業項目詳細（仕様書12.2、12.3、12.4、8.4、11章）。
 *
 * 一つの作業項目について、区間履歴・参加者・工数内訳を出し、状態に応じた操作を
 * 置く。実施回詳細の作業項目行からも一部の操作ができるが（`runView.js`）、
 * こちらは記録した区間を1件ずつ確かめ、追加・編集・削除できる点が違う。
 *
 * 結線済みの操作は開始・休憩・再開・終了・参加者変更・区間追加・履歴編集
 * （編集・削除）である。直接入力（8.5）だけが Step 7 待ちで残る。押せるのに
 * 何も起きないボタンにはせず、無効にしたうえで理由を添える（`shell.js` の
 * 未実装ナビと同じ扱い）。
 *
 * ## 画面内で開くフォームは1つ
 *
 * `local.activeForm` が、上部の操作ボタンから開くフォーム（開始・休憩・…・
 * 区間追加）と、区間履歴の行から開く編集フォームの両方を1つのスロットで持つ。
 * 別の操作を開くと前のフォームは自動的に閉じる。同時に複数の入力が開いた
 * ままだと、確定したときにどれを保存したのか分かりにくくなるためである。
 * 削除確認（`local.deleteTarget`）も同様に単一である。
 *
 * ## 保存中は外側の操作を止める
 *
 * フォーム自身は送信中に自分の確定・取消を無効にするが、それだけでは足りない。
 * 保存を待つ間に上部のボタンや別の行から次のフォームを開けてしまうと、先の
 * 保存の完了処理が `activeForm` を畳み、開いたばかりの入力を消す
 * （レビュー指摘 FB-10）。`local.busy` の間は外側のボタンをすべて無効にし、
 * 開いているフォームが常に1つだけという前提を保存中も崩さない。
 *
 * 無効化は `render()` ではなく {@link applyBusy} で行う。保存中に描き直すと、
 * まさに送信中のフォームが作り直され、入力内容と「保存中」の表示が失われる。
 *
 * 経過時間の1分ごとの再評価（仕様書8.8）は Step 11 である。ここでは未終了区間で
 * あることを表示するにとどめる（設計メモ §5）。
 */

import { compareIso } from '../../domain/datetime.js';
import {
  INTERVAL_TYPE,
  INTERVAL_TYPE_LABEL,
  intervalEffortSeconds,
  isOpenInterval,
  summarizeTask,
} from '../../domain/effort.js';
import { formatIsoForHuman } from '../../domain/history.js';
import { collectParticipants } from '../../domain/participants.js';
import { describeNotEditable, isRunEditable } from '../../domain/runStatus.js';
import {
  TASK_OPERATION,
  TASK_OPERATION_LABEL,
  TASK_STATE_LABEL,
  availableOperations,
  taskState,
} from '../../domain/taskState.js';
import { createDeleteIntervalConfirm } from '../components/deleteIntervalConfirm.js';
import { createIntervalEntryForm } from '../components/intervalEntryForm.js';
import { createIntervalOperationForm } from '../components/intervalOperationForm.js';
import { el, replaceChildren } from '../dom.js';
import { RUN_STATUS_LABEL, toMinutesLabel } from '../labels.js';
import { VIEW } from '../shell.js';

/** 結線済みの操作。直接入力（8.5）だけが Step 7 待ちで残る。 */
const WIRED_OPERATIONS = new Set([
  TASK_OPERATION.START,
  TASK_OPERATION.BREAK,
  TASK_OPERATION.RESUME,
  TASK_OPERATION.FINISH,
  TASK_OPERATION.CHANGE_PARTICIPANTS,
  TASK_OPERATION.ADD_INTERVAL,
  TASK_OPERATION.EDIT_HISTORY,
]);

/** 未実装の操作に添える理由。 */
const NOT_READY_REASON = {
  [TASK_OPERATION.DIRECT_ENTRY]: '直接入力は次の段階で実装します',
};

/** 区間履歴の表の列数。編集モード中は「操作」列が1つ増える。 */
const BASE_COLUMN_COUNT = 5;

/**
 * 作業項目詳細を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {recordStart: Function, recordBreak: Function,
 *                    recordResume: Function, recordFinish: Function,
 *                    recordParticipantChange: Function,
 *                    addIntervalManually: Function, updateInterval: Function,
 *                    deleteInterval: Function, previewIntervalDeletion: Function},
 *          handlers: {onBackToRun: Function},
 *          now?: () => Date}} options
 * @returns {{render: () => void, reset: () => void}}
 */
export function createTaskDetailView({ container, store, actions, handlers, now }) {
  /**
   * ビュー内部の状態（`src/app/store.js` の規約2）。
   *
   * - `activeForm`: 開いているフォーム。`{kind:'operation', operation}` /
   *   `{kind:'addInterval'}` / `{kind:'editInterval', intervalId}` / `null`。
   * - `historyEditMode`: 区間履歴の行に編集・削除ボタンを出すかどうか
   *   （「履歴編集」の押下で切り替える）。
   * - `deleteTarget`: 削除確認を開いている区間のID。
   * - `warnings`: 直前の保存で出た警告（区間の重複、仕様書8.9.5）。
   * - `busy`: 保存中かどうか。外側のボタンを止める（レビュー指摘 FB-10）。
   *
   * 保存を拒否したエラーは各フォーム自身が出す。
   */
  const local = {
    activeForm: null,
    historyEditMode: false,
    deleteTarget: null,
    warnings: [],
    busy: false,
  };

  function reset() {
    local.activeForm = null;
    local.historyEditMode = false;
    local.deleteTarget = null;
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

  /** 保存中かどうかを、いま画面にあるボタンへ反映する（レビュー指摘 FB-10）。 */
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
   * ここでの局所描画は `detailPane` を上書きしてしまう（レビュー指摘 FB-7）。
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
   * @param {(target: {runId: string, taskRecordId: string}) => Promise<object>} perform
   */
  async function withCurrentTarget(perform) {
    const { selection } = store.getState();
    const target = { runId: selection.runId, taskRecordId: selection.taskRecordId };
    // 保存中は外側のボタンを止める。押せたままだと、この await の間に次の
    // フォームが開き、下の畳み込みがそれを消す（レビュー指摘 FB-10）。
    local.busy = true;
    applyBusy();

    let result;
    try {
      result = await perform(target);
    } catch (error) {
      // 保存を拒否された。フォームは開いたままにする。送信元のフォームが自分で
      // エラーを出し、利用者は入力を直して押し直せる（`intervalEntryForm` の
      // `submit()`）。ここで描き直すとその表示ごと消えるため、戻すのは外側の
      // ボタンだけにする。
      local.busy = false;
      applyBusy();
      throw error;
    }

    // 保存できたので、開いていた入力を畳む。あとで再びこの作業項目を表示した
    // ときに古いフォームが残らないようにするためで、描画するかどうかとは別に
    // 必ず行う。
    local.busy = false;
    local.activeForm = null;
    local.deleteTarget = null;
    local.warnings = (result.warnings ?? []).map((warning) => warning.message);
    // 保存が成功するとストア購読の再描画が走るが、それはこの行より前、まだ
    // ローカル状態が残っている時点で起きる。閉じた状態を映すために、対象が
    // いまも表示中であればここで描き直す（`src/app/store.js` の規約2、
    // レビュー指摘 FB-7）。
    if (isShowingTask(target.runId, target.taskRecordId)) {
      render();
    }
  }

  /**
   * 開始・休憩・再開・終了・参加者変更・区間追加を実行する。
   *
   * @param {Function} action
   * @param {object} input
   */
  function runOperation(action, input) {
    return withCurrentTarget((target) => action(target, input));
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
   * 操作ボタンを1つ作る。
   *
   * 「履歴編集」だけは他と違い、フォームを開くのではなく区間履歴の行に
   * 編集・削除ボタンを出す・消すトグルである。
   *
   * @param {string} operation
   * @param {string[]} allowed
   */
  function operationButton(operation, allowed) {
    const ready = WIRED_OPERATIONS.has(operation);
    const enabled = allowed.includes(operation) && ready;
    const isHistoryToggle = operation === TASK_OPERATION.EDIT_HISTORY;
    const pressed = isHistoryToggle && local.historyEditMode;
    return trackOuter(
      el('button', {
        type: 'button',
        class: pressed ? 'button button--active' : 'button',
        text: TASK_OPERATION_LABEL[operation],
        dataset: { testid: `op-${operation}` },
        disabled: !enabled || local.busy,
        title: ready ? undefined : NOT_READY_REASON[operation],
        'aria-pressed': isHistoryToggle ? String(local.historyEditMode) : undefined,
        on: {
          click: () => {
            if (isHistoryToggle) {
              local.historyEditMode = !local.historyEditMode;
              if (!local.historyEditMode) {
                // 一覧を畳むときは、行から開いていた編集・削除も一緒に畳む。
                // ボタン自体が消えるため、開いたままだと閉じる手段が無くなる。
                if (local.activeForm?.kind === 'editInterval') {
                  local.activeForm = null;
                }
                local.deleteTarget = null;
              }
              render();
              return;
            }
            local.warnings = [];
            local.deleteTarget = null;
            local.activeForm =
              operation === TASK_OPERATION.ADD_INTERVAL
                ? { kind: 'addInterval' }
                : { kind: 'operation', operation };
            render();
            // 開いた入力欄へ移す。押したボタンは再描画で作り直されるため、
            // フォーカスを戻す先が無くなる（レビュー指摘 D-18 の (a) と同じ形）。
            form?.focus();
          },
        },
      }),
      !enabled,
    );
  }

  /** 直近に描いた上部フォーム。フォーカス移動のために持つ。 */
  let form = null;

  /**
   * 直近に描いた行内フォーム（区間の編集・削除確認）。
   *
   * 上部の `form` と同じくフォーカス移動のために持つ。行の中で作るため、
   * 呼び出し側からは局所変数へ届かない（レビュー指摘 FB-11）。
   */
  let rowForm = null;

  /**
   * 上部の操作フォーム（開始・休憩・…・区間追加）。行の編集フォームは
   * {@link renderIntervalRow} が別に持つ。
   *
   * @param {object} task
   */
  function renderOperationForm(task) {
    form = null;
    if (local.activeForm === null || local.activeForm.kind === 'editInterval') {
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
        onCancel: () => {
          local.activeForm = null;
          render();
        },
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
      onCancel: () => {
        local.activeForm = null;
        render();
      },
    });
    return form.element;
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
    const deletingThis = local.historyEditMode && local.deleteTarget === interval.intervalId;

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
          el('div', { class: 'actions actions--inline' }, [
            trackOuter(
              el('button', {
                type: 'button',
                class: 'button button--compact',
                text: '編集',
                dataset: { testid: 'interval-edit' },
                disabled: local.busy,
                on: {
                  click: () => {
                    local.deleteTarget = null;
                    local.activeForm = { kind: 'editInterval', intervalId: interval.intervalId };
                    render();
                    // 上部の操作ボタンと同じ規約で、開いた入力欄へ移す。押した
                    // ボタンは再描画で作り直される（レビュー指摘 FB-11）。
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
                dataset: { testid: 'interval-delete' },
                disabled: local.busy,
                on: {
                  click: () => {
                    local.activeForm = null;
                    local.deleteTarget = interval.intervalId;
                    render();
                    rowForm?.focus();
                  },
                },
              }),
              false,
            ),
          ]),
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
        onCancel: () => {
          local.activeForm = null;
          render();
        },
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
        const confirm = createDeleteIntervalConfirm({
          preview,
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
    // ではなく実時刻で比べる（レビュー指摘 FB-1）。記録経路は常にローカル
    // オフセットで書くため実害は無いが、インポートJSON（仕様書9.3）は異なる
    // オフセットの区間を許すため、`compareIso` を通す（F-25 の集約方針）。
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
   * 固定警告領域（仕様書8.8.1）は Step 11 の範囲であり、ここでは画面内に出す。
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
            el('span', {
              class: `badge badge--${state}`,
              dataset: { testid: 'task-detail-state' },
              text: TASK_STATE_LABEL[state],
            }),
            el('span', { text: ' ／ ' }),
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

      renderOperationForm(task),

      el('section', { class: 'card' }, [
        el('h3', { class: 'card__title', text: '工数内訳' }),
        renderSummary(task),
      ]),

      el('section', { class: 'card' }, [
        el('h3', { class: 'card__title', text: '区間履歴' }),
        renderIntervals(run, task),
      ]),
    ]);
  }

  return { render, reset };
}
