/**
 * 実施回詳細（仕様書12.3、12.4）。
 *
 * 各作業項目について、名称・外部項目コード・現在状態・時刻入力分・直接入力分・
 * 転記値を一行で確認でき（12.3）、その行から状態に応じた操作を行える（12.4）。
 *
 * ## 一覧から操作できるようにする理由
 *
 * 複数の作業項目を同時に作業中にできる（仕様書8.4.9、A-16）ことが本ツールの
 * 中心的な用途である。項目を切り替えるたびに画面を移ると、同時進行の記録が
 * そのぶん遅れる。作業項目詳細（`taskDetailView.js`）にも同じ操作を置くが、
 * あちらは区間履歴を1件ずつ確かめる場である。
 *
 * ボタンを押した時点では記録しない。日時（操作によっては参加者）を確かめてから
 * 確定させる（仕様書12.4「いずれも日時の初期値は現在日時とし、確定前に修正
 * できる」）。入力は `components/intervalOperationForm.js` が持ち、詳細画面と
 * 共通である。
 *
 * 行に出るのは開始・休憩・再開・終了・参加者変更である。区間追加・履歴編集は
 * 作業項目詳細のみ（PR-B2）、直接入力は Step 7 で足す。行を短く保つため、行には
 * 有効な操作だけを出す。まだ無い操作は作業項目詳細側で無効なボタンとして見える。
 */

import { summarizeRun, summarizeTask } from '../../domain/effort.js';
import { compareExternalCode } from '../../domain/naturalSort.js';
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
import { VIEW } from '../shell.js';

/** 並び順の選択（仕様書8.7.3）。 */
const SORT = {
  ORDER: 'order',
  EXTERNAL_CODE: 'externalCode',
};

/**
 * 作業項目行に出す操作。
 *
 * 区間追加・履歴編集は区間履歴の表と一緒でないと場所が要る（1件ずつ選ぶ・
 * 編集後の内容を確かめるなど）ため、実施回詳細の行には出さない。作業項目詳細
 * （`taskDetailView.js`）にのみ置く。
 */
const ROW_OPERATIONS = [
  TASK_OPERATION.START,
  TASK_OPERATION.BREAK,
  TASK_OPERATION.RESUME,
  TASK_OPERATION.FINISH,
  TASK_OPERATION.CHANGE_PARTICIPANTS,
];

/** 表の列数。操作フォーム行の `colspan` に使う。 */
const COLUMN_COUNT = 7;

/**
 * 実施回詳細を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {recordStart: Function, recordBreak: Function,
 *                    recordResume: Function, recordFinish: Function,
 *                    recordParticipantChange: Function},
 *          handlers: {onOpenTask: Function, onSelectProject: Function},
 *          now?: () => Date}} options
 * @returns {{render: () => void, reset: () => void}}
 */
export function createRunView({ container, store, actions, handlers, now }) {
  /**
   * ビュー内部の状態（`src/app/store.js` の規約2）。
   *
   * `operation` は開いている操作フォームの対象（作業項目と操作の組）である。
   */
  const local = { sort: SORT.ORDER, operation: null, warnings: [] };

  function reset() {
    local.operation = null;
    local.warnings = [];
  }

  function selectedRun() {
    const { dataset, selection = {} } = store.getState();
    return dataset.workRuns.find((run) => run.runId === selection.runId) ?? null;
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
   * 表示順を決める。
   *
   * 外部項目コード順は自然順で、未設定は末尾へ置く（仕様書8.7.3）。集計・転記
   * 画面（Step 8）と同じ並びをここでも選べるようにしてある。
   *
   * @param {object[]} tasks
   */
  function sortTasks(tasks) {
    const sorted = [...tasks];
    if (local.sort === SORT.EXTERNAL_CODE) {
      sorted.sort((left, right) => compareExternalCode(left.externalCode, right.externalCode));
    } else {
      sorted.sort((left, right) => left.order - right.order);
    }
    return sorted;
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
   * この実施回がいま案件画面の中で表示されているかを確かめる。
   *
   * 保存を待つあいだに利用者が別の実施回・別の作業項目・別の画面へ移った場合、
   * ここでの局所描画は `detailPane` を上書きしてしまう（レビュー指摘 FB-7）。
   * `wrap()` の `store.setState()` が既にストア購読経由で現在の画面を正しく
   * 描いているため、対象が変わっていれば局所描画をしない。
   *
   * @param {string} runId
   * @returns {boolean}
   */
  function isShowingRun(runId) {
    const { view, selection } = store.getState();
    return view === VIEW.PROJECTS && selection.taskRecordId === null && selection.runId === runId;
  }

  /**
   * 操作を実行する。
   *
   * 区間の重複は拒否ではなく警告なので（仕様書8.9.5）、保存したうえで画面へ
   * 出す。保存を拒否した場合はフォームがエラーを出すため、投げ直すだけにする。
   *
   * @param {string} taskRecordId
   * @param {string} operation
   * @param {object} input
   */
  async function runOperation(taskRecordId, operation, input) {
    const run = selectedRun();
    const runId = run.runId;
    const result = await actionFor(operation)({ runId, taskRecordId }, input);
    // 保存の成否によらず、開いていた入力をここで畳む。あとで再びこの実施回を
    // 表示したときに古いフォームが残らないようにするためで、描画するかどうかとは
    // 別に必ず行う。
    local.operation = null;
    local.warnings = result.warnings.map((warning) => warning.message);
    // 保存が成功するとストア購読の再描画が走るが、それはこの行より前、まだ
    // `local.operation` が残っている時点で起きる。閉じた状態を映すために、
    // 対象がいまも表示中であればここで描き直す（`src/app/store.js` の規約2）。
    if (isShowingRun(runId)) {
      render();
    }
  }

  /** 直近に描いた操作フォーム。フォーカス移動のために持つ。 */
  let form = null;

  /**
   * 作業項目行に置く操作ボタン。
   *
   * @param {object} task
   * @param {string[]} allowed
   */
  function operationButtons(task, allowed) {
    return ROW_OPERATIONS.filter((operation) => allowed.includes(operation)).map((operation) =>
      el('button', {
        type: 'button',
        class: 'button button--compact',
        text: TASK_OPERATION_LABEL[operation],
        dataset: { testid: `row-op-${operation}` },
        on: {
          click: () => {
            local.warnings = [];
            local.operation = { taskRecordId: task.taskRecordId, operation };
            render();
            form?.focus();
          },
        },
      }),
    );
  }

  function renderTaskRow(task, allowed) {
    const state = taskState(task);
    const summary = summarizeTask(task);
    const { selection = {} } = store.getState();
    const current = selection.taskRecordId === task.taskRecordId;

    const rowAttrs = {
      class: current ? 'table__row--selected' : '',
      'aria-current': current ? 'true' : 'false',
      dataset: { testid: 'task-row', taskRecordId: task.taskRecordId },
    };

    return el('tr', rowAttrs, [
      el('td', {}, [
        el('button', {
          type: 'button',
          class: 'link',
          text: task.name,
          dataset: { testid: 'task-name' },
          on: { click: () => handlers.onOpenTask(task.taskRecordId) },
        }),
      ]),
      el('td', {
        dataset: { testid: 'task-code' },
        class: task.externalCode === null ? 'cell--warn' : '',
        text: task.externalCode ?? '（未設定）',
      }),
      el('td', {}, [
        el('span', {
          class: `badge badge--${state}`,
          dataset: { testid: 'task-state' },
          text: TASK_STATE_LABEL[state],
        }),
      ]),
      el('td', {
        class: 'table__num',
        dataset: { testid: 'task-time' },
        text: toMinutesLabel(summary.timeSeconds),
      }),
      el('td', {
        class: 'table__num',
        dataset: { testid: 'task-direct' },
        text: toMinutesLabel(summary.directSeconds),
      }),
      el('td', {
        class: 'table__num',
        dataset: { testid: 'task-transfer' },
        // 未終了区間があるうちは転記値が未確定になる（仕様書8.6.5）。
        text: summary.confirmed ? `${summary.transferMinutes}分` : '未確定',
      }),
      el('td', {}, [
        el('div', { class: 'actions actions--inline' }, [
          ...operationButtons(task, allowed),
          el('button', {
            type: 'button',
            class: 'button button--compact',
            text: '詳細',
            dataset: { testid: 'open-task' },
            on: { click: () => handlers.onOpenTask(task.taskRecordId) },
          }),
        ]),
      ]),
    ]);
  }

  /**
   * 操作フォームの行。対象の作業項目行の直下へ置く。
   *
   * 別の場所に出すと、どの作業項目に対する操作なのかが分からなくなる。同時に
   * 複数項目を扱う画面なので、対象との近さが要る。
   *
   * @param {object} task
   * @param {object} run
   */
  function renderFormRow(task, run) {
    const { dataset } = store.getState();
    form = createIntervalOperationForm({
      operation: local.operation.operation,
      taskRecord: task,
      candidates: collectParticipants(dataset.workRuns, { runId: run.runId }),
      now,
      idPrefix: 'run-op',
      onSubmit: (input) =>
        runOperation(task.taskRecordId, local.operation.operation, input),
      onCancel: () => {
        local.operation = null;
        render();
      },
    });
    return el('tr', { class: 'table__row--form', dataset: { testid: 'task-form-row' } }, [
      el('td', { colspan: String(COLUMN_COUNT) }, [form.element]),
    ]);
  }

  /**
   * 直前の保存で出た警告（仕様書8.9.5）。保存自体は済んでいる。
   */
  function renderWarnings() {
    if (local.warnings.length === 0) {
      return null;
    }
    return el(
      'div',
      { class: 'card card--warn', role: 'status', dataset: { testid: 'run-warnings' } },
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

  function renderTaskBody(run, editable) {
    const rows = [];
    for (const task of sortTasks(run.tasks)) {
      const allowed = availableOperations(task, { runEditable: editable });
      rows.push(renderTaskRow(task, allowed));
      if (local.operation !== null && local.operation.taskRecordId === task.taskRecordId) {
        rows.push(renderFormRow(task, run));
      }
    }
    return rows;
  }

  function render() {
    form = null;
    const run = selectedRun();
    if (run === null) {
      replaceChildren(container, [
        el('p', {
          class: 'placeholder',
          dataset: { testid: 'run-empty' },
          text: '左の一覧から実施回を選んでください。',
        }),
      ]);
      return;
    }

    const group = projectOf(run);
    const summary = summarizeRun(run);
    const editable = isRunEditable(run);
    // 開いていたフォームの対象が消えた場合（別の実施回へ移った場合など）は閉じる。
    if (
      local.operation !== null &&
      !run.tasks.some((task) => task.taskRecordId === local.operation.taskRecordId)
    ) {
      local.operation = null;
    }

    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('div', {}, [
          el('h2', {
            class: 'view__title',
            dataset: { testid: 'run-title' },
            text: `${group === null ? '' : group.projectId} ／ ${run.workDate}`,
          }),
          el('p', { class: 'note' }, [
            el('span', {
              class: `badge badge--${run.status}`,
              dataset: { testid: 'run-status' },
              text: RUN_STATUS_LABEL[run.status] ?? run.status,
            }),
            el('span', {
              dataset: { testid: 'run-quantity-label' },
              text: ` 今回数量 ${run.runQuantity}`,
            }),
            el('span', {
              dataset: { testid: 'run-template-version' },
              text: ` ／ テンプレート版${run.templateVersion}`,
            }),
          ]),
        ]),
        group !== null &&
          el('button', {
            type: 'button',
            class: 'button',
            text: '案件へ戻る',
            dataset: { testid: 'back-to-project' },
            on: { click: () => handlers.onSelectProject(group.projectGroupId) },
          }),
      ]),
      el('p', {
        class: 'note',
        text:
          'テンプレート改訂の影響を受けません。作業項目は実施回作成時の内容で固定されています。',
      }),
      !editable &&
        el('p', {
          class: 'note note--warn',
          dataset: { testid: 'run-not-editable' },
          text: describeNotEditable(run),
        }),
      renderWarnings(),
      el('div', { class: 'field-row field-row--baseline' }, [
        el('label', { class: 'field__label', for: 'run-sort', text: '並び順' }),
        el(
          'select',
          {
            id: 'run-sort',
            class: 'input input--auto',
            dataset: { testid: 'run-sort' },
            on: {
              change: (event) => {
                local.sort = event.target.value;
                render();
              },
            },
          },
          [
            el('option', {
              value: SORT.ORDER,
              text: '表示順',
              selected: local.sort === SORT.ORDER,
            }),
            el('option', {
              value: SORT.EXTERNAL_CODE,
              text: '外部項目コード順（自然順）',
              selected: local.sort === SORT.EXTERNAL_CODE,
            }),
          ],
        ),
      ]),
      run.tasks.length === 0
        ? el('p', {
            class: 'placeholder',
            dataset: { testid: 'task-list-empty' },
            text: '作業項目がありません。',
          })
        : el('table', { class: 'table', dataset: { testid: 'task-list' } }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { scope: 'col', text: '作業項目' }),
                el('th', { scope: 'col', text: '外部項目コード' }),
                el('th', { scope: 'col', text: '状態' }),
                el('th', { scope: 'col', class: 'table__num', text: '時刻入力分' }),
                el('th', { scope: 'col', class: 'table__num', text: '直接入力分' }),
                el('th', { scope: 'col', class: 'table__num', text: '転記値' }),
                el('th', { scope: 'col', text: '操作' }),
              ]),
            ]),
            el('tbody', {}, renderTaskBody(run, editable)),
          ]),
      el('p', {
        class: 'note',
        dataset: { testid: 'run-total' },
        text: summary.confirmed
          ? `合計 ${toMinutesLabel(summary.totalSeconds)} ／ 転記値合計 ${summary.transferMinutesSum}分`
          : `確定分合計 ${toMinutesLabel(summary.totalSeconds)} ／ 転記値は未確定（進行中${summary.openCount}件）`,
      }),
      el('p', {
        class: 'note',
        text: '直接入力は次の段階で実装します。',
      }),
    ]);
  }

  return { render, reset };
}
