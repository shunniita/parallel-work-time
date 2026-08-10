/**
 * 工数直接入力の追加・編集フォーム（仕様書8.5）。
 *
 * 追加と編集で同じ部品を使う。違うのは初期値と見出しだけで、入力する内容
 * （追加工数・参加者・備考）は同じである。区間の `intervalEntryForm.js` と
 * 同じ流儀にそろえてある。
 *
 * ## 参加者は必須ではない
 *
 * 直接入力の `seconds` は既に人数を含んだ総工数であり（仕様書8.5.6）、参加者は
 * 誰の分かを後から照合するための補助情報である（仕様書6.8）。`work` 区間のように
 * 0人を禁じる理由（仕様書8.9.4）が無いため、空のまま保存できる。
 *
 * ## 備考は必須
 *
 * 仕様書8.5.4 が定めている。直接入力は計測の裏づけが無い数字なので、後から根拠を
 * たどれるようにする。空欄の判定は `directEntryOps.js` が行い、ここは受け取った
 * エラーを出すだけにする。同じ規則を画面と domain の両方へ書かない。
 */

import { toErrorMessages } from '../../app/errors.js';
import { MAX_TEXT_LENGTH } from '../../config.js';
import { createDurationInput } from './durationInput.js';
import { createParticipantsInput } from './participantsInput.js';
import { el, field, replaceChildren } from '../dom.js';

/**
 * 直接入力フォームを作る。
 *
 * @param {{mode: 'add'|'edit', entry?: object, candidates?: string[],
 *          idPrefix?: string,
 *          onSubmit: (input: {seconds: number, participants: string[],
 *                             note: string}) => Promise<unknown>,
 *          onCancel: () => void}} options
 *   `entry` は `mode: 'edit'` のときの編集対象。既存の値を初期値にする。
 * @returns {{element: HTMLElement, focus: () => void}}
 */
export function createDirectEntryForm({
  mode,
  entry = null,
  candidates = [],
  idPrefix = 'direct',
  onSubmit,
  onCancel,
}) {
  const isEdit = mode === 'edit';
  const label = isEdit ? '直接入力を編集' : '工数を直接入力';

  const duration = createDurationInput({
    idPrefix: `${idPrefix}-duration`,
    testidPrefix: 'direct-duration',
    seconds: entry?.seconds,
  });

  const participants = createParticipantsInput({
    id: `${idPrefix}-participants`,
    testid: 'direct-participants',
    label: '参加者',
    hint: '任意です。誰の分かを後から照合するために残します（仕様書6.8）。',
    candidates,
    value: entry?.participants ?? [],
  });

  // textarea の初期値は `value` 属性ではなく子テキストで決まる。`el` の `text` は
  // `textContent` へ入れるため、そのまま `.value` の初期値になる。
  const noteInput = el('textarea', {
    class: 'input',
    rows: '2',
    maxlength: MAX_TEXT_LENGTH,
    dataset: { testid: 'direct-note' },
    text: entry?.note ?? '',
  });

  const errorBox = el('div', {
    class: 'errors',
    role: 'alert',
    dataset: { testid: 'direct-errors' },
    hidden: true,
  });

  const submitButton = el('button', {
    type: 'button',
    class: 'button button--primary',
    text: isEdit ? '保存' : '追加',
    dataset: { testid: 'direct-submit' },
    on: { click: submit },
  });

  const cancelButton = el('button', {
    type: 'button',
    class: 'button',
    text: '取消',
    dataset: { testid: 'direct-cancel' },
    on: { click: () => onCancel() },
  });

  /**
   * @param {string[]} messages
   */
  function showErrors(messages) {
    replaceChildren(errorBox, [
      el('p', { class: 'errors__title', text: `${label}できません` }),
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
    const total = duration.read();
    if (!total.ok) {
      showErrors([total.error]);
      duration.focus();
      return;
    }

    const input = {
      seconds: total.seconds,
      participants: participants.getValue(),
      note: noteInput.value,
    };

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
      dataset: { testid: 'direct-form', mode },
      'aria-label': `${label}の入力`,
    },
    [
      el('h3', { class: 'card__title', text: label }),
      errorBox,
      isEdit
        ? null
        : el('p', {
            class: 'note',
            text:
              '計測し損ねた工数を後から足します（仕様書8.5）。' +
              '入力した値に参加者数は掛けません。',
          }),
      duration.element,
      el('div', { class: 'field-row' }, [participants.element]),
      field({
        id: `${idPrefix}-note`,
        label: '備考',
        hint: '必須です。何の工数を足したのかを残します（仕様書8.5.4）。',
        input: noteInput,
      }),
      el('div', { class: 'actions' }, [submitButton, cancelButton]),
    ],
  );

  return {
    element,
    focus() {
      duration.focus();
    },
  };
}
