/**
 * 保存の一元化と成否通知（仕様書9.1）。
 *
 * 保存を伴う操作はすべてここを通す。理由は3つある。
 *
 * 1. 保存の成否を画面へ必ず出す。捕捉しないと失敗が沈黙し、記録の欠落に
 *    気づけない（特に `QuotaExceededError`）。
 * 2. 保存後に読み直したデータセットを1か所で作る。アクション側が
 *    `loadAll()` を呼ぶ順序を気にしなくてよくなる。
 * 3. 「読み込み → メモリ上で改変 → 書き戻し」を直列化する。各操作が独立に
 *    `loadAll()` してから WorkRun 全体を書き戻す作りのため、同一レコードへの
 *    2操作が重なると後勝ちで前者が消える（lost update）。Step 6 では
 *    「項目Aで開始 → 項目Bで開始」のように同一 WorkRun への連続書き込みが
 *    常態になるため、版管理を持たない現状では直列化で防ぐ。
 *
 * ## 単一の保存と、複数の保存からなる1操作は別物（敵対的レビュー GAR-1）
 *
 * `run()` が守るのは保存1回ぶんである。「退避してから全置換」（9.4）のように
 * 利用者から1つに見える操作が2回の保存でできている場合、その隙間へ別の保存が
 * 割り込む。退避JSONを取った後に積まれた保存は、退避にも置換後にも残らない。
 *
 * そのため `runExclusive()` を分けて用意した。区間の中では渡された `run` を使い、
 * 外から積まれた保存は区間の終了まで待つ。区間内かどうかを共有フラグで見分ける
 * 作りにはしない。区間の実行中に利用者が別画面を操作した場合まで「区間の内側」と
 * 誤判定し、まさに防ぎたい割り込みを許してしまう。
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

/** 書き込みは成功したが読み直しに失敗したときの注記。 */
const RELOAD_FAILED_DETAIL =
  '保存後の読み直しに失敗しました。表示が最新でない可能性があります。画面を再読み込みしてください。';

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

  /**
   * 直列化の待ち行列。
   *
   * 常に「最後に積んだ操作」を指す。次の操作はこれが決着してから始まる。
   */
  let tail = Promise.resolve();

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
   * 待ち行列の末尾へ積む。
   *
   * 前の操作が失敗しても次は実行する。失敗の扱いは積んだ側の責務であり、
   * 1回の失敗で以降の保存が全部止まる方が有害なため。
   *
   * @param {() => Promise<any>} task
   * @returns {Promise<any>}
   */
  function enqueue(task) {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * 保存を伴う操作を、読み込みから書き込みまで1つの区間として実行する。
   *
   * `plan` は待ち行列の中で最新のデータセットを受け取り、検証と組み立てを行って
   * 書き込み本体（`write`）を返す。読み込みと書き込みの間に別の操作が割り込む
   * 隙間が無くなるため、後勝ちで前の更新が消えることがない。
   *
   * 保存状態を動かすのは `write` を呼ぶ直前からである。`plan` が投げた場合
   * （検証で弾いた場合）は保存を試みていないので、失敗表示も出さない。
   *
   * 書き込み後の読み直しに失敗しても「保存失敗」とはしない。書き込みは成功して
   * いるため、失敗と表示すると利用者が同じ操作を繰り返す。この場合は成功として
   * 注記を添え、`dataset` に `null` を返す。呼び出し側は画面へ流し込まない。
   *
   * @template T
   * @param {(dataset: object) => Promise<{write: () => Promise<void>, value?: T}>} plan
   * @returns {Promise<{dataset: object|null, value: T|undefined}>}
   */
  async function run(plan) {
    return enqueue(() => execute(plan));
  }

  /**
   * 複数の保存を1つの排他区間として実行する（仕様書9.4、敵対的レビュー GAR-1）。
   *
   * `body` は区間内で使う `run` を受け取る。これは待ち行列へ積み直さず直接
   * 実行するため、区間を握ったまま複数回の保存ができる。外から `run()` で
   * 積まれた保存は、区間が終わるまで待つ。
   *
   * 区間内の保存が失敗した場合は `body` へそのまま投げ返す。どこまで進めるかは
   * 呼び出し側が決める（退避に失敗したら破壊的操作へ進まない、など）。
   *
   * @template T
   * @param {(session: {run: typeof execute}) => Promise<T>} body
   * @returns {Promise<T>}
   */
  async function runExclusive(body) {
    return enqueue(() => body({ run: execute }));
  }

  /**
   * 待ち行列へ積まずに、読み込みから書き込みまでを1回実行する。
   *
   * 直列化は呼び出し側（`run` / `runExclusive`）が持つ。
   */
  async function execute(plan) {
    const loaded = await adapter.loadAll();
    const { write, value } = await plan(loaded);

    setStatus({ state: SAVE_STATE.SAVING, at: null, message: '保存中…', details: [] });
    try {
      await write();
    } catch (error) {
      setStatus({
        state: SAVE_STATE.FAILED,
        at: toIsoSecond(now()),
        message: describeFailure(error),
        details: error?.details ?? [],
      });
      // 呼び出し側が画面の入力内容を保持したままやり直せるよう投げ直す。
      // 通知だけして成功したように見せない。
      throw error;
    }

    const at = toIsoSecond(now());
    try {
      const dataset = await adapter.loadAll();
      setStatus({ state: SAVE_STATE.SAVED, at, message: '保存しました', details: [] });
      return { dataset, value };
    } catch {
      setStatus({
        state: SAVE_STATE.SAVED,
        at,
        message: '保存しました',
        details: [RELOAD_FAILED_DETAIL],
      });
      return { dataset: null, value };
    }
  }

  return { run, runExclusive, getStatus, subscribe };
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
