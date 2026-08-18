/**
 * 案件IDの正規化（仕様書8.2.6、8.9.9）。
 *
 * 案件IDは一意制約を持つ唯一の利用者入力である。比較のたびに書き方が違うと
 * 一意性が保てないため、正規化を1か所へ置く。
 *
 * 登録（`templateInstantiate.js`）・重複判定（`validation.js`）・取り込み検証
 * （`integrity.js`）の3経路が同じ関数を通る。以前は
 * `templateInstantiate.js`（テンプレートの値複製）に同居していたが、案件IDの
 * 正規化はインスタンス化とは別の関心であり、依存の向きも不自然だった
 * （過去のレビュー指摘）。
 */

/**
 * 案件IDを比較・保存できる形へ整える。
 *
 * 前後空白の除去のみ行う。全角半角の統一や大文字小文字の畳み込みはしない。
 * 参加者名の表記ゆれを警告しない方針（仕様書8.9.9）と揃え、利用者が入力した
 * 文字は保つ。前後空白だけは打ち間違いとして扱い、一意制約が空白の有無で
 * すり抜けないようにする（過去の実装計画）。
 *
 * @param {unknown} projectId
 * @returns {string}
 */
export function normalizeProjectId(projectId) {
  return String(projectId ?? '').trim();
}
