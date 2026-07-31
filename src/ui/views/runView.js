/**
 * 実施回詳細（仕様書12.3）。
 *
 * 各作業項目について、名称・外部項目コード・現在状態・時刻入力分・直接入力分・
 * 転記値を一行で確認できるようにする。
 *
 * 実装計画 Step 5 の時点では閲覧のみである。区間の記録（開始・休憩・再開・終了、
 * 参加者変更）は Step 6、直接入力は Step 7 で追加する。工数の列は
 * `src/domain/effort.js` を通して計算しており、区間が入り次第そのまま数字が出る。
 */

import { summarizeRun, summarizeTask } from '../../domain/effort.js';
import { compareExternalCode } from '../../domain/naturalSort.js';
import { TASK_STATE, taskState } from '../../domain/taskState.js';
import { el, replaceChildren } from '../dom.js';

/** 作業項目の状態表示（仕様書7.2）。 */
const TASK_STATE_LABEL = {
  [TASK_STATE.NOT_STARTED]: '未着手',
  [TASK_STATE.WORKING]: '作業中',
  [TASK_STATE.ON_BREAK]: '休憩中',
  [TASK_STATE.DONE]: '完了',
};

/** 実施回の状態表示（仕様書7章）。 */
const RUN_STATUS_LABEL = {
  working: '作業中',
  aggregated: '集計済み',
  transferred: '転記済み',
  archived: 'アーカイブ',
};

/** 並び順の選択（仕様書8.7.3）。 */
const SORT = {
  ORDER: 'order',
  EXTERNAL_CODE: 'externalCode',
};

/**
 * 秒を「n分」表記へ直す。表示用であり、転記値の計算とは別である。
 *
 * @param {number} seconds
 * @returns {string}
 */
function toMinutesLabel(seconds) {
  if (seconds === 0) {
    return '0分';
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}分` : `${minutes}分${rest}秒`;
}

/**
 * 実施回詳細を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          handlers: {onSelectTask: Function, onSelectProject: Function}}} options
 * @returns {{render: () => void}}
 */
export function createRunView({ container, store, handlers }) {
  const local = { sort: SORT.ORDER };

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

  function renderTaskRow(task) {
    const state = taskState(task);
    const summary = summarizeTask(task);

    return el('tr', { dataset: { testid: 'task-row', taskRecordId: task.taskRecordId } }, [
      el('td', {}, [
        el('button', {
          type: 'button',
          class: 'link',
          text: task.name,
          dataset: { testid: 'task-name' },
          on: { click: () => handlers.onSelectTask(task.taskRecordId) },
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
    ]);
  }

  function render() {
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
              ]),
            ]),
            el('tbody', {}, sortTasks(run.tasks).map(renderTaskRow)),
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
        text: '時刻の記録と直接入力は次の段階で実装します。',
      }),
    ]);
  }

  return { render };
}
