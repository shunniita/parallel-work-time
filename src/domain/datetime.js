/**
 * 日時の生成・解析・差分。
 *
 * 保存形式はタイムゾーンオフセット付きISO 8601、秒精度（仕様書8.4.4）。
 * オフセットを文字列へ含めるため、日をまたぐ区間も解析だけで正しく扱える（仕様書8.4.8）。
 *
 * このモジュールは現在時刻を自分で取得しない。現在日時が必要な処理は
 * 呼び出し側から Date を受け取る。
 */

/** オフセット付きISO 8601（秒精度）。ミリ秒や日付のみの形式は受け付けない。 */
const ISO_SECOND_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;

/** 日付のみの形式（実施回の作業日、仕様書6.5）。 */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * UTCからの分差をISO 8601のオフセット表記へ変換する。
 *
 * 引数は `Date#getTimezoneOffset()` と同じ符号（UTCより西が正）で受け取るため、
 * 出力の符号は反転する。JST（-540）は `+09:00` になる。
 *
 * @param {number} offsetMinutes
 * @returns {string}
 */
export function formatOffset(offsetMinutes) {
  if (!Number.isInteger(offsetMinutes)) {
    throw new TypeError(`オフセットは整数の分で指定する: ${offsetMinutes}`);
  }
  const sign = offsetMinutes > 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

/**
 * Date をローカルタイムゾーンのISO 8601（秒精度）へ変換する。
 *
 * ミリ秒は切り捨てる。
 *
 * @param {Date} date
 * @returns {string}
 */
export function toIsoSecond(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`有効な Date が必要: ${date}`);
  }
  const datePart = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const timePart = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return `${datePart}T${timePart}${formatOffset(date.getTimezoneOffset())}`;
}

/**
 * 保存形式として妥当なISO 8601かどうかを判定する。
 *
 * 形式が合っていても実在しない日付（2月30日など）は false を返す。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidIsoSecond(value) {
  if (typeof value !== 'string' || !ISO_SECOND_PATTERN.test(value)) {
    return false;
  }
  const epochMs = Date.parse(value);
  if (Number.isNaN(epochMs)) {
    return false;
  }
  // Date.parse は 2026-02-30 のような繰り上がる日付を受け付ける場合があるため、
  // 壁時計の日付が保たれているかを確認する。ローカル時刻 = UTC + オフセット
  // なので、オフセット分を足した時刻をUTCとして読み直す。
  const [, year, month, day] = ISO_SECOND_PATTERN.exec(value);
  const offsetMinutes = parseOffsetMinutes(value.slice(19));
  const shifted = new Date(epochMs + offsetMinutes * 60 * 1000);
  return (
    shifted.getUTCFullYear() === Number(year) &&
    shifted.getUTCMonth() + 1 === Number(month) &&
    shifted.getUTCDate() === Number(day)
  );
}

function parseOffsetMinutes(offsetPart) {
  if (offsetPart === 'Z') {
    return 0;
  }
  const sign = offsetPart[0] === '-' ? -1 : 1;
  const hours = Number(offsetPart.slice(1, 3));
  const minutes = Number(offsetPart.slice(4, 6));
  return sign * (hours * 60 + minutes);
}

/**
 * ISO 8601 をエポックミリ秒へ変換する。
 *
 * @param {string} value
 * @returns {number}
 */
export function parseIso(value) {
  if (!isValidIsoSecond(value)) {
    throw new TypeError(`オフセット付きISO 8601（秒精度）が必要: ${value}`);
  }
  return Date.parse(value);
}

/**
 * 2つの日時の差をミリ秒で返す（終了 − 開始）。
 *
 * @param {string} startIso
 * @param {string} endIso
 * @returns {number}
 */
export function diffMs(startIso, endIso) {
  return parseIso(endIso) - parseIso(startIso);
}

/**
 * 2つの日時の差を秒へ切り捨てて返す（仕様書8.6.1）。
 *
 * @param {string} startIso
 * @param {string} endIso
 * @returns {number}
 */
export function diffSeconds(startIso, endIso) {
  return Math.floor(diffMs(startIso, endIso) / 1000);
}

/**
 * Date をローカル日付の `YYYY-MM-DD` へ変換する。
 *
 * @param {Date} date
 * @returns {string}
 */
export function toDateKey(date) {
  return toIsoSecond(date).slice(0, 10);
}

/**
 * ISO 8601 の日付部分を返す。オフセットを含めたローカル日付になる。
 *
 * @param {string} iso
 * @returns {string}
 */
export function dateKeyOf(iso) {
  if (!isValidIsoSecond(iso)) {
    throw new TypeError(`オフセット付きISO 8601（秒精度）が必要: ${iso}`);
  }
  return iso.slice(0, 10);
}

/**
 * `YYYY-MM-DD` として妥当かどうかを判定する。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) {
    return false;
  }
  return isValidIsoSecond(`${value}T00:00:00Z`);
}
