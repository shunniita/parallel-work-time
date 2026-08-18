// @vitest-environment happy-dom

/**
 * DOM組み立て補助の単体テスト。
 *
 * `src/ui/dom.js` は全ビューの生成経路であり、`innerHTML` 不使用の規律
 * （過去の実装計画）がここで守られている。属性の扱いと部分更新の挙動を、E2E ではなく
 * この層で固定する。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  append,
  el,
  field,
  replaceChildren,
  replaceOptions,
  setNote,
  setText,
} from '../../../src/ui/dom.js';

describe('el()', () => {
  it('タグ名の要素を作る', () => {
    expect(el('div').tagName).toBe('DIV');
  });

  it('class と text を専用の扱いにする', () => {
    const node = el('p', { class: 'note', text: '本文' });

    expect(node.className).toBe('note');
    expect(node.textContent).toBe('本文');
    // 属性としては設定しない。
    expect(node.hasAttribute('text')).toBe(false);
  });

  it('text は文字列として入れる（マークアップとして解釈しない）', () => {
    const node = el('p', { text: '<b>甲</b> & 乙' });

    expect(node.textContent).toBe('<b>甲</b> & 乙');
    expect(node.children).toHaveLength(0);
  });

  it('text が null なら設定しない', () => {
    expect(el('p', { text: null }).textContent).toBe('');
  });

  it('text の 0 と空文字は設定する', () => {
    expect(el('p', { text: 0 }).textContent).toBe('0');
    expect(el('p', { text: '' }).textContent).toBe('');
  });

  it('dataset をキャメルケースのまま受け取る', () => {
    const node = el('div', { dataset: { testid: 'row', taskRecordId: 'task-1' } });

    expect(node.dataset.testid).toBe('row');
    expect(node.getAttribute('data-task-record-id')).toBe('task-1');
  });

  it('dataset の null / undefined は設定しない', () => {
    const node = el('div', { dataset: { a: null, b: undefined, c: 'x' } });

    expect(node.dataset.a).toBeUndefined();
    expect(node.dataset.b).toBeUndefined();
    expect(node.dataset.c).toBe('x');
  });

  it('on でイベントを結ぶ', () => {
    const handler = vi.fn();
    const node = el('button', { on: { click: handler } });

    node.dispatchEvent(new window.Event('click'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('true の属性は空文字の属性として置く', () => {
    const node = el('button', { disabled: true });

    expect(node.hasAttribute('disabled')).toBe(true);
    expect(node.getAttribute('disabled')).toBe('');
  });

  it('false / null / undefined の属性は置かない', () => {
    const node = el('button', { disabled: false, hidden: null, title: undefined });

    expect(node.hasAttribute('disabled')).toBe(false);
    expect(node.hasAttribute('hidden')).toBe(false);
    expect(node.hasAttribute('title')).toBe(false);
  });

  it('数値の属性は文字列にして置く', () => {
    expect(el('input', { min: 1 }).getAttribute('min')).toBe('1');
  });

  it('子要素を追加する', () => {
    const node = el('ul', {}, [el('li', { text: 'A' }), el('li', { text: 'B' })]);

    expect(node.children).toHaveLength(2);
    expect(node.textContent).toBe('AB');
  });
});

describe('append()', () => {
  it('配列の入れ子を平らにして追加する', () => {
    const parent = el('div');

    append(parent, [el('span'), [el('span'), [el('span')]]]);

    expect(parent.children).toHaveLength(3);
  });

  it('null / undefined / false / 空文字は飛ばす', () => {
    const parent = el('div');

    append(parent, [null, undefined, false, '', el('span')]);

    expect(parent.childNodes).toHaveLength(1);
  });

  it('0 はテキストとして追加する（false と混同しない）', () => {
    const parent = el('div');

    append(parent, [0]);

    expect(parent.textContent).toBe('0');
  });

  it('Node でない値はテキストノードにする', () => {
    const parent = el('div');

    append(parent, '<b>甲</b>');

    expect(parent.textContent).toBe('<b>甲</b>');
    expect(parent.children).toHaveLength(0);
  });

  it('単体の子も受け取る', () => {
    const parent = el('div');

    append(parent, el('span'));

    expect(parent.children).toHaveLength(1);
  });
});

describe('replaceChildren()', () => {
  it('既存の中身を捨ててから入れ直す', () => {
    const parent = el('div', {}, [el('span', { text: '旧' })]);

    replaceChildren(parent, [el('p', { text: '新' })]);

    expect(parent.children).toHaveLength(1);
    expect(parent.textContent).toBe('新');
  });
});

describe('setText()', () => {
  it('テキストだけを差し替える', () => {
    const node = el('p', { class: 'note', text: '旧' });

    setText(node, '新');

    expect(node.textContent).toBe('新');
    // 要素は作り直さないので class は保たれる。
    expect(node.className).toBe('note');
  });

  it('null / undefined は空文字にする', () => {
    const node = el('p', { text: '旧' });

    setText(node, null);

    expect(node.textContent).toBe('');
  });

  it('参照が null でも落ちない', () => {
    expect(() => setText(null, 'x')).not.toThrow();
    expect(() => setText(undefined, 'x')).not.toThrow();
  });
});

describe('setNote()', () => {
  it('文言を入れると表示する', () => {
    const node = el('p');

    setNote(node, { text: '追加後の累計 30' });

    expect(node.textContent).toBe('追加後の累計 30');
    expect(node.hidden).toBe(false);
    expect(node.className).toBe('note');
  });

  it('warn で強調表示へ切り替える', () => {
    const node = el('p');

    setNote(node, { text: '超えます', warn: true });

    expect(node.className).toBe('note note--warn');
  });

  it('空文字で hidden にする', () => {
    const node = el('p');
    setNote(node, { text: '一度出す' });

    setNote(node, { text: '' });

    expect(node.textContent).toBe('');
    expect(node.hidden).toBe(true);
  });

  it('引数なしでも hidden の空注記になる', () => {
    const node = el('p');

    setNote(node);

    expect(node.hidden).toBe(true);
  });

  it('同じノードを繰り返し更新できる（部分更新の前提）', () => {
    const node = el('p');

    setNote(node, { text: '1', warn: true });
    setNote(node, { text: '2', warn: false });

    expect(node.textContent).toBe('2');
    expect(node.className).toBe('note');
    expect(node.hidden).toBe(false);
  });

  it('参照が null でも落ちない', () => {
    expect(() => setNote(null, { text: 'x' })).not.toThrow();
  });
});

describe('replaceOptions()', () => {
  it('選択肢だけを差し替え、入れ物の要素は使い回す', () => {
    const list = el('datalist', { id: 'variant-options' });
    replaceOptions(list, ['標準', '拡張']);

    replaceOptions(list, ['簡易']);

    expect([...list.children].map((option) => option.value)).toEqual(['簡易']);
    // 入力欄の `list` 属性が指す先が変わらないよう、id は保たれる。
    expect(list.id).toBe('variant-options');
  });

  it('空配列で選択肢を消す', () => {
    const list = el('datalist');
    replaceOptions(list, ['A']);

    replaceOptions(list, []);

    expect(list.children).toHaveLength(0);
  });

  it('参照が null でも落ちない', () => {
    expect(() => replaceOptions(null, ['A'])).not.toThrow();
  });
});

describe('field()', () => {
  it('label の for と入力欄の id を結ぶ', () => {
    const input = el('input', { type: 'text' });

    const node = field({ id: 'target-type', label: '対象種別', input });

    expect(input.id).toBe('target-type');
    expect(node.querySelector('label').getAttribute('for')).toBe('target-type');
  });

  it('hint を渡すと注記を添える', () => {
    const node = field({
      id: 'project-id',
      label: '案件ID',
      input: el('input'),
      hint: '一意です。',
    });

    expect(node.querySelector('.field__hint').textContent).toBe('一意です。');
  });

  it('hint が無ければ注記を置かない', () => {
    const node = field({ id: 'project-id', label: '案件ID', input: el('input') });

    expect(node.querySelector('.field__hint')).toBeNull();
  });

  it('after を入力欄の兄弟として置く（datalist をラッパーで包まない）', () => {
    const input = el('input', { list: 'variant-options' });
    const list = el('datalist', { id: 'variant-options' });

    const node = field({ id: 'variant', label: 'バリエーション', input, after: list });

    // ラッパーへ id が付いてしまう作りだと、for が実際の入力欄と無関係になる。
    expect(input.id).toBe('variant');
    expect(list.parentElement).toBe(node);
    expect(input.nextElementSibling).toBe(list);
  });
});
