/** JSONファイルの読み出しと事前検証（仕様書9.3）。 */

import { MAX_IMPORT_BYTES } from '../config.js';
import { ValidationError } from '../app/errors.js';
import { validateImport } from '../domain/integrity.js';

/**
 * 選択されたファイルをJSONとして読み、構造・業務整合性まで確認する。
 *
 * 保存アダプターも同じ検証を再実行する。ここでの検証は、置換確認を出す前に
 * 利用者へ原因を返すための防御であり、不変条件の正は保存入口側に残す。
 *
 * 大きさは中身を読む前に見る。全置換インポートはツール外で作られた任意の入力を
 * 受け取る唯一の経路であり（9.3）、`text()` と `JSON.parse()` は途中で諦められない。
 * 巨大なファイルを選んだだけで画面が固まると、利用者は誤操作を取り消せない。
 */
export async function readImportFile(file) {
  if (file === null || file === undefined || typeof file.text !== 'function') {
    throw new ValidationError(['ファイル: JSONファイルを選択してください']);
  }
  if (typeof file.size === 'number' && file.size > MAX_IMPORT_BYTES) {
    throw new ValidationError([
      `ファイル: ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)}MB 以下のJSONのみ取り込めます` +
        `（選択されたファイルは ${Math.ceil(file.size / 1024 / 1024)}MB）`,
    ]);
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
