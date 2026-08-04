/**
 * 区間削除の確認（仕様書8.4.5、11章）。
 *
 * 削除前に対象区間の内容を示し、理由の入力を必須とする。確認に出す文言と、
 * 削除に伴う変更履歴の要約は同じ関数（`describeInterval`）から作られる
 * （`src/app/actions/intervalActions.js` の `previewIntervalDeletion`）。
 * 「確認した内容」と「履歴に残る内容」が食い違わない。
 *
 * ## モーダルにしなかった理由
 *
 * 設計メモは削除前の確認を「ダイアログ」と呼んでいるが、本ツールの画面は
 * どこにもオーバーレイ（モーダル）を持たない。区間履歴の対象行の直下へ差し込む
 * 形にし、他の確認・編集フォーム（`intervalOperationForm.js`、
 * `intervalEntryForm.js`）と同じ「対象の近くにインラインで置く」流儀に合わせた。
 * 削除は取り消せない操作だが、理由入力を必須にし確定ボタンを主要ボタンにしない
 * ことで、うっかり押しても続行できない形にしている。
 *
 * 実施回が転記済み・アーカイブの場合、呼び出し側（`taskDetailView.js`）は
 * 削除ボタン自体を出さないため通常は開かれない。万一開かれた場合に備え、
 * `preview.deletable` が false なら確定ボタンを無効にし、理由を示す。
 */

import { toErrorMessages } from '../../app/errors.js';
import { el, field, replaceChildren } from '../dom.js';

/**
 * 削除確認を作る。
 *
 * @param {{preview: {description: string, deletable: boolean,
 *          blockedReason: string|null}, idPrefix?: string,
 *          onConfirm: (reason: string) => Promise<unknown>,
 *          onCancel: () => void}} options
 * @returns {{element: HTMLElement, focus: () => void}}
 */
export function createDeleteIntervalConfirm({ preview, idPrefix = 'delete', onConfirm, onCancel }) {
  const reasonInput = el('textarea', {
    class: 'input',
    rows: '2',
    dataset: { testid: 'delete-reason' },
  });

  const errorBox = el('div', {
    class: 'errors',
    role: 'alert',
    dataset: { testid: 'delete-errors' },
    hidden: true,
  });

  const confirmButton = el('button', {
    type: 'button',
    class: 'button button--danger',
    text: '削除する',
    dataset: { testid: 'delete-confirm' },
    disabled: !preview.deletable,
    on: { click: submit },
  });

  const cancelButton = el('button', {
    type: 'button',
    class: 'button',
    text: '取消',
    dataset: { testid: 'delete-cancel' },
    on: { click: () => onCancel() },
  });

  /**
   * @param {string[]} messages
   */
  function showErrors(messages) {
    replaceChildren(errorBox, [
      el('p', { class: 'errors__title', text: '削除できません' }),
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
    confirmButton.disabled = busy || !preview.deletable;
    cancelButton.disabled = busy;
  }

  async function submit() {
    const reason = reasonInput.value.trim();
    if (reason === '') {
      showErrors(['理由: 必須項目である（仕様書11章）']);
      reasonInput.focus();
      return;
    }

    errorBox.hidden = true;
    setBusy(true);
    try {
      await onConfirm(reason);
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
      dataset: { testid: 'delete-confirm-panel' },
      role: 'alertdialog',
      'aria-label': '区間の削除確認',
    },
    [
      el('h3', { class: 'card__title', text: '区間を削除します' }),
      errorBox,
      el('p', {
        dataset: { testid: 'delete-confirm-description' },
        text: preview.description,
      }),
      preview.deletable
        ? field({
            id: `${idPrefix}-reason`,
            label: '削除の理由',
            hint: '必須です。変更履歴に記録されます（仕様書11章）。',
            input: reasonInput,
          })
        : el('p', {
            class: 'note note--warn',
            dataset: { testid: 'delete-blocked' },
            text: preview.blockedReason,
          }),
      el('div', { class: 'actions' }, [confirmButton, cancelButton]),
    ],
  );

  return {
    element,
    focus() {
      reasonInput.focus();
    },
  };
}
