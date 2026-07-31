/**
 * 案件詳細（仕様書8.2.4〜8.2.7、8.3、12.2）。
 *
 * 数量サマリ（総予定数・累計・残数）、総予定数の修正、実施回の一覧、実施回の
 * 追加を扱う。
 *
 * 累計と残数は保存しない導出値である（実装計画3.4）。総予定数や今回数量を
 * 修正すると、保存後のデータセットから再計算されて表示が更新される。
 *
 * 累計超過は警告であって拒否ではない（仕様書8.9.7）。確認を求めたうえで
 * `confirmedOverflow` を付けて呼び直す。
 */

import { previewQuantity, summarizeQuantity } from '../../domain/quantity.js';
import { generatableTasks } from '../../domain/templateInstantiate.js';
import { toDateKey } from '../../domain/datetime.js';
import {
  QuantityOverflowError,
  findActiveTemplate,
} from '../../app/actions/projectActions.js';
import { ValidationError } from '../../app/actions/templateActions.js';
import { el, field, replaceChildren } from '../dom.js';

/** 実施回の状態表示（仕様書7章）。 */
const RUN_STATUS_LABEL = {
  working: '作業中',
  aggregated: '集計済み',
  transferred: '転記済み',
  archived: 'アーカイブ',
};

/**
 * 案件詳細を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {createWorkRun: Function, updateTotalQuantity: Function,
 *                    updateRunQuantity: Function},
 *          handlers: {onSelectRun: Function},
 *          now?: () => Date}} options
 * @returns {{render: () => void, openRunForm: () => void, reset: () => void}}
 */
export function createProjectView({ container, store, actions, handlers, now }) {
  const currentDate = now ?? (() => new Date());

  const local = {
    /** @type {object|null} 実施回追加フォームの下書き。null で閉じている */
    runDraft: null,
    /** @type {string|null} 総予定数を編集中なら入力値 */
    totalQuantityDraft: null,
    /** @type {string|null} 今回数量を編集中の実施回 */
    editingRunId: null,
    /** @type {string|null} */
    runQuantityDraft: null,
    /** @type {string[]} */
    errors: [],
    /** @type {{warnings: string[], retry: () => Promise<void>}|null} */
    overflow: null,
    busy: false,
  };

  function reset() {
    local.runDraft = null;
    local.totalQuantityDraft = null;
    local.editingRunId = null;
    local.runQuantityDraft = null;
    local.errors = [];
    local.overflow = null;
    local.busy = false;
  }

  function selectedGroup() {
    const { dataset, selection = {} } = store.getState();
    return (
      dataset.projectGroups.find(
        (group) => group.projectGroupId === selection.projectGroupId,
      ) ?? null
    );
  }

  /** 当該案件の実施回。アーカイブ済みも含む（数量の累計に必要）。 */
  function runsOf(group) {
    return store
      .getState()
      .dataset.workRuns.filter((run) => run.projectGroupId === group.projectGroupId)
      .sort(
        (left, right) =>
          left.workDate.localeCompare(right.workDate) ||
          left.createdAt.localeCompare(right.createdAt),
      );
  }

  /** 案件の対象種別×バリエーションに対応する有効版テンプレート。 */
  function templateOf(group) {
    return findActiveTemplate(
      store.getState().dataset.taskTemplates,
      group.targetType,
      group.variant,
    );
  }

  /**
   * 保存処理の共通の受け皿。
   *
   * 累計超過（`QuantityOverflowError`）は確認を求める状態へ移し、利用者が
   * 押し直せるよう `retry` を保持する（仕様書8.9.7）。
   *
   * `operation` が true を返した場合は、別の画面へ移ったことを表す。この場合は
   * 再描画しない。移動先が描いた詳細ペインを、この画面で上書きしてしまう。
   *
   * @param {(options: {confirmedOverflow?: boolean}) => Promise<boolean|void>} operation
   */
  async function submit(operation) {
    if (local.busy) {
      return;
    }
    local.busy = true;
    local.errors = [];
    local.overflow = null;
    render();

    let navigated = false;
    try {
      navigated = (await operation({})) === true;
    } catch (error) {
      if (error instanceof QuantityOverflowError) {
        local.overflow = {
          warnings: error.warnings,
          retry: () => submit((options) => operation({ ...options, confirmedOverflow: true })),
        };
      } else if (error instanceof ValidationError) {
        local.errors = error.errors;
      } else {
        local.errors = [`保存: ${error?.message ?? String(error)}`];
      }
    }
    local.busy = false;

    if (!navigated) {
      render();
    }
  }

  function openRunForm() {
    const group = selectedGroup();
    const template = group === null ? null : templateOf(group);
    local.runDraft = {
      // 作業日の初期値は今日（実装計画2.2(2)）。
      workDate: toDateKey(currentDate()),
      runQuantity: '',
      // 生成対象は既定で全選択（仕様書8.3.1、8.3.2）。
      excluded: new Set(),
      generatable: template === null ? [] : generatableTasks(template),
    };
    local.errors = [];
    local.overflow = null;
  }

  async function handleCreateRun() {
    const group = selectedGroup();
    if (group === null || local.runDraft === null) {
      return;
    }
    const draft = local.runDraft;
    await submit(async ({ confirmedOverflow }) => {
      const { workRun } = await actions.createWorkRun(group.projectGroupId, {
        workDate: draft.workDate,
        runQuantity: Number.parseInt(draft.runQuantity, 10),
        excludedTaskDefinitionIds: [...draft.excluded],
        confirmedOverflow,
      });
      local.runDraft = null;
      // 作成した実施回を開く。画面が移るので再描画は任せる。
      handlers.onSelectRun(workRun.runId);
      return true;
    });
  }

  async function handleUpdateTotalQuantity() {
    const group = selectedGroup();
    if (group === null || local.totalQuantityDraft === null) {
      return;
    }
    const next = Number.parseInt(local.totalQuantityDraft, 10);
    await submit(async ({ confirmedOverflow }) => {
      await actions.updateTotalQuantity(group.projectGroupId, {
        totalQuantity: next,
        confirmedOverflow,
      });
      local.totalQuantityDraft = null;
    });
  }

  async function handleUpdateRunQuantity() {
    if (local.editingRunId === null || local.runQuantityDraft === null) {
      return;
    }
    const runId = local.editingRunId;
    const next = Number.parseInt(local.runQuantityDraft, 10);
    await submit(async ({ confirmedOverflow }) => {
      await actions.updateRunQuantity(runId, {
        runQuantity: next,
        confirmedOverflow,
      });
      local.editingRunId = null;
      local.runQuantityDraft = null;
    });
  }

  /**
   * 数量サマリ（仕様書8.2.5）。
   *
   * @param {object} group
   * @param {object[]} runs
   */
  function renderSummary(group, runs) {
    const summary = summarizeQuantity(group, runs);
    const editing = local.totalQuantityDraft !== null;

    return el('section', { class: 'card', dataset: { testid: 'quantity-summary' } }, [
      el('h3', { class: 'card__title', text: '数量' }),
      el('dl', { class: 'summary' }, [
        el('dt', { text: '総予定数' }),
        el('dd', { dataset: { testid: 'total-quantity-value' }, text: String(summary.totalQuantity) }),
        el('dt', { text: '累計' }),
        el('dd', { dataset: { testid: 'accumulated-value' }, text: String(summary.accumulated) }),
        el('dt', { text: '残数' }),
        el('dd', {
          class: summary.exceeded ? 'summary__warn' : '',
          dataset: { testid: 'remaining-value' },
          text: String(summary.remaining),
        }),
        el('dt', { text: '実施回' }),
        el('dd', { dataset: { testid: 'run-count' }, text: `${summary.runCount}件` }),
      ]),
      summary.exceeded &&
        el('p', {
          class: 'note note--warn',
          dataset: { testid: 'exceeded-note' },
          text: `累計が総予定数を ${-summary.remaining} 超えています。`,
        }),
      el('p', {
        class: 'note',
        text: '累計にはアーカイブ済みの実施回も含みます。',
      }),
      editing
        ? el('div', { class: 'field-row' }, [
            field({
              id: 'edit-total-quantity',
              label: '総予定数を修正',
              input: el('input', {
                type: 'number',
                class: 'input input--num',
                min: '1',
                step: '1',
                value: local.totalQuantityDraft,
                dataset: { testid: 'edit-total-quantity' },
                on: {
                  input: (event) => {
                    local.totalQuantityDraft = event.target.value;
                  },
                },
              }),
            }),
            el('div', { class: 'actions' }, [
              el('button', {
                type: 'button',
                class: 'button button--primary',
                text: '保存',
                dataset: { testid: 'save-total-quantity' },
                disabled: local.busy,
                on: { click: handleUpdateTotalQuantity },
              }),
              el('button', {
                type: 'button',
                class: 'button',
                text: 'キャンセル',
                dataset: { testid: 'cancel-total-quantity' },
                on: {
                  click: () => {
                    local.totalQuantityDraft = null;
                    local.overflow = null;
                    render();
                  },
                },
              }),
            ]),
          ])
        : el('div', { class: 'actions' }, [
            el('button', {
              type: 'button',
              class: 'button',
              text: '総予定数を修正',
              dataset: { testid: 'edit-total-quantity-toggle' },
              on: {
                click: () => {
                  local.totalQuantityDraft = String(group.totalQuantity);
                  render();
                },
              },
            }),
          ]),
    ]);
  }

  /**
   * 実施回一覧（仕様書8.2.4）。
   */
  function renderRunList(group, runs) {
    if (runs.length === 0) {
      return el('p', {
        class: 'placeholder',
        dataset: { testid: 'run-list-empty' },
        text: '実施回がありません。「実施回を追加」から作成してください。',
      });
    }

    return el('table', { class: 'table', dataset: { testid: 'run-list' } }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: '回' }),
          el('th', { scope: 'col', text: '作業日' }),
          el('th', { scope: 'col', class: 'table__num', text: '今回数量' }),
          el('th', { scope: 'col', class: 'table__num', text: '作業項目' }),
          el('th', { scope: 'col', text: '状態' }),
          el('th', { scope: 'col' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        runs.map((run, index) => {
          const editing = local.editingRunId === run.runId;
          return el('tr', { dataset: { testid: 'run-row', runId: run.runId } }, [
            el('td', { text: `第${index + 1}回` }),
            el('td', { dataset: { testid: 'run-date' }, text: run.workDate }),
            el('td', { class: 'table__num' }, [
              editing
                ? el('input', {
                    type: 'number',
                    class: 'input input--num',
                    min: '1',
                    step: '1',
                    value: local.runQuantityDraft,
                    'aria-label': '今回数量',
                    dataset: { testid: 'edit-run-quantity' },
                    on: {
                      input: (event) => {
                        local.runQuantityDraft = event.target.value;
                      },
                    },
                  })
                : el('span', {
                    dataset: { testid: 'run-quantity' },
                    text: String(run.runQuantity),
                  }),
            ]),
            el('td', { class: 'table__num', text: `${run.tasks.length}件` }),
            el('td', {}, [
              el('span', {
                class: `badge badge--${run.status}`,
                text: RUN_STATUS_LABEL[run.status] ?? run.status,
              }),
            ]),
            el('td', {}, [
              el('div', { class: 'actions actions--inline' }, [
                editing
                  ? [
                      el('button', {
                        type: 'button',
                        class: 'button button--primary',
                        text: '保存',
                        dataset: { testid: 'save-run-quantity' },
                        disabled: local.busy,
                        on: { click: handleUpdateRunQuantity },
                      }),
                      el('button', {
                        type: 'button',
                        class: 'button',
                        text: 'キャンセル',
                        dataset: { testid: 'cancel-run-quantity' },
                        on: {
                          click: () => {
                            local.editingRunId = null;
                            local.runQuantityDraft = null;
                            local.overflow = null;
                            render();
                          },
                        },
                      }),
                    ]
                  : [
                      el('button', {
                        type: 'button',
                        class: 'button',
                        text: '開く',
                        dataset: { testid: 'open-run' },
                        on: { click: () => handlers.onSelectRun(run.runId) },
                      }),
                      el('button', {
                        type: 'button',
                        class: 'button',
                        text: '数量を修正',
                        dataset: { testid: 'edit-run-quantity-toggle' },
                        on: {
                          click: () => {
                            local.editingRunId = run.runId;
                            local.runQuantityDraft = String(run.runQuantity);
                            render();
                          },
                        },
                      }),
                    ],
              ]),
            ]),
          ]);
        }),
      ),
    ]);
  }

  /**
   * 実施回追加フォーム（仕様書8.2.4、8.3.1、8.3.2）。
   */
  function renderRunForm(group, runs) {
    if (local.runDraft === null) {
      return el('div', { class: 'actions' }, [
        el('button', {
          type: 'button',
          class: 'button button--primary',
          text: '実施回を追加',
          dataset: { testid: 'add-run-toggle' },
          on: {
            click: () => {
              openRunForm();
              render();
            },
          },
        }),
      ]);
    }

    const draft = local.runDraft;
    const parsedQuantity = Number.parseInt(draft.runQuantity, 10);
    const preview = Number.isInteger(parsedQuantity)
      ? previewQuantity(group, runs, { runQuantity: parsedQuantity })
      : null;
    const selectedCount = draft.generatable.length - draft.excluded.size;

    return el('section', { class: 'card', dataset: { testid: 'run-form' } }, [
      el('h3', { class: 'card__title', text: '実施回を追加' }),
      el('div', { class: 'field-row' }, [
        field({
          id: 'work-date',
          label: '作業日',
          hint: '同じ日付に複数の実施回を作成できます。',
          input: el('input', {
            type: 'date',
            class: 'input',
            value: draft.workDate,
            dataset: { testid: 'work-date' },
            on: {
              input: (event) => {
                draft.workDate = event.target.value;
              },
            },
          }),
        }),
        field({
          id: 'run-quantity',
          label: '今回数量',
          input: el('input', {
            type: 'number',
            class: 'input input--num',
            min: '1',
            step: '1',
            value: draft.runQuantity,
            dataset: { testid: 'run-quantity-input' },
            on: {
              input: (event) => {
                draft.runQuantity = event.target.value;
                // 累計の見込みを出すため描き直す。
                render();
              },
            },
          }),
        }),
      ]),
      preview !== null &&
        el('p', {
          class: preview.exceeded ? 'note note--warn' : 'note',
          dataset: { testid: 'quantity-preview' },
          text: preview.exceeded
            ? `追加後の累計 ${preview.accumulated} は総予定数を ${preview.overBy} 超えます。`
            : `追加後の累計 ${preview.accumulated} ／ 残数 ${preview.remaining}`,
        }),
      draft.generatable.length === 0
        ? el('p', {
            class: 'note note--warn',
            dataset: { testid: 'no-generatable' },
            text:
              `${group.targetType} / ${group.variant} に有効な作業項目がありません。` +
              'テンプレート画面で登録してください。',
          })
        : el('fieldset', { class: 'fieldset', dataset: { testid: 'task-selection' } }, [
            el('legend', {
              text: `生成する作業項目（${selectedCount} / ${draft.generatable.length}件）`,
            }),
            el('p', {
              class: 'note',
              text: '無効化された作業項目は候補に出ません。不要な項目はここで外せます。',
            }),
            el(
              'ul',
              { class: 'checklist' },
              draft.generatable.map((definition) =>
                el('li', {}, [
                  el('label', { class: 'checklist__item' }, [
                    el('input', {
                      type: 'checkbox',
                      checked: !draft.excluded.has(definition.taskDefinitionId),
                      dataset: {
                        testid: 'task-include',
                        taskDefinitionId: definition.taskDefinitionId,
                      },
                      on: {
                        change: (event) => {
                          if (event.target.checked) {
                            draft.excluded.delete(definition.taskDefinitionId);
                          } else {
                            draft.excluded.add(definition.taskDefinitionId);
                          }
                          render();
                        },
                      },
                    }),
                    el('span', {
                      text: `${definition.name}${
                        definition.externalCode === null
                          ? '（外部コード未設定）'
                          : `（${definition.externalCode}）`
                      }`,
                    }),
                  ]),
                ]),
              ),
            ),
          ]),
      el('div', { class: 'actions' }, [
        el('button', {
          type: 'button',
          class: 'button button--primary',
          text: '作成',
          dataset: { testid: 'create-run' },
          disabled: local.busy || draft.generatable.length === 0,
          on: { click: handleCreateRun },
        }),
        el('button', {
          type: 'button',
          class: 'button',
          text: 'キャンセル',
          dataset: { testid: 'cancel-run' },
          on: {
            click: () => {
              local.runDraft = null;
              local.errors = [];
              local.overflow = null;
              render();
            },
          },
        }),
      ]),
    ]);
  }

  /**
   * 累計超過の確認（仕様書8.9.7）。
   *
   * 保存を止める表示ではない。確認して続行できることを明示する。
   */
  function renderOverflowConfirm() {
    if (local.overflow === null) {
      return null;
    }
    return el(
      'section',
      { class: 'card card--warn', role: 'alert', dataset: { testid: 'overflow-confirm' } },
      [
        el('h3', { class: 'card__title', text: '累計が総予定数を超えます' }),
        el(
          'ul',
          {},
          local.overflow.warnings.map((message) => el('li', { text: message })),
        ),
        el('div', { class: 'actions' }, [
          el('button', {
            type: 'button',
            class: 'button button--primary',
            text: '確認して続行',
            dataset: { testid: 'confirm-overflow' },
            disabled: local.busy,
            on: { click: () => local.overflow.retry() },
          }),
          el('button', {
            type: 'button',
            class: 'button',
            text: 'やめる',
            dataset: { testid: 'reject-overflow' },
            on: {
              click: () => {
                local.overflow = null;
                render();
              },
            },
          }),
        ]),
      ],
    );
  }

  function renderErrors() {
    if (local.errors.length === 0) {
      return null;
    }
    return el(
      'div',
      { class: 'errors', role: 'alert', dataset: { testid: 'project-errors' } },
      [
        el('p', { class: 'errors__title', text: '保存できません' }),
        el(
          'ul',
          {},
          local.errors.map((message) => el('li', { text: message })),
        ),
      ],
    );
  }

  function render() {
    const group = selectedGroup();
    if (group === null) {
      replaceChildren(container, [
        el('p', {
          class: 'placeholder',
          dataset: { testid: 'project-empty' },
          text: '左の一覧から案件を選んでください。',
        }),
      ]);
      return;
    }

    const runs = runsOf(group);

    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('div', {}, [
          el('h2', { class: 'view__title', dataset: { testid: 'project-title' }, text: group.projectId }),
          el('p', {
            class: 'note',
            dataset: { testid: 'project-subtitle' },
            text: `${group.targetType} / ${group.variant}`,
          }),
        ]),
      ]),
      renderErrors(),
      renderOverflowConfirm(),
      renderSummary(group, runs),
      el('section', { class: 'card' }, [
        el('h3', { class: 'card__title', text: '実施回' }),
        renderRunList(group, runs),
      ]),
      renderRunForm(group, runs),
    ]);
  }

  return { render, openRunForm, reset };
}
