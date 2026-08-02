/**
 * メモリ上の状態と購読通知。
 *
 * フレームワークを使わないため（仕様書5.1.4、5.1.5）、状態の保持と再描画の
 * きっかけを自前で持つ。保存先の内容は `dataset` として丸ごと抱え、画面の選択
 * 状態やエラー表示は同じ状態オブジェクトへ並べる。
 *
 * ## 再描画の規約
 *
 * 描画のきっかけを3段に分ける。どれを使うかは「何が変わったか」で決める。
 *
 * 1. **アプリ全体の状態**（`dataset` / `view` / `selection`）を変えるときは
 *    `setState()` を呼ぶ。再描画は `main.js` が張るストア購読1本が受け持つ。
 *    呼び出し側は `render()` を書かない。書き忘れても誰も気づかない構造を
 *    残さないため、また同じデータを見ている複数の表示領域（左ツリーと詳細ペイン
 *    など）が同時に更新されることを保証するためである。
 * 2. **ビュー内部の編集状態**（下書き・エラー・展開の有無）を変えるときは、
 *    そのビュー自身の `render()` だけを呼ぶ。ストアは触らない。
 * 3. **値だけが変わり構造は変わらない**とき（入力中の先読み表示、Step 6 の
 *    1分ごとの経過時間）は、どちらも呼ばない。`src/ui/dom.js` の
 *    `setText` / `setNote` / `replaceOptions` で対象ノードだけを書き換える。
 *
 * 入力欄への打ち込みで 1. や 2. を呼んではならない。`replaceChildren` は DOM を
 * 全消去するため、フォーカス中の入力欄ごと破棄され、1文字目で入力欄から
 * 抜けてしまう。
 *
 * 初版の性能目標（案件20件・実施回100件・区間2,000件、仕様書13章）に対しては、
 * 1. の全再描画で足りる。差分描画の仕組みは持たない。
 */

/**
 * ストアを作る。
 *
 * @template T
 * @param {T} initialState
 * @returns {{getState: () => T, setState: (updater: object|((state: T) => object)) => T,
 *            subscribe: (listener: (state: T) => void) => () => void}}
 */
export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  /**
   * 状態を更新して購読者へ通知する。
   *
   * 更新は浅いマージとする。入れ子を書き換える場合は呼び出し側で新しい
   * オブジェクトを作る。関数を渡すと現在の状態を受け取れる。
   *
   * @param {object|((state: T) => object)} updater
   * @returns {T} 更新後の状態
   */
  function setState(updater) {
    const patch = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...patch };
    // 通知中に購読が解除されても走査が壊れないよう、複製へ対して回す。
    for (const listener of [...listeners]) {
      listener(state);
    }
    return state;
  }

  /**
   * @param {(state: T) => void} listener
   * @returns {() => void} 購読を解除する関数
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}
