/**
 * アーカイブ画面（仕様書10章、12.2）。
 *
 * アーカイブ済みの実施回を一覧し、保持期間を過ぎたものを削除候補として示す。
 * 完全削除はここからのみ行う。
 *
 * ## 削除できるのは削除候補だけ
 *
 * 仕様書7.1 の遷移表は `アーカイブ → 削除候補 → 完全削除` であり、アーカイブ済み
 * から直接消す辺は無い。保持期間内の実施回は削除ボタンを押せない状態で出し、
 * 残り日数を添える。判定は `retention.js` の `canDeleteRun()` を画面とアクションで
 * 共有する。押せるかどうかと保存が通るかどうかが別の条件になると、押せたのに
 * 失敗する（または逆）ことになる。
 *
 * 自動削除はしない（仕様書10.6）。候補になっても消すかどうかは利用者が決める。
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
 * 配下の実施回がすべて削除候補の案件だけを消せる。実施回が0件の案件も対象で、
 * これが登録しただけの案件を消す唯一の経路である。一覧の組み立てと可否の判断は
 * `summarizeArchive()` が行い、ここは理由を集めて渡すだけである。
 */

import { toErrorMessages } from '../../app/errors.js';
import { formatIsoForHuman, toIsoSecond } from '../../domain/datetime.js';
import { canDeleteRun, daysUntilDeletable } from '../../domain/retention.js';
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
 *          actions: {summarizeArchive: Function},
 *          now?: () => Date, runDestructive?: Function}} options
 *   削除そのものは `runDestructive` が排他区間の中で用意する（GAR-1）。
 * @returns {{render: () => void, reset: () => void}}
 */
export function createArchiveView({
  container,
  store,
  actions,
  now = () => new Date(),
  runDestructive = runDestructiveAction,
  isActive = () => true,
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

    return submit(
      () =>
        runDestructive({
          backup,
          confirmedWithoutBackup: true,
          // 退避と削除は1つの排他区間で行う。区間の中で使うアクションは
          // 呼び出し元から渡される（敵対的レビュー GAR-1）。
          destructiveAction: (scoped) =>
            target.kind === TARGET.RUN
              ? scoped.deleteRun(target.id, { reason: target.reason })
              : scoped.deleteProjectGroup(target.id, { reason: target.reason }),
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
    // 表示も可否も同じ述語から導く。別々に持つと、保持期限ちょうどの1点で
    // 「削除候補と出ているのに押せない」ような食い違いが生じる。
    const allowed = canDeleteRun(run, options);
    const group = groupOf(run.projectGroupId);

    return el(
      'tr',
      {
        class: allowed.ok ? 'table__row--warn' : '',
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
          class: allowed.ok ? 'cell--warn' : '',
          text: allowed.ok ? '削除候補' : `あと${remaining}日`,
        }),
        el('td', {}, [
          el('button', {
            type: 'button',
            class: 'button button--compact button--danger',
            text: '完全削除',
            dataset: { testid: 'delete-run' },
            disabled: local.busy || !allowed.ok,
            title: allowed.ok ? undefined : allowed.reason,
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
   * 束の見出しへ置く。束ね方と削除の可否は `summarizeArchive()` が決めており、
   * ここは描くだけである。
   *
   * @param {{group: object, runs: {run: object, number: number}[],
   *          deletion: {ok: boolean, reason: string|null}}[]} groups
   * @param {{retentionDays: number, now: string}} options
   */
  function renderGroups(groups, options) {
    return groups.map(({ group, runs, deletion }) =>
      el('section', { class: 'card', dataset: { testid: 'archive-group' } }, [
        el('div', { class: 'view__head' }, [
          el('h3', {
            class: 'card__title',
            dataset: { testid: 'archive-group-title' },
            text: group.projectId,
          }),
          el('button', {
            type: 'button',
            class: 'button button--danger',
            text: '案件ごと削除',
            dataset: { testid: 'delete-group' },
            disabled: local.busy || !deletion.ok,
            title: deletion.ok ? undefined : deletion.reason,
            on: {
              click: () => {
                local.deleting = {
                  kind: TARGET.GROUP,
                  id: group.projectGroupId,
                  description:
                    runs.length === 0
                      ? `案件 ${group.projectId} を完全に削除します。`
                      : `案件 ${group.projectId} と配下の実施回 ${runs.length}件を` +
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
        runs.length === 0
          ? el('p', {
              class: 'placeholder',
              dataset: { testid: 'archive-group-empty' },
              text: 'この案件には実施回がありません。案件ごと削除できます。',
            })
          : el('table', { class: 'table', dataset: { testid: 'archive-list' } }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { scope: 'col', text: '案件' }),
                  el('th', { scope: 'col', text: '実施回' }),
                  el('th', { scope: 'col', text: 'アーカイブ日時' }),
                  el('th', { scope: 'col', text: '保持期間' }),
                  el('th', { scope: 'col' }),
                ]),
              ]),
              el('tbody', {}, runs.map((item) => renderRunRow(item, options))),
            ]),
      ]),
    );
  }

  function render() {
    // 非同期処理の完了後に呼ばれることがある。その間に利用者が別画面へ移って
    // いれば、共有している詳細ペインを奪い返してはいけない（GAR-4）。
    if (!isActive()) {
      return;
    }
    panel = null;
    const { dataset } = store.getState();
    // 削除候補は保存しない派生値なので、描くたびに現在日時から求める（10.3）。
    const nowIso = toIsoSecond(now());
    const summary = actions.summarizeArchive(dataset, { now: nowIso });
    const options = { retentionDays: summary.retentionDays, now: nowIso };

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

      summary.groups.length === 0
        ? el('p', {
            class: 'placeholder',
            dataset: { testid: 'archive-empty' },
            text:
              'アーカイブ済みの実施回はありません。転記済みの実施回を' +
              '集計・転記画面から移せます。',
          })
        : renderGroups(summary.groups, options),

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
