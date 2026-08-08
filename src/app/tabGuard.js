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
 * 3. タブを閉じるとき（`pagehide`）に `bye` を送り、受けた側は相手を忘れる。
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
 *          tabId?: string}} options
 *   `channel` はテストで差し替えるために受け取る。省略時は
 *   `TAB_CHANNEL_NAME` の `BroadcastChannel` を作る。
 * @returns {{peerCount: () => number, dispose: () => void}}
 */
export function startTabGuard({ onChange, channel, tabId }) {
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

  function handlePageHide() {
    resolved.postMessage({ type: 'bye', sender: id });
  }

  resolved.addEventListener('message', handleMessage);
  globalThis.addEventListener?.('pagehide', handlePageHide);
  resolved.postMessage({ type: 'hello', sender: id });

  return {
    peerCount: () => peers.size,
    dispose: () => {
      resolved.postMessage({ type: 'bye', sender: id });
      resolved.removeEventListener('message', handleMessage);
      globalThis.removeEventListener?.('pagehide', handlePageHide);
      resolved.close?.();
    },
  };
}
