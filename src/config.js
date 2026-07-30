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

/** 未終了区間を強調表示するしきい値の初期値。時間（仕様書8.8.3）。 */
export const DEFAULT_LONG_RUNNING_THRESHOLD_HOURS = 12;

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
