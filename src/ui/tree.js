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
 *
 * ## キーボード操作（仕様書13章、レビュー指摘 D-18）
 *
 * ARIA の tree パターンに従い、ノード間は矢印キーで移動する。Tab はツリー全体を
 * 1つの停留所として扱い（roving tabindex）、ツリー内の全ノードを Tab で辿らせ
 * ない。案件20件・実施回100件の規模では、Tab 移動だと詳細ペインへ抜けるまでに
 * 百回押すことになる。
 *
 * - ↑↓: 表示中のノード間を移動
 * - →: 折りたたまれていれば展開。展開済みなら最初の子へ
 * - ←: 展開されていれば折りたたむ。子ノードなら親へ
 * - Home / End: 先頭・末尾
 * - Enter / Space: 選択（button の既定動作）
 *
 * 展開・折りたたみは再描画を伴うため、直前に触っていたノードへフォーカスを
 * 戻す。戻さないと矢印キーを1回押すたびにフォーカスが body へ飛ぶ。マウスで
 * 折りたたみボタンを押した場合も同じ（レビュー指摘 S11-5）。
 *
 * 「現在地」は経路上の最深ノード1つだけに置く（{@link currentKeyOf}）。子ノードを
 * 束ねる `ul` は `aria-owns` で親 treeitem に結ぶ（{@link childrenId}）。
 */

import { summarizeQuantity } from '../domain/quantity.js';
import { activeRuns } from '../domain/runOrder.js';
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
 * 子ノードの入れ物（`role="group"`）に振る ID（レビュー指摘 S11-2）。
 *
 * treeitem は `button` なので、その内側へ子の `ul` を入れられない（対話要素の
 * 入れ子になる）。DOM では兄弟に置き、所有関係だけ `aria-owns` で示す。これが
 * 無いと、支援技術からは「どの group がどの treeitem の子か」が分からず、
 * 見た目が3階層でも階層として読まれない。
 *
 * @param {string} key ノードのキー（`group:...` / `run:...`）
 * @returns {string}
 */
function childrenId(key) {
  return `tree-children-${key.replace(/[^\w-]/g, '-')}`;
}

/**
 * いま選択している最深のノードのキーを求める（レビュー指摘 S11-3）。
 *
 * 選択は案件→実施回→作業項目と積み上がるため、各段が自分の ID だけを見て
 * 「現在地」を決めると、経路上の3つすべてに `aria-current` が立つ。そうなると
 * roving tabindex の停留所も最初に見つかった案件になり、警告領域から作業項目を
 * 開いた直後に Tab でツリーへ入ると、表示中の詳細と停留所が食い違う。
 *
 * 現在地は最深の1つだけとする。
 *
 * @param {{projectGroupId?: string|null, runId?: string|null,
 *          taskRecordId?: string|null}} selection
 * @returns {string|null}
 */
function currentKeyOf(selection) {
  if (selection.taskRecordId) {
    return `task:${selection.taskRecordId}`;
  }
  if (selection.runId) {
    return `run:${selection.runId}`;
  }
  if (selection.projectGroupId) {
    return `group:${selection.projectGroupId}`;
  }
  return null;
}

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

  /** 最後にフォーカスしていたノードのキー。roving tabindex の停留所になる。 */
  let focusedKey = null;

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
   * キーボードでは矢印キー（←→）が同じ役割を持つため、Tab の停留所にしない。
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
      tabindex: '-1',
      'aria-expanded': String(open),
      'aria-label': open ? '折りたたむ' : '展開する',
      dataset: { testid: 'tree-toggle' },
      on: {
        click: () => {
          // このボタンは `treeitem` の子ではなく兄弟なので、押しても `focusin` の
          // 経路に乗らず `focusedKey` が動かない。加えて `toggle()` の再描画で
          // ボタン自身が消えるため、そのままではフォーカスが body へ落ちて、
          // マウスで展開した直後に矢印キーへ移れない（レビュー指摘 S11-5）。
          const restore = container.contains(document.activeElement);
          focusedKey = key;
          toggle(key);
          if (restore) {
            focusItem(key);
          }
        },
      },
    });
  }

  /** ツリー内のノード（treeitem）を表示順で返す。 */
  function visibleItems() {
    return [...container.querySelectorAll('[role="treeitem"]')];
  }

  /**
   * キーで指したノードへフォーカスを移す。
   *
   * @param {string|null} key
   */
  function focusItem(key) {
    if (key === null) {
      return;
    }
    const item = container.querySelector(`[data-tree-key="${key}"]`);
    item?.focus();
  }

  /**
   * 矢印キーによるノード移動（仕様書13章、レビュー指摘 D-18）。
   *
   * 展開・折りたたみは `toggle()` が再描画するため、その後に同じノードへ
   * フォーカスを戻す。
   *
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    const target = event.target.closest?.('[role="treeitem"]');
    if (!target) {
      return;
    }
    const items = visibleItems();
    const index = items.indexOf(target);
    const key = target.dataset.treeKey;
    const expandable = target.getAttribute('aria-expanded') !== null;
    const open = target.getAttribute('aria-expanded') === 'true';

    if (event.key === 'ArrowDown') {
      items[index + 1]?.focus();
    } else if (event.key === 'ArrowUp') {
      items[index - 1]?.focus();
    } else if (event.key === 'Home') {
      items[0]?.focus();
    } else if (event.key === 'End') {
      items[items.length - 1]?.focus();
    } else if (event.key === 'ArrowRight') {
      if (expandable && !open) {
        toggle(key);
        focusItem(key);
      } else if (expandable && open) {
        // 展開済みなら最初の子へ。直後のノードが必ず子である（表示順のため）。
        items[index + 1]?.focus();
      }
    } else if (event.key === 'ArrowLeft') {
      if (expandable && open) {
        toggle(key);
        focusItem(key);
      } else {
        // 親ノードへ。li の入れ子を1段さかのぼる。
        const parent = target
          .closest('li')
          ?.parentElement?.closest('li')
          ?.querySelector('[role="treeitem"]');
        parent?.focus();
      }
    } else {
      return;
    }
    event.preventDefault();
  }

  /**
   * Tab の停留所を1つにする（roving tabindex）。
   *
   * 直前に触っていたノードがあればそこへ、無ければ先頭へ置く。
   */
  function applyRovingTabindex() {
    const items = visibleItems();
    if (items.length === 0) {
      return;
    }
    let anchor = focusedKey === null
      ? null
      : items.find((item) => item.dataset.treeKey === focusedKey) ?? null;
    anchor ??= items.find((item) => item.getAttribute('aria-current') === 'true') ?? items[0];
    for (const item of items) {
      item.tabIndex = item === anchor ? 0 : -1;
    }
  }

  container.addEventListener('keydown', handleKeydown);
  container.addEventListener('focusin', (event) => {
    const key = event.target.closest?.('[role="treeitem"]')?.dataset.treeKey;
    if (key !== undefined) {
      focusedKey = key;
      applyRovingTabindex();
    }
  });

  function renderTaskNode(run, task, currentKey) {
    const state = taskState(task);
    const key = `task:${task.taskRecordId}`;
    const current = key === currentKey;

    return el('li', { class: 'tree__item tree__item--task', role: 'none' }, [
      el('span', { class: 'tree__toggle tree__toggle--empty', 'aria-hidden': 'true' }),
      el('button', {
        type: 'button',
        class: `tree__label${current ? ' tree__label--selected' : ''}`,
        role: 'treeitem',
        tabindex: '-1',
        dataset: {
          testid: 'tree-task',
          taskRecordId: task.taskRecordId,
          treeKey: key,
          state,
        },
        'aria-current': current ? 'true' : 'false',
        // 状態記号（●/○/◐/✓）は支援技術へ渡らないため、語を名前に含める
        // （レビュー指摘 D-18）。
        'aria-label': `${task.name}（${TASK_STATE_LABEL[state]}）`,
        title: `${task.name}（${TASK_STATE_LABEL[state]}）`,
        on: { click: () => handlers.onSelectTask(run.runId, task.taskRecordId) },
      }, [
        el('span', {
          class: `tree__mark tree__mark--${state}`,
          'aria-hidden': 'true',
          text: TASK_STATE_MARK[state],
        }),
        el('span', { class: 'tree__text', text: task.name }),
      ]),
    ]);
  }

  function renderRunNode(run, number, currentKey) {
    const key = `run:${run.runId}`;
    const hasTasks = run.tasks.length > 0;
    const open = hasTasks && expanded.has(key);
    const current = key === currentKey;

    return el('li', { class: 'tree__item', role: 'none' }, [
      el('div', { class: 'tree__row' }, [
        renderToggle(key, hasTasks),
        el('button', {
          type: 'button',
          class: `tree__label${current ? ' tree__label--selected' : ''}`,
          role: 'treeitem',
          tabindex: '-1',
          dataset: { testid: 'tree-run', runId: run.runId, treeKey: key },
          'aria-current': current ? 'true' : 'false',
          'aria-expanded': hasTasks ? String(expanded.has(key)) : undefined,
          // 畳んでいるあいだ `ul` は存在しないため、参照先の無い ID を指さない。
          'aria-owns': open ? childrenId(key) : undefined,
          on: { click: () => handlers.onSelectRun(run.runId) },
        }, [
          el('span', { class: 'tree__text', text: `第${number}回 ${run.workDate}` }),
          el('span', {
            class: `badge badge--${run.status}`,
            text: RUN_STATUS_LABEL[run.status] ?? run.status,
          }),
        ]),
      ]),
      open &&
        el(
          'ul',
          { class: 'tree__children', role: 'group', id: childrenId(key) },
          run.tasks.map((task) => renderTaskNode(run, task, currentKey)),
        ),
    ]);
  }

  function renderProjectNode(group, runs, currentKey) {
    const key = `group:${group.projectGroupId}`;
    // アーカイブ済みはツリーへ出さないが、数量の累計には含める（仕様書8.2.5）。
    // 番号は全件を通して振ってから絞る。表示中だけで数えると、第1回をアーカイブ
    // した瞬間に第2回が繰り上がる（レビュー指摘 D-14）。
    const visible = activeRuns(runs);
    const summary = summarizeQuantity(group, runs);
    const open = visible.length > 0 && expanded.has(key);
    const current = key === currentKey;

    return el('li', { class: 'tree__item', role: 'none' }, [
      el('div', { class: 'tree__row' }, [
        renderToggle(key, visible.length > 0),
        el('button', {
          type: 'button',
          class: `tree__label${current ? ' tree__label--selected' : ''}`,
          role: 'treeitem',
          tabindex: '-1',
          dataset: {
            testid: 'tree-project',
            projectGroupId: group.projectGroupId,
            treeKey: key,
          },
          'aria-current': current ? 'true' : 'false',
          'aria-expanded': visible.length > 0 ? String(expanded.has(key)) : undefined,
          'aria-owns': open ? childrenId(key) : undefined,
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
      open &&
        el(
          'ul',
          { class: 'tree__children', role: 'group', id: childrenId(key) },
          visible.map(({ run, number }) => renderRunNode(run, number, currentKey)),
        ),
    ]);
  }

  function render() {
    const { dataset, selection = {} } = store.getState();
    const currentKey = currentKeyOf(selection);
    const groups = [...dataset.projectGroups].sort((left, right) =>
      left.projectId.localeCompare(right.projectId, 'ja'),
    );

    // 案件ごとに束ねるだけにする。並べ替えと採番は `runOrder.js` が持つ
    // （レビュー指摘 D-14）。
    const runsByProject = new Map();
    for (const run of dataset.workRuns) {
      const list = runsByProject.get(run.projectGroupId) ?? [];
      list.push(run);
      runsByProject.set(run.projectGroupId, list);
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
            { class: 'tree', role: 'tree', 'aria-label': '案件・実施回・作業項目', dataset: { testid: 'tree' } },
            groups.map((group) =>
              renderProjectNode(
                group,
                runsByProject.get(group.projectGroupId) ?? [],
                currentKey,
              ),
            ),
          ),
    ]);

    applyRovingTabindex();
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
