/**
 * 作業項目詳細（仕様書12.2、12.3、12.4、8.4）。
 *
 * 一つの作業項目について、区間履歴・参加者・工数内訳を出し、状態に応じた操作を
 * 置く。実施回詳細の作業項目行からも同じ操作ができるが（`runView.js`）、こちらは
 * 記録した区間を1件ずつ確かめられる点が違う。
 *
 * 実装計画 Step 6 PR-B1 の時点で動くのは開始・休憩・再開・終了である。参加者
 * 変更・区間追加・履歴編集は PR-B2、直接入力は Step 7 で足す。押せるのに何も
 * 起きないボタンにはせず、無効にしたうえで理由を添える（`shell.js` の未実装
 * ナビと同じ扱い）。
 *
 * 経過時間の1分ごとの再評価（仕様書8.8）は Step 11 である。ここでは未終了区間で
 * あることを表示するにとどめる（設計メモ §5）。
 */

import {
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
import { createIntervalOperationForm } from '../components/intervalOperationForm.js';
import { el, replaceChildren } from '../dom.js';
import { RUN_STATUS_LABEL, toMinutesLabel } from '../labels.js';

/** PR-B1 で結線済みの操作。 */
const WIRED_OPERATIONS = new Set([
  TASK_OPERATION.START,
  TASK_OPERATION.BREAK,
  TASK_OPERATION.RESUME,
  TASK_OPERATION.FINISH,
]);

/** 未実装の操作に添える理由。 */
const NOT_READY_REASON = {
  [TASK_OPERATION.CHANGE_PARTICIPANTS]: '参加者変更は次の段階で実装します',
  [TASK_OPERATION.ADD_INTERVAL]: '区間追加は次の段階で実装します',
  [TASK_OPERATION.EDIT_HISTORY]: '履歴編集は次の段階で実装します',
  [TASK_OPERATION.DIRECT_ENTRY]: '直接入力は次の段階で実装します',
};

/**
 * 作業項目詳細を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {recordStart: Function, recordBreak: Function,
 *                    recordResume: Function, recordFinish: Function},
 *          handlers: {onBackToRun: Function},
 *          now?: () => Date}} options
 * @returns {{render: () => void, reset: () => void}}
 */
export function createTaskDetailView({ container, store, actions, handlers, now }) {
  /**
   * ビュー内部の状態（`src/app/store.js` の規約2）。
   *
   * `operation` は開いている操作フォーム、`warnings` は直前の保存で出た警告
   * （区間の重複、仕様書8.9.5）である。ストアへは持たせない。保存を拒否した
   * エラーはフォーム自身が出す。
   */
  const local = { operation: null, warnings: [] };

  function reset() {
    local.operation = null;
    local.warnings = [];
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
   * 操作を実行する。
   *
   * 成功したらフォームを閉じる。区間の重複は拒否ではなく警告なので（仕様書
   * 8.9.5）、保存したうえで画面へ出す。失敗時はフォーム側がエラーを出すため、
   * ここでは投げ直すだけにする。
   *
   * @param {Function} action
   * @param {object} input
   */
  async function runOperation(action, input) {
    const { selection } = store.getState();
    const target = { runId: selection.runId, taskRecordId: selection.taskRecordId };
    const result = await action(target, input);
    local.operation = null;
    local.warnings = result.warnings.map((warning) => warning.message);
    // 保存が成功するとストア購読の再描画が走るが、それはこの行より前、まだ
    // `local.operation` が残っている時点で起きる。閉じた状態を映すために、
    // ここで必ず描き直す（`src/app/store.js` の規約2）。
    render();
  }

  /**
   * 操作ボタンを1つ作る。
   *
   * @param {object} task
   * @param {string} operation
   * @param {string[]} allowed
   */
  function operationButton(task, operation, allowed) {
    const ready = WIRED_OPERATIONS.has(operation);
    const enabled = allowed.includes(operation) && ready;
    return el('button', {
      type: 'button',
      class: 'button',
      text: TASK_OPERATION_LABEL[operation],
      dataset: { testid: `op-${operation}` },
      disabled: !enabled,
      title: ready ? undefined : NOT_READY_REASON[operation],
      on: {
        click: () => {
          local.warnings = [];
          local.operation = operation;
          render();
          // 開いた入力欄へ移す。押したボタンは再描画で作り直されるため、
          // フォーカスを戻す先が無くなる（レビュー指摘 D-18 の (a) と同じ形）。
          form?.focus();
        },
      },
    });
  }

  /** 直近に描いた操作フォーム。フォーカス移動のために持つ。 */
  let form = null;

  function renderOperationForm(task) {
    form = null;
    if (local.operation === null) {
      return null;
    }
    const { dataset, selection } = store.getState();
    form = createIntervalOperationForm({
      operation: local.operation,
      taskRecord: task,
      candidates: collectParticipants(dataset.workRuns, { runId: selection.runId }),
      now,
      idPrefix: 'task-op',
      onSubmit: (input) => runOperation(actionFor(local.operation), input),
      onCancel: () => {
        local.operation = null;
        render();
      },
    });
    return form.element;
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
      default:
        return actions.recordFinish;
    }
  }

  /**
   * 区間履歴の1行。
   *
   * 開始・終了とも日付を省略しない。日をまたぐ区間があるため（仕様書8.4.8）、
   * 時刻だけでは前後が読めない行が混ざる。
   *
   * @param {object} interval
   */
  function renderIntervalRow(interval) {
    const open = isOpenInterval(interval);
    return el('tr', { dataset: { testid: 'interval-row', intervalId: interval.intervalId } }, [
      el('td', {}, [
        el('span', {
          class: `badge badge--${interval.type === 'break' ? 'onBreak' : 'working'}`,
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
    ]);
  }

  function renderIntervals(task) {
    if (task.intervals.length === 0) {
      return el('p', {
        class: 'placeholder',
        dataset: { testid: 'interval-empty' },
        text: 'まだ作業区間がありません。「開始」で記録を始めます。',
      });
    }
    // 開始が早い順に並べる。記録した順ではなく時間の順で読む。
    const ordered = [...task.intervals].sort((left, right) =>
      left.startAt < right.startAt ? -1 : left.startAt > right.startAt ? 1 : 0,
    );
    return el('table', { class: 'table', dataset: { testid: 'interval-list' } }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: '種別' }),
          el('th', { scope: 'col', text: '開始' }),
          el('th', { scope: 'col', text: '終了' }),
          el('th', { scope: 'col', text: '参加者' }),
          el('th', { scope: 'col', class: 'table__num', text: '工数' }),
        ]),
      ]),
      el('tbody', {}, ordered.map(renderIntervalRow)),
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
            Object.values(TASK_OPERATION).map((operation) =>
              operationButton(task, operation, allowed),
            ),
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
        renderIntervals(task),
      ]),
    ]);
  }

  return { render, reset };
}
