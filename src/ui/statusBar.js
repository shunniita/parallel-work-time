/**
 * 保存状態の表示（仕様書9.1）。
 *
 * 保存の成功・失敗は必ず画面へ出す。捕捉しても表示しなければ記録の欠落に
 * 気づけないためである。`schemaVersion` も併記し、エクスポート／インポート時に
 * 利用者が版を確認できるようにする（9.3）。
 */

import { SAVE_STATE } from '../app/persistence.js';
import { el, replaceChildren } from './dom.js';

/**
 * 保存状態表示を初期化する。
 *
 * @param {HTMLElement} container `renderShell` が返す `statusBar`
 * @param {{schemaVersion: number}} options
 * @returns {{update: (status: object) => void}}
 */
export function renderStatusBar(container, { schemaVersion }) {
  const message = el('span', {
    class: 'status-bar__message',
    // 保存の成否は読み上げでも伝える（仕様書9.1、レビュー指摘 D-18）。失敗に
    // 気づけないと記録の欠落につながるため、画面を見ていない利用者にも届ける。
    role: 'status',
    'aria-live': 'polite',
    dataset: { testid: 'save-status' },
    text: '—',
  });
  const detail = el('span', {
    class: 'status-bar__detail',
    dataset: { testid: 'save-status-detail' },
    hidden: true,
  });

  replaceChildren(container, [
    message,
    detail,
    el('span', {
      class: 'status-bar__schema',
      dataset: { testid: 'schema-version' },
      text: `schemaVersion ${schemaVersion}`,
    }),
  ]);

  /**
   * @param {{state: string, at: string|null, message: string, details: string[]}} status
   */
  function update(status) {
    container.dataset.state = status.state;

    if (status.state === SAVE_STATE.IDLE) {
      message.textContent = '—';
    } else if (status.state === SAVE_STATE.SAVED && status.at !== null) {
      // 時刻は秒まで出す。連続して保存したとき、最後がいつだったか分かるように。
      message.textContent = `${status.message} ${status.at.slice(11, 19)}`;
    } else {
      message.textContent = status.message;
    }

    const hasDetails = status.details.length > 0;
    detail.hidden = !hasDetails;
    detail.textContent = hasDetails ? status.details.join(' / ') : '';
  }

  return { update };
}
