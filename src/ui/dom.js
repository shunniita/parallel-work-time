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
 * - `class` / `text` / `html` 以外はそのまま属性として設定する
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
 * @param {HTMLElement} parent
 * @param {unknown} children
 */
export function replaceChildren(parent, children) {
  parent.textContent = '';
  append(parent, children);
}

/**
 * ラベルと入力欄の組を作る。
 *
 * `label` の `for` と入力欄の `id` を結ぶ。キーボードで主要入力欄へ到達できる
 * ようにするため（仕様書13章）、入力欄は素の `input` / `select` を使う。
 *
 * @param {{id: string, label: string, input: HTMLElement, hint?: string}} options
 * @returns {HTMLElement}
 */
export function field({ id, label, input, hint }) {
  input.id = id;
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: id, text: label }),
    input,
    hint !== undefined && el('p', { class: 'field__hint', text: hint }),
  ]);
}
