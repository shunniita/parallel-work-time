// @vitest-environment happy-dom

/**
 * 未実装画面の受け皿の単体テスト（レビュー指摘 B-6）。
 *
 * 未登録のビュー名が案件詳細へ落ちないことを、ビューの登録表と合わせて担保する。
 */

import { describe, expect, it } from 'vitest';

import { createPlaceholderView } from '../../../src/ui/views/placeholderView.js';

describe('createPlaceholderView', () => {
  it('見出しと理由を出す', () => {
    const container = document.createElement('div');
    const view = createPlaceholderView({
      container,
      title: '集計・転記',
      note: '実装計画 Step 8 で作ります。',
    });

    view.render();

    expect(container.querySelector('.view__title').textContent).toBe('集計・転記');
    expect(container.querySelector('[data-testid="placeholder-view"]').textContent).toBe(
      '実装計画 Step 8 で作ります。',
    );
  });

  it('理由を省くと既定の文言を出す', () => {
    const container = document.createElement('div');

    createPlaceholderView({ container, title: 'アーカイブ' }).render();

    expect(container.textContent).toContain('まだ実装していません');
  });

  it('testid を変えられる（未知のビュー用）', () => {
    const container = document.createElement('div');

    createPlaceholderView({
      container,
      title: '画面が見つかりません',
      testid: 'unknown-view',
    }).render();

    expect(container.querySelector('[data-testid="unknown-view"]')).not.toBeNull();
  });

  it('描き直しても内容が重ならない', () => {
    const container = document.createElement('div');
    const view = createPlaceholderView({ container, title: '設定' });

    view.render();
    view.render();

    expect(container.querySelectorAll('.view__title')).toHaveLength(1);
  });
});
