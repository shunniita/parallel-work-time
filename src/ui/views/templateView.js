/**
 * 作業テンプレート画面（仕様書8.1、12.2）。
 *
 * 有効版の一覧、選択したテンプレートの編集、改訂、新規登録、複製、アーカイブと
 * その復元、削除を扱う（仕様書8.1）。旧版の閲覧・比較画面は設けない（仕様書6.3、12.2）。
 *
 * 描画の方針。入力欄への打ち込みでは再描画しない。下書きオブジェクトを直接
 * 書き換えるだけにして、フォーカスとカーソル位置を保つ。再描画は行の追加・削除、
 * 選択の切り替え、保存の完了といった構造が変わる操作に限る。
 */

import {
  activeTemplates,
  archivedTemplates,
  nextOrder,
  sortTaskDefinitions,
} from '../../domain/templateOps.js';
import { toCopyDraft, toDraft } from '../../app/actions/templateActions.js';
import { toErrorMessages } from '../../app/errors.js';
import { createConfirmPanel } from '../components/confirmPanel.js';
import { el, field, replaceChildren } from '../dom.js';
import { toOptionalIntegerInput } from '../numeric.js';
import { MAX_TEXT_LENGTH } from '../../config.js';

/**
 * テンプレート画面を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {createTemplate: Function, reviseTemplate: Function}}} options
 * @returns {{render: () => void}}
 */
export function createTemplateView({ container, store, actions, isActive = () => true }) {
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
    /** 削除の確認中である系列。確認パネルは対象の近くへ差し込む。 */
    /** @type {string|null} */
    pendingDeleteSeriesId: null,
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

  /** アーカイブ済みの系列（系列ごとに最新版1件）。 */
  function archived() {
    return archivedTemplates(store.getState().dataset.taskTemplates);
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
      local.errors = toErrorMessages(error);
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
   * 複製して新規登録を始める（仕様書8.1.7）。
   *
   * 登録はせず、新規登録フォームを複製元の内容で開くだけにする。対象種別か
   * バリエーションを変えないと有効版が重複して保存できないため、どこを変えるかを
   * 利用者に決めさせる。
   */
  function startCopy(template) {
    local.creating = true;
    local.newDraft = toCopyDraft(template);
    local.errors = [];
    local.pendingDeleteSeriesId = null;
    render();
  }

  async function handleArchive(templateId) {
    await submit(async () => {
      await actions.archiveTemplate(templateId);
      // アーカイブすると一覧から消える。編集中だった場合は選択を外す。
      if (local.selectedTemplateId === templateId) {
        local.selectedTemplateId = null;
        local.draft = null;
      }
    });
  }

  async function handleRestore(templateSeriesId) {
    await submit(async () => {
      await actions.restoreTemplate(templateSeriesId);
    });
  }

  async function handleDelete(templateSeriesId) {
    await submit(async () => {
      await actions.deleteTemplate(templateSeriesId);
      local.pendingDeleteSeriesId = null;
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
                el('button', {
                  type: 'button',
                  class: 'button',
                  text: '複製',
                  dataset: { testid: 'copy-template' },
                  disabled: local.busy,
                  on: { click: () => startCopy(template) },
                }),
                el('button', {
                  type: 'button',
                  class: 'button',
                  text: 'アーカイブ',
                  dataset: { testid: 'archive-template' },
                  disabled: local.busy,
                  on: { click: () => handleArchive(template.templateId) },
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
                maxlength: MAX_TEXT_LENGTH,
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
                maxlength: MAX_TEXT_LENGTH,
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
                    // 空欄は未設定、`1.5` のような非整数は NaN のまま渡して
                    // 検証（`validateTaskTemplate`）に捕まえさせる。
                    task.order = toOptionalIntegerInput(event.target.value);
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
      el('div', { class: 'field-row' }, [
        field({
          id: 'editor-target-type',
          label: '対象種別',
          input: el('input', {
            type: 'text',
            class: 'input',
            value: local.draft.targetType,
            maxlength: MAX_TEXT_LENGTH,
            dataset: { testid: 'editor-target-type' },
            on: {
              input: (event) => {
                local.draft.targetType = event.target.value;
              },
            },
          }),
        }),
        field({
          id: 'editor-variant',
          label: 'バリエーション',
          input: el('input', {
            type: 'text',
            class: 'input',
            value: local.draft.variant,
            maxlength: MAX_TEXT_LENGTH,
            dataset: { testid: 'editor-variant' },
            on: {
              input: (event) => {
                local.draft.variant = event.target.value;
              },
            },
          }),
        }),
      ]),
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
            maxlength: MAX_TEXT_LENGTH,
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
            maxlength: MAX_TEXT_LENGTH,
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

  /**
   * アーカイブ済みテンプレートの一覧を描く（仕様書8.1.9、8.1.10、8.1.11）。
   *
   * 系列ごとに最新版だけを出す。戻す操作も削除も系列単位であり、版を選ばせる
   * 意味がない。1件も無ければ節ごと出さない。
   */
  function renderArchived() {
    const list = archived();
    if (list.length === 0) {
      return null;
    }

    return el('section', { class: 'card', dataset: { testid: 'archived-templates' } }, [
      el('h3', { class: 'card__title', text: 'アーカイブ済み' }),
      el('p', {
        class: 'note',
        text:
          'アーカイブしたテンプレートは一覧と実施回の作成候補から外れます。' +
          '記録は残るため、いつでも戻せます。',
      }),
      el('table', { class: 'table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: '対象種別' }),
            el('th', { scope: 'col', text: 'バリエーション' }),
            el('th', { scope: 'col', class: 'table__num', text: '版' }),
            el('th', { scope: 'col' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          list.map((template) =>
            el(
              'tr',
              {
                dataset: {
                  testid: 'archived-row',
                  templateSeriesId: template.templateSeriesId,
                },
              },
              [
                el('td', { text: template.targetType }),
                el('td', { text: template.variant }),
                el('td', { class: 'table__num', text: `版${template.version}` }),
                el('td', {}, [
                  el('button', {
                    type: 'button',
                    class: 'button',
                    text: '戻す',
                    dataset: { testid: 'restore-template' },
                    disabled: local.busy,
                    on: { click: () => handleRestore(template.templateSeriesId) },
                  }),
                  el('button', {
                    type: 'button',
                    class: 'button',
                    text: '削除',
                    dataset: { testid: 'delete-template' },
                    disabled: local.busy,
                    on: {
                      click: () => {
                        local.pendingDeleteSeriesId = template.templateSeriesId;
                        local.errors = [];
                        render();
                      },
                    },
                  }),
                ]),
              ],
            ),
          ),
        ),
      ]),
      renderDeleteConfirm(list),
    ]);
  }

  /**
   * 削除の確認を描く。
   *
   * 削除は取り消せないうえ、系列の全版をまとめて消す。実施回から参照されている
   * 場合はアクションが拒むが、その手前で対象を言葉にして見せる。
   */
  function renderDeleteConfirm(list) {
    if (local.pendingDeleteSeriesId === null) {
      return null;
    }
    const target = list.find(
      (template) => template.templateSeriesId === local.pendingDeleteSeriesId,
    );
    if (target === undefined) {
      return null;
    }

    const { element } = createConfirmPanel({
      title: 'テンプレートを削除する',
      description:
        `${target.targetType} / ${target.variant} を版${target.version}まで全て削除します。` +
        'この操作は取り消せません。',
      note:
        '実施回から参照されているテンプレートは削除できません。' +
        'その場合はアーカイブのままにしてください。',
      confirmLabel: '削除する',
      testidPrefix: 'delete-template-confirm',
      busy: local.busy,
      onConfirm: () => handleDelete(target.templateSeriesId),
      onCancel: () => {
        local.pendingDeleteSeriesId = null;
        render();
      },
    });
    return element;
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
    // 非同期処理の完了後に呼ばれることがある。その間に利用者が別画面へ移って
    // いれば、共有している詳細ペインを奪い返してはいけない（過去のレビュー指摘）。
    if (!isActive()) {
      return;
    }
    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('h2', { class: 'view__title', text: '作業テンプレート' }),
        renderCreateToggle(),
      ]),
      renderErrors(),
      renderCreateForm(),
      renderList(),
      renderEditor(),
      renderArchived(),
    ]);
  }

  return { render };
}
