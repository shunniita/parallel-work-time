/**
 * 日時の生成・解析・差分。
 *
 * 保存形式はタイムゾーンオフセット付きISO 8601、秒精度（仕様書8.4.4）。
 * オフセットを文字列へ含めるため、日をまたぐ区間も解析だけで正しく扱える（仕様書8.4.8）。
 *
 * このモジュールは現在時刻を自分で取得しない。現在日時が必要な処理は
 * 呼び出し側から Date を受け取る。
 *
 * ## オフセットの符号規約
 *
 * 公開APIの `offsetMinutes` はすべて ISO 8601 と同じ符号で扱う（UTCより東が正、
 * JST は `+540`）。`Date#getTimezoneOffset()` は逆符号（西が正）を返すため、
 * その値を扱うのは {@link localOffsetMinutes} の内部だけに閉じ込める。同一
 * モジュール内で2つの規約が混ざると、オフセット計算を触るたびに符号の取り違えが
 * 起きる（レビュー指摘 F-25）。
 *
 * ## 夏時間を想定しない
 *
 * 本ツールは夏時間のない地域（日本）での利用を前提とする。夏時間の切替に伴う
 * 「存在しない時刻」と「2回存在する時刻」に専用の扱いは設けない（レビュー指摘
 * SOL-1 の決定）。
 *
 * ただし、オフセットは**入力された壁時計日時に対応するもの**を求める。現在日時や
 * 別の日のオフセットを流用すると、夏時間のある環境で保存される瞬間が1時間ずれる
 * ためである。この求め方であれば、夏時間の有無にかかわらず入力どおりの瞬間が
 * 保存される。副次的に、存在しない時刻は {@link isValidDateTimeLocal} と
 * {@link fromDateTimeLocal} が拒否し、2回存在する時刻は処理系が選ぶ側として
 * 保存される。日本ではどちらも起こらない。
 */

/** オフセット付きISO 8601（秒精度）。ミリ秒や日付のみの形式は受け付けない。 */
const ISO_SECOND_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;

/** 日付のみの形式（実施回の作業日、仕様書6.5）。 */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `<input type="datetime-local">` の値。秒は省略されうる（仕様書8.4.3、8.4.4）。 */
const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * UTCからの分差をISO 8601のオフセット表記へ変換する。
 *
 * 引数は ISO 8601 と同じ符号（UTCより東が正）で受け取る。JST（540）は
 * `+09:00` になる。`Date#getTimezoneOffset()` の値をそのまま渡してはならない。
 * 符号が逆であり、{@link localOffsetMinutes} を経由する。
 *
 * @param {number} offsetMinutes
 * @returns {string}
 */
export function formatOffset(offsetMinutes) {
  if (!Number.isInteger(offsetMinutes)) {
    throw new TypeError(`オフセットは整数の分で指定する: ${offsetMinutes}`);
  }
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

/**
 * Date のローカルタイムゾーンのオフセットを ISO 規約の分で返す。
 *
 * `Date#getTimezoneOffset()` を呼ぶのはここだけである。呼び出し側は符号の
 * 反転を気にしなくてよい。
 *
 * @param {Date} date
 * @returns {number} UTCより東が正。JST なら 540
 */
export function localOffsetMinutes(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`有効な Date が必要: ${date}`);
  }
  return -date.getTimezoneOffset();
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
  return `${datePart}T${timePart}${formatOffset(localOffsetMinutes(date))}`;
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
 * ISO 8601 が持つオフセットを分で返す。
 *
 * @param {string} iso
 * @returns {number} UTCより東が正
 */
export function offsetMinutesOf(iso) {
  assertIso(iso);
  return parseOffsetMinutes(iso.slice(19));
}

function assertIso(value) {
  if (!isValidIsoSecond(value)) {
    throw new TypeError(`オフセット付きISO 8601（秒精度）が必要: ${value}`);
  }
}

/**
 * ISO 8601 をエポックミリ秒へ変換する。
 *
 * @param {string} value
 * @returns {number}
 */
export function parseIso(value) {
  assertIso(value);
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
 * 2つの日時の前後を比較する。
 *
 * 大小の判定を各所で `parseIso` の数値比較として書くと、比較のたびに解析の
 * 失敗をどう扱うかが散らばる。ここへ集約する（レビュー指摘 F-25）。
 * オフセットが異なっていても実時刻で比較する。
 *
 * @param {string} left
 * @param {string} right
 * @returns {number} `left` が前なら負、同時刻なら0、後なら正
 */
export function compareIso(left, right) {
  const difference = parseIso(left) - parseIso(right);
  if (difference === 0) {
    return 0;
  }
  return difference < 0 ? -1 : 1;
}

/**
 * 日時へ秒を加減算する。
 *
 * 元の値が持つオフセットを保つ。壁時計の値だけが動くため、日をまたいでも
 * 表示上の日付が正しく繰り上がる（仕様書8.4.8）。
 *
 * @param {string} iso
 * @param {number} seconds 負数で過去へ戻す
 * @returns {string}
 */
export function addSeconds(iso, seconds) {
  if (!Number.isInteger(seconds)) {
    throw new TypeError(`秒は整数で指定する: ${seconds}`);
  }
  const offsetMinutes = offsetMinutesOf(iso);
  const shifted = new Date(parseIso(iso) + seconds * 1000 + offsetMinutes * 60 * 1000);
  const datePart =
    `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-` +
    `${pad2(shifted.getUTCDate())}`;
  const timePart =
    `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:` +
    `${pad2(shifted.getUTCSeconds())}`;
  return `${datePart}T${timePart}${formatOffset(offsetMinutes)}`;
}

/**
 * ISO 8601 を `<input type="datetime-local">` の値へ変換する（仕様書8.4.4）。
 *
 * オフセットは落とす。入力欄は壁時計の値しか扱えないため、書き戻すときの
 * オフセットは {@link fromDateTimeLocal} の引数で明示する。
 *
 * @param {string} iso
 * @returns {string} 例: `2026-07-30T09:00:00`
 */
export function toDateTimeLocal(iso) {
  assertIso(iso);
  return iso.slice(0, 19);
}

/**
 * `<input type="datetime-local">` の値を解析する。
 *
 * 形式と、その壁時計日時が実在することの両方を見る。判定を1か所へ置き、
 * {@link isValidDateTimeLocal} と {@link fromDateTimeLocal} で結果が食い違わない
 * ようにする（レビュー指摘 SOL-3）。「妥当と判定したのに変換で例外」という境界を
 * 画面に作らないためである。
 *
 * 秒が省略された値（`2026-07-30T09:00`）は0秒として補う。ブラウザは `step` の
 * 指定によって秒を返したり返さなかったりする。
 *
 * `Date` は 2026-02-30 のような値を3月2日へ繰り上げて受け入れるため、壁時計の
 * 各項目が保たれているかで実在を判定する。
 *
 * @param {unknown} value
 * @returns {{date: Date, wallClock: string}|null} 妥当でなければ null
 */
function parseDateTimeLocal(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const matched = DATE_TIME_LOCAL_PATTERN.exec(value);
  if (matched === null) {
    return null;
  }
  const [, year, month, day, hours, minutes, seconds = '00'] = matched;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  const preserved =
    date.getFullYear() === Number(year) &&
    date.getMonth() + 1 === Number(month) &&
    date.getDate() === Number(day) &&
    date.getHours() === Number(hours) &&
    date.getMinutes() === Number(minutes) &&
    date.getSeconds() === Number(seconds);
  if (!preserved) {
    return null;
  }
  return { date, wallClock: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}` };
}

/**
 * `<input type="datetime-local">` の値をオフセット付きISO 8601 へ変換する。
 *
 * オフセットを省略すると、**入力された壁時計日時に対応するローカルオフセット**を
 * 使う。現在日時のオフセットを流用しないのは、夏時間のある環境で入力日と現在日の
 * 適用状態が違うと、保存される瞬間がずれるためである（レビュー指摘 SOL-1）。
 *
 * `offsetMinutes` を明示できるのは、保存済みの区間が持つオフセット
 * （{@link offsetMinutesOf}）で書き戻したい場合と、試験を実行環境の
 * タイムゾーンから切り離したい場合のためである。
 *
 * @param {string} value
 * @param {number} [offsetMinutes] UTCより東が正。省略時は入力日時のローカル値
 * @returns {string}
 */
export function fromDateTimeLocal(value, offsetMinutes) {
  const parsed = parseDateTimeLocal(value);
  if (parsed === null) {
    throw new TypeError(`datetime-local の値が必要: ${value}`);
  }
  const offset = offsetMinutes ?? localOffsetMinutes(parsed.date);
  const iso = `${parsed.wallClock}${formatOffset(offset)}`;
  // 保存形式として妥当かどうかは最後にもう一度確かめる。
  assertIso(iso);
  return iso;
}

/**
 * `<input type="datetime-local">` の値として妥当かどうかを判定する。
 *
 * 画面が保存前に入力欄の状態を見るために使う。{@link fromDateTimeLocal} が
 * 受け付ける値と一致する。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidDateTimeLocal(value) {
  return parseDateTimeLocal(value) !== null;
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
  assertIso(iso);
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
