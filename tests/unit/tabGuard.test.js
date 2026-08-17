// @vitest-environment happy-dom

/**
 * 多重タブ検知の単体テスト（仕様書8.10）。
 *
 * 実際の `BroadcastChannel` の代わりに、同じバスへつながる偽チャンネルを使う。
 * 実ブラウザでの往復は E2E（T-14）が確かめる。
 *
 * `pagehide` / `pageshow` を投げるため happy-dom で動かす。タブの寿命は
 * 「起動と終了」だけではなく、BFCache への退避と復帰を含む（過去のレビュー指摘）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startTabGuard } from '../../src/app/tabGuard.js';

/** 同じバスにつながる偽チャンネルを作る。 */
function createBus() {
  const channels = [];
  return {
    connect() {
      const listeners = new Set();
      const channel = {
        postMessage(data) {
          // BroadcastChannel と同じく、送信者自身へは届かない。
          for (const other of channels) {
            if (other.channel !== channel) {
              for (const listener of other.listeners) {
                listener({ data });
              }
            }
          }
        },
        addEventListener(_type, listener) {
          listeners.add(listener);
        },
        removeEventListener(_type, listener) {
          listeners.delete(listener);
        },
        close: vi.fn(),
      };
      channels.push({ channel, listeners });
      return channel;
    },
  };
}

/** この試験で開いたタブ。`pagehide` が他の試験のタブへ届かないよう後始末する。 */
const opened = [];

afterEach(() => {
  while (opened.length > 0) {
    opened.pop().dispose();
  }
});

/**
 * タブを1つ開く。
 *
 * タブごとに別の `lifecycle` を渡し、片方だけを退避させられるようにする。
 */
function openTab(bus, id) {
  const onChange = vi.fn();
  const lifecycle = new EventTarget();
  const guard = startTabGuard({ onChange, channel: bus.connect(), tabId: id, lifecycle });
  opened.push(guard);
  return { guard, onChange, lifecycle };
}

/**
 * ページ遷移の便りを投げる。
 *
 * `persisted` は BFCache への退避・復帰を表す。`new Event()` では設定できない
 * ため、後から生やす。
 *
 * @param {{lifecycle: EventTarget}} tab
 * @param {'pagehide'|'pageshow'} type
 * @param {boolean} persisted
 */
function firePageTransition(tab, type, persisted) {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  tab.lifecycle.dispatchEvent(event);
}

describe('startTabGuard（仕様書8.10）', () => {
  it('1タブだけなら何も検知しない', () => {
    const bus = createBus();

    const tab = openTab(bus, 'tab-a');

    expect(tab.guard.peerCount()).toBe(0);
    expect(tab.onChange).not.toHaveBeenCalled();
  });

  it('2タブ目を開くと両方が検知する', () => {
    const bus = createBus();
    const first = openTab(bus, 'tab-a');

    const second = openTab(bus, 'tab-b');

    // 先行タブは hello を、後発タブは ack を受けて知る。
    expect(first.guard.peerCount()).toBe(1);
    expect(second.guard.peerCount()).toBe(1);
    expect(first.onChange).toHaveBeenLastCalledWith(true);
    expect(second.onChange).toHaveBeenLastCalledWith(true);
  });

  it('相手が閉じると検知が解ける', () => {
    const bus = createBus();
    const first = openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');

    second.guard.dispose();

    expect(first.guard.peerCount()).toBe(0);
    expect(first.onChange).toHaveBeenLastCalledWith(false);
  });

  it('3タブでも数え違えない', () => {
    const bus = createBus();
    const first = openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');
    const third = openTab(bus, 'tab-c');

    expect(first.guard.peerCount()).toBe(2);
    expect(second.guard.peerCount()).toBe(2);
    expect(third.guard.peerCount()).toBe(2);

    third.guard.dispose();

    expect(first.guard.peerCount()).toBe(1);
    expect(second.guard.peerCount()).toBe(1);
  });

  it('自分の送信は数えない', () => {
    const bus = createBus();
    const tab = openTab(bus, 'tab-a');

    // 偽バスは自分へ配らないが、実装側も sender で自衛している。直接届けて確かめる。
    const channel = bus.connect();
    channel.postMessage({ type: 'hello', sender: 'tab-a' });

    expect(tab.guard.peerCount()).toBe(0);
  });

  it('チャンネルが無い環境では何もしない', () => {
    const onChange = vi.fn();

    const guard = startTabGuard({ onChange, channel: null });

    expect(guard.peerCount()).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('型の合わない便りは無視する', () => {
    const bus = createBus();
    const tab = openTab(bus, 'tab-a');
    const channel = bus.connect();

    channel.postMessage(null);
    channel.postMessage({ type: 'hello' });
    channel.postMessage({ type: 'unknown', sender: 'tab-x' });

    expect(tab.guard.peerCount()).toBe(0);
  });
});

describe('BFCache への退避と復帰（過去のレビュー指摘）', () => {
  it('退避すると相手から外れる', () => {
    // 退避中のページは操作できないため、相手の一覧から外れるのは正しい。
    const bus = createBus();
    const first = openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');

    firePageTransition(second, 'pagehide', true);

    expect(first.guard.peerCount()).toBe(0);
    expect(first.onChange).toHaveBeenLastCalledWith(false);
  });

  it('復帰すると相手が知り直す', () => {
    // `pageshow` で名乗り直さないと、両方のタブが操作可能なのに片側だけ警告が
    // 出ない状態が残る。
    const bus = createBus();
    const first = openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');
    firePageTransition(second, 'pagehide', true);
    expect(first.guard.peerCount()).toBe(0);

    firePageTransition(second, 'pageshow', true);

    expect(first.guard.peerCount()).toBe(1);
    expect(second.guard.peerCount()).toBe(1);
    expect(first.onChange).toHaveBeenLastCalledWith(true);
    expect(second.onChange).toHaveBeenLastCalledWith(true);
  });

  it('退避中は自分の記憶も捨てる', () => {
    // 止まっているあいだに相手が閉じても `bye` を受け取れない。復帰直後の記憶は
    // 当てにならないので、数え直す。
    const bus = createBus();
    openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');
    expect(second.guard.peerCount()).toBe(1);

    firePageTransition(second, 'pagehide', true);

    expect(second.guard.peerCount()).toBe(0);
    expect(second.onChange).toHaveBeenLastCalledWith(false);
  });

  it('退避中に相手が閉じたら、復帰後は警告を出さない', () => {
    const bus = createBus();
    const first = openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');

    firePageTransition(second, 'pagehide', true);
    first.guard.dispose();
    firePageTransition(second, 'pageshow', true);

    expect(second.guard.peerCount()).toBe(0);
    expect(second.onChange).toHaveBeenLastCalledWith(false);
  });

  it('通常の離脱では記憶を捨てない', () => {
    // `persisted` が false の `pagehide` はページの破棄であり、復帰しない。
    const bus = createBus();
    openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');

    firePageTransition(second, 'pagehide', false);

    expect(second.guard.peerCount()).toBe(1);
  });

  it('初回表示の pageshow では名乗り直さない', () => {
    // 通常の読み込みでも `pageshow` は起きる（`persisted` は false）。ここで
    // 送ると起動時の `hello` と二重になる。
    const bus = createBus();
    const first = openTab(bus, 'tab-a');
    const second = openTab(bus, 'tab-b');
    first.onChange.mockClear();

    firePageTransition(second, 'pageshow', false);

    expect(first.onChange).not.toHaveBeenCalled();
  });
});
