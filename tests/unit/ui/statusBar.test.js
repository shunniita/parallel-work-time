// @vitest-environment happy-dom

/**
 * 保存状態表示の単体テスト（仕様書9.1）。
 *
 * 失敗の分類と文言そのものは `persistence.js` の `describeFailure()` が持ち、
 * 結合テストが押さえている。ここは「その状態が画面へどう出るか」だけを見る。
 *
 * 実装計画8.2 は保存失敗の表示を手動確認としていたが、表示は状態を渡すだけで
 * 再現できるため自動化した。IndexedDBの書き込みを実ブラウザで失敗させる手間に
 * 見合う情報は増えない。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { SAVE_STATE, describeFailure } from '../../../src/app/persistence.js';
import { STORAGE_ERROR_KIND } from '../../../src/storage/StorageAdapter.js';
import { renderStatusBar } from '../../../src/ui/statusBar.js';

let container;
let statusBar;

beforeEach(() => {
  container = document.createElement('footer');
  document.body.replaceChildren(container);
  statusBar = renderStatusBar(container, { schemaVersion: 1 });
});

const query = (testid) => container.querySelector(`[data-testid="${testid}"]`);

/** `persistence` が作る状態オブジェクトと同じ形。 */
function status(overrides) {
  return { state: SAVE_STATE.IDLE, at: null, message: '', details: [], ...overrides };
}

describe('renderStatusBar', () => {
  it('初期状態は「—」を出す', () => {
    statusBar.update(status({}));

    expect(query('save-status').textContent).toBe('—');
    expect(container.dataset.state).toBe(SAVE_STATE.IDLE);
  });

  it('schemaVersion を併記する（仕様書9.3）', () => {
    expect(query('schema-version').textContent).toBe('schemaVersion 1');
  });

  it('保存中を出す', () => {
    statusBar.update(status({ state: SAVE_STATE.SAVING, message: '保存中…' }));

    expect(query('save-status').textContent).toBe('保存中…');
    expect(container.dataset.state).toBe(SAVE_STATE.SAVING);
  });

  it('成功したら時刻を秒まで添える', () => {
    // 連続して保存したとき、最後がいつだったか分かるようにする。
    statusBar.update(
      status({
        state: SAVE_STATE.SAVED,
        at: '2026-08-09T20:32:45+09:00',
        message: '保存しました',
      }),
    );

    expect(query('save-status').textContent).toBe('保存しました 20:32:45');
  });

  describe('失敗の表示（仕様書9.1）', () => {
    it('失敗を出し、状態を data 属性へ載せる', () => {
      statusBar.update(
        status({
          state: SAVE_STATE.FAILED,
          at: '2026-08-09T20:32:45+09:00',
          message: describeFailure({ kind: STORAGE_ERROR_KIND.QUOTA }),
        }),
      );

      expect(container.dataset.state).toBe(SAVE_STATE.FAILED);
      expect(query('save-status').textContent).toContain('保存に失敗しました');
    });

    it('容量超過はエクスポートと削除を促す（仕様書9.1）', () => {
      statusBar.update(
        status({
          state: SAVE_STATE.FAILED,
          message: describeFailure({ kind: STORAGE_ERROR_KIND.QUOTA }),
        }),
      );

      const text = query('save-status').textContent;
      expect(text).toContain('JSONへエクスポート');
      expect(text).toContain('不要なデータを削除');
    });

    it('失敗の詳細を添える', () => {
      statusBar.update(
        status({
          state: SAVE_STATE.FAILED,
          message: '保存に失敗しました',
          details: ['実施回: 見つからない'],
        }),
      );

      const detail = query('save-status-detail');
      expect(detail.hidden).toBe(false);
      expect(detail.textContent).toBe('実施回: 見つからない');
    });

    it('詳細が無ければ隠す', () => {
      statusBar.update(status({ state: SAVE_STATE.FAILED, message: '保存に失敗しました' }));

      expect(query('save-status-detail').hidden).toBe(true);
    });

    it('成功へ戻ると失敗の詳細が消える', () => {
      statusBar.update(
        status({ state: SAVE_STATE.FAILED, message: '失敗', details: ['原因'] }),
      );

      statusBar.update(
        status({ state: SAVE_STATE.SAVED, at: '2026-08-09T20:33:00+09:00', message: '保存しました' }),
      );

      expect(query('save-status-detail').hidden).toBe(true);
      expect(container.dataset.state).toBe(SAVE_STATE.SAVED);
    });
  });

  it('書き込み成功後に読み直しへ失敗した場合は成功として注記を添える', () => {
    // 失敗と表示すると利用者が同じ操作を繰り返す（`persistence.run` 参照）。
    statusBar.update(
      status({
        state: SAVE_STATE.SAVED,
        at: '2026-08-09T20:32:45+09:00',
        message: '保存しました',
        details: ['保存後の読み直しに失敗しました。'],
      }),
    );

    expect(query('save-status').textContent).toContain('保存しました');
    expect(query('save-status-detail').textContent).toContain('読み直しに失敗');
  });
});
