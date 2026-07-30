/**
 * 外部項目コードの並び（仕様書8.7.3）。
 *
 * コード内の数値部分を数値として比較する自然順とする。辞書順では
 * `X-10` が `X-2` より前になってしまうため、転記時の並びとして使えない。
 * 未設定の項目は末尾へ置く。
 */

/** 数字の連続と非数字の連続へ分割する。 */
function toChunks(value) {
  return String(value).match(/\d+|\D+/g) ?? [];
}

function isNumericChunk(chunk) {
  return /^\d/.test(chunk);
}

/**
 * 自然順で比較する。
 *
 * @param {string} left
 * @param {string} right
 * @returns {number} 負なら left が前、正なら right が前
 */
export function compareNatural(left, right) {
  const leftChunks = toChunks(left);
  const rightChunks = toChunks(right);
  const length = Math.min(leftChunks.length, rightChunks.length);

  for (let i = 0; i < length; i += 1) {
    const a = leftChunks[i];
    const b = rightChunks[i];
    if (a === b) {
      continue;
    }
    if (isNumericChunk(a) && isNumericChunk(b)) {
      const diff = Number(a) - Number(b);
      if (diff !== 0) {
        return diff;
      }
      // 数値として等しい場合（0埋めの差）は桁数が少ない方を前へ置く。
      const lengthDiff = a.length - b.length;
      if (lengthDiff !== 0) {
        return lengthDiff;
      }
      continue;
    }
    return a < b ? -1 : 1;
  }

  return leftChunks.length - rightChunks.length;
}

/**
 * 外部項目コードが未設定かどうかを判定する。
 *
 * @param {unknown} code
 * @returns {boolean}
 */
export function isExternalCodeMissing(code) {
  return code === null || code === undefined || String(code).trim() === '';
}

/**
 * 外部項目コードを自然順で比較する。未設定は末尾へ置く（仕様書8.7.3、8.7.4）。
 *
 * @param {string|null} left
 * @param {string|null} right
 * @returns {number}
 */
export function compareExternalCode(left, right) {
  const leftMissing = isExternalCodeMissing(left);
  const rightMissing = isExternalCodeMissing(right);
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) {
      return 0;
    }
    return leftMissing ? 1 : -1;
  }
  return compareNatural(left, right);
}

/**
 * 作業項目を外部項目コード順へ並べた新しい配列を返す。
 *
 * 未設定どうしと同一コードどうしは表示順（`order`）で安定させる。
 *
 * @param {{externalCode: string|null, order: number}[]} tasks
 * @returns {object[]}
 */
export function sortByExternalCode(tasks) {
  return [...tasks].sort((left, right) => {
    const codeDiff = compareExternalCode(left.externalCode, right.externalCode);
    return codeDiff !== 0 ? codeDiff : left.order - right.order;
  });
}
