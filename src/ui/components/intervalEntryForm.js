/**
 * 区間の手動追加・編集フォーム（仕様書8.4.11、8.4.5）。
 *
 * `intervalOperationForm.js`（開始・休憩・再開・終了・参加者変更）とは別に
 * 用意する。あちらは「進行中区間を閉じて新しい区間を開く」形に共通する日時・
 * 参加者だけを持つが、手動追加・編集は区間種別と終了日時も指定できる必要が
 * あり、入力項目の形が違う（設計メモ §2 の表）。
 *
 * `mode: 'add'` と `mode: 'edit'` の違いは初期値と終了日時の扱いだけである。
 *
 * - 追加は終了日時が必須（仕様書8.4.11、設計メモ §2.2）。未終了の区間は
 *   ボタン操作でのみ生じるため、手動追加では常に終了日時を入力させる。
 * - 編集はもともと未終了だった区間に限り、終了日時を空欄のまま保存できる
 *   （8.8.4 が求めるのは `null` → 値の補完であり、逆方向は無い）。もともと
 *   終了していた区間は空欄にできない。
 */

import { toErrorMessages } from '../../app/errors.js';
import { offsetMinutesOf } from '../../domain/datetime.js';
import { INTERVAL_TYPE, INTERVAL_TYPE_LABEL } from '../../domain/effort.js';
import { el, field, replaceChildren } from '../dom.js';
import { createDateTimeInput } from './dateTimeInput.js';
import { createParticipantsInput } from './participantsInput.js';

/**
 * 区間追加・編集フォームを作る。
 *
 * @param {{mode: 'add'|'edit', interval?: object, candidates?: string[],
 *          now?: () => Date, idPrefix?: string,
 *          onSubmit: (input: {type: string, startAt: string, endAt: string|null,
 *                             participants: string[]}) => Promise<unknown>,
 *          onCancel: () => void}} options
 *   `interval` は `mode: 'edit'` のときの編集対象。既存の値を初期値にする。
 * @returns {{element: HTMLElement, focus: () => void}}
 */
export function createIntervalEntryForm({
  mode,
  interval = null,
  candidates = [],
  now = () => new Date(),
  idPrefix = 'entry',
  onSubmit,
  onCancel,
}) {
  const isEdit = mode === 'edit';
  const label = isEdit ? '区間を編集' : '区間を追加';
  // もともと未終了だった区間だけ、終了日時を空欄のまま保存できる（設計メモ §2.2）。
  const wasOpen = isEdit && interval.endAt === null;

  const typeSelect = el(
    'select',
    { class: 'input input--auto', dataset: { testid: 'entry-type' } },
    [INTERVAL_TYPE.WORK, INTERVAL_TYPE.BREAK].map((type) =>
      el('option', {
        value: type,
        text: INTERVAL_TYPE_LABEL[type],
        selected: (interval?.type ?? INTERVAL_TYPE.WORK) === type,
      }),
    ),
  );

  // 編集では元の区間のオフセットで書き戻す（レビュー指摘 FB-9）。端末のオフセット
  // を使うと、インポートしたJSONのように別のオフセットで記録された区間を無変更で
  // 保存しただけで、指す瞬間が変わってしまう。追加では `undefined` にして、入力
  // された日の端末ローカル値へ委ねる。
  const baseOffset = isEdit ? offsetMinutesOf(interval.startAt) : undefined;

  const startInput = createDateTimeInput({
    id: `${idPrefix}-start`,
    testid: 'entry-start',
    label: '開始日時',
    value: interval?.startAt,
    offsetMinutes: baseOffset,
    now,
  });

  const endInput = createDateTimeInput({
    id: `${idPrefix}-end`,
    testid: 'entry-end',
    label: '終了日時',
    value: isEdit && !wasOpen ? interval.endAt : undefined,
    startEmpty: wasOpen,
    optional: wasOpen,
    // 未終了区間へ終了時刻を補う場合（仕様書8.8.4）も開始側のオフセットを使う。
    // 同じ作業の終わりであり、開始と別のオフセットで記録する理由が無い。
    offsetMinutes: baseOffset,
    hint: wasOpen ? '空欄のままにすると未終了のまま保存します。' : undefined,
    now,
  });

  const participants = createParticipantsInput({
    id: `${idPrefix}-participants`,
    testid: 'entry-participants',
    label: '参加者',
    hint: '複数登録できます。過去に入力した名前が候補に出ます。',
    candidates,
    value: interval?.participants ?? [],
  });

  const errorBox = el('div', {
    class: 'errors',
    role: 'alert',
    dataset: { testid: 'entry-errors' },
    hidden: true,
  });

  const submitButton = el('button', {
    type: 'button',
    class: 'button button--primary',
    text: isEdit ? '保存' : '追加',
    dataset: { testid: 'entry-submit' },
    on: { click: submit },
  });

  const cancelButton = el('button', {
    type: 'button',
    class: 'button',
    text: '取消',
    dataset: { testid: 'entry-cancel' },
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
    const start = startInput.read();
    if (!start.ok) {
      showErrors([start.error]);
      startInput.focus();
      return;
    }
    const end = endInput.read();
    if (!end.ok) {
      showErrors([end.error]);
      endInput.focus();
      return;
    }

    const input = {
      type: typeSelect.value,
      startAt: start.iso,
      endAt: end.iso,
      participants: participants.getValue(),
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
      dataset: { testid: 'entry-form', mode },
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
              '開始日時と終了日時を指定して区間を追加します（仕様書8.4.11）。' +
              '他の区間と時間帯が重なっても保存できます。',
          }),
      el('div', { class: 'field-row' }, [
        field({ id: `${idPrefix}-type`, label: '種別', input: typeSelect }),
        startInput.element,
        endInput.element,
        participants.element,
      ]),
      el('div', { class: 'actions' }, [submitButton, cancelButton]),
    ],
  );

  return {
    element,
    focus() {
      startInput.focus();
    },
  };
}
