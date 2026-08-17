/**
 * 参加者名の正規化と候補抽出（仕様書8.4.7、8.6.1）。
 *
 * 作業者マスターは設けない（仕様書6.7）。候補は過去に入力した参加者名を
 * 保存済みデータから集めたものであり、選ばなければならない一覧ではない。
 * 新しい名前はそのまま入力できる。
 *
 * ## 収集範囲と並び
 *
 * 収集は全実施回から行う。当該実施回だけに絞ると、前回まで一緒に作業していた
 * 人が候補に出ず、候補表示の意味が薄れる。
 *
 * 並びは「当該実施回で既に出ている名前 → それ以外」とする（過去の設計メモ）。同じ実施回の続きを記録している最中は、直前に入力した
 * 人をもう一度選ぶ場面がほとんどである。各群の中は自然順とする。日本語の氏名に
 * 読みは持たないため、自然順は実質的に文字コード順になる。並びの意味は
 * 「群が分かれていること」にあり、群の中の順序は再現性のためだけに定める。
 *
 * 件数による絞り込みはしない。区間2,000件（仕様書13章）で参加者名の一意集合が
 * 実用上の候補数を超えるとは考えにくく、超えてから対処する。
 */

import { MAX_PARTICIPANTS, MAX_TEXT_LENGTH } from '../config.js';
import { compareNatural } from './naturalSort.js';

/** 正規化後の参加者一覧について、保存形式と共有する上限違反を返す。 */
export function participantLimits(participants) {
  return {
    tooMany: participants.length > MAX_PARTICIPANTS,
    hasOverlongName: participants.some((name) => name.length > MAX_TEXT_LENGTH),
  };
}

export function participantLimitErrors(participants) {
  const errors = [];
  const limits = participantLimits(participants);
  if (limits.tooMany) {
    errors.push(`${MAX_PARTICIPANTS}名以下で指定する`);
  }
  if (limits.hasOverlongName) {
    errors.push(`参加者名は${MAX_TEXT_LENGTH}文字以下で指定する`);
  }
  return errors;
}

/**
 * 参加者一覧を整える。
 *
 * 前後空白を落とし、空文字を除き、完全一致の重複を1つにまとめる。表記ゆれ
 * （「甲」と「甲 太郎」など）は判断しない。利用者へ委ねると決まっている
 * （仕様書8.9.9）。
 *
 * 工数は人数を掛けて求めるため（8.6.1）、同じ名前が2回入った一覧は1人の作業を
 * 2人分として計上する。この関数が「同じ顔ぶれ」の唯一の定義であり、区間・
 * 直接入力・取り込み検証（`integrity.js`）がすべてここを通る。規則を1か所に
 * 置かないと、取り込み側だけ古い規則で残り、水増しがそのクラスで復活する。
 *
 * @param {unknown} value
 * @returns {string[]|null} 文字列配列でなければ null
 */
export function normalizeParticipants(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return null;
    }
    const name = item.trim();
    if (name === '' || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push(name);
  }
  return result;
}

/**
 * 参加者名の配列から、空でない名前を順に取り出す。
 *
 * 取り込んだJSONに文字列以外が混じっていても走査を止めない。候補表示は
 * あくまで補助であり、ここで例外を投げると画面全体が出なくなる。
 *
 * @param {unknown} participants
 * @param {(name: string) => void} visit
 */
function visitNames(participants, visit) {
  if (!Array.isArray(participants)) {
    return;
  }
  for (const item of participants) {
    if (typeof item !== 'string') {
      continue;
    }
    const name = item.trim();
    if (name !== '') {
      visit(name);
    }
  }
}

/**
 * 作業項目実績に現れる参加者名を集める。
 *
 * 直接入力の参加者（仕様書6.8）も含める。時刻入力で候補に出したい名前は
 * 「過去に入力した参加者名」であって、入力経路は問わない（仕様書8.4.7）。
 *
 * @param {{intervals?: object[], directEntries?: object[]}} taskRecord
 * @param {Set<string>} into
 */
function collectFromTask(taskRecord, into) {
  for (const interval of taskRecord?.intervals ?? []) {
    visitNames(interval?.participants, (name) => into.add(name));
  }
  for (const entry of taskRecord?.directEntries ?? []) {
    visitNames(entry?.participants, (name) => into.add(name));
  }
}

/**
 * 実施回1件に現れる参加者名を集める。
 *
 * @param {{tasks?: object[]}} workRun
 * @returns {Set<string>}
 */
export function participantsInRun(workRun) {
  const names = new Set();
  for (const taskRecord of workRun?.tasks ?? []) {
    collectFromTask(taskRecord, names);
  }
  return names;
}

/**
 * 参加者名の候補を返す（仕様書8.4.7）。
 *
 * @param {object[]} workRuns 保存済みの実施回すべて
 * @param {{runId?: string|null}} [options] `runId` を渡すと、その実施回で
 *   既に出ている名前を先頭群へ集める
 * @returns {string[]} 重複のない候補一覧
 */
export function collectParticipants(workRuns, options = {}) {
  const { runId = null } = options;
  const all = new Set();
  let recent = new Set();

  for (const workRun of workRuns ?? []) {
    const names = participantsInRun(workRun);
    for (const name of names) {
      all.add(name);
    }
    if (runId !== null && workRun?.runId === runId) {
      recent = names;
    }
  }

  const preferred = [...all].filter((name) => recent.has(name)).sort(compareNatural);
  const others = [...all].filter((name) => !recent.has(name)).sort(compareNatural);
  return [...preferred, ...others];
}
