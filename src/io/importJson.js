/** JSONファイルの読み出しと事前検証（仕様書9.3）。 */

import { ValidationError } from '../app/errors.js';
import { validateImport } from '../domain/integrity.js';

/**
 * 選択されたファイルをJSONとして読み、構造・業務整合性まで確認する。
 *
 * 保存アダプターも同じ検証を再実行する。ここでの検証は、置換確認を出す前に
 * 利用者へ原因を返すための防御であり、不変条件の正は保存入口側に残す。
 */
export async function readImportFile(file) {
  if (file === null || file === undefined || typeof file.text !== 'function') {
    throw new ValidationError(['ファイル: JSONファイルを選択してください']);
  }

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    throw new ValidationError([
      `ファイル: JSONとして読み取れません（${error?.message ?? String(error)}）`,
    ]);
  }

  const result = validateImport(payload);
  if (!result.ok) {
    throw new ValidationError(result.errors);
  }
  return payload;
}
