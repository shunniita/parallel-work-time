/**
 * 未実装画面の受け皿（仕様書12.2）。
 *
 * ヘッダーの未実装ナビは押せないようにしてあるが（`shell.js`）、ビューの登録表に
 * 穴を空けておくと、未知のビュー名が案件詳細へ落ちる。何が起きたのか分からない
 * 表示になるより、まだ無いと明示する方がよい（レビュー指摘 B-6）。
 */

import { el, replaceChildren } from '../dom.js';

/**
 * 未実装であることを示すビューを作る。
 *
 * @param {{container: HTMLElement, title: string, note?: string,
 *          testid?: string}} options
 * @returns {{render: () => void}}
 */
export function createPlaceholderView({ container, title, note, testid = 'placeholder-view' }) {
  function render() {
    replaceChildren(container, [
      el('div', { class: 'view__head' }, [el('h2', { class: 'view__title', text: title })]),
      el('p', {
        class: 'placeholder',
        dataset: { testid },
        text: note ?? 'この画面はまだ実装していません。',
      }),
    ]);
  }

  return { render };
}
