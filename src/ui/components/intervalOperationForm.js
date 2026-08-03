/**
 * 開始・休憩・再開・終了の入力フォーム（仕様書12.4）。
 *
 * 仕様書12.4 は「いずれも日時の初期値は現在日時とし、確定前に修正できる」と
 * 定めている。ボタンを押した瞬間に記録するのではなく、日時（操作によっては
 * 参加者）を確かめてから確定させる。押し間違いをその場で取り消せる。
 *
 * 実施回詳細の作業項目行と作業項目詳細の両方から使う。同じ操作が画面ごとに
 * 違う形で出ると、確かめる項目も検証の掛かり方も食い違うためである。
 *
 * ## 参加者の入力を求める場面
 *
 * | 操作 | 参加者 |
 * | ---- | ------ |
 * | 開始 | 入力する（作業区間は0人を禁止、仕様書8.9.4） |
 * | 休憩 | 入力しない。直前の作業区間から引き継ぐ（仕様書8.9 補足） |
 * | 再開 | 直前の休憩から引き継ぐ。引き継ぎが0人のときだけ入力する（設計メモ §2.1） |
 * | 終了 | 入力しない。新しい区間を作らない |
 *
 * 保存の可否そのものは `src/domain/intervalOps.js` が決める。この画面の分岐は
 * 「何を尋ねるか」であって、検証ではない。
 */

import { toErrorMessages } from '../../app/errors.js';
import { TASK_OPERATION, TASK_OPERATION_LABEL, activeInterval } from '../../domain/taskState.js';
import { el, replaceChildren } from '../dom.js';
import { createDateTimeInput } from './dateTimeInput.js';
import { createParticipantsInput } from './participantsInput.js';

/**
 * 操作ごとの補足文。何が起きるかを確定前に示す。
 *
 * @param {string} operation
 * @param {string[]} inherited 引き継ぐ参加者
 * @returns {string}
 */
function describeOperation(operation, inherited) {
  switch (operation) {
    case TASK_OPERATION.START:
      return 'この日時から作業区間を開始します。終了日時は空のままです。';
    case TASK_OPERATION.BREAK:
      return `進行中の作業をこの日時で終了し、同じ日時から休憩を開始します。参加者（${inherited.join('、')}）を引き継ぎます。`;
    case TASK_OPERATION.RESUME:
      return inherited.length === 0
        ? '直前の休憩は参加者0人です。作業区間は1人以上必要なため、再開する参加者を入力してください（仕様書8.9.4）。'
        : `進行中の休憩をこの日時で終了し、同じ日時から作業を再開します。参加者（${inherited.join('、')}）を引き継ぎます。`;
    case TASK_OPERATION.FINISH:
      return '進行中の区間をこの日時で終了します。新しい区間は作りません。';
    default:
      return '';
  }
}

/**
 * 参加者の入力が要るかを決める。
 *
 * @param {string} operation
 * @param {string[]} inherited
 * @returns {boolean}
 */
function needsParticipants(operation, inherited) {
  if (operation === TASK_OPERATION.START) {
    return true;
  }
  // 0人の休憩から再開すると引き継いだ結果が 8.9.4 違反になる。黙って0人の
  // 作業区間を作らず、ここで入力を求める。
  return operation === TASK_OPERATION.RESUME && inherited.length === 0;
}

/**
 * 操作フォームを作る。
 *
 * @param {{operation: string, taskRecord: object, candidates?: string[],
 *          now?: () => Date, idPrefix?: string,
 *          onSubmit: (input: {at: string, participants?: string[]}) => Promise<unknown>,
 *          onCancel: () => void}} options
 * @returns {{element: HTMLElement, focus: () => void}}
 */
export function createIntervalOperationForm({
  operation,
  taskRecord,
  candidates = [],
  now = () => new Date(),
  idPrefix = 'op',
  onSubmit,
  onCancel,
}) {
  const active = activeInterval(taskRecord);
  const inherited = active === null ? [] : [...active.participants];
  const label = TASK_OPERATION_LABEL[operation] ?? operation;

  const dateTime = createDateTimeInput({
    id: `${idPrefix}-at`,
    testid: 'op-at',
    label: '日時',
    now,
  });

  const participants = needsParticipants(operation, inherited)
    ? createParticipantsInput({
        id: `${idPrefix}-participants`,
        testid: 'op-participants',
        label: '参加者',
        hint: '複数登録できます。過去に入力した名前が候補に出ます。',
        candidates,
      })
    : null;

  const errorBox = el('div', {
    class: 'errors',
    role: 'alert',
    dataset: { testid: 'op-errors' },
    hidden: true,
  });

  const submitButton = el('button', {
    type: 'button',
    class: 'button button--primary',
    text: `${label}を記録`,
    dataset: { testid: 'op-submit' },
    on: { click: submit },
  });

  const cancelButton = el('button', {
    type: 'button',
    class: 'button',
    text: '取消',
    dataset: { testid: 'op-cancel' },
    on: { click: () => onCancel() },
  });

  /**
   * @param {string[]} messages
   */
  function showErrors(messages) {
    replaceChildren(errorBox, [
      el('p', { class: 'errors__title', text: `${label}を記録できません` }),
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
    submitButton.disabled = busy;
    cancelButton.disabled = busy;
  }

  async function submit() {
    const time = dateTime.read();
    if (!time.ok) {
      showErrors([time.error]);
      dateTime.focus();
      return;
    }

    const input = { at: time.iso };
    if (participants !== null) {
      input.participants = participants.getValue();
    }

    errorBox.hidden = true;
    setBusy(true);
    try {
      await onSubmit(input);
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
      class: 'card op-form',
      dataset: { testid: 'op-form', operation },
      'aria-label': `${label}の入力`,
    },
    [
      el('h3', { class: 'card__title', text: label }),
      errorBox,
      el('p', { class: 'note', text: describeOperation(operation, inherited) }),
      el('div', { class: 'field-row' }, [
        dateTime.element,
        participants === null ? null : participants.element,
      ]),
      el('div', { class: 'actions' }, [submitButton, cancelButton]),
    ],
  );

  return {
    element,
    focus() {
      // 参加者を尋ねる操作では参加者から、そうでなければ日時から入力させる。
      // 日時は現在日時が入っており、そのまま確定する場面が多い。
      if (participants !== null) {
        participants.focus();
        return;
      }
      dateTime.focus();
    },
  };
}
