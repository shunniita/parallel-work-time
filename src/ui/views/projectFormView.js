/**
 * 案件登録フォーム（仕様書8.2.1、8.2.6、12.2）。
 *
 * 案件IDは一意である。既存の案件IDが入力された場合は登録を禁止し、何が登録
 * 済みかを示したうえで、その案件へ実施回を追加する導線を出す。仕様書8.2.6 の
 * 「その内容を示して登録を禁止する」を、単なるエラー文ではなく操作の続きが
 * ある形で満たす。
 *
 * 既存案件の対象種別・バリエーションは上書きしない。実施回は作成時に
 * テンプレートから作業項目を複製しており、後から案件の対象種別が変わると
 * 過去の実施回と食い違うためである。
 */

import { summarizeQuantity } from '../../domain/quantity.js';
import { activeTemplates } from '../../domain/templateOps.js';
import { ProjectIdConflictError } from '../../app/actions/projectActions.js';
import { ValidationError } from '../../app/actions/templateActions.js';
import { el, field, replaceChildren } from '../dom.js';

/**
 * 案件登録フォームを作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {createProjectGroup: Function},
 *          handlers: {onCreated: Function, onOpenExisting: Function, onCancel: Function}}} options
 * @returns {{render: () => void, reset: () => void}}
 */
export function createProjectFormView({ container, store, actions, handlers }) {
  const local = {
    draft: emptyDraft(),
    /** @type {string[]} */
    errors: [],
    /** @type {object|null} 既存案件と衝突したときの相手 */
    conflict: null,
    busy: false,
  };

  function emptyDraft() {
    return { projectId: '', targetType: '', variant: '', totalQuantity: '' };
  }

  function reset() {
    local.draft = emptyDraft();
    local.errors = [];
    local.conflict = null;
    local.busy = false;
  }

  /** テンプレートから選べる対象種別（重複を除く）。 */
  function targetTypeOptions() {
    const templates = activeTemplates(store.getState().dataset.taskTemplates);
    return [...new Set(templates.map((template) => template.targetType))];
  }

  /** 選択中の対象種別に紐づくバリエーション（仕様書8.2.1）。 */
  function variantOptions() {
    const templates = activeTemplates(store.getState().dataset.taskTemplates);
    return templates
      .filter((template) => template.targetType === local.draft.targetType)
      .map((template) => template.variant);
  }

  async function handleSubmit() {
    if (local.busy) {
      return;
    }
    local.busy = true;
    local.errors = [];
    local.conflict = null;
    render();

    /** @type {object|null} */
    let created = null;
    try {
      const result = await actions.createProjectGroup({
        projectId: local.draft.projectId,
        targetType: local.draft.targetType,
        variant: local.draft.variant,
        // 画面の値は文字列なので、ここで数値へ変換する。変換できない入力は
        // NaN になり、検証（仕様書8.9.2）が捕まえる。
        totalQuantity: Number.parseInt(local.draft.totalQuantity, 10),
      });
      created = result.projectGroup;
    } catch (error) {
      if (error instanceof ProjectIdConflictError) {
        local.errors = error.errors;
        local.conflict = error.conflict;
      } else if (error instanceof ValidationError) {
        local.errors = error.errors;
      } else {
        local.errors = [`保存: ${error?.message ?? String(error)}`];
      }
    }
    local.busy = false;

    if (created !== null) {
      // 成功したら案件詳細へ移る。ここで再描画してはいけない。移動先が描いた
      // 詳細ペインを、このフォームで上書きしてしまう。
      reset();
      handlers.onCreated(created);
      return;
    }
    render();
  }

  /**
   * 案件IDが衝突したときの案内（仕様書8.2.6）。
   *
   * 既存案件の対象種別・バリエーションと数量の状況を示し、その案件へ実施回を
   * 追加する導線を出す。
   */
  function renderConflict() {
    if (local.conflict === null) {
      return null;
    }
    const { dataset } = store.getState();
    const runs = dataset.workRuns.filter(
      (run) => run.projectGroupId === local.conflict.projectGroupId,
    );
    const summary = summarizeQuantity(local.conflict, runs);

    return el('section', { class: 'card card--info', dataset: { testid: 'project-conflict' } }, [
      el('h3', { class: 'card__title', text: `登録済みの案件: ${local.conflict.projectId}` }),
      el('dl', { class: 'summary' }, [
        el('dt', { text: '対象種別' }),
        el('dd', { dataset: { testid: 'conflict-target-type' }, text: local.conflict.targetType }),
        el('dt', { text: 'バリエーション' }),
        el('dd', { dataset: { testid: 'conflict-variant' }, text: local.conflict.variant }),
        el('dt', { text: '総予定数' }),
        el('dd', { text: String(summary.totalQuantity) }),
        el('dt', { text: '累計' }),
        el('dd', { text: String(summary.accumulated) }),
        el('dt', { text: '残数' }),
        el('dd', { text: String(summary.remaining) }),
        el('dt', { text: '実施回' }),
        el('dd', { text: `${summary.runCount}件` }),
      ]),
      el('p', {
        class: 'note',
        text:
          '案件IDは一意です。この案件の対象種別とバリエーションは変更できません。' +
          '同じ案件の作業を続ける場合は、実施回を追加してください。',
      }),
      el('div', { class: 'actions' }, [
        el('button', {
          type: 'button',
          class: 'button button--primary',
          text: 'この案件へ実施回を追加',
          dataset: { testid: 'open-existing-project' },
          on: {
            click: () => {
              const target = local.conflict;
              reset();
              handlers.onOpenExisting(target.projectGroupId);
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
      { class: 'errors', role: 'alert', dataset: { testid: 'project-errors' } },
      [
        el('p', { class: 'errors__title', text: '登録できません' }),
        el(
          'ul',
          {},
          local.errors.map((message) => el('li', { text: message })),
        ),
      ],
    );
  }

  /**
   * 選択肢つきのテキスト入力を作る。
   *
   * テンプレートに無い対象種別を打てないようにするのではなく、既存を選びやすく
   * するだけにする。テンプレート登録の前後で入力できる内容が変わると分かり
   * にくいため、`datalist` で候補を出す形にした。
   *
   * @param {string} id
   * @param {string} key
   * @param {string[]} options
   */
  function suggestInput(id, key, options) {
    const listId = `${id}-options`;
    return el('span', { class: 'suggest' }, [
      el('input', {
        type: 'text',
        class: 'input',
        list: listId,
        value: local.draft[key],
        dataset: { testid: id },
        on: {
          input: (event) => {
            local.draft[key] = event.target.value;
            // 対象種別を変えるとバリエーションの候補が変わるため描き直す。
            if (key === 'targetType') {
              render();
            }
          },
        },
      }),
      el(
        'datalist',
        { id: listId },
        options.map((option) => el('option', { value: option })),
      ),
    ]);
  }

  function render() {
    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('h2', { class: 'view__title', text: '案件登録' }),
      ]),
      renderErrors(),
      renderConflict(),
      el('section', { class: 'card', dataset: { testid: 'project-form' } }, [
        el('div', { class: 'field-row' }, [
          field({
            id: 'project-id',
            label: '案件ID',
            hint: '一意です。登録後は変更できません。',
            input: el('input', {
              type: 'text',
              class: 'input',
              value: local.draft.projectId,
              dataset: { testid: 'project-id' },
              on: {
                input: (event) => {
                  local.draft.projectId = event.target.value;
                },
              },
            }),
          }),
          field({
            id: 'target-type',
            label: '対象種別',
            input: suggestInput('target-type', 'targetType', targetTypeOptions()),
          }),
          field({
            id: 'variant',
            label: 'バリエーション',
            input: suggestInput('variant', 'variant', variantOptions()),
          }),
          field({
            id: 'total-quantity',
            label: '総予定数',
            hint: '1以上の整数。後から修正できます。',
            input: el('input', {
              type: 'number',
              class: 'input input--num',
              min: '1',
              step: '1',
              value: local.draft.totalQuantity,
              dataset: { testid: 'total-quantity' },
              on: {
                input: (event) => {
                  local.draft.totalQuantity = event.target.value;
                },
              },
            }),
          }),
        ]),
        el('div', { class: 'actions' }, [
          el('button', {
            type: 'button',
            class: 'button button--primary',
            text: '登録',
            dataset: { testid: 'create-project' },
            disabled: local.busy,
            on: { click: handleSubmit },
          }),
          el('button', {
            type: 'button',
            class: 'button',
            text: 'キャンセル',
            dataset: { testid: 'cancel-project' },
            disabled: local.busy,
            on: {
              click: () => {
                reset();
                handlers.onCancel();
              },
            },
          }),
        ]),
      ]),
    ]);
  }

  return { render, reset };
}
