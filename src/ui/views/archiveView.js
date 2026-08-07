/**
 * アーカイブ画面（仕様書10章、12.2）。
 *
 * アーカイブ済みの実施回を一覧し、保持期間を過ぎたものを削除候補として示す。
 * 完全削除はここからのみ行う。
 *
 * ## 削除候補は「消してよい候補」でしかない
 *
 * 自動削除はしない（仕様書10.6）。候補として色を変え、残り日数を出すだけである。
 * 消すかどうかは利用者が決める。保持期間内のものも削除できる。仕様書10.3 が
 * 定めるのは「候補として表示する」ことであって、削除できる条件ではない。
 *
 * ## 削除の前に退避を挟む
 *
 * 完全削除の前にJSONへ退避する導線を出す（仕様書10.5、9.4）。退避せずに進むことも
 * 選べるが、その場合は取り消せない旨をもう一度確認する。処理は
 * `io/safetyExport.js` の `runDestructiveAction()` と共通で、インポートの全置換
 * （9.3）と同じ流れである。
 *
 * ## 案件グループの削除
 *
 * 配下の実施回がすべてアーカイブ済みの案件だけを消せる。1つでも運用中の記録が
 * 残っていれば早い。判断はアクション層が行い、ここは理由を集めて渡すだけである。
 */

import { toErrorMessages } from '../../app/errors.js';
import { formatIsoForHuman, toIsoSecond } from '../../domain/datetime.js';
import { daysUntilDeletable } from '../../domain/retention.js';
import { numberRuns } from '../../domain/runOrder.js';
import { RUN_STATUS } from '../../domain/schema.js';
import { runDestructiveAction } from '../../io/safetyExport.js';
import { createReasonConfirm } from '../components/reasonConfirm.js';
import { el, replaceChildren } from '../dom.js';

/** 削除対象の種別。 */
const TARGET = {
  RUN: 'run',
  GROUP: 'group',
};

/**
 * アーカイブ画面を作る。
 *
 * @param {{container: HTMLElement, store: object,
 *          actions: {summarizeArchive: Function, archiveRun: Function,
 *                    deleteRun: Function, deleteProjectGroup: Function,
 *                    exportData: Function},
 *          now?: () => Date, runDestructive?: Function}} options
 * @returns {{render: () => void, reset: () => void}}
 */
export function createArchiveView({
  container,
  store,
  actions,
  now = () => new Date(),
  runDestructive = runDestructiveAction,
}) {
  /**
   * ビュー内部の状態（`src/app/store.js` の規約2）。
   *
   * - `deleting`: 削除の理由入力を開いている対象。`{kind, id, reason}` か `null`。
   * - `backupChoice`: 退避の有無を尋ねている対象。理由を確定した後の段階。
   */
  const local = {
    deleting: null,
    backupChoice: null,
    errors: [],
    notice: null,
    busy: false,
  };

  function reset() {
    local.deleting = null;
    local.backupChoice = null;
    local.errors = [];
    local.notice = null;
    local.busy = false;
  }

  /** 直近に描いた確認パネル。フォーカス移動のために持つ。 */
  let panel = null;

  /** 案件グループを引く。 */
  function groupOf(projectGroupId) {
    return (
      store
        .getState()
        .dataset.projectGroups.find((group) => group.projectGroupId === projectGroupId) ?? null
    );
  }

  /**
   * 保存を1回通す共通の受け皿。
   *
   * 成功したらローカル状態を畳み、通知を出す。失敗は画面へ出して状態を保つ。
   *
   * @param {() => Promise<unknown>} operation
   * @param {string} message
   */
  async function submit(operation, message) {
    local.busy = true;
    local.errors = [];
    render();
    try {
      await operation();
      local.deleting = null;
      local.backupChoice = null;
      local.notice = message;
    } catch (error) {
      local.errors = toErrorMessages(error);
    } finally {
      local.busy = false;
    }
    render();
  }

  /**
   * 理由を受け取ったら、退避の確認へ進む（仕様書10.5、9.4）。
   *
   * 理由と退避を1つの画面へ混ぜない。理由は「なぜ消すか」、退避は「消す前に
   * 控えを取るか」であり、利用者が答える問いが違う。
   *
   * @param {string} reason
   */
  function acceptReason(reason) {
    local.backupChoice = { ...local.deleting, reason };
    local.deleting = null;
    local.errors = [];
    render();
    panel?.focus();
  }

  /**
   * 退避の有無を決めて削除する。
   *
   * @param {boolean} backup
   */
  function executeDelete(backup) {
    const target = local.backupChoice;
    const remove = () =>
      target.kind === TARGET.RUN
        ? actions.deleteRun(target.id, { reason: target.reason })
        : actions.deleteProjectGroup(target.id, { reason: target.reason });

    return submit(
      () =>
        runDestructive({
          backup,
          confirmedWithoutBackup: true,
          exportData: () => actions.exportData(),
          destructiveAction: remove,
        }),
      target.kind === TARGET.RUN ? '実施回を削除しました。' : '案件を削除しました。',
    );
  }

  /** 削除の理由入力（仕様書11章）。 */
  function renderReasonConfirm() {
    if (local.deleting === null) {
      return null;
    }
    const isRun = local.deleting.kind === TARGET.RUN;
    const confirm = createReasonConfirm({
      preview: {
        description: local.deleting.description,
        deletable: true,
        blockedReason: null,
      },
      subject: isRun ? '実施回' : '案件',
      action: { verb: '削除', reasonHint: '必須です。変更履歴に記録されます（仕様書11章）。' },
      idPrefix: 'archive-delete',
      testidPrefix: 'archive-delete',
      onConfirm: async (reason) => acceptReason(reason),
      onCancel: () => {
        local.deleting = null;
        render();
      },
    });
    panel = confirm;
    return confirm.element;
  }

  /** 退避の確認（仕様書10.5、9.4）。 */
  function renderBackupChoice() {
    if (local.backupChoice === null) {
      return null;
    }
    return el(
      'section',
      {
        class: 'card card--warn',
        role: 'alertdialog',
        'aria-label': '削除前の退避確認',
        dataset: { testid: 'backup-choice' },
      },
      [
        el('h3', { class: 'card__title', text: '削除する前にJSONへ退避しますか' }),
        el('p', { text: '完全削除は取り消せません。退避しておくと後から復元できます。' }),
        el('div', { class: 'actions' }, [
          el('button', {
            type: 'button',
            class: 'button button--primary',
            text: '退避してから削除する',
            dataset: { testid: 'delete-with-backup' },
            disabled: local.busy,
            on: { click: () => executeDelete(true) },
          }),
          el('button', {
            type: 'button',
            class: 'button button--danger',
            text: '退避せずに削除する',
            dataset: { testid: 'delete-without-backup' },
            disabled: local.busy,
            on: { click: () => executeDelete(false) },
          }),
          el('button', {
            type: 'button',
            class: 'button',
            text: 'やめる',
            dataset: { testid: 'delete-cancel-all' },
            disabled: local.busy,
            on: {
              click: () => {
                local.backupChoice = null;
                render();
              },
            },
          }),
        ]),
      ],
    );
  }

  /**
   * アーカイブ済みの実施回1行。
   *
   * @param {{run: object, number: number}} item
   * @param {{retentionDays: number, now: string}} options
   */
  function renderRunRow(item, options) {
    const { run, number } = item;
    const remaining = daysUntilDeletable(run, options);
    const deletable = remaining === 0;
    const group = groupOf(run.projectGroupId);

    return el(
      'tr',
      {
        class: deletable ? 'table__row--warn' : '',
        dataset: { testid: 'archive-row', runId: run.runId },
      },
      [
        el('td', { dataset: { testid: 'archive-project' }, text: group?.projectId ?? '（不明）' }),
        el('td', { text: `第${number}回 ${run.workDate}` }),
        el('td', {
          dataset: { testid: 'archived-at' },
          text: run.archivedAt === null ? '（不明）' : formatIsoForHuman(run.archivedAt),
        }),
        el('td', {
          dataset: { testid: 'archive-remaining' },
          class: deletable ? 'cell--warn' : '',
          text: deletable ? '削除候補' : `あと${remaining}日`,
        }),
        el('td', {}, [
          el('button', {
            type: 'button',
            class: 'button button--compact button--danger',
            text: '完全削除',
            dataset: { testid: 'delete-run' },
            disabled: local.busy,
            on: {
              click: () => {
                local.deleting = {
                  kind: TARGET.RUN,
                  id: run.runId,
                  description:
                    `${group?.projectId ?? ''} 第${number}回 ${run.workDate}` +
                    `（数量 ${run.runQuantity}）を完全に削除します。`,
                };
                local.backupChoice = null;
                local.errors = [];
                render();
                panel?.focus();
              },
            },
          }),
        ]),
      ],
    );
  }

  /**
   * 案件ごとにまとめた一覧。
   *
   * 実施回は案件をまたいで並ぶため、案件で束ねてから出す。案件の削除ボタンは
   * 束の見出しへ置く。
   *
   * @param {object[]} archived
   * @param {{retentionDays: number, now: string}} options
   */
  function renderGroups(archived, options) {
    const { dataset } = store.getState();
    const byGroup = new Map();
    for (const run of archived) {
      const list = byGroup.get(run.projectGroupId) ?? [];
      list.push(run);
      byGroup.set(run.projectGroupId, list);
    }

    return [...byGroup.entries()].map(([projectGroupId, runs]) => {
      const group = groupOf(projectGroupId);
      // 番号は案件の全実施回を通して振る（レビュー指摘 D-14）。アーカイブ済み
      // だけで数えると、通常一覧と番号が食い違う。
      const numbered = numberRuns(
        dataset.workRuns.filter((run) => run.projectGroupId === projectGroupId),
      ).filter((item) => runs.some((run) => run.runId === item.run.runId));
      const activeCount = dataset.workRuns.filter(
        (run) => run.projectGroupId === projectGroupId && run.status !== RUN_STATUS.ARCHIVED,
      ).length;

      return el('section', { class: 'card', dataset: { testid: 'archive-group' } }, [
        el('div', { class: 'view__head' }, [
          el('h3', {
            class: 'card__title',
            dataset: { testid: 'archive-group-title' },
            text: group?.projectId ?? '（案件が見つかりません）',
          }),
          el('button', {
            type: 'button',
            class: 'button button--danger',
            text: '案件ごと削除',
            dataset: { testid: 'delete-group' },
            disabled: local.busy || activeCount > 0,
            title:
              activeCount > 0
                ? `アーカイブ済みでない実施回が ${activeCount} 件あります（仕様書10.4）。`
                : undefined,
            on: {
              click: () => {
                local.deleting = {
                  kind: TARGET.GROUP,
                  id: projectGroupId,
                  description:
                    `案件 ${group?.projectId ?? ''} と配下の実施回 ${runs.length}件を` +
                    '完全に削除します。',
                };
                local.backupChoice = null;
                local.errors = [];
                render();
                panel?.focus();
              },
            },
          }),
        ]),
        el('table', { class: 'table', dataset: { testid: 'archive-list' } }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: '案件' }),
              el('th', { scope: 'col', text: '実施回' }),
              el('th', { scope: 'col', text: 'アーカイブ日時' }),
              el('th', { scope: 'col', text: '保持期間' }),
              el('th', { scope: 'col' }),
            ]),
          ]),
          el('tbody', {}, numbered.map((item) => renderRunRow(item, options))),
        ]),
      ]);
    });
  }

  function render() {
    panel = null;
    const { dataset } = store.getState();
    const options = {
      retentionDays: dataset.settings?.retentionDays ?? 30,
      // 削除候補は保存しない派生値なので、描くたびに現在日時から求める（10.3）。
      now: toIsoSecond(now()),
    };
    const summary = actions.summarizeArchive(dataset, options);

    replaceChildren(container, [
      el('div', { class: 'view__head' }, [
        el('div', {}, [
          el('h2', { class: 'view__title', text: 'アーカイブ' }),
          el('p', {
            class: 'note',
            dataset: { testid: 'archive-summary' },
            text:
              `アーカイブ済み ${summary.archived.length}件` +
              `（削除候補 ${summary.deletable.length}件）／保持期間 ${summary.retentionDays}日`,
          }),
        ]),
      ]),

      local.errors.length > 0 &&
        el('div', { class: 'errors', role: 'alert', dataset: { testid: 'archive-errors' } }, [
          el('p', { class: 'errors__title', text: '実行できません' }),
          el('ul', {}, local.errors.map((message) => el('li', { text: message }))),
        ]),

      local.notice !== null &&
        el('p', {
          class: 'note',
          role: 'status',
          dataset: { testid: 'archive-notice' },
          text: local.notice,
        }),

      renderReasonConfirm(),
      renderBackupChoice(),

      summary.archived.length === 0
        ? el('p', {
            class: 'placeholder',
            dataset: { testid: 'archive-empty' },
            text:
              'アーカイブ済みの実施回はありません。転記済みの実施回を' +
              '集計・転記画面から移せます。',
          })
        : renderGroups(summary.archived, options),

      el('p', {
        class: 'note',
        text:
          '保持期間を過ぎても自動では削除しません（仕様書10.6）。' +
          '完全削除は取り消せないため、必要ならJSONへ退避してから実行してください。',
      }),
    ]);
  }

  return { render, reset };
}
