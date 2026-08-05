/**
 * 削除の確認（仕様書11章）。
 *
 * 削除前に対象の内容を示し、理由の入力を必須とする。区間（仕様書8.4.5）と
 * 直接入力（8.5）の両方が使う。確認に出す文言と、削除に伴う変更履歴の要約は
 * 同じ関数から作られる（`previewIntervalDeletion` は `describeInterval`、
 * `previewDirectEntryDeletion` は `describeDirectEntry`）。「確認した内容」と
 * 「履歴に残る内容」が食い違わない。
 *
 * 対象ごとに違うのは見出しの語だけなので、`subject` で受け取る。中身の作りは
 * 同じである（理由必須、確定と取消、削除できない場合の表示）。
 *
 * ## モーダルにしなかった理由
 *
 * 設計メモは削除前の確認を「ダイアログ」と呼んでいるが、本ツールの画面は
 * どこにもオーバーレイ（モーダル）を持たない。一覧の対象行の直下へ差し込む
 * 形にし、他の確認・編集フォーム（`intervalOperationForm.js`、
 * `intervalEntryForm.js`、`directEntryForm.js`）と同じ「対象の近くにインラインで
 * 置く」流儀に合わせた。削除は取り消せない操作だが、理由入力を必須にし確定
 * ボタンを主要ボタンにしないことで、うっかり押しても続行できない形にしている。
 *
 * 実施回が転記済み・アーカイブの場合、呼び出し側（`taskDetailView.js`）は
 * 削除ボタン自体を出さないため通常は開かれない。万一開かれた場合に備え、
 * `preview.deletable` が false なら確定ボタンを無効にし、理由を示す。
 */

import { toErrorMessages } from '../../app/errors.js';
import { el, field, replaceChildren } from '../dom.js';

/**
 * 理由必須の確認を作る。
 *
 * 既定は削除の文言である。転記済みの取り消し（仕様書7.1、11章）のように、削除
 * 以外で理由を要る操作は `action` で語を差し替える。
 *
 * @param {{preview: {description: string, deletable: boolean,
 *          blockedReason: string|null}, subject?: string,
 *          action?: {verb?: string, noun?: string, danger?: boolean,
 *                    reasonHint?: string},
 *          idPrefix?: string, testidPrefix?: string,
 *          onConfirm: (reason: string) => Promise<unknown>,
 *          onCancel: () => void}} options
 *   `subject` は見出しへ入れる対象の呼び名（例: `区間` / `直接入力`）。
 *   `action.verb` は「削除する」の「削除」に当たる語、`action.noun` は
 *   「削除の理由」の「削除」に当たる語である（多くは同じだが、「取り消し」の
 *   ように送り仮名で変わる場合に分ける）。
 * @returns {{element: HTMLElement, focus: () => void}}
 */
export function createReasonConfirm({
  preview,
  subject = '区間',
  action = {},
  idPrefix = 'delete',
  testidPrefix = 'delete',
  onConfirm,
  onCancel,
}) {
  const verb = action.verb ?? '削除';
  const noun = action.noun ?? verb;
  const danger = action.danger ?? true;
  const reasonHint = action.reasonHint ?? '必須です。変更履歴に記録されます（仕様書11章）。';

  const reasonInput = el('textarea', {
    class: 'input',
    rows: '2',
    dataset: { testid: `${testidPrefix}-reason` },
  });

  const errorBox = el('div', {
    class: 'errors',
    role: 'alert',
    dataset: { testid: `${testidPrefix}-errors` },
    hidden: true,
  });

  const confirmButton = el('button', {
    type: 'button',
    class: danger ? 'button button--danger' : 'button button--primary',
    text: `${verb}する`,
    dataset: { testid: `${testidPrefix}-confirm` },
    disabled: !preview.deletable,
    on: { click: submit },
  });

  const cancelButton = el('button', {
    type: 'button',
    class: 'button',
    text: '取消',
    dataset: { testid: `${testidPrefix}-cancel` },
    on: { click: () => onCancel() },
  });

  /**
   * @param {string[]} messages
   */
  function showErrors(messages) {
    replaceChildren(errorBox, [
      el('p', { class: 'errors__title', text: `${verb}できません` }),
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
      dataset: { testid: `${testidPrefix}-confirm-panel` },
      role: 'alertdialog',
      'aria-label': `${subject}の${noun}確認`,
    },
    [
      el('h3', { class: 'card__title', text: `${subject}を${verb}します` }),
      errorBox,
      el('p', {
        dataset: { testid: `${testidPrefix}-confirm-description` },
        text: preview.description,
      }),
      preview.deletable
        ? field({
            id: `${idPrefix}-reason`,
            label: `${noun}の理由`,
            hint: reasonHint,
            input: reasonInput,
          })
        : el('p', {
            class: 'note note--warn',
            dataset: { testid: `${testidPrefix}-blocked` },
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
