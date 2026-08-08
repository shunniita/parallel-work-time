/**
 * 多重タブ検知の単体テスト（仕様書8.10）。
 *
 * 実際の `BroadcastChannel` の代わりに、同じバスへつながる偽チャンネルを使う。
 * 実ブラウザでの往復は E2E（T-14）が確かめる。
 */

import { describe, expect, it, vi } from 'vitest';

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

/** タブを1つ開く。 */
function openTab(bus, id) {
  const onChange = vi.fn();
  const guard = startTabGuard({ onChange, channel: bus.connect(), tabId: id });
  return { guard, onChange };
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
