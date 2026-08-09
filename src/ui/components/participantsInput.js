/**
 * 参加者の入力欄（仕様書8.4.6、8.4.7）。
 *
 * 一つの区間へ複数の参加者名を登録する。候補は過去に入力した名前から出すが
 * （`src/domain/participants.js`）、候補から選ぶ必要はない。作業者マスターを
 * 設けない方針（仕様書6.7）に合わせ、新しい名前はそのまま打てる。
 *
 * ## 打ち込み中に再描画しない
 *
 * 追加・削除で作り直すのは参加者一覧の入れ物だけである。入力欄そのものは使い
 * 回すため、フォーカスも `datalist` の候補ポップアップも保たれる
 * （`src/app/store.js` の再描画の規約3）。
 *
 * ## 未確定の入力も拾う
 *
 * 「追加」を押さずに保存へ進んだ場合、入力欄に残っている名前も参加者として
 * 数える。押し忘れで参加者が欠けた記録が残る方が、余計に拾うより害が大きい。
 * 重複と空白は `src/domain/participants.js` の `normalizeParticipants()` と同じ
 * 規則で整える（前後空白を落とし、完全一致の重複をまとめる）。
 */

import { el, field, replaceChildren, replaceOptions } from '../dom.js';

/**
 * 参加者入力欄を作る。
 *
 * @param {{id: string, testid?: string, label?: string, hint?: string,
 *          candidates?: string[], value?: string[]}} options
 * @returns {{element: HTMLElement, getValue: () => string[],
 *            setCandidates: (candidates: string[]) => void, focus: () => void}}
 */
export function createParticipantsInput({
  id,
  testid = id,
  label = '参加者',
  hint,
  candidates = [],
  value = [],
}) {
  /** 追加済みの名前。表示順は追加順とする。 */
  const names = [];
  const listId = `${id}-options`;

  const chips = el('ul', {
    class: 'chips',
    dataset: { testid: `${testid}-list` },
  });

  const datalist = el(
    'datalist',
    { id: listId },
    candidates.map((candidate) => el('option', { value: candidate })),
  );

  const input = el('input', {
    type: 'text',
    class: 'input',
    list: listId,
    autocomplete: 'off',
    dataset: { testid },
    on: {
      keydown: (event) => {
        // Enter は「追加」と同じ扱いにする。フォーム全体の送信は起こさない。
        if (event.key === 'Enter') {
          event.preventDefault();
          addFromInput();
        }
      },
    },
  });

  const addButton = el('button', {
    type: 'button',
    class: 'button',
    text: '追加',
    dataset: { testid: `${testid}-add` },
    on: { click: addFromInput },
  });

  /**
   * 名前を1件足す。空文字と既出は無視する。
   *
   * @param {string} raw
   */
  function add(raw) {
    const name = String(raw ?? '').trim();
    if (name === '' || names.includes(name)) {
      return;
    }
    names.push(name);
    renderChips();
  }

  function addFromInput() {
    add(input.value);
    input.value = '';
    input.focus();
  }

  /**
   * @param {string} name
   */
  function remove(name) {
    const index = names.indexOf(name);
    if (index >= 0) {
      names.splice(index, 1);
      renderChips();
    }
  }

  function renderChips() {
    replaceChildren(
      chips,
      names.map((name) =>
        el('li', { class: 'chips__item', dataset: { testid: `${testid}-item` } }, [
          el('span', { text: name }),
          el('button', {
            type: 'button',
            class: 'chips__remove',
            text: '×',
            'aria-label': `${name} を外す`,
            dataset: { testid: `${testid}-remove` },
            on: { click: () => remove(name) },
          }),
        ]),
      ),
    );
    chips.hidden = names.length === 0;
  }

  for (const initial of value) {
    add(initial);
  }
  renderChips();

  const element = field({
    id,
    label,
    hint,
    input,
    after: [datalist, addButton, chips],
  });
  element.classList.add('field--participants');

  return {
    element,

    /**
     * 入力された参加者を返す。「追加」を押していない入力欄の値も含める。
     *
     * @returns {string[]}
     */
    getValue() {
      const pending = input.value.trim();
      if (pending === '' || names.includes(pending)) {
        return [...names];
      }
      return [...names, pending];
    },

    /**
     * 候補だけを差し替える。入れ物の `datalist` は使い回す。
     *
     * @param {string[]} next
     */
    setCandidates(next) {
      replaceOptions(datalist, next);
    },

    focus() {
      input.focus();
    },
  };
}
