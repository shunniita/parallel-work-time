// @vitest-environment happy-dom

/**
 * 参加者入力欄の単体テスト（仕様書8.4.6、8.4.7）。
 *
 * 追加・削除・候補は組み立ての分岐でしかない。E2E では1件ごとに実ブラウザの
 * 起動が要るため、ここで固定して E2E は導線の確認に絞る。
 */

import { describe, expect, it } from 'vitest';

import { createParticipantsInput } from '../../../src/ui/components/participantsInput.js';

/**
 * 入力欄を作って DOM へ載せる。
 *
 * @param {object} [options]
 */
function mount(options = {}) {
  const component = createParticipantsInput({ id: 'participants', ...options });
  document.body.replaceChildren(component.element);
  return {
    component,
    input: component.element.querySelector('[data-testid="participants"]'),
    addButton: component.element.querySelector('[data-testid="participants-add"]'),
    items: () =>
      [...component.element.querySelectorAll('[data-testid="participants-item"] span')].map(
        (node) => node.textContent,
      ),
    remove: (index) =>
      component.element
        .querySelectorAll('[data-testid="participants-remove"]')
        [index].click(),
  };
}

describe('createParticipantsInput', () => {
  it('「追加」で参加者を積む', () => {
    const view = mount();

    view.input.value = '甲';
    view.addButton.click();
    view.input.value = '乙';
    view.addButton.click();

    expect(view.items()).toEqual(['甲', '乙']);
    expect(view.component.getValue()).toEqual(['甲', '乙']);
  });

  it('Enter でも追加できる', () => {
    const view = mount();

    view.input.value = '甲';
    view.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(view.items()).toEqual(['甲']);
  });

  it('追加すると入力欄を空にして次を打てるようにする', () => {
    const view = mount();

    view.input.value = '甲';
    view.addButton.click();

    expect(view.input.value).toBe('');
  });

  it('前後空白を落とす', () => {
    const view = mount();

    view.input.value = '  甲  ';
    view.addButton.click();

    expect(view.component.getValue()).toEqual(['甲']);
  });

  it('空文字は追加しない', () => {
    const view = mount();

    view.input.value = '   ';
    view.addButton.click();

    expect(view.items()).toEqual([]);
  });

  it('同じ名前は二重に積まない', () => {
    const view = mount();

    view.input.value = '甲';
    view.addButton.click();
    view.input.value = '甲';
    view.addButton.click();

    expect(view.items()).toEqual(['甲']);
  });

  it('表記が違えば別人として扱う（仕様書8.9.9）', () => {
    const view = mount();

    view.input.value = '甲';
    view.addButton.click();
    view.input.value = '甲 太郎';
    view.addButton.click();

    expect(view.items()).toEqual(['甲', '甲 太郎']);
  });

  it('×で外せる', () => {
    const view = mount({ value: ['甲', '乙'] });

    view.remove(0);

    expect(view.component.getValue()).toEqual(['乙']);
  });

  it('初期値を持って始められる（参加者の引き継ぎ）', () => {
    const view = mount({ value: ['甲', '乙'] });

    expect(view.items()).toEqual(['甲', '乙']);
  });

  it('「追加」を押していない入力欄の値も参加者として数える', () => {
    const view = mount();

    view.input.value = '甲';
    view.addButton.click();
    // 押し忘れたまま保存へ進んだ場合。参加者が欠けた記録を残さない。
    view.input.value = '乙';

    expect(view.component.getValue()).toEqual(['甲', '乙']);
  });

  it('未確定の入力が既に積んだ名前と同じなら重複させない', () => {
    const view = mount({ value: ['甲'] });

    view.input.value = '甲';

    expect(view.component.getValue()).toEqual(['甲']);
  });

  it('候補を datalist へ出す（仕様書8.4.7）', () => {
    const view = mount({ candidates: ['甲', '乙'] });

    const options = [...view.component.element.querySelectorAll('option')].map(
      (option) => option.value,
    );
    expect(options).toEqual(['甲', '乙']);
    expect(view.input.getAttribute('list')).toBe('participants-options');
  });

  it('候補の差し替えで入力欄を作り直さない', () => {
    const view = mount({ candidates: ['甲'] });
    view.input.value = '入力中';

    view.component.setCandidates(['甲', '乙', '丙']);

    // 入れ物を使い回すため、打ち込み中の値も候補ポップアップも保たれる。
    expect(view.input.value).toBe('入力中');
    expect([...view.component.element.querySelectorAll('option')]).toHaveLength(3);
  });

  it('ラベルが入力欄と結び付いている（過去のレビュー指摘）', () => {
    const view = mount();

    const label = view.component.element.querySelector('label');
    expect(label.getAttribute('for')).toBe('participants');
    expect(view.input.id).toBe('participants');
  });
});
