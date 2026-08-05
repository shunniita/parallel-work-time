/**
 * 実施回の集計と転記用テキスト（仕様書8.6.5、8.7）。
 *
 * 純関数のみ。工数そのものの計算は `effort.js` が持ち、ここはそれを「転記のため
 * に読む形」へ整える。並べ替え、未設定コードの印、確定と未確定の切り分け、
 * クリップボードへ渡す文字列である。
 *
 * ## 未確定でも小計は出す
 *
 * 未終了区間を含む作業項目の転記値は未確定である（仕様書8.6.5）。ただし
 * 「未確定だから何も出さない」ではなく、確定済みの区間と直接入力から求めた
 * 小計は表示する。実施回合計についても同様とする、と仕様が明記している。
 *
 * このため実施回の転記値には2つの値がある。混同すると転記の数字を誤る。
 *
 * | 値 | 意味 |
 * | -- | ---- |
 * | `transferMinutesSum` | 実施回全体が確定しているときだけの合計。未確定なら `null` |
 * | `confirmedTransferMinutesSum` | 確定済みの作業項目だけを足した合計。常に数値 |
 *
 * 前者が `null` のときに後者を「実施回の転記値」として扱ってはならない。まだ
 * 記録されていない作業が残っている（レビュー指摘 F-25 の補足）。
 */

import { summarizeTask, toTransferMinutes } from './effort.js';
import { compareExternalCode, isExternalCodeMissing } from './naturalSort.js';

/** 集計一覧の並び順（仕様書8.7.3）。 */
export const AGGREGATE_SORT = {
  /** 外部項目コードの自然順。未設定は末尾（8.7.3）。転記の既定はこちら。 */
  EXTERNAL_CODE: 'externalCode',
  /** テンプレートで決めた表示順。 */
  ORDER: 'order',
};

/**
 * 実施回を転記のために集計する（仕様書8.7.1、8.7.2）。
 *
 * @param {{tasks: object[]}} workRun
 * @param {{sort?: string}} [options] 既定は外部項目コード順（8.7.3）
 * @returns {{rows: object[], totalSeconds: number, openCount: number,
 *            confirmed: boolean, transferMinutesSum: number|null,
 *            confirmedTransferMinutesSum: number, confirmedCount: number,
 *            unconfirmedCount: number, missingExternalCodeCount: number}}
 */
export function aggregateRun(workRun, { sort = AGGREGATE_SORT.EXTERNAL_CODE } = {}) {
  const rows = workRun.tasks.map((taskRecord) => {
    const summary = summarizeTask(taskRecord);
    return {
      taskRecordId: taskRecord.taskRecordId,
      name: taskRecord.name,
      externalCode: taskRecord.externalCode,
      order: taskRecord.order,
      // 転記時に欠落へ気づけるようにする（仕様書8.7.4）。並べ替えの都合とは別に、
      // 行ごとの印として持たせる。
      externalCodeMissing: isExternalCodeMissing(taskRecord.externalCode),
      ...summary,
    };
  });

  sortRows(rows, sort);

  const totalSeconds = rows.reduce((total, row) => total + row.totalSeconds, 0);
  const openCount = rows.reduce((total, row) => total + row.openCount, 0);
  const confirmed = openCount === 0;
  const confirmedRows = rows.filter((row) => row.confirmed);

  return {
    rows,
    totalSeconds,
    openCount,
    confirmed,
    // 実施回全体が確定しているときだけの合計。各作業項目の転記値を足す。実施回の
    // 合計秒をまとめて切り上げた値ではない（仕様書8.6.4、8.7.1）。
    transferMinutesSum: confirmed
      ? rows.reduce((total, row) => total + row.transferMinutes, 0)
      : null,
    // 確定済みの作業項目だけを足した小計。未確定でも表示できる（仕様書8.6.5）。
    confirmedTransferMinutesSum: confirmedRows.reduce(
      (total, row) => total + row.transferMinutes,
      0,
    ),
    confirmedCount: confirmedRows.length,
    unconfirmedCount: rows.length - confirmedRows.length,
    missingExternalCodeCount: rows.filter((row) => row.externalCodeMissing).length,
  };
}

/**
 * 行を並べ替える（その場で書き換える）。
 *
 * 外部項目コード順では、同一コードと未設定どうしを表示順で安定させる。
 *
 * @param {object[]} rows
 * @param {string} sort
 */
function sortRows(rows, sort) {
  if (sort === AGGREGATE_SORT.ORDER) {
    rows.sort((left, right) => left.order - right.order);
    return;
  }
  rows.sort((left, right) => {
    const codeDiff = compareExternalCode(left.externalCode, right.externalCode);
    return codeDiff !== 0 ? codeDiff : left.order - right.order;
  });
}

/**
 * 転記値をクリップボード用のタブ区切りテキストへ直す（仕様書8.7.7）。
 *
 * 形式は `外部項目コード<TAB>転記値分` の行であり、外部項目コード順に並べる。
 *
 * ## 何を出さないか
 *
 * 次の行は除く。除いた件数は呼び出し側へ返し、画面が理由を示す。黙って落とすと
 * 転記漏れに気づけない。
 *
 * - **外部項目コードが未設定の行**: 貼り付け先はコードで行を突き合わせる。空の
 *   コードを含む行を混ぜると、外部システム側で行がずれるか取り込みが失敗する。
 * - **転記値が未確定の行**: 未終了区間を含む作業項目には転記値が無い
 *   （仕様書8.6.5）。仮の値を入れると、確定していない数字が正式な記録先へ入る。
 *
 * どちらも「出さない」を選んだのは、貼り付けたテキストがそのまま使える状態で
 * あることを優先したためである。欠けた行は画面上の一覧では見えている。
 *
 * @param {{rows: object[]}} aggregate {@link aggregateRun} の結果
 * @returns {{text: string, copiedCount: number, skippedMissingCode: number,
 *            skippedUnconfirmed: number}}
 */
export function buildTransferText(aggregate) {
  let skippedMissingCode = 0;
  let skippedUnconfirmed = 0;
  const lines = [];

  for (const row of aggregate.rows) {
    if (row.externalCodeMissing) {
      skippedMissingCode += 1;
      continue;
    }
    if (!row.confirmed) {
      skippedUnconfirmed += 1;
      continue;
    }
    lines.push(`${row.externalCode}\t${row.transferMinutes}`);
  }

  return {
    text: lines.join('\n'),
    copiedCount: lines.length,
    skippedMissingCode,
    skippedUnconfirmed,
  };
}

/**
 * 集計済みへ進められるかを判定する（仕様書8.9.6、A-08）。
 *
 * 未終了区間が1つでもあれば進められない。判定は状態遷移の可否（`runStatus.js`）
 * とは別で、こちらは「記録の中身が揃っているか」を見る。
 *
 * @param {{tasks: object[]}} workRun
 * @returns {{ok: boolean, openCount: number, reason: string|null}}
 */
export function canAggregate(workRun) {
  const openCount = workRun.tasks.reduce(
    (total, taskRecord) => total + summarizeTask(taskRecord).openCount,
    0,
  );
  if (openCount === 0) {
    return { ok: true, openCount: 0, reason: null };
  }
  return {
    ok: false,
    openCount,
    reason:
      `未終了の作業区間が ${openCount} 件ある。終了時刻を入れるか区間を削除すると` +
      '集計済みへ進める（仕様書8.9.6）。',
  };
}

export { toTransferMinutes };
