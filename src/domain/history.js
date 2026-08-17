/**
 * 簡易変更履歴の組み立て（仕様書11章）。
 *
 * 全面的な監査ログは初版では設けない。履歴を残すのは次の3種の操作に限る。
 *
 * - 転記済み状態からの後退
 * - 作業区間または直接入力の削除
 * - 実施回または案件グループの削除
 *
 * いずれも `reason` が必須である。ここは「履歴1件を作る」ことと「何を削除
 * したかを1行で言い表す」ことだけを持つ純関数である。書き込みは
 * `src/app/actions/` が行い、削除本体と同一の保存へまとめる。
 *
 * ## 削除と同時に書く
 *
 * 履歴を後から足すと、その間「履歴を残さずに削除できる」期間が生まれ、
 * 仕様書11章を満たさない記録が実データへ残る。削除と同時に書き込み、
 * 履歴を残す操作の入口は、すべてこのモジュールにする。
 */

import {
  INTERVAL_TYPE_LABEL,
  intervalEffortSeconds,
  isOpenInterval,
  summarizeRun,
} from './effort.js';
import { dateKeyOf, formatIsoForHuman, isValidIsoSecond } from './datetime.js';
import { formatSeconds } from './directEntryOps.js';
import { RUN_STATUS_LABEL } from './runStatus.js';
import { HISTORY_ENTITY_TYPE, HISTORY_OPERATION } from './schema.js';
import { MAX_SUMMARY_LENGTH, MAX_TEXT_LENGTH } from '../config.js';

/** 履歴の対象種別（仕様書11章）。`schema.js` の一覧へ名前を付けたもの。 */
export const HISTORY_ENTITY = {
  WORK_RUN: 'workRun',
  PROJECT_GROUP: 'projectGroup',
  INTERVAL: 'interval',
  DIRECT_ENTRY: 'directEntry',
};

/** 履歴の操作種別（仕様書11章）。 */
export const HISTORY_OP = {
  STATUS_REVERTED: 'statusReverted',
  INTERVAL_DELETED: 'intervalDeleted',
  DIRECT_ENTRY_DELETED: 'directEntryDeleted',
  WORK_RUN_DELETED: 'workRunDeleted',
  PROJECT_GROUP_DELETED: 'projectGroupDeleted',
};

/**
 * 操作と対象種別の対応（過去のレビュー指摘）。
 *
 * 仕様書11章は対象種別と操作をそれぞれ列挙するが、**組み合わせの表は無い**。
 * 列挙値どうしを自由に組めると、`projectGroup` を対象にした `intervalDeleted`
 * のような、語義の通らない履歴を作れてしまう。現行の語義では対応は一意に決まる
 * ため、ここで契約として固定する。
 *
 * 書き込み（{@link buildHistoryEntry}）と取り込み（`integrity.js`）の両方が
 * この表を見る。片方だけに置くと、経路によって通る履歴が変わる。
 */
export const HISTORY_ENTITY_BY_OP = {
  [HISTORY_OP.STATUS_REVERTED]: HISTORY_ENTITY.WORK_RUN,
  [HISTORY_OP.INTERVAL_DELETED]: HISTORY_ENTITY.INTERVAL,
  [HISTORY_OP.DIRECT_ENTRY_DELETED]: HISTORY_ENTITY.DIRECT_ENTRY,
  [HISTORY_OP.WORK_RUN_DELETED]: HISTORY_ENTITY.WORK_RUN,
  [HISTORY_OP.PROJECT_GROUP_DELETED]: HISTORY_ENTITY.PROJECT_GROUP,
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * 履歴1件を組み立てる（仕様書11章）。
 *
 * 検証を通らない場合は組み立てない。履歴だけが欠けた削除も、内容の欠けた履歴も
 * 後から埋め合わせられないためである。
 *
 * `reason` は必須である。仕様書11章は「転記済み状態からの後退および削除の場合に
 * 必須」と定めており、履歴を残す操作はいまのところすべてどちらかに当たる。
 * 前後空白だけの理由は未入力として扱う。
 *
 * @param {{entityType: string, targetId: string, operation: string,
 *          summary: string, reason: string}} draft
 * @param {{historyId: string, timestamp: string}} meta
 * @returns {{ok: boolean, errors: string[], entry: object|null}}
 */
export function buildHistoryEntry(draft, meta) {
  const errors = [];

  if (!HISTORY_ENTITY_TYPE.includes(draft.entityType)) {
    errors.push(`対象種別: ${HISTORY_ENTITY_TYPE.join(' / ')} のいずれかである`);
  }
  if (!isNonEmptyString(draft.targetId)) {
    errors.push('対象: 識別子が必要である');
  } else if (draft.targetId.trim().length > MAX_TEXT_LENGTH) {
    errors.push(`対象: 識別子は${MAX_TEXT_LENGTH}文字以下である`);
  }
  if (!HISTORY_OPERATION.includes(draft.operation)) {
    errors.push(`操作: ${HISTORY_OPERATION.join(' / ')} のいずれかである`);
  } else {
    // 操作が既知なら、対象種別との組み合わせも確かめる（過去のレビュー指摘）。
    // 操作が未知の場合は上の指摘だけで足り、対応表を引いても意味がない。
    const expected = HISTORY_ENTITY_BY_OP[draft.operation];
    if (draft.entityType !== expected) {
      errors.push(`対象種別: ${draft.operation} の対象種別は ${expected} である`);
    }
  }
  if (typeof draft.summary !== 'string') {
    errors.push('要約: 文字列である');
  } else if (draft.summary.length > MAX_SUMMARY_LENGTH) {
    errors.push(`要約: ${MAX_SUMMARY_LENGTH}文字以下である`);
  }
  if (!isNonEmptyString(draft.reason)) {
    errors.push('理由: 必須項目である');
  } else if (draft.reason.trim().length > MAX_TEXT_LENGTH) {
    errors.push(`理由: ${MAX_TEXT_LENGTH}文字以下である`);
  }
  if (!isNonEmptyString(meta.historyId)) {
    errors.push('履歴ID: 識別子が必要である');
  } else if (meta.historyId.trim().length > MAX_TEXT_LENGTH) {
    errors.push(`履歴ID: ${MAX_TEXT_LENGTH}文字以下である`);
  }
  if (!isValidIsoSecond(meta.timestamp)) {
    errors.push('記録日時: オフセット付きISO 8601（秒精度）が必要である');
  }

  if (errors.length > 0) {
    return { ok: false, errors, entry: null };
  }

  return {
    ok: true,
    errors: [],
    entry: {
      historyId: meta.historyId,
      timestamp: meta.timestamp,
      entityType: draft.entityType,
      targetId: draft.targetId,
      operation: draft.operation,
      summary: draft.summary,
      reason: draft.reason.trim(),
    },
  };
}

/**
 * 区間の時間帯を1行で表す。
 *
 * 日をまたぐ場合だけ終了側にも日付を付ける（仕様書8.4.8）。同日なら時刻だけに
 * して、一覧で開始と終了を見比べやすくする。
 *
 * @param {{startAt: string, endAt: string|null}} interval
 * @returns {string}
 */
export function formatIntervalRange(interval) {
  const start = formatIsoForHuman(interval.startAt);
  if (isOpenInterval(interval)) {
    return `${start} 〜 未終了`;
  }
  const sameDay = dateKeyOf(interval.startAt) === dateKeyOf(interval.endAt);
  const end = sameDay
    ? interval.endAt.slice(11, 19)
    : formatIsoForHuman(interval.endAt);
  return `${start} 〜 ${end}`;
}

/**
 * 区間1件の内容を1行で表す。
 *
 * 削除前の確認と、履歴の要約の両方で使う。確認画面と履歴で表記が食い違うと、
 * 「確認したものが消えたか」を後から突き合わせられない。
 *
 * 工数を含めるのは、削除の影響が数字として分かるようにするためである。休憩は
 * 0秒であり（仕様書8.6.2）、未終了区間は確定分に含めない（仕様書8.6.5）ので、
 * どちらも「0秒」と出る。
 *
 * @param {{type: string, startAt: string, endAt: string|null, participants: string[]}} interval
 * @returns {string}
 */
export function describeInterval(interval) {
  const type = INTERVAL_TYPE_LABEL[interval.type] ?? interval.type;
  const participants =
    interval.participants.length === 0 ? 'なし' : interval.participants.join('、');
  const effort = intervalEffortSeconds(interval);
  return (
    `${type} ${formatIntervalRange(interval)} / ` +
    `参加者: ${participants} / 工数: ${effort}秒`
  );
}

/**
 * 区間削除の要約文を作る（仕様書11章）。
 *
 * 変更前後の完全な複製は必須ではない（仕様書11章）。ただし「どの実施回の
 * どの作業項目から、どの時間帯の区間が消えたか」が分からない履歴は、後から
 * 突き合わせる用を成さない。実施回・作業項目・区間の内容をこの1行へ入れる。
 *
 * @param {{workDate: string}} workRun
 * @param {{name: string}} taskRecord
 * @param {object} interval
 * @returns {string}
 */
export function summarizeIntervalDeletion(workRun, taskRecord, interval) {
  return (
    `実施回 ${workRun.workDate} / 作業項目「${taskRecord.name}」の作業区間を削除` +
    `（${describeInterval(interval)}）`
  );
}

/**
 * 直接入力1件の内容を1行で表す。
 *
 * 区間の {@link describeInterval} と同じく、削除前の確認と履歴の要約の両方で
 * 使う。確認画面と履歴で表記が食い違うと、「確認したものが消えたか」を後から
 * 突き合わせられない。
 *
 * 工数は参加者数を掛けない値である（仕様書8.5.6）。参加者は誰の分かを照合する
 * 補助情報なので（仕様書6.8）、人数から工数を再計算できると誤読されないよう、
 * 秒数をそのまま出す。
 *
 * 備考を含める。直接入力は計測の裏づけが無い数字であり、何のために足した分が
 * 消えたのかは備考にしか残っていない。
 *
 * @param {{seconds: number, participants: string[], note: string}} entry
 * @returns {string}
 */
export function describeDirectEntry(entry) {
  const participants = entry.participants.length === 0 ? 'なし' : entry.participants.join('、');
  return (
    `追加工数: ${formatSeconds(entry.seconds)}（${entry.seconds}秒） / ` +
    `参加者: ${participants} / 備考: ${entry.note}`
  );
}

/**
 * 直接入力削除の要約文を作る（仕様書11章）。
 *
 * @param {{workDate: string}} workRun
 * @param {{name: string}} taskRecord
 * @param {object} entry
 * @returns {string}
 */
export function summarizeDirectEntryDeletion(workRun, taskRecord, entry) {
  return (
    `実施回 ${workRun.workDate} / 作業項目「${taskRecord.name}」の直接入力を削除` +
    `（${describeDirectEntry(entry)}）`
  );
}

/**
 * 実施回1件の内容を1行で表す。
 *
 * 削除すると配下の作業項目・区間・直接入力がまとめて消える。何がどれだけ消えたか
 * を件数と工数で残す。個々の区間まで書き出すと要約が長くなりすぎるため、規模が
 * 分かる粒度に留める。
 *
 * @param {{workDate: string, runQuantity: number, status: string, tasks: object[]}} workRun
 * @returns {string}
 */
export function describeWorkRun(workRun) {
  const tasks = workRun.tasks ?? [];
  const intervals = tasks.reduce((total, task) => total + (task.intervals ?? []).length, 0);
  const entries = tasks.reduce((total, task) => total + (task.directEntries ?? []).length, 0);
  const summary = summarizeRun(workRun);
  const transfer =
    summary.transferMinutesSum === null
      ? '転記値: 未確定'
      : `転記値合計: ${summary.transferMinutesSum}分`;
  return (
    `作業日 ${workRun.workDate} / 数量 ${workRun.runQuantity} / ` +
    `状態 ${RUN_STATUS_LABEL[workRun.status] ?? workRun.status} / ` +
    `作業項目 ${tasks.length}件・区間 ${intervals}件・直接入力 ${entries}件 / ${transfer}`
  );
}

/**
 * 実施回削除の要約文を作る（仕様書11章）。
 *
 * 案件IDを含める。実施回を消すと親の案件からたどれなくなるため、要約だけで
 * どの案件の記録だったかが分かる必要がある。
 *
 * @param {{projectId: string}} projectGroup
 * @param {object} workRun
 * @returns {string}
 */
export function summarizeWorkRunDeletion(projectGroup, workRun) {
  return `案件 ${projectGroup.projectId} の実施回を削除（${describeWorkRun(workRun)}）`;
}

/**
 * 案件グループ削除の要約文を作る（仕様書11章）。
 *
 * 配下の実施回もすべて消える。実施回1件ずつの履歴は残さず、この1件へまとめる。
 * 案件を消すという1つの操作であり、利用者から見て複数の削除ではない。件数と
 * 数量で規模を残す。
 *
 * @param {{projectId: string, targetType: string, variant: string,
 *          totalQuantity: number}} projectGroup
 * @param {object[]} runs 配下の実施回
 * @returns {string}
 */
export function summarizeProjectGroupDeletion(projectGroup, runs) {
  const accumulated = runs.reduce((total, run) => total + run.runQuantity, 0);
  return (
    `案件 ${projectGroup.projectId} を削除` +
    `（${projectGroup.targetType} / ${projectGroup.variant} / ` +
    `総予定数 ${projectGroup.totalQuantity} / 実施回 ${runs.length}件・累計数量 ${accumulated}）`
  );
}
