/**
 * DOM組み立ての小さな補助。
 *
 * フレームワークを使わないため（仕様書5.1.4、5.1.5）、要素生成をここへ寄せる。
 * 文字列のHTMLを組み立てて `innerHTML` へ流す方式は取らない。利用者が入力した
 * 作業項目名や参加者名がそのままマークアップとして解釈される経路を作らないため。
 */

/**
 * 要素を作る。
 *
 * `attrs` の扱い:
 * - `class` / `text` / `dataset` / `on` 以外はそのまま属性として設定する
 * - `dataset` はオブジェクトで渡す
 * - `on` はイベント名 → ハンドラのオブジェクト
 * - `text` は `textContent` へ入れる（エスケープ不要）
 *
 * @param {string} tagName
 * @param {object} [attrs]
 * @param {(Node|string|null|undefined|false)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tagName, attrs = {}, children = []) {
  const element = document.createElement(tagName);
  const { class: className, text, dataset, on, ...rest } = attrs;

  if (className !== undefined) {
    element.className = className;
  }
  if (text !== undefined && text !== null) {
    element.textContent = String(text);
  }
  if (dataset !== undefined) {
    for (const [key, value] of Object.entries(dataset)) {
      if (value !== undefined && value !== null) {
        element.dataset[key] = String(value);
      }
    }
  }
  if (on !== undefined) {
    for (const [eventName, handler] of Object.entries(on)) {
      element.addEventListener(eventName, handler);
    }
  }
  for (const [name, value] of Object.entries(rest)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }
    if (value === true) {
      element.setAttribute(name, '');
      continue;
    }
    element.setAttribute(name, String(value));
  }

  append(element, children);
  return element;
}

/**
 * 子要素を追加する。配列の入れ子と null / false を許す。
 *
 * @param {HTMLElement} parent
 * @param {unknown} children
 */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === '') {
      continue;
    }
    if (Array.isArray(child)) {
      append(parent, child);
      continue;
    }
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * 要素の中身を差し替える。
 *
 * 既存の子要素をすべて破棄する。フォーカス中の入力欄が中にあると、その要素ごと
 * 消えてフォーカスが `body` へ飛ぶ。入力に反応して表示を変えたいだけの場面では
 * これを呼ばず、下の部分更新（{@link setText} / {@link setNote} /
 * {@link replaceOptions}）を使う。
 *
 * @param {HTMLElement} parent
 * @param {unknown} children
 */
export function replaceChildren(parent, children) {
  parent.textContent = '';
  append(parent, children);
}

/*
 * 以下は部分更新のための道具である。
 *
 * 再描画せずに既存ノードの中身だけを書き換える経路を、ここに集約する。入力中の
 * 先読み表示や、Step 6 で入る「1分ごとの経過時間の再評価」（仕様書8.8）のように
 * 「値だけが変わり構造は変わらない」更新で使う。全再描画で済ませると、記入途中の
 * 入力・フォーカス・スクロール位置・datalist のポップアップが毎回失われる。
 */

/**
 * ノードのテキストだけを差し替える。
 *
 * @param {HTMLElement|null} node
 * @param {unknown} text `null` / `undefined` は空文字として扱う
 */
export function setText(node, text) {
  if (node === null || node === undefined) {
    return;
  }
  node.textContent = text === null || text === undefined ? '' : String(text);
}

/**
 * 注記ノードのテキストと強調表示をまとめて差し替える。
 *
 * 空文字を渡すと `hidden` にする。表示の有無が変わるだけで要素は作り直さないため、
 * 参照を持ったまま繰り返し更新できる。
 *
 * @param {HTMLElement|null} node
 * @param {{text?: string, warn?: boolean}} state
 */
export function setNote(node, { text = '', warn = false } = {}) {
  if (node === null || node === undefined) {
    return;
  }
  setText(node, text);
  node.className = warn ? 'note note--warn' : 'note';
  node.hidden = text === '';
}

/**
 * `datalist` や `select` の選択肢だけを差し替える。
 *
 * 入れ物の要素は使い回す。`datalist` を作り直すと、紐づく入力欄の `list` 属性が
 * 指す先が変わり、開いている候補ポップアップが閉じる。
 *
 * @param {HTMLElement|null} node
 * @param {string[]} values
 */
export function replaceOptions(node, values) {
  if (node === null || node === undefined) {
    return;
  }
  replaceChildren(
    node,
    values.map((value) => el('option', { value })),
  );
}

/**
 * ラベルと入力欄の組を作る。
 *
 * `label` の `for` と入力欄の `id` を結ぶ。キーボードで主要入力欄へ到達できる
 * ようにするため（仕様書13章）、入力欄は素の `input` / `select` を使う。
 *
 * `input` には必ず生の入力要素を渡す。ラッパー要素を渡すと `id` がラッパーへ付き、
 * `for` が実際の入力欄と無関係になってラベルクリックも支援技術への伝達も効かなく
 * なる。`datalist` のような付随要素は `after` で入力欄の兄弟として置く。
 *
 * @param {{id: string, label: string, input: HTMLElement, hint?: string,
 *          after?: unknown}} options
 * @returns {HTMLElement}
 */
export function field({ id, label, input, hint, after }) {
  input.id = id;
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: id, text: label }),
    input,
    after,
    hint !== undefined && el('p', { class: 'field__hint', text: hint }),
  ]);
}
