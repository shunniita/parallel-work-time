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

/**
 * 数量（総予定数・今回数量、仕様書8.9.2）の上限。
 *
 * 上限が無いと `9007199254740993` のような値が `Number` へ丸められたまま整数として
 * 通り、保存された値と入力した値が一致しなくなる。累計の加算も安全整数の外へ出る。
 * 性能目標が置く規模（案件20件・実施回100件、仕様書13章）に対して十分な余裕を
 * 取ったうえで、丸めが起きない範囲へ収める。
 */
export const MAX_QUANTITY = 1_000_000;

/**
 * 直接入力の秒数（仕様書8.5.5、8.5.6）の上限。
 *
 * 直接入力は「作業1件分の工数」であり、1年分を超える値に業務上の意味が無い。
 * 集計は秒を合算して分へ切り上げるため（8.6.1）、ここを開けたままにすると
 * 合計が安全整数の外へ出て、転記値が黙って別の数になりうる。
 */
export const MAX_DIRECT_ENTRY_SECONDS = 366 * 24 * 60 * 60;

/**
 * 作業項目実績1件、および実施回1件の合計工数の上限。秒（仕様書8.6）。
 *
 * 個々の入力値に上限を置いても、派生する合計には効かない。工数は
 * 「区間の経過秒 × 参加者数」を足し合わせた値であり、区間数・作業項目数・
 * 参加者数がそれぞれ上限内でも、積と和を重ねれば安全整数（約9.0×10^15）を
 * 超えうる。超えた時点で加算は丸められ、集計値と転記値が静かに厳密値からずれる。
 *
 * 10^12秒は約31,700人年であり、業務上到達しない。安全整数に対して4桁の余裕を
 * 残すため、合計がこの値を超えた入力は受け付けない。
 */
export const MAX_EFFORT_SECONDS = 1_000_000_000_000;

/**
 * 版番号・表示順のような通し番号の上限。
 *
 * どちらもツールが1から順に振る値であり（`templateOps.js`）、利用者が直接
 * 打ち込む数ではない。上限は「人手で編集したJSONの異常値を弾く」ためだけに置く。
 */
export const MAX_ORDINAL = 100_000;

/**
 * 取り込むJSONの上限（仕様書9.3）。
 *
 * 全置換インポートは唯一、ツール外で作られた任意の入力を丸ごと受け取る経路である。
 * 検証は全件をメモリへ載せてから走るため、上限が無いと巨大なファイルや極端に長い
 * 文字列だけで画面が応答しなくなる。読み込みの前と検証の中の両方で見る。
 *
 * `MAX_IMPORT_ENTITIES` は1コレクションあたりの件数である。性能目標が置く規模
 * （案件20件・実施回100件・区間2,000件、仕様書13章）の百倍以上を許す一方、
 * 桁違いの入力は取り込む前に断る。
 */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_IMPORT_ENTITIES = 100_000;
export const MAX_TEXT_LENGTH = 1_000;

/**
 * 変更履歴の要約（仕様書11章）の上限。
 *
 * 要約はツールが組み立てる1行であり、利用者が打ち込む項目ではない。区間の内容や
 * 参加者一覧を含めるため他の文字列項目より長くなる。
 */
export const MAX_SUMMARY_LENGTH = 10_000;

/**
 * 1区間・1直接入力あたりの参加者数の上限（仕様書8.6.1）。
 *
 * 作業区間の工数は人数を掛けて求める。ここが開いていると、取り込んだJSONひとつで
 * 転記値を任意倍にできる。同時に同じ作業項目を実施する人数として現実的な範囲へ
 * 収める。
 */
export const MAX_PARTICIPANTS = 200;

/** 未終了区間を強調表示するしきい値の初期値。時間（仕様書8.8.3）。 */
export const DEFAULT_LONG_RUNNING_THRESHOLD_HOURS = 12;

/**
 * 1以上 `max` 以下の安全な整数かを判定する。
 *
 * 設定値・数量・秒数・通し番号のいずれもこの述語を通す。保存の入口
 * （`updateSettings` などのアクション）、スキーマ検証（`schema.js`）、取り込み
 * 検証が同じ述語を使う。別々に書くと、片方だけを通る経路から範囲外の値が入る。
 *
 * `Number.isInteger()` では足りない。`9007199254740993` は `Number` へ変換された
 * 時点で `9007199254740992` へ丸められ、丸めた後でも整数判定を通る。入力した値と
 * 保存される値が違うことに利用者が気づけないため、安全整数で判定する。
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {boolean}
 */
export function isIntegerInRange(value, max) {
  return Number.isSafeInteger(value) && value >= 1 && value <= max;
}

/**
 * 0以上 `max` 以下の安全な整数かを判定する。0を許す項目に使う。
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {boolean}
 */
export function isNonNegativeIntegerInRange(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
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
  return isIntegerInRange(value, MAX_RETENTION_DAYS) ? value : DEFAULT_RETENTION_DAYS;
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
  return isIntegerInRange(value, MAX_LONG_RUNNING_THRESHOLD_HOURS)
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
