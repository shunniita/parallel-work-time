/**
 * 内部固有IDの生成（仕様書6.1）。
 *
 * 利用者が入力する案件IDとは別に、案件グループ・実施回・作業項目実績・
 * 作業区間・直接入力へ `crypto.randomUUID()` で採番する。
 *
 * 生成器を1か所へ寄せるのは、テストで差し替えられるようにするためである。
 * `crypto` は Web Crypto API であり外部通信を伴わない（仕様書5.1.4）。
 */

/**
 * UUID v4 形式の内部固有IDを返す。
 *
 * `crypto.randomUUID()` は安全なコンテキスト（HTTPS または localhost）でのみ
 * 利用できる。`file://` を動作保証外とする仕様書5.1.3 と整合するため、
 * 代替実装は用意せず、利用できない場合は明示的に失敗させる。
 *
 * @returns {string}
 */
export function newId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error(
      'crypto.randomUUID() が利用できない。HTTPまたはHTTPSで配信して利用する。',
    );
  }
  return globalThis.crypto.randomUUID();
}

/** UUID の形式（版・バリアントは問わない）。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UUID 形式かどうかを判定する。
 *
 * インポートJSONの検証（仕様書9.3）で、内部固有IDの体裁を確かめるために使う。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
