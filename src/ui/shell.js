/**
 * ヘッダー・警告領域・二分割レイアウト・フッターの骨格（仕様書12.1）。
 *
 * 画面幅1280px以上のPCを主対象とし、左に階層一覧、右に選択中の詳細を置く。
 * 専用ルーティングは持たず、単一ページ内のビュー切替で7画面を表現する（12.2）。
 *
 * 本モジュールは器だけを用意する。警告領域（8.8.1、8.10、9.5）と左ツリーの
 * 中身は、それぞれ実装計画 Step 11 と Step 5 で埋める。空のまま置いておくのは、
 * 後から差し込む位置を先に決めておくためである。
 */

import { el, replaceChildren } from './dom.js';

/**
 * 単一ページ内のビュー（仕様書12.2 の7画面）。
 *
 * `PROJECT_FORM` はヘッダーに並べない。案件登録は左ツリーの「新規案件」から
 * 入る操作であり、画面切替の行き先として常設する必要がないためである。
 */
export const VIEW = {
  PROJECTS: 'projects',
  PROJECT_FORM: 'projectForm',
  SUMMARY: 'summary',
  TEMPLATES: 'templates',
  ARCHIVE: 'archive',
  SETTINGS: 'settings',
};

const NAV_ITEMS = [
  { view: VIEW.PROJECTS, label: '案件・実施回' },
  { view: VIEW.SUMMARY, label: '集計・転記' },
  { view: VIEW.TEMPLATES, label: 'テンプレート' },
  { view: VIEW.ARCHIVE, label: 'アーカイブ' },
  { view: VIEW.SETTINGS, label: '設定' },
];

/** 実装計画 Step 5 の時点で中身があるのは案件とテンプレート。 */
const IMPLEMENTED_VIEWS = new Set([VIEW.PROJECTS, VIEW.TEMPLATES]);

/**
 * 骨格を組み立てて指定要素へ差し込む。
 *
 * @param {HTMLElement} root マウント先
 * @param {{onNavigate: (view: string) => void}} handlers
 * @returns {{warningBar: HTMLElement, treePane: HTMLElement, detailPane: HTMLElement,
 *            statusBar: HTMLElement, setActiveView: (view: string) => void}}
 */
export function renderShell(root, handlers) {
  const navButtons = new Map();

  const nav = el(
    'nav',
    { class: 'header__nav', 'aria-label': '画面切替' },
    NAV_ITEMS.map((item) => {
      const implemented = IMPLEMENTED_VIEWS.has(item.view);
      const button = el('button', {
        type: 'button',
        class: 'header__nav-item',
        text: item.label,
        dataset: { view: item.view, testid: `nav-${item.view}` },
        // 未実装の画面は押せないようにする。押せるのに何も起きない状態より、
        // 何がまだ無いのかが分かる方がよい。
        disabled: !implemented,
        title: implemented ? undefined : '実装予定',
        on: { click: () => handlers.onNavigate(item.view) },
      });
      navButtons.set(item.view, button);
      return button;
    }),
  );

  const warningBar = el('section', {
    class: 'warning-bar',
    'aria-live': 'polite',
    'aria-label': '警告',
    dataset: { testid: 'warning-bar' },
    // 中身が無いあいだは領域を占めない。Step 11 で件数に応じて表示する。
    hidden: true,
  });

  const treePane = el('aside', {
    class: 'layout__tree',
    'aria-label': '案件・実施回・作業項目',
    dataset: { testid: 'tree-pane' },
  });

  const detailPane = el('main', {
    class: 'layout__detail',
    dataset: { testid: 'detail-pane' },
  });

  const statusBar = el('footer', {
    class: 'status-bar',
    dataset: { testid: 'status-bar' },
  });

  replaceChildren(root, [
    el('header', { class: 'header' }, [
      el('h1', { class: 'header__title', text: '同時並行作業時間計測支援ツール' }),
      nav,
    ]),
    warningBar,
    el('div', { class: 'layout' }, [treePane, detailPane]),
    statusBar,
  ]);

  /**
   * 現在の画面を示す。
   *
   * @param {string} view
   */
  function setActiveView(view) {
    for (const [candidate, button] of navButtons) {
      // 案件登録は案件画面の一部として扱い、ヘッダーでは案件を現在地とする。
      const current =
        candidate === view || (candidate === VIEW.PROJECTS && view === VIEW.PROJECT_FORM);
      button.classList.toggle('header__nav-item--active', current);
      button.setAttribute('aria-current', current ? 'page' : 'false');
    }
  }

  return { warningBar, treePane, detailPane, statusBar, setActiveView };
}
