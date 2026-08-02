/**
 * アクションが受け取る依存の既定値。
 *
 * 時刻とID生成はテストで固定したいので引数で受け取る（実装計画4.2）。同じ
 * 補完処理を各アクションファイルへ書き写すと、既定値がずれても気づけないため
 * 1か所へ置く。
 */

import { newId as defaultNewId } from '../../domain/ids.js';

/**
 * 依存を既定値で補う。
 *
 * @param {{adapter: object, persistence: object, now?: () => Date,
 *          newId?: () => string}} deps
 * @returns {{adapter: object, persistence: object, now: () => Date,
 *            newId: () => string}}
 */
export function resolveDeps(deps) {
  return {
    adapter: deps.adapter,
    persistence: deps.persistence,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? defaultNewId,
  };
}
