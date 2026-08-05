/**
 * 案件・実施回・作業項目の3階層ツリー（仕様書12.1、12.2）。
 *
 *   案件ID
 *   └─ 実施回
 *      └─ 作業項目
 *
 * 作業項目ノードには現在状態を出す（仕様書7.2）。状態は保存せず区間から導出する
 * 派生値なので、`src/domain/taskState.js` を通して求める。
 *
 * アーカイブ済みの実施回は既定で表示しない（実装計画2.2(1)）。アーカイブ画面が
 * 扱う対象であり、通常一覧から分離するのがアーカイブの目的である（仕様書10.1）。
 * 数量の累計には含める（仕様書8.2.5）ため、非表示と集計対象は別物である。
 */

import { summarizeQuantity } from '../domain/quantity.js';
import { RUN_STATUS_LABEL } from '../domain/runStatus.js';
import { TASK_STATE, TASK_STATE_LABEL, taskState } from '../domain/taskState.js';
import { el, replaceChildren } from './dom.js';

/**
 * 作業項目の状態を表す記号（仕様書7.2）。
 *
 * 語そのものは `TASK_STATE_LABEL`（`domain/taskState.js`）を使う。ここが持つのは
 * ツリーでしか使わない記号だけである（レビュー指摘 D-16）。
 *
 * 記号は語の代わりではなく添え物である。`title` に語を入れてあり、記号だけで
 * 意味を取らせない。記号を支援技術へ伝える対応は Step 11（D-18 の (c)）。
 */
const TASK_STATE_MARK = {
  [TASK_STATE.NOT_STARTED]: '○',
  [TASK_STATE.WORKING]: '●',
  [TASK_STATE.ON_BREAK]: '◐',
  [TASK_STATE.DONE]: '✓',
};

/**
 * ツリーを作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          handlers: {onSelectProject: Function, onSelectRun: Function,
 *                     onSelectTask: Function, onCreateProject: Function}}} options
 * @returns {{render: () => void}}
 */
export function createTree({ container, store, handlers }) {
  /** 展開しているノードの識別子。既定はすべて折りたたむ。 */
  const expanded = new Set();

  function toggle(key) {
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
    }
    render();
  }

  /**
   * 折りたたみボタン。子を持たないノードでは場所だけ確保する。
   *
   * @param {string} key
   * @param {boolean} hasChildren
   */
  function renderToggle(key, hasChildren) {
    if (!hasChildren) {
      return el('span', { class: 'tree__toggle tree__toggle--empty', 'aria-hidden': 'true' });
    }
    const open = expanded.has(key);
    return el('button', {
      type: 'button',
      class: 'tree__toggle',
      text: open ? '▼' : '▶',
      'aria-expanded': String(open),
      'aria-label': open ? '折りたたむ' : '展開する',
      dataset: { testid: 'tree-toggle' },
      on: { click: () => toggle(key) },
    });
  }

  function renderTaskNode(run, task, selection) {
    const state = taskState(task);
    const current = selection.taskRecordId === task.taskRecordId;

    return el('li', { class: 'tree__item tree__item--task' }, [
      el('span', { class: 'tree__toggle tree__toggle--empty', 'aria-hidden': 'true' }),
      el('button', {
        type: 'button',
        class: `tree__label${current ? ' tree__label--selected' : ''}`,
        dataset: {
          testid: 'tree-task',
          taskRecordId: task.taskRecordId,
          state,
        },
        'aria-current': current ? 'true' : 'false',
        title: `${task.name}（${TASK_STATE_LABEL[state]}）`,
        on: { click: () => handlers.onSelectTask(run.runId, task.taskRecordId) },
      }, [
        el('span', { class: `tree__mark tree__mark--${state}`, text: TASK_STATE_MARK[state] }),
        el('span', { class: 'tree__text', text: task.name }),
      ]),
    ]);
  }

  function renderRunNode(run, index, selection) {
    const key = `run:${run.runId}`;
    const hasTasks = run.tasks.length > 0;
    const current = selection.runId === run.runId;

    return el('li', { class: 'tree__item' }, [
      el('div', { class: 'tree__row' }, [
        renderToggle(key, hasTasks),
        el('button', {
          type: 'button',
          class: `tree__label${current ? ' tree__label--selected' : ''}`,
          dataset: { testid: 'tree-run', runId: run.runId },
          'aria-current': current ? 'true' : 'false',
          on: { click: () => handlers.onSelectRun(run.runId) },
        }, [
          el('span', { class: 'tree__text', text: `第${index + 1}回 ${run.workDate}` }),
          el('span', {
            class: `badge badge--${run.status}`,
            text: RUN_STATUS_LABEL[run.status] ?? run.status,
          }),
        ]),
      ]),
      hasTasks &&
        expanded.has(key) &&
        el(
          'ul',
          { class: 'tree__children' },
          run.tasks.map((task) => renderTaskNode(run, task, selection)),
        ),
    ]);
  }

  function renderProjectNode(group, runs, selection) {
    const key = `group:${group.projectGroupId}`;
    // アーカイブ済みはツリーへ出さないが、数量の累計には含める（仕様書8.2.5）。
    const visibleRuns = runs.filter((run) => run.status !== 'archived');
    const summary = summarizeQuantity(group, runs);
    const current = selection.projectGroupId === group.projectGroupId;

    return el('li', { class: 'tree__item' }, [
      el('div', { class: 'tree__row' }, [
        renderToggle(key, visibleRuns.length > 0),
        el('button', {
          type: 'button',
          class: `tree__label${current ? ' tree__label--selected' : ''}`,
          dataset: { testid: 'tree-project', projectGroupId: group.projectGroupId },
          'aria-current': current ? 'true' : 'false',
          on: { click: () => handlers.onSelectProject(group.projectGroupId) },
        }, [
          el('span', { class: 'tree__text', text: group.projectId }),
          el('span', {
            class: summary.exceeded ? 'tree__meta tree__meta--warn' : 'tree__meta',
            dataset: { testid: 'tree-remaining' },
            text: `残${summary.remaining}`,
          }),
        ]),
      ]),
      visibleRuns.length > 0 &&
        expanded.has(key) &&
        el(
          'ul',
          { class: 'tree__children' },
          visibleRuns.map((run, index) => renderRunNode(run, index, selection)),
        ),
    ]);
  }

  function render() {
    const { dataset, selection = {} } = store.getState();
    const groups = [...dataset.projectGroups].sort((left, right) =>
      left.projectId.localeCompare(right.projectId, 'ja'),
    );

    // 実施回は作業日、次に作成日時の順に並べる。同日複数回（仕様書8.2.3）でも
    // 作成した順に「第n回」が付く。
    const runsByProject = new Map();
    for (const run of dataset.workRuns) {
      const list = runsByProject.get(run.projectGroupId) ?? [];
      list.push(run);
      runsByProject.set(run.projectGroupId, list);
    }
    for (const list of runsByProject.values()) {
      list.sort(
        (left, right) =>
          left.workDate.localeCompare(right.workDate) ||
          left.createdAt.localeCompare(right.createdAt),
      );
    }

    replaceChildren(container, [
      el('div', { class: 'tree__head' }, [
        el('h2', { class: 'tree__title', text: '案件・実施回' }),
        el('button', {
          type: 'button',
          class: 'button button--primary',
          text: '新規案件',
          dataset: { testid: 'new-project' },
          on: { click: () => handlers.onCreateProject() },
        }),
      ]),
      groups.length === 0
        ? el('p', {
            class: 'placeholder',
            dataset: { testid: 'tree-empty' },
            text: '案件がありません。「新規案件」から登録してください。',
          })
        : el(
            'ul',
            { class: 'tree', dataset: { testid: 'tree' } },
            groups.map((group) =>
              renderProjectNode(
                group,
                runsByProject.get(group.projectGroupId) ?? [],
                selection,
              ),
            ),
          ),
    ]);
  }

  /**
   * 指定した案件と実施回を展開する。
   *
   * 作成直後に自分が作ったものが見えるようにするため、画面側から呼ぶ。
   *
   * @param {{projectGroupId?: string, runId?: string}} target
   */
  function expand(target) {
    if (target.projectGroupId !== undefined && target.projectGroupId !== null) {
      expanded.add(`group:${target.projectGroupId}`);
    }
    if (target.runId !== undefined && target.runId !== null) {
      expanded.add(`run:${target.runId}`);
    }
  }

  return { render, expand };
}
