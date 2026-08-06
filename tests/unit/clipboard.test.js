// @vitest-environment happy-dom

/**
 * クリップボード書き出しの単体テスト（仕様書8.7.7）。
 *
 * `navigator.clipboard` は安全なコンテキストでしか使えず、本ツールは HTTP 配信も
 * 想定する（仕様書5.1.3）。2経路とも試すことと、どちらも駄目なら理由を返すことを
 * 固定する。
 */

import { describe, expect, it, vi } from 'vitest';

import { writeToClipboard } from '../../src/io/clipboard.js';

/** `document.execCommand` を差し替えた文書を作る。 */
function fakeDocument(execResult) {
  return {
    execCommand: vi.fn(() => execResult),
    createElement: (tagName) => document.createElement(tagName),
    body: document.body,
  };
}

describe('writeToClipboard()', () => {
  it('navigator.clipboard が使えればそれで書く', async () => {
    const clipboard = { writeText: vi.fn(async () => {}) };

    const result = await writeToClipboard('X-100\t10', { clipboard });

    expect(clipboard.writeText).toHaveBeenCalledWith('X-100\t10');
    expect(result).toEqual({ ok: true, method: 'clipboard', reason: null });
  });

  it('空文字は書かずに理由を返す', async () => {
    const clipboard = { writeText: vi.fn(async () => {}) };

    const result = await writeToClipboard('', { clipboard });

    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('コピーする内容がありません');
  });

  it('clipboard が無ければ execCommand へ落とす', async () => {
    const doc = fakeDocument(true);

    const result = await writeToClipboard('X-100\t10', { clipboard: undefined, document: doc });

    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(result).toEqual({ ok: true, method: 'execCommand', reason: null });
  });

  it('clipboard が拒否されたら execCommand へ落とす', async () => {
    // 権限を拒否された場合など。書けないまま黙って終わらせない。
    const clipboard = { writeText: vi.fn(async () => { throw new Error('拒否'); }) };
    const doc = fakeDocument(true);

    const result = await writeToClipboard('X-100\t10', { clipboard, document: doc });

    expect(result.method).toBe('execCommand');
  });

  it('どちらも使えなければ理由を返す', async () => {
    const doc = fakeDocument(false);

    const result = await writeToClipboard('X-100\t10', { clipboard: undefined, document: doc });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('選択してコピー');
  });

  it('execCommand を持たない文書でも例外にしない', async () => {
    const result = await writeToClipboard('X-100\t10', {
      clipboard: undefined,
      document: { createElement: () => document.createElement('textarea'), body: document.body },
    });

    expect(result.ok).toBe(false);
  });

  it('書き出しに使った要素を残さない', async () => {
    const before = document.body.childElementCount;
    const doc = fakeDocument(true);

    await writeToClipboard('X-100\t10', { clipboard: undefined, document: doc });

    expect(document.body.childElementCount).toBe(before);
  });
});
