/**
 * 検証結果の入れ物（仕様書8.9）。
 *
 * `validation.js` と `intervalOps.js` が同じ形のクラスを別々に持っていたため、
 * ここへ一本化した（レビュー指摘 D-15）。Step 7 の直接入力検証も同じ形を使う。
 *
 * ## エラーと警告を分ける理由
 *
 * `errors` は保存を止める不備、`warnings` は保存を止めずに知らせる事柄である。
 * 累計超過（仕様書8.9.7）・区間重複（8.9.5）・直接入力の重複候補（8.9.8）は
 * いずれも「警告して続行できる」と定められており、拒否と同じ経路へ混ぜられない。
 *
 * ## 警告が種別コードを持つ理由
 *
 * 呼び出し側は「どの警告が出たか」で分岐する。累計超過だけは確認ダイアログへ
 * 差し戻す（`QuantityOverflowError`）一方、区間重複や重複候補はそのまま保存して
 * 画面へ並べる。文字列の一覧では判別できず、`warnings.length > 0` を確認要求と
 * みなす実装は、別種の警告を足した瞬間に誤爆する（D-15）。
 *
 * `errors` は文字列（`"場所: 説明"`）のままにしてある。エラーはすべて保存を
 * 止めるという一様な扱いで、種別による分岐が要らないためである。
 */

/**
 * 検証で見つかった不備と警告を集める。
 */
export class Problems {
  constructor() {
    /** @type {string[]} 「場所: 説明」形式 */
    this.errors = [];
    /** @type {{code: string, path: string, message: string}[]} */
    this.warnings = [];
  }

  /**
   * 保存を止める不備を積む。
   *
   * @param {string} path 例: `作業項目2の名称`
   * @param {string} message
   */
  add(path, message) {
    this.errors.push(`${path}: ${message}`);
  }

  /**
   * 保存は止めないが利用者へ知らせる事柄を積む。
   *
   * @param {string} code 呼び出し側が分岐に使う種別。各モジュールの
   *   `*_WARNING` 定数を渡す
   * @param {string} path
   * @param {string} message
   */
  warn(code, path, message) {
    this.warnings.push({ code, path, message });
  }

  get ok() {
    return this.errors.length === 0;
  }

  /**
   * @param {object} [extra] `preview` など呼び出し側へ返す補足
   * @returns {{ok: boolean, errors: string[], warnings: object[]}}
   */
  toResult(extra = {}) {
    return { ok: this.ok, errors: this.errors, warnings: this.warnings, ...extra };
  }
}

/**
 * 指定した種別の警告が含まれるか。
 *
 * @param {{code: string}[]} warnings
 * @param {string} code
 * @returns {boolean}
 */
export function hasWarning(warnings, code) {
  return warnings.some((warning) => warning.code === code);
}

/**
 * 警告の文言だけを取り出す。画面表示と例外メッセージで使う。
 *
 * @param {{message: string}[]} warnings
 * @returns {string[]}
 */
export function warningMessages(warnings) {
  return warnings.map((warning) => warning.message);
}
