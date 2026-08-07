/** JSONエクスポートのファイル化とダウンロード（仕様書9.2）。 */

import { EXPORT_FILE_PREFIX } from '../config.js';

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** `parallel-work-time_YYYYMMDD-HHmmss.json` 形式の名前を作る。 */
export function exportFileName(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('エクスポートファイル名には有効な日時が必要です。');
  }
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${EXPORT_FILE_PREFIX}_${day}-${time}.json`;
}

/** 人が確認しやすい2空白インデント、末尾改行ありのJSONへする。 */
export function serializeExport(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * JSONをブラウザのダウンロードとして渡す。
 *
 * Browser APIは注入できるようにし、単体テストで実際のダウンロードを起こさない。
 */
export function downloadExport(payload, options = {}) {
  const date = options.date ?? new Date();
  const documentRef = options.documentRef ?? document;
  const BlobCtor = options.BlobCtor ?? Blob;
  const createObjectURL = options.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = options.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const filename = exportFileName(date);
  const text = serializeExport(payload);
  const blob = new BlobCtor([text], { type: 'application/json;charset=utf-8' });
  const url = createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  documentRef.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    revokeObjectURL(url);
  }
  return { filename, text };
}
