/**
 * 作業テンプレート画面（仕様書8.1、12.2）。
 *
 * 有効版の一覧、選択したテンプレートの作業項目編集、改訂、新規登録を扱う。
 * 旧版の閲覧・比較画面は設けない（仕様書6.3、12.2）。
 *
 * 描画の方針。入力欄への打ち込みでは再描画しない。下書きオブジェクトを直接
 * 書き換えるだけにして、フォーカスとカーソル位置を保つ。再描画は行の追加・削除、
 * 選択の切り替え、保存の完了といった構造が変わる操作に限る。
 */

import {
  activeTemplates,
  nextOrder,
  sortTaskDefinitions,
} from '../../domain/templateOps.js';
import { ValidationError, toDraft } from '../../app/actions/templateActions.js';
import { el, field, replaceChildren } from '../dom.js';

/**
 * テンプレート画面を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {createTemplate: Function, reviseTemplate: Function}}} options
 * @returns {{render: () => void}}
 */
export function createTemplateView({ container, store, actions }) {
  /**
   * 画面が持つ編集状態。
   *
   * 保存済みのテンプレートは書き換えず、常に複製（下書き）を編集する。保存に
   * 失敗しても画面と保存内容が食い違わないようにするため。
   */
  const local = {
    /** @type {string|null} */
    selectedTemplateId: null,
    /** @type {object|null} */
    draft: null,
    /** @type {string[]} */
    errors: [],
    creating: false,
    /** @type {object} */
    newDraft: emptyDraft(),
    busy: false,
  };

  function emptyDraft() {
    return {
      targetType: '',
      variant: '',
      tasks: [{ name: '', externalCode: '', order: 1, active: true }],
    };
  }

  /** 現在のデータセットにある有効版テンプレート。 */
  function templates() {
    return activeTemplates(store.getState().dataset.taskTemplates);
  }

  /** 選択中のテンプレート。選択が失われていれば null。 */
  function selected() {
    return (
      templates().find((template) => template.templateId === local.selectedTemplateId) ?? null
    );
  }

  function selectTemplate(templateId) {
    const template = templates().find((candidate) => candidate.templateId === templateId);
    local.selectedTemplateId = templateId;
    local.draft = template === null || template === undefined ? null : toDraft(template);
    local.errors = [];
    render();
  }

  /**
   * 保存を実行する共通処理。
   *
   * 検証エラーは画面へ出して入力内容を残す。保存領域の失敗はフッターの保存状態
   * 表示が受け持つため（仕様書9.1）、ここでは再送できる状態へ戻すだけにする。
   *
   * @param {() => Promise<void>} operation
   */
  async function submit(operation) {
    if (local.busy) {
      return;
    }
    local.busy = true;
    local.errors = [];
    render();
    try {
      await operation();
    } catch (error) {
      local.errors =
        error instanceof ValidationError
          ? error.errors
          : [`保存: ${error?.message ?? String(error)}`];
    } finally {
      local.busy = false;
      render();
    }
  }

  async function handleCreate() {
    await submit(async () => {
      const { template } = await actions.createTemplate(local.newDraft);
      local.creating = false;
      local.newDraft = emptyDraft();
      local.selectedTemplateId = template.templateId;
      local.draft = toDraft(template);
    });
  }

  async function handleRevise() {
    const current = selected();
    if (current === null) {
      return;
    }
    await submit(async () => {
      const { template } = await actions.reviseTemplate(current.templateId, local.draft);
      // 改訂すると templateId が変わる。新しい版を選択し直す（仕様書6.3）。
      local.selectedTemplateId = template.templateId;
      local.draft = toDraft(template);
    });
  }

  /**
   * 有効版テンプレートの一覧を描く。
   */
  function renderList() {
    const list = templates();
    if (list.length === 0) {
      return el('p', { class: 'placeholder', text: '登録されたテンプレートはありません。' });
    }

    return el('table', { class: 'table', dataset: { testid: 'template-list' } }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: '対象種別' }),
          el('th', { scope: 'col', text: 'バリエーション' }),
          el('th', { scope: 'col', class: 'table__num', text: '版' }),
          el('th', { scope: 'col', class: 'table__num', text: '作業項目' }),
          el('th', { scope: 'col' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        list.map((template) => {
          const current = template.templateId === local.selectedTemplateId;
          return el(
            'tr',
            {
              class: current ? 'table__row--selected' : '',
              dataset: { testid: 'template-row', templateId: template.templateId },
            },
            [
              el('td', { text: template.targetType }),
              el('td', { text: template.variant }),
              el('td', { class: 'table__num', text: `版${template.version}` }),
              el('td', { class: 'table__num', text: `${template.tasks.length}件` }),
              el('td', {}, [
                el('button', {
                  type: 'button',
                  class: 'button',
                  text: current ? '編集中' : '編集',
                  dataset: { testid: 'select-template' },
                  disabled: current,
                  on: { click: () => selectTemplate(template.templateId) },
                }),
              ]),
            ],
          );
        }),
      ),
    ]);
  }

  /**
   * 作業項目の編集表を描く（仕様書8.1.2）。
   *
   * @param {object} draft
   * @param {string} testidPrefix
   */
  function renderTaskTable(draft, testidPrefix) {
    return el('table', { class: 'table', dataset: { testid: `${testidPrefix}-tasks` } }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: '名称' }),
          el('th', { scope: 'col', text: '外部項目コード' }),
          el('th', { scope: 'col', class: 'table__num', text: '表示順' }),
          el('th', { scope: 'col', class: 'table__num', text: '有効' }),
          el('th', { scope: 'col' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        draft.tasks.map((task, index) =>
          el('tr', { dataset: { testid: 'task-row', index } }, [
            el('td', {}, [
              el('input', {
                type: 'text',
                class: 'input',
                value: task.name ?? '',
                'aria-label': `作業項目${index + 1}の名称`,
                dataset: { testid: 'task-name' },
                on: {
                  input: (event) => {
                    task.name = event.target.value;
                  },
                },
              }),
            ]),
            el('td', {}, [
              el('input', {
                type: 'text',
                class: 'input',
                value: task.externalCode ?? '',
                'aria-label': `作業項目${index + 1}の外部項目コード`,
                dataset: { testid: 'task-code' },
                on: {
                  input: (event) => {
                    task.externalCode = event.target.value;
                  },
                },
              }),
            ]),
            el('td', { class: 'table__num' }, [
              el('input', {
                type: 'number',
                class: 'input input--num',
                min: '1',
                step: '1',
                value: String(task.order ?? index + 1),
                'aria-label': `作業項目${index + 1}の表示順`,
                dataset: { testid: 'task-order' },
                on: {
                  input: (event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    task.order = Number.isNaN(parsed) ? undefined : parsed;
                  },
                },
              }),
            ]),
            el('td', { class: 'table__num' }, [
              el('input', {
                type: 'checkbox',
                'aria-label': `作業項目${index + 1}の有効状態`,
                dataset: { testid: 'task-active' },
                checked: task.active !== false,
                on: {
                  change: (event) => {
                    task.active = event.target.checked;
                  },
                },
              }),
            ]),
            el('td', {}, [
              el('button', {
                type: 'button',
                class: 'button',
                text: '行を削除',
                dataset: { testid: 'remove-task' },
                // 0件では登録できないため、最後の1行は消させない。
                disabled: draft.tasks.length <= 1,
                on: {
                  click: () => {
                    draft.tasks.splice(index, 1);
                    render();
                  },
                },
              }),
            ]),
          ]),
        ),
      ),
    ]);
  }

  function renderAddTaskButton(draft) {
    return el('button', {
      type: 'button',
      class: 'button',
      text: '作業項目を追加',
      dataset: { testid: 'add-task' },
      on: {
        click: () => {
          draft.tasks.push({
            name: '',
            externalCode: '',
            order: nextOrder(draft.tasks),
            active: true,
          });
          render();
        },
      },
    });
  }

  /**
   * 選択中テンプレートの編集領域を描く。
   */
  function renderEditor() {
    const current = selected();
    if (current === null || local.draft === null) {
      return el('p', {
        class: 'placeholder',
        dataset: { testid: 'editor-empty' },
        text: '一覧から編集するテンプレートを選んでください。',
      });
    }

    // 表示は保存済みの並び順で見せる。表示順の入力値は保存時に1から振り直す。
    const orderedPreview = sortTaskDefinitions(local.draft.tasks)
      .map((task) => task.name || '（名称未入力）')
      .join(' → ');

    return el('section', { class: 'card', dataset: { testid: 'template-editor' } }, [
      el('h3', {
        class: 'card__title',
        dataset: { testid: 'editor-heading' },
        text: `${current.targetType} / ${current.variant} 版${current.version}`,
      }),
      el('p', {
        class: 'note',
        text:
          '改訂すると版番号が繰り上がり、旧版のレコードは保持されます。' +
          '既存の実施回は作業項目定義を複製済みのため、改訂の影響を受けません。',
      }),
      renderTaskTable(local.draft, 'editor'),
      el('p', {
        class: 'note',
        dataset: { testid: 'order-preview' },
        text: `保存後の並び: ${orderedPreview}`,
      }),
      el('div', { class: 'actions' }, [
        renderAddTaskButton(local.draft),
        el('button', {
          type: 'button',
          class: 'button button--primary',
          text: '改訂して保存',
          dataset: { testid: 'revise' },
          disabled: local.busy,
          on: { click: handleRevise },
        }),
        el('button', {
          type: 'button',
          class: 'button',
          text: '編集を破棄',
          dataset: { testid: 'discard' },
          disabled: local.busy,
          on: { click: () => selectTemplate(current.templateId) },
        }),
      ]),
    ]);
  }

  /**
   * 見出し行に置く新規登録の開始ボタン。
   *
   * フォーム本体は見出し行の外へ出す。見出しと横並びにすると幅が半分になり、
   * 作業項目の表が読みにくくなる。
   */
  function renderCreateToggle() {
    if (local.creating) {
      return null;
    }
    return el('button', {
      type: 'button',
      class: 'button button--primary',
      text: '新規テンプレート',
      dataset: { testid: 'new-template-toggle' },
      on: {
        click: () => {
          local.creating = true;
          local.errors = [];
          render();
        },
      },
    });
  }

  /**
   * 新規登録フォームを描く（仕様書8.1.1）。
   */
  function renderCreateForm() {
    if (!local.creating) {
      return null;
    }

    return el('section', { class: 'card', dataset: { testid: 'new-template-form' } }, [
      el('h3', { class: 'card__title', text: '新規テンプレート' }),
      el('div', { class: 'field-row' }, [
        field({
          id: 'new-target-type',
          label: '対象種別',
          input: el('input', {
            type: 'text',
            class: 'input',
            value: local.newDraft.targetType,
            dataset: { testid: 'new-target-type' },
            on: {
              input: (event) => {
                local.newDraft.targetType = event.target.value;
              },
            },
          }),
        }),
        field({
          id: 'new-variant',
          label: 'バリエーション',
          input: el('input', {
            type: 'text',
            class: 'input',
            value: local.newDraft.variant,
            dataset: { testid: 'new-variant' },
            on: {
              input: (event) => {
                local.newDraft.variant = event.target.value;
              },
            },
          }),
        }),
      ]),
      renderTaskTable(local.newDraft, 'new'),
      el('div', { class: 'actions' }, [
        renderAddTaskButton(local.newDraft),
        el('button', {
          type: 'button',
          class: 'button button--primary',
          text: '登録',
          dataset: { testid: 'create' },
          disabled: local.busy,
          on: { click: handleCreate },
        }),
        el('button', {
          type: 'button',
          class: 'button',
          text: 'キャンセル',
          dataset: { testid: 'cancel-create' },
          disabled: local.busy,
          on: {
            click: () => {
              local.creating = false;
              local.newDraft = emptyDraft();
              local.errors = [];
              render();
            },
          },
        }),
      ]),
    ]);
  }

  function renderErrors() {
    if (local.errors.length === 0) {
      return null;
    }
    return el(
      'div',
      { class: 'errors', role: 'alert', dataset: { testid: 'template-errors' } },
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
    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('h2', { class: 'view__title', text: '作業テンプレート' }),
        renderCreateToggle(),
      ]),
      renderErrors(),
      renderCreateForm(),
      renderList(),
      renderEditor(),
    ]);
  }

  return { render };
}
