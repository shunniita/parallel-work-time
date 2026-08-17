/**
 * 同一データを開く複数タブの検知（仕様書8.10）。
 *
 * `BroadcastChannel` で同一オリジンのタブどうしが名乗り合う。検知したら警告を
 * 出すだけで、ロックや強制終了は行わない（8.10 が明示的に不要としている）。
 *
 * ## 手順
 *
 * 1. 起動時に `hello` を送る。
 * 2. `hello` を受けたタブは相手を覚え、`ack` を返す。後から開いたタブは
 *    この `ack` で先行タブの存在を知る。
 * 3. タブを離れるとき（`pagehide`）に `bye` を送り、受けた側は相手を忘れる。
 * 4. BFCache から戻ったとき（`pageshow` の `persisted`）に `hello` を送り直す。
 *
 * ## 退避と復帰を「終了と起動」と同じに扱う（過去のレビュー指摘）
 *
 * `pagehide` はタブを閉じたときだけでなく、ブラウザがページを BFCache へ退避
 * するときにも起きる。退避中のページは操作できないので、相手の一覧から外すのは
 * 正しい。ところが復帰時には `pageshow` が起きるだけで、`hello` を送り直さないと
 * **相手からは消えたままになる**。両方のタブが操作可能なのに、片側だけ警告が
 * 出ない状態が残る。
 *
 * 退避時には自分が覚えている相手も忘れる。止まっているあいだに相手が閉じても
 * `bye` を受け取れないため、復帰直後の記憶は当てにならない。復帰したら名乗り
 * 直して、`ack` が返ってきた相手だけを数える。
 *
 * クラッシュしたタブは `bye` を送れないため、警告が残ることがある。過剰に
 * 警告する方向の誤りであり、同時操作を見逃す方向ではないので許容する。
 * 再読み込みで作り直される。
 *
 * `BroadcastChannel` が無い環境では何もしない。検知できないだけで、アプリの
 * 動作には影響させない。
 */

import { TAB_CHANNEL_NAME } from '../config.js';

/**
 * タブ検知を始める。
 *
 * @param {{onChange: (hasPeers: boolean) => void,
 *          channel?: {postMessage: Function, close: Function,
 *                     addEventListener: Function}|null,
 *          tabId?: string,
 *          lifecycle?: EventTarget}} options
 *   `channel` と `lifecycle` はテストで差し替えるために受け取る。`channel` の
 *   省略時は `TAB_CHANNEL_NAME` の `BroadcastChannel` を作る。`lifecycle` は
 *   `pagehide` / `pageshow` の発生源で、既定は `globalThis`。単体テストでは
 *   タブごとに別の発生源を渡し、片方だけを退避させる。
 * @returns {{peerCount: () => number, dispose: () => void}}
 */
export function startTabGuard({ onChange, channel, tabId, lifecycle = globalThis }) {
  const resolved =
    channel !== undefined
      ? channel
      : typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(TAB_CHANNEL_NAME);
  if (resolved === null) {
    return { peerCount: () => 0, dispose: () => {} };
  }

  const id = tabId ?? (globalThis.crypto?.randomUUID?.() ?? `tab-${Math.random()}`);
  const peers = new Set();

  function notify() {
    onChange(peers.size > 0);
  }

  function handleMessage(event) {
    const { type, sender } = event.data ?? {};
    if (typeof sender !== 'string' || sender === id) {
      return;
    }
    if (type === 'hello') {
      peers.add(sender);
      // 後から開いたタブが先行タブを知る手段はこの返信だけである。
      resolved.postMessage({ type: 'ack', sender: id });
      notify();
    } else if (type === 'ack') {
      peers.add(sender);
      notify();
    } else if (type === 'bye') {
      peers.delete(sender);
      notify();
    }
  }

  /**
   * 離脱時。BFCache への退避でも起きる。
   *
   * @param {{persisted?: boolean}} [event]
   */
  function handlePageHide(event) {
    resolved.postMessage({ type: 'bye', sender: id });
    if (event?.persisted === true && peers.size > 0) {
      // 止まっているあいだに相手が閉じても `bye` を受け取れない。復帰したら
      // 名乗り直して数え直す。
      peers.clear();
      notify();
    }
  }

  /**
   * 復帰時。BFCache から戻った場合だけ名乗り直す。
   *
   * @param {{persisted?: boolean}} [event]
   */
  function handlePageShow(event) {
    if (event?.persisted === true) {
      resolved.postMessage({ type: 'hello', sender: id });
    }
  }

  resolved.addEventListener('message', handleMessage);
  lifecycle?.addEventListener?.('pagehide', handlePageHide);
  lifecycle?.addEventListener?.('pageshow', handlePageShow);
  resolved.postMessage({ type: 'hello', sender: id });

  return {
    peerCount: () => peers.size,
    dispose: () => {
      resolved.postMessage({ type: 'bye', sender: id });
      resolved.removeEventListener('message', handleMessage);
      lifecycle?.removeEventListener?.('pagehide', handlePageHide);
      lifecycle?.removeEventListener?.('pageshow', handlePageShow);
      resolved.close?.();
    },
  };
}
