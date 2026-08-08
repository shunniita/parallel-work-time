/**
 * 画面上部の固定警告領域（仕様書8.8.1、8.8.2、8.10、12.2）。
 *
 * 3種類の内容を持つ。
 *
 * 1. 多重タブの警告（8.10）。検知は `src/app/tabGuard.js` が行い、ここは表示だけ。
 * 2. アプリの通知（サンプルテンプレートの読込失敗、捕捉されなかった例外）。
 * 3. 未終了区間の一覧（8.8.1）。しきい値を超えたものを強調する（8.8.2）。
 *
 * どれも無いあいだは `hidden` で畳み、領域を占めない。
 *
 * ## 1分ごとの再評価は部分更新で行う（仕様書8.8、store.js の規約3）
 *
 * しきい値の判定は現在日時に依存するため、`main.js` が1分ごとに {@link tick} を
 * 呼ぶ。tick は「値だけが変わり構造は変わらない」更新であり、`replaceChildren`
 * は使わない。全再描画すると、警告領域内のリンクへフォーカスしていた利用者が
 * 毎分フォーカスを失う。未終了区間の増減そのものは保存を伴う操作でしか起きず、
 * その場合はストア購読経由で {@link render} が呼ばれる。
 */

import { resolveLongRunningThresholdHours } from '../config.js';
import { formatIsoForHuman } from '../domain/datetime.js';
import { RUN_STATUS } from '../domain/schema.js';
import { formatElapsed, summarizeOpenIntervals } from '../domain/warnings.js';
import { el, replaceChildren, setText } from './dom.js';

/** 多重タブの警告文。仕様書8.10 が定める文言をそのまま使う。 */
export const MULTI_TAB_MESSAGE =
  '同じデータを別のタブでも開いています。' +
  '同時操作すると、後から保存した内容で上書きされる可能性があります。';

/**
 * 警告領域を作る。
 *
 * @param {{container: HTMLElement, store: object, now?: () => Date,
 *          handlers: {onSelectTask: (projectGroupId: string|null, runId: string,
 *                                    taskRecordId: string) => void}}} options
 * @returns {{render: () => void, tick: () => void,
 *            setMultiTab: (active: boolean) => void,
 *            addNotice: (message: string) => void}}
 */
export function createWarningBar({ container, store, now = () => new Date(), handlers }) {
  /** 多重タブが検知されているか（仕様書8.10）。 */
  let multiTab = false;
  /** アプリの通知。同文の重複は足さない。 */
  const notices = [];
  /** tick で書き換える行の参照。`render()` のたびに作り直す。 */
  let rows = [];
  /** tick で書き換える件数見出しの参照。 */
  let countNode = null;

  /** 未終了区間のまとめを現在日時で求める。 */
  function summarize() {
    const { dataset } = store.getState();
    return summarizeOpenIntervals(dataset, {
      now: now(),
      thresholdHours: resolveLongRunningThresholdHours(dataset.settings),
    });
  }

  /**
   * 未終了区間1件ぶんの行。
   *
   * @param {object} item `summarizeOpenIntervals` の要素
   */
  function renderItem(item) {
    const label =
      `${item.projectGroup?.projectId ?? '（案件不明）'} ` +
      `第${item.runNumber}回 ${item.taskRecord.name}`;
    const elapsed = el('span', {
      class: item.exceeded ? 'warning-bar__elapsed warning-bar__elapsed--exceeded' : 'warning-bar__elapsed',
      dataset: { testid: 'warning-elapsed' },
      text: elapsedText(item),
    });

    const element = el(
      'li',
      {
        class: item.exceeded ? 'warning-bar__item warning-bar__item--exceeded' : 'warning-bar__item',
        dataset: { testid: 'warning-open-interval' },
      },
      [
        el('button', {
          type: 'button',
          class: 'warning-bar__link',
          dataset: { testid: 'warning-open-link' },
          text: label,
          on: {
            click: () =>
              handlers.onSelectTask(
                item.run.projectGroupId ?? null,
                item.run.runId,
                item.taskRecord.taskRecordId,
              ),
          },
        }),
        el('span', {
          class: 'warning-bar__meta',
          text: `開始 ${formatIsoForHuman(item.interval.startAt)}`,
        }),
        elapsed,
        // 転記済み・アーカイブ済みに残る未終了区間は、取り込みデータ等でしか
        // 生じない異常なので、状態も添えて知らせる。
        item.run.status === RUN_STATUS.TRANSFERRED || item.run.status === RUN_STATUS.ARCHIVED
          ? el('span', { class: 'warning-bar__meta warning-bar__meta--warn', text: '閲覧のみの実施回' })
          : null,
      ],
    );

    return { element, elapsed, intervalId: item.interval.intervalId };
  }

  /**
   * @param {{exceeded: boolean, elapsedMinutes: number}} item
   */
  function elapsedText(item) {
    const base = `経過 ${formatElapsed(item.elapsedMinutes)}`;
    return item.exceeded ? `${base}（しきい値超過）` : base;
  }

  /**
   * @param {{items: object[], exceededCount: number}} summary
   */
  function countText(summary) {
    return (
      `未終了の区間 ${summary.items.length}件` +
      (summary.exceededCount > 0 ? `（しきい値超過 ${summary.exceededCount}件）` : '')
    );
  }

  function render() {
    rows = [];
    countNode = null;
    const summary = summarize();
    const hasContent = multiTab || notices.length > 0 || summary.items.length > 0;
    container.hidden = !hasContent;
    if (!hasContent) {
      replaceChildren(container, []);
      return;
    }

    const items = summary.items.map((item) => {
      const row = renderItem(item);
      rows.push({ ...row, item });
      return row.element;
    });

    replaceChildren(container, [
      multiTab &&
        el('p', {
          class: 'warning-bar__tabs',
          dataset: { testid: 'multi-tab-warning' },
          text: MULTI_TAB_MESSAGE,
        }),

      ...notices.map((message) =>
        el('p', {
          class: 'warning-bar__notice',
          dataset: { testid: 'warning-notice' },
          text: message,
        }),
      ),

      summary.items.length > 0 &&
        el('div', { class: 'warning-bar__section' }, [
          (countNode = el('p', {
            class: 'warning-bar__title',
            dataset: { testid: 'warning-open-count' },
            text: countText(summary),
          })),
          el('ul', { class: 'warning-bar__list' }, items),
        ]),
    ]);
  }

  /**
   * しきい値の再評価（仕様書8.8）。1分ごとに `main.js` が呼ぶ。
   *
   * 経過時間の文字列と超過の強調だけを書き換える。未終了区間の集合が変わって
   * いた場合（別タブでの保存を読み直した直後など）は構造が変わるため描き直す。
   */
  function tick() {
    const summary = summarize();
    const sameSet =
      summary.items.length === rows.length &&
      summary.items.every((item, index) => item.interval.intervalId === rows[index].intervalId);
    if (!sameSet) {
      render();
      return;
    }
    setText(countNode, countText(summary));
    for (const [index, item] of summary.items.entries()) {
      const row = rows[index];
      setText(row.elapsed, elapsedText(item));
      row.elapsed.classList.toggle('warning-bar__elapsed--exceeded', item.exceeded);
      row.element.classList.toggle('warning-bar__item--exceeded', item.exceeded);
    }
  }

  /**
   * 多重タブの検知状態を反映する（仕様書8.10）。
   *
   * @param {boolean} active
   */
  function setMultiTab(active) {
    if (multiTab === active) {
      return;
    }
    multiTab = active;
    render();
  }

  /**
   * アプリの通知を1件足す。同じ文言は重ねない。
   *
   * @param {string} message
   */
  function addNotice(message) {
    if (notices.includes(message)) {
      return;
    }
    notices.push(message);
    render();
  }

  return { render, tick, setMultiTab, addNotice };
}
