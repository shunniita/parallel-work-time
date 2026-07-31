/**
 * 保存の一元化と成否通知（仕様書9.1）。
 *
 * 保存を伴う操作はすべてここを通す。理由は2つある。
 *
 * 1. 保存の成否を画面へ必ず出す。捕捉しないと失敗が沈黙し、記録の欠落に
 *    気づけない（特に `QuotaExceededError`）。
 * 2. 保存後に読み直したデータセットを1か所で作る。アクション側が
 *    `loadAll()` を呼ぶ順序を気にしなくてよくなる。
 *
 * 警告領域との結線は実装計画 Step 11 で行う。ここでは購読の仕組みだけ用意する。
 */

import { STORAGE_ERROR_KIND } from '../storage/StorageAdapter.js';
import { toIsoSecond } from '../domain/datetime.js';

/** 保存状態（仕様書9.1 の画面表示に対応）。 */
export const SAVE_STATE = {
  IDLE: 'idle',
  SAVING: 'saving',
  SAVED: 'saved',
  FAILED: 'failed',
};

/**
 * 失敗の種別ごとの案内文。
 *
 * `quota` はJSONエクスポートと不要データ削除を促す（仕様書9.1）。
 */
const GUIDANCE = {
  [STORAGE_ERROR_KIND.QUOTA]:
    '保存領域が不足しています。設定画面からJSONへエクスポートし、不要なデータを削除してください。',
  [STORAGE_ERROR_KIND.CONSTRAINT]: '同じ値が既に登録されています。入力内容を確認してください。',
  [STORAGE_ERROR_KIND.UNAVAILABLE]:
    'ブラウザの保存領域を利用できません。プライベートウィンドウでは無効化されている場合があります。',
  [STORAGE_ERROR_KIND.SCHEMA_MISMATCH]:
    'ファイルのスキーマ版がこのツールと一致しません。取り込みは行われていません。',
};

/**
 * 保存の窓口を作る。
 *
 * @param {import('../storage/StorageAdapter.js').StorageAdapter} adapter
 * @param {{now?: () => Date}} [options] `now` はテストで時刻を固定するために渡す
 */
export function createPersistence(adapter, options = {}) {
  const now = options.now ?? (() => new Date());
  const listeners = new Set();
  let status = { state: SAVE_STATE.IDLE, at: null, message: '', details: [] };

  function getStatus() {
    return status;
  }

  function setStatus(next) {
    status = next;
    for (const listener of [...listeners]) {
      listener(status);
    }
  }

  /**
   * @param {(status: object) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /**
   * 保存処理を実行し、成否を通知したうえで最新のデータセットを返す。
   *
   * 失敗した場合は例外を投げ直す。呼び出し側が画面の入力内容を保持したまま
   * やり直せるようにするためで、通知だけして成功したように見せない。
   *
   * @param {() => Promise<void>} write 保存本体
   * @returns {Promise<object>} `loadAll()` の結果
   */
  async function run(write) {
    setStatus({ state: SAVE_STATE.SAVING, at: null, message: '保存中…', details: [] });
    try {
      await write();
      const dataset = await adapter.loadAll();
      setStatus({
        state: SAVE_STATE.SAVED,
        at: toIsoSecond(now()),
        message: '保存しました',
        details: [],
      });
      return dataset;
    } catch (error) {
      setStatus({
        state: SAVE_STATE.FAILED,
        at: toIsoSecond(now()),
        message: describeFailure(error),
        details: error?.details ?? [],
      });
      throw error;
    }
  }

  return { run, getStatus, subscribe };
}

/**
 * 失敗の説明文を作る。
 *
 * @param {unknown} error
 * @returns {string}
 */
export function describeFailure(error) {
  const guidance = GUIDANCE[error?.kind];
  if (guidance !== undefined) {
    return `保存に失敗しました。${guidance}`;
  }
  if (error?.kind === STORAGE_ERROR_KIND.VALIDATION) {
    // 検証失敗は入力内容の問題であり、保存領域の話と混ぜない。
    return '入力内容に不備があるため保存できません。';
  }
  return `保存に失敗しました: ${error?.message ?? String(error)}`;
}
