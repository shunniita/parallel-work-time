/**
 * 集計・転記（仕様書8.6.5、8.7、7.1、12.2）。
 *
 * 選択中の実施回について、作業項目別の工数内訳と転記値を一覧で出し、外部の記録先
 * へ転記する作業を支える。転記そのものは手作業であり（仕様書2章）、この画面が
 * 行うのは「転記しやすい形で数字を見せる」ことと「転記が済んだ印を残す」ことである。
 *
 * ## 転記済みは実施回単位のみ
 *
 * 作業項目単位の転記済みは保存しない（仕様書8.7.5）。行の `✓` は画面上の一時的な
 * チェックであり、再読み込みで消える。長い一覧を上から転記していくときに「どこまで
 * やったか」を見失わないための目印にすぎない。保存する印だと誤解されないよう、
 * 一覧の下に明記する。
 *
 * ## コピーは「そのまま貼れる」ことを優先する
 *
 * 外部項目コードが未設定の行と、転記値が未確定の行はコピーへ含めない
 * （`domain/aggregate.js` の `buildTransferText()`）。除いた件数は画面へ出す。
 * 黙って落とすと転記漏れに気づけない。
 *
 * ## 状態遷移
 *
 * 仕様書7.1 のうち集計済み・転記済みまわりの4遷移をここへ置く。アーカイブは
 * Step 10 である。転記済みから戻す操作だけは理由が必須で、変更履歴へ残る（11章）。
 */

import {
  AGGREGATE_SORT,
  aggregateRun,
  buildTransferText,
} from '../../domain/aggregate.js';
import { RUN_STATUS_LABEL } from '../../domain/runStatus.js';
import { RUN_STATUS } from '../../domain/schema.js';
import { toErrorMessages } from '../../app/errors.js';
import { writeToClipboard } from '../../io/clipboard.js';
import { createReasonConfirm } from '../components/reasonConfirm.js';
import { el, field, replaceChildren } from '../dom.js';
import { toMinutesLabel } from '../labels.js';

/** 並び順の選択肢（仕様書8.7.3）。既定は外部項目コード順。 */
const SORT_OPTIONS = [
  { value: AGGREGATE_SORT.EXTERNAL_CODE, label: '外部項目コード順（自然順）' },
  { value: AGGREGATE_SORT.ORDER, label: '表示順' },
];

/**
 * 集計・転記画面を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {markAggregated: Function, reopenRun: Function,
 *                    markTransferred: Function, revertTransfer: Function,
 *                    previewStatusChange: Function},
 *          handlers: {onSelectRun: Function},
 *          copyText?: Function}} options
 *   `copyText` はクリップボード書き出しの差し替え口（テスト用）。
 * @returns {{render: () => void, reset: () => void}}
 */
export function createSummaryView({
  container,
  store,
  actions,
  handlers,
  copyText,
  isActive = () => true,
}) {
  const writeClipboard = copyText ?? writeToClipboard;

  /**
   * ビュー内部の状態（`src/app/store.js` の規約2）。
   *
   * - `sort`: 並び順。既定は外部項目コード順（仕様書8.7.3）。
   * - `checked`: 転記の目印。**保存しない**（仕様書8.7.5）。
   * - `reverting`: 転記済みから戻す確認を開いているか。
   * - `notice` / `errors`: 直前の操作の結果。
   * - `busy`: 保存中かどうか。
   */
  const local = {
    sort: AGGREGATE_SORT.EXTERNAL_CODE,
    checked: new Set(),
    reverting: false,
    notice: null,
    errors: [],
    busy: false,
  };

  function reset() {
    local.reverting = false;
    local.notice = null;
    local.errors = [];
    local.busy = false;
    // `checked` は残す。実施回を見比べている間に消えると目印の用を成さない。
    // 実施回が変わったときだけ捨てる（`selectedRun()` の呼び出し側で判定）。
  }

  /** 直近に描いた確認フォーム。フォーカス移動のために持つ。 */
  let confirmForm = null;

  /** `checked` が指している実施回。切り替わったら目印を捨てる。 */
  let checkedRunId = null;

  function selectedRun() {
    const { dataset, selection = {} } = store.getState();
    return dataset.workRuns.find((run) => run.runId === selection.runId) ?? null;
  }

  function projectOf(run) {
    return (
      store
        .getState()
        .dataset.projectGroups.find((group) => group.projectGroupId === run.projectGroupId) ??
      null
    );
  }

  /**
   * 状態を変える操作の共通の受け皿。
   *
   * @param {() => Promise<unknown>} operation
   * @param {string} successNotice
   */
  async function submit(operation, successNotice) {
    if (local.busy) {
      return;
    }
    local.busy = true;
    local.errors = [];
    local.notice = null;
    render();

    try {
      await operation();
      local.notice = successNotice;
      local.reverting = false;
    } catch (error) {
      local.errors = toErrorMessages(error);
    } finally {
      local.busy = false;
    }
    render();
  }

  /**
   * 転記値をクリップボードへ渡す（仕様書8.7.7）。
   *
   * @param {object} aggregate
   */
  async function copyTransferValues(aggregate) {
    const built = buildTransferText(aggregate);
    local.errors = [];

    const result = await writeClipboard(built.text);
    if (!result.ok) {
      local.errors = [result.reason];
      local.notice = null;
    } else {
      local.notice = describeCopy(built);
    }
    render();
  }

  /**
   * コピーの結果を1行で言う。除いた行があれば必ず添える。
   *
   * @param {{copiedCount: number, skippedMissingCode: number,
   *          skippedUnconfirmed: number}} built
   * @returns {string}
   */
  function describeCopy(built) {
    const parts = [`${built.copiedCount}件をコピーしました。`];
    if (built.skippedMissingCode > 0) {
      parts.push(`外部項目コード未設定の${built.skippedMissingCode}件は含めていません。`);
    }
    if (built.skippedUnconfirmed > 0) {
      parts.push(`転記値が未確定の${built.skippedUnconfirmed}件は含めていません。`);
    }
    return parts.join('');
  }

  /**
   * 状態遷移のボタンを1つ作る。
   *
   * 押せない場合は理由を `title` へ入れる。仕様書8.9.6 の「未終了区間があると
   * 集計済みにできない」を、押してから初めて知る形にしない。
   *
   * @param {object} run
   * @param {{to: string, label: string, primary?: boolean, testid: string}} spec
   */
  function statusButton(run, spec) {
    const preview = actions.previewStatusChange(run, spec.to);
    return el('button', {
      type: 'button',
      class: spec.primary ? 'button button--primary' : 'button',
      text: spec.label,
      dataset: { testid: spec.testid },
      disabled: !preview.ok || local.busy,
      title: preview.ok ? undefined : preview.reason,
      on: {
        click: () =>
          submit(
            () => actions[spec.action](run.runId),
            `実施回を${RUN_STATUS_LABEL[spec.to]}にしました。`,
          ),
      },
    });
  }

  /**
   * 状態に応じた操作を並べる（仕様書7.1）。
   *
   * @param {object} run
   */
  function renderStatusActions(run) {
    const buttons = [];
    if (run.status === RUN_STATUS.WORKING) {
      buttons.push(
        statusButton(run, {
          to: RUN_STATUS.AGGREGATED,
          action: 'markAggregated',
          label: '集計済みにする',
          primary: true,
          testid: 'mark-aggregated',
        }),
      );
    }
    if (run.status === RUN_STATUS.AGGREGATED) {
      buttons.push(
        statusButton(run, {
          to: RUN_STATUS.TRANSFERRED,
          action: 'markTransferred',
          label: '実施回を転記済みにする',
          primary: true,
          testid: 'mark-transferred',
        }),
        statusButton(run, {
          to: RUN_STATUS.WORKING,
          action: 'reopenRun',
          label: '作業中へ戻す',
          testid: 'reopen-run',
        }),
      );
    }
    if (run.status === RUN_STATUS.TRANSFERRED) {
      buttons.push(
        // アーカイブは利用者の操作によってのみ行う（仕様書10.1）。転記済みに
        // したことによる自動アーカイブはしない。
        statusButton(run, {
          to: RUN_STATUS.ARCHIVED,
          action: 'archiveRun',
          label: 'アーカイブへ移す',
          testid: 'archive-run',
        }),
        el('button', {
          type: 'button',
          class: 'button button--danger',
          text: '転記済みを取り消す',
          dataset: { testid: 'revert-transfer' },
          disabled: local.busy,
          on: {
            click: () => {
              local.reverting = true;
              local.errors = [];
              local.notice = null;
              render();
              confirmForm?.focus();
            },
          },
        }),
      );
    }
    return buttons;
  }

  /**
   * 転記済みを取り消す確認（仕様書11章）。理由が必須である。
   *
   * @param {object} run
   */
  function renderRevertConfirm(run) {
    confirmForm = null;
    if (!local.reverting) {
      return null;
    }
    confirmForm = createReasonConfirm({
      subject: '転記済み',
      action: {
        verb: '取り消',
        noun: '取り消し',
        reasonHint:
          '必須です。変更履歴に記録されます。外部の記録先を直した理由を残します。',
      },
      preview: {
        description:
          `実施回 ${run.workDate} を集計済みへ戻します。` +
          '外部の正式な記録先へ渡した数字と食い違う状態になるため、理由を残します。',
        deletable: true,
        blockedReason: null,
      },
      idPrefix: 'revert',
      testidPrefix: 'revert',
      onConfirm: (reason) =>
        submit(
          () => actions.revertTransfer(run.runId, { reason }),
          '転記済みを取り消し、集計済みへ戻しました。',
        ),
      onCancel: () => {
        local.reverting = false;
        render();
      },
    });
    return confirmForm.element;
  }

  /**
   * 一覧の1行。
   *
   * @param {object} row
   */
  function renderRow(row) {
    const checked = local.checked.has(row.taskRecordId);
    return el('tr', { dataset: { testid: 'summary-row', taskRecordId: row.taskRecordId } }, [
      el('td', {
        dataset: { testid: 'summary-code' },
        class: row.externalCodeMissing ? 'cell--warn' : '',
        text: row.externalCodeMissing ? '（未設定）' : row.externalCode,
      }),
      el('td', { dataset: { testid: 'summary-name' }, text: row.name }),
      el('td', {
        class: 'table__num',
        dataset: { testid: 'summary-time' },
        text: toMinutesLabel(row.timeSeconds),
      }),
      el('td', {
        class: 'table__num',
        dataset: { testid: 'summary-direct' },
        text: toMinutesLabel(row.directSeconds),
      }),
      el('td', {
        class: 'table__num',
        dataset: { testid: 'summary-total-seconds' },
        text: `${row.totalSeconds}`,
      }),
      el('td', {
        class: row.confirmed ? 'table__num' : 'table__num cell--warn',
        dataset: { testid: 'summary-transfer' },
        // 未終了区間を含む項目の転記値は未確定（仕様書8.6.5）。
        text: row.confirmed ? `${row.transferMinutes}分` : `未確定（進行中${row.openCount}件）`,
      }),
      el('td', {}, [
        el('input', {
          type: 'checkbox',
          checked: checked ? true : undefined,
          'aria-label': `${row.name} を転記した`,
          dataset: { testid: 'summary-check' },
          on: {
            change: (event) => {
              // 保存しない（仕様書8.7.5）。再描画で作り直されるため、
              // ここでは `local` の集合だけを更新して描き直さない。
              if (event.target.checked) {
                local.checked.add(row.taskRecordId);
              } else {
                local.checked.delete(row.taskRecordId);
              }
            },
          },
        }),
      ]),
    ]);
  }

  /**
   * 集計一覧（仕様書8.7.1、8.7.2）。
   *
   * @param {object} aggregate
   */
  function renderTable(aggregate) {
    if (aggregate.rows.length === 0) {
      return el('p', {
        class: 'placeholder',
        dataset: { testid: 'summary-empty' },
        text: 'この実施回には作業項目がありません。',
      });
    }
    return el('table', { class: 'table', dataset: { testid: 'summary-list' } }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: '外部項目コード' }),
          el('th', { scope: 'col', text: '作業項目' }),
          el('th', { scope: 'col', class: 'table__num', text: '時刻入力分' }),
          el('th', { scope: 'col', class: 'table__num', text: '直接入力分' }),
          el('th', { scope: 'col', class: 'table__num', text: '合計秒' }),
          el('th', { scope: 'col', class: 'table__num', text: '転記値' }),
          el('th', { scope: 'col', text: '転記' }),
        ]),
      ]),
      el('tbody', {}, aggregate.rows.map(renderRow)),
    ]);
  }

  /**
   * 実施回の合計（仕様書8.6.5、8.7.1）。
   *
   * 未確定があるときは、確定済みだけの小計であることを明示する。転記値そのものと
   * 取り違えると、記録されていない作業を転記したことになる。
   *
   * @param {object} aggregate
   */
  function renderTotals(aggregate) {
    return el('dl', { class: 'summary', dataset: { testid: 'summary-totals' } }, [
      el('dt', { text: '確定分の合計' }),
      el('dd', {
        dataset: { testid: 'total-seconds' },
        text: toMinutesLabel(aggregate.totalSeconds),
      }),
      el('dt', { text: '転記値合計' }),
      el('dd', {
        dataset: { testid: 'total-transfer' },
        class: aggregate.confirmed ? '' : 'summary__warn',
        text: aggregate.confirmed
          ? `${aggregate.transferMinutesSum}分`
          : `未確定（進行中${aggregate.openCount}件）。` +
            `確定済み${aggregate.confirmedCount}件の小計は${aggregate.confirmedTransferMinutesSum}分`,
      }),
    ]);
  }

  function renderNotices(aggregate, run) {
    const notes = [];
    // 「集計済みなのに未終了区間がある」記録の修復導線（仕様書7.1）。
    //
    // 仕様書1.3 で集計済みからの作業再開に確認を挟むようにしたため、通常の操作で
    // この状態にはならない。取り込んだJSONや旧版のデータでは起こりうるので、
    // 気づけるようにしたうえで直し方を示す。転記済みへは進めないため、放置すると
    // 行き止まりになる。
    if (run.status === RUN_STATUS.AGGREGATED && aggregate.openCount > 0) {
      notes.push(
        el('p', {
          class: 'note note--warn',
          dataset: { testid: 'inconsistent-state-warning' },
          text:
            `集計済みですが未終了の作業区間が ${aggregate.openCount} 件あります。` +
            '「作業中へ戻す」を押してから区間を終了してください。',
        }),
      );
    }
    if (aggregate.missingExternalCodeCount > 0) {
      notes.push(
        el('p', {
          class: 'note note--warn',
          dataset: { testid: 'missing-code-warning' },
          text:
            `外部項目コードが未設定の作業項目が ${aggregate.missingExternalCodeCount} 件あります` +
            '。転記先を決められないため、コピーには含めません。',
        }),
      );
    }
    if (local.notice !== null) {
      notes.push(
        el('p', {
          class: 'note',
          role: 'status',
          dataset: { testid: 'summary-notice' },
          text: local.notice,
        }),
      );
    }
    if (local.errors.length > 0) {
      notes.push(
        el(
          'div',
          { class: 'errors', role: 'alert', dataset: { testid: 'summary-errors' } },
          [
            el('p', { class: 'errors__title', text: '実行できません' }),
            el('ul', {}, local.errors.map((message) => el('li', { text: message }))),
          ],
        ),
      );
    }
    return notes;
  }

  function render() {
    // 非同期処理の完了後に呼ばれることがある。その間に利用者が別画面へ移って
    // いれば、共有している詳細ペインを奪い返してはいけない（GAR-4）。
    if (!isActive()) {
      return;
    }
    const run = selectedRun();
    if (run === null) {
      replaceChildren(container, [
        el('p', {
          class: 'placeholder',
          dataset: { testid: 'summary-no-run' },
          text: '左の一覧から実施回を選ぶと、転記値の一覧を表示します。',
        }),
      ]);
      return;
    }

    // 実施回が変わったら転記の目印を捨てる。別の実施回のチェックが残っていると、
    // どこまで転記したかの目印として誤る。
    if (checkedRunId !== run.runId) {
      local.checked.clear();
      checkedRunId = run.runId;
    }

    const group = projectOf(run);
    const aggregate = aggregateRun(run, { sort: local.sort });

    const sortSelect = el(
      'select',
      {
        class: 'input input--auto',
        dataset: { testid: 'summary-sort' },
        on: {
          change: (event) => {
            local.sort = event.target.value;
            render();
          },
        },
      },
      SORT_OPTIONS.map((option) =>
        el('option', {
          value: option.value,
          text: option.label,
          selected: local.sort === option.value,
        }),
      ),
    );

    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('div', {}, [
          el('h2', {
            class: 'view__title',
            dataset: { testid: 'summary-title' },
            text: `${group === null ? '' : group.projectId} ／ ${run.workDate}`,
          }),
          el('p', { class: 'note' }, [
            el('span', {
              class: `badge badge--${run.status}`,
              dataset: { testid: 'summary-run-status' },
              text: RUN_STATUS_LABEL[run.status] ?? run.status,
            }),
            el('span', {
              dataset: { testid: 'summary-run-quantity' },
              text: ` ／ 今回数量 ${run.runQuantity}`,
            }),
          ]),
        ]),
        el('button', {
          type: 'button',
          class: 'button',
          text: '実施回詳細へ',
          dataset: { testid: 'open-run-detail' },
          on: { click: () => handlers.onSelectRun(run.runId) },
        }),
      ]),

      renderNotices(aggregate, run),

      el('div', { class: 'field-row field-row--baseline' }, [
        field({ id: 'summary-sort-select', label: '並び順', input: sortSelect }),
      ]),

      el('section', { class: 'card' }, [
        el('h3', { class: 'card__title', text: '作業項目別の転記値' }),
        renderTable(aggregate),
        el('p', {
          class: 'field__hint',
          dataset: { testid: 'check-note' },
          text:
            '右端のチェックは転記作業の目印です。保存しないため、再読み込みすると消えます'
            + '。',
        }),
        renderTotals(aggregate),
      ]),

      el('div', { class: 'actions', dataset: { testid: 'summary-actions' } }, [
        el('button', {
          type: 'button',
          class: 'button',
          text: '転記値をコピー',
          dataset: { testid: 'copy-transfer' },
          disabled: local.busy,
          on: { click: () => copyTransferValues(aggregate) },
        }),
        ...renderStatusActions(run),
      ]),

      renderRevertConfirm(run),
    ]);
  }

  return { render, reset };
}
