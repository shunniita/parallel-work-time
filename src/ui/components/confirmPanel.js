/**
 * 理由を伴わない確認（仕様書7.1）。
 *
 * 「このまま続けてよいか」だけを尋ねる。理由の入力が要る確認は
 * `reasonConfirm.js` が扱う（削除、転記済みの取り消し）。両者を1つにまとめない
 * のは、理由が必須かどうかが操作の意味そのものだからである。変更履歴へ残す操作
 * （11章）は理由が要り、そうでない操作は要らない。
 *
 * 現在の利用先は、集計済みの実施回で作業を再開するときの確認である。集計済みは
 * 「未終了区間がない」状態なので、再開すると実施回を作業中へ戻すことになる。
 * 黙って戻さず、何が起きるかを示してから続ける（仕様書7.1）。
 *
 * モーダルにしない理由は `reasonConfirm.js` と同じである。対象の近くへインラインで
 * 差し込む。
 */

import { toErrorMessages } from '../../app/errors.js';
import { el, replaceChildren } from '../dom.js';

/**
 * 確認パネルを作る。
 *
 * @param {{title: string, description: string, confirmLabel?: string,
 *          note?: string, testidPrefix?: string,
 *          onConfirm: () => Promise<unknown>, onCancel: () => void}} options
 * @returns {{element: HTMLElement, focus: () => void}}
 */
export function createConfirmPanel({
  title,
  description,
  confirmLabel = '続行する',
  note,
  testidPrefix = 'confirm',
  onConfirm,
  onCancel,
}) {
  const errorBox = el('div', {
    class: 'errors',
    role: 'alert',
    dataset: { testid: `${testidPrefix}-errors` },
    hidden: true,
  });

  const confirmButton = el('button', {
    type: 'button',
    class: 'button button--primary',
    text: confirmLabel,
    dataset: { testid: `${testidPrefix}-accept` },
    on: { click: submit },
  });

  const cancelButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'やめる',
    dataset: { testid: `${testidPrefix}-cancel` },
    on: { click: () => onCancel() },
  });

  /**
   * @param {string[]} messages
   */
  function showErrors(messages) {
    replaceChildren(errorBox, [
      el('p', { class: 'errors__title', text: '続行できません' }),
      el(
        'ul',
        {},
        messages.map((message) => el('li', { text: message })),
      ),
    ]);
    errorBox.hidden = false;
  }

  /**
   * @param {boolean} busy
   */
  function setBusy(busy) {
    confirmButton.disabled = busy;
    cancelButton.disabled = busy;
  }

  async function submit() {
    errorBox.hidden = true;
    setBusy(true);
    try {
      await onConfirm();
      // 成功した場合、この要素は親の再描画で捨てられる。ここでは何もしない。
    } catch (error) {
      showErrors(toErrorMessages(error));
    } finally {
      setBusy(false);
    }
  }

  const element = el(
    'section',
    {
      class: 'card card--warn',
      dataset: { testid: `${testidPrefix}-panel` },
      role: 'alertdialog',
      'aria-label': title,
    },
    [
      el('h3', { class: 'card__title', text: title }),
      errorBox,
      el('p', { dataset: { testid: `${testidPrefix}-description` }, text: description }),
      note !== undefined && el('p', { class: 'note', text: note }),
      el('div', { class: 'actions' }, [confirmButton, cancelButton]),
    ],
  );

  return {
    element,
    focus() {
      confirmButton.focus();
    },
  };
}
