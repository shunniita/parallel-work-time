/**
 * アプリ全体の既定値と定数。
 *
 * 仕様書13章（保守性）により、保持期間と警告しきい値はソース修正なしで
 * 変更できる。ここに置くのは初期値であり、実際の値は設定へ保存する。
 */

/**
 * スキーマ版。この定数が値の正であり、Settings とエクスポートJSONの
 * 両方へこの値を書き込む（仕様書6.2）。
 */
export const SCHEMA_VERSION = 1;

/** IndexedDB のデータベース名と版（仕様書5.2）。 */
export const DB_NAME = 'parallel-work-time';
export const DB_VERSION = 1;

/** 保持期間の初期値。日数（仕様書10.2）。 */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * 保持期間と未終了しきい値の上限。
 *
 * 上限そのものは仕様書が定めていない。設けるのは、これらの値が日時の加算へ
 * そのまま入るためである。`retentionDays` は `archivedAt` へ日数を足して削除
 * 候補になる日時を作り（10.2）、しきい値は経過時間との比較に使う（8.8.3）。
 * 上限が無いと `1e20` のような値を保存でき、加算結果が `Date` の表現範囲
 * （±約27万年）を超えて `NaN` になる。`NaN` は比較で例外になり、保存済みの
 * 設定が原因で画面が開けなくなる。入力の時点で弾く方が復旧しやすい。
 *
 * 値は運用上の上限として選んだ。保持期間10年、しきい値1年を超える設定に
 * 意味のある使い道が無い。
 */
export const MAX_RETENTION_DAYS = 3650;
export const MAX_LONG_RUNNING_THRESHOLD_HOURS = 8760;

/** 未終了区間を強調表示するしきい値の初期値。時間（仕様書8.8.3）。 */
export const DEFAULT_LONG_RUNNING_THRESHOLD_HOURS = 12;

/**
 * 設定値が保存してよい範囲かを判定する。
 *
 * 保存の入口（`updateSettings`）、スキーマ検証（`schema.js`）、取り込み検証が
 * 同じ述語を使う。別々に書くと、片方だけを通る経路から範囲外の値が入る。
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {boolean}
 */
export function isSettingInRange(value, max) {
  return Number.isSafeInteger(value) && value >= 1 && value <= max;
}

/**
 * 保存済みの保持期間を読み取り用に解決する。
 *
 * 書き込みは範囲を強制するが、読み取りは既定値へ倒す。この修正より前に保存
 * された範囲外の値や、外部で書き換えられた値があっても、アーカイブ画面が開けなく
 * なるより既定値で動く方がよい。設定画面から入れ直せば正しい値に戻る。
 *
 * @param {{retentionDays?: unknown}|null|undefined} settings
 * @returns {number}
 */
export function resolveRetentionDays(settings) {
  const value = settings?.retentionDays;
  return isSettingInRange(value, MAX_RETENTION_DAYS) ? value : DEFAULT_RETENTION_DAYS;
}

/**
 * 保存済みの未終了しきい値を読み取り用に解決する。`resolveRetentionDays` と
 * 同じ理由で、範囲外の値は既定値へ倒す。
 *
 * @param {{longRunningThresholdHours?: unknown}|null|undefined} settings
 * @returns {number}
 */
export function resolveLongRunningThresholdHours(settings) {
  const value = settings?.longRunningThresholdHours;
  return isSettingInRange(value, MAX_LONG_RUNNING_THRESHOLD_HOURS)
    ? value
    : DEFAULT_LONG_RUNNING_THRESHOLD_HOURS;
}

/** 未終了区間のしきい値判定を再評価する間隔。ミリ秒（仕様書8.8）。 */
export const THRESHOLD_RECHECK_INTERVAL_MS = 60 * 1000;

/** 多重タブ検知に使う BroadcastChannel 名（仕様書8.10）。 */
export const TAB_CHANNEL_NAME = 'parallel-work-time/tab-guard';

/** エクスポートファイル名の接頭辞（仕様書9.2）。 */
export const EXPORT_FILE_PREFIX = 'parallel-work-time';

/**
 * 設定の初期値を返す。
 *
 * 呼び出しごとに新しいオブジェクトを返し、既定値そのものが
 * 書き換えられないようにする。
 *
 * @returns {{schemaVersion: number, retentionDays: number,
 *            longRunningThresholdHours: number, lastExportedAt: string|null}}
 */
export function createDefaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    retentionDays: DEFAULT_RETENTION_DAYS,
    longRunningThresholdHours: DEFAULT_LONG_RUNNING_THRESHOLD_HOURS,
    lastExportedAt: null,
  };
}
