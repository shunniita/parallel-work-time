/**
 * 作業区間の変換（仕様書8.4）。
 *
 * 7つの操作すべてを「進行中区間を閉じる」と「新しい区間を開く」の組み合わせと
 * して表す（設計メモ PWT-DESIGN-006 §2）。
 *
 * | 操作         | 前提状態      | 進行中区間  | 新規区間                  |
 * | ------------ | ------------- | ----------- | ------------------------- |
 * | 開始         | 未着手 / 完了 | —           | `work` を `at` から       |
 * | 休憩         | 作業中        | `endAt=at`  | `break` を `at` から      |
 * | 再開         | 休憩中        | `endAt=at`  | `work` を `at` から       |
 * | 終了         | 作業中/休憩中 | `endAt=at`  | 作らない                  |
 * | 参加者変更   | 作業中/休憩中 | `endAt=at`  | 同じ種別を `at` から      |
 * | 区間追加     | 任意          | 触らない    | 指定内容（`endAt` 必須）  |
 * | 区間編集     | 任意          | 触らない    | 既存区間を差し替え        |
 * | 区間削除     | 任意          | 触らない    | 取り除く                  |
 *
 * すべて純関数である。作業項目実績を書き換えず、変換後の `intervals` 配列を返す。
 * 保存は `src/app/actions/intervalActions.js` が行う。
 *
 * ## 前提状態の検査をここに置く理由
 *
 * 画面のボタン制御（`taskState.js` の `availableOperations`）だけに頼らない。
 * 「ボタン操作による未終了区間は作業項目ごとに一つまで」（仕様書8.4 補足1、
 * A-17）は、押せるボタンを絞るだけでは担保できない。連打・多重タブ・保存の
 * 競合のいずれでも、状態と合わない入力がここへ届きうる。
 *
 * ## 検証結果の形
 *
 * `{ok, errors, warnings, intervals}` を返す。`errors` は保存を止める不備で
 * 「場所: 説明」の文字列、`warnings` は種別コードつきの
 * `{code, path, message}` である（設計メモ §3.1、レビュー指摘 D-15）。
 * `validation.js` の警告は文字列のままだが、こちらは新設なので最初から
 * 種別コードを持たせる。D-15 の対応時に既存側を揃える。
 */

import { compareIso, isValidIsoSecond } from './datetime.js';
import { INTERVAL_TYPE, isOpenInterval } from './effort.js';
import { findOverlappingPairs } from './overlap.js';
import { TASK_STATE, TASK_STATE_LABEL, activeInterval, taskState } from './taskState.js';

/** 区間の検証で出る警告の種別（設計メモ §3.1）。 */
export const INTERVAL_WARNING = {
  /** 同一作業項目内で時間帯が重なる（仕様書8.9.5）。保存は止めない。 */
  OVERLAP: 'intervalOverlap',
};

/**
 * 検証結果を集める入れ物。
 *
 * `validation.js` の同名クラスと形が違う。警告が種別コードを持つためである。
 */
class Problems {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * @param {string} path 例: `終了日時`
   * @param {string} message
   */
  add(path, message) {
    this.errors.push(`${path}: ${message}`);
  }

  /**
   * @param {string} code {@link INTERVAL_WARNING} のいずれか
   * @param {string} path
   * @param {string} message
   */
  warn(code, path, message) {
    this.warnings.push({ code, path, message });
  }

  get ok() {
    return this.errors.length === 0;
  }
}

/**
 * 変換に失敗した結果を返す。
 *
 * @param {Problems} problems
 * @returns {{ok: false, errors: string[], warnings: object[], intervals: null}}
 */
function rejected(problems) {
  return { ok: false, errors: problems.errors, warnings: problems.warnings, intervals: null };
}

/**
 * 変換に成功した結果を返す。重複の警告はここで一度だけ足す。
 *
 * @param {Problems} problems
 * @param {object[]} intervals 変換後の区間一覧
 * @param {object} [extra] `created` / `closed` / `updated` などの補足
 * @returns {{ok: true, errors: string[], warnings: object[], intervals: object[]}}
 */
function accepted(problems, intervals, extra = {}) {
  addOverlapWarning(problems, intervals);
  return { ok: true, errors: [], warnings: problems.warnings, intervals, ...extra };
}

/**
 * 区間の重複を警告する（仕様書8.9.5）。保存は止めない。
 *
 * 別のグループが同じ作業項目を同時並行で実施した記録として正しい場合がある
 * ため、拒否しない（仕様書8.4 補足1）。
 *
 * @param {Problems} problems
 * @param {object[]} intervals
 */
function addOverlapWarning(problems, intervals) {
  const pairs = findOverlappingPairs(intervals);
  if (pairs.length === 0) {
    return;
  }
  problems.warn(
    INTERVAL_WARNING.OVERLAP,
    '作業区間',
    `時間帯が重なる組が ${pairs.length} 組ある。別のグループが同じ作業項目を` +
      '同時並行で実施した記録であれば、そのままでよい（仕様書8.9.5）。',
  );
}

/**
 * 参加者一覧を整える。
 *
 * 前後空白を落とし、空文字を除き、完全一致の重複を1つにまとめる。表記ゆれ
 * （「甲」と「甲 太郎」など）は判断しない。利用者へ委ねると決まっている
 * （仕様書8.9.9）。
 *
 * @param {unknown} value
 * @returns {string[]|null} 配列でなければ null
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
 * 日時が保存形式として妥当かを確かめる。
 *
 * @returns {boolean}
 */
function checkIso(problems, path, value) {
  if (!isValidIsoSecond(value)) {
    problems.add(path, 'オフセット付きISO 8601（秒精度）の日時が必要である（仕様書8.4.4）');
    return false;
  }
  return true;
}

/**
 * 作業項目の状態が操作の前提と合うかを確かめる（仕様書12.4）。
 *
 * @returns {boolean}
 */
function checkState(problems, taskRecord, allowed, operationLabel) {
  const state = taskState(taskRecord);
  if (allowed.includes(state)) {
    return true;
  }
  problems.add(
    '作業項目',
    `${stateLabel(state)}のため「${operationLabel}」は記録できない` +
      `（${allowed.map(stateLabel).join(' / ')}のときに限る）`,
  );
  return false;
}

function stateLabel(state) {
  return TASK_STATE_LABEL[state] ?? state;
}

/**
 * 参加者の人数を確かめる（仕様書8.9.4）。
 *
 * `work` は0人を禁止し、`break` は許す。
 *
 * @returns {boolean}
 */
function checkParticipants(problems, type, participants, path = '参加者') {
  if (participants === null) {
    problems.add(path, '文字列の配列で指定する');
    return false;
  }
  if (type === INTERVAL_TYPE.WORK && participants.length === 0) {
    problems.add(path, '作業区間は1人以上必要である（仕様書8.9.4）');
    return false;
  }
  return true;
}

/**
 * 区間種別が既知かを確かめる。
 *
 * @returns {boolean}
 */
function checkType(problems, type, path = '区間種別') {
  if (!Object.values(INTERVAL_TYPE).includes(type)) {
    problems.add(path, `${Object.values(INTERVAL_TYPE).join(' / ')} のいずれかを指定する`);
    return false;
  }
  return true;
}

/**
 * 終了日時が開始日時以降かを確かめる（仕様書8.9.3）。
 *
 * 同一日時は0秒の区間として許す。
 *
 * @returns {boolean}
 */
function checkOrder(problems, startAt, endAt, path = '終了日時') {
  if (compareIso(endAt, startAt) < 0) {
    problems.add(path, '開始日時以降である必要がある（仕様書8.9.3）');
    return false;
  }
  return true;
}

/**
 * 区間を1件作る。
 *
 * @param {{type: string, startAt: string, endAt: string|null, participants: string[]}} draft
 * @param {{now: string, newId: () => string}} context
 * @returns {object}
 */
function buildInterval(draft, context) {
  return {
    intervalId: context.newId(),
    type: draft.type,
    startAt: draft.startAt,
    endAt: draft.endAt,
    participants: draft.participants,
    createdAt: context.now,
    updatedAt: context.now,
  };
}

/**
 * 区間を指定時刻で閉じる。
 *
 * @param {object} interval
 * @param {string} at
 * @param {{now: string}} context
 * @returns {object}
 */
function closeInterval(interval, at, context) {
  return { ...interval, endAt: at, updatedAt: context.now };
}

/**
 * 進行中区間を閉じ、必要なら新しい区間を開く共通処理。
 *
 * 休憩・再開・終了・参加者変更はいずれもこの形である。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{at: string, operationLabel: string, allowedStates: string[],
 *          nextType?: string|null, participantsFor?: (closed: object) => string[]|null}} plan
 * @param {{now: string, newId: () => string}} context
 */
function closeThenOpen(taskRecord, plan, context) {
  const problems = new Problems();
  const atValid = checkIso(problems, '日時', plan.at);
  const stateValid = checkState(
    problems,
    taskRecord,
    plan.allowedStates,
    plan.operationLabel,
  );
  if (!atValid || !stateValid) {
    return rejected(problems);
  }

  const active = activeInterval(taskRecord);
  if (!checkOrder(problems, active.startAt, plan.at, '日時')) {
    return rejected(problems);
  }

  const closed = closeInterval(active, plan.at, context);
  let created = null;
  if (plan.nextType !== null && plan.nextType !== undefined) {
    const participants = plan.participantsFor(closed);
    if (!checkParticipants(problems, plan.nextType, participants)) {
      return rejected(problems);
    }
    created = buildInterval(
      { type: plan.nextType, startAt: plan.at, endAt: null, participants },
      context,
    );
  }

  const intervals = taskRecord.intervals.map((interval) =>
    interval.intervalId === closed.intervalId ? closed : interval,
  );
  if (created !== null) {
    intervals.push(created);
  }
  return accepted(problems, intervals, { closed, created });
}

/**
 * 作業を開始する（仕様書8.4.1）。
 *
 * 未着手または完了のときに限る。「完了」は不可逆ではなく、再開始で作業中へ
 * 戻る（仕様書7.2）。作業中・休憩中から開始できないことが、ボタン操作による
 * 未終了区間を1つに保つ担保である（仕様書8.4 補足1）。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{at: string, participants: string[]}} input
 * @param {{now: string, newId: () => string}} context
 * @returns {{ok: boolean, errors: string[], warnings: object[], intervals: object[]|null,
 *            created?: object}}
 */
export function startWork(taskRecord, input, context) {
  const problems = new Problems();
  const atValid = checkIso(problems, '開始日時', input.at);
  const stateValid = checkState(
    problems,
    taskRecord,
    [TASK_STATE.NOT_STARTED, TASK_STATE.DONE],
    '開始',
  );
  const participants = normalizeParticipants(input.participants);
  const participantsValid = checkParticipants(problems, INTERVAL_TYPE.WORK, participants);
  if (!atValid || !stateValid || !participantsValid) {
    return rejected(problems);
  }

  const created = buildInterval(
    { type: INTERVAL_TYPE.WORK, startAt: input.at, endAt: null, participants },
    context,
  );
  return accepted(problems, [...taskRecord.intervals, created], { created });
}

/**
 * 休憩を開始する（仕様書8.4.1）。
 *
 * 参加者は直前の作業区間から引き継ぎ、入力を求めない（仕様書8.9 補足）。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{at: string}} input
 * @param {{now: string, newId: () => string}} context
 */
export function startBreak(taskRecord, input, context) {
  return closeThenOpen(
    taskRecord,
    {
      at: input.at,
      operationLabel: '休憩',
      allowedStates: [TASK_STATE.WORKING],
      nextType: INTERVAL_TYPE.BREAK,
      participantsFor: (closed) => [...closed.participants],
    },
    context,
  );
}

/**
 * 作業を再開する（仕様書8.4.1）。
 *
 * 参加者は直前の休憩区間から引き継ぐ。ただし休憩は0人を許す一方で作業は
 * 0人を禁じるため（仕様書8.9.4）、引き継いだ結果が0人になる場合は入力を
 * 求めて拒否する。黙って0人の作業区間を作らない（設計メモ §2.1）。
 * `input.participants` を渡せば引き継ぎより優先する。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{at: string, participants?: string[]}} input
 * @param {{now: string, newId: () => string}} context
 */
export function resumeWork(taskRecord, input, context) {
  return closeThenOpen(
    taskRecord,
    {
      at: input.at,
      operationLabel: '再開',
      allowedStates: [TASK_STATE.ON_BREAK],
      nextType: INTERVAL_TYPE.WORK,
      participantsFor: (closed) =>
        input.participants === undefined
          ? [...closed.participants]
          : normalizeParticipants(input.participants),
    },
    context,
  );
}

/**
 * 作業を終了する（仕様書8.4.1）。新しい区間は作らない。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{at: string}} input
 * @param {{now: string, newId: () => string}} context
 */
export function finishWork(taskRecord, input, context) {
  return closeThenOpen(
    taskRecord,
    {
      at: input.at,
      operationLabel: '終了',
      allowedStates: [TASK_STATE.WORKING, TASK_STATE.ON_BREAK],
      nextType: null,
    },
    context,
  );
}

/**
 * 参加者を変更する（仕様書8.4.10、8.4 補足2）。
 *
 * 進行中の区間を指定時刻で閉じ、**同じ種別**の区間を同じ時刻から開く。作業中
 * なら作業区間を、休憩中なら休憩区間を開く。休憩中に一部の参加者だけが作業へ
 * 戻る場合は、参加者変更ではなく再開で表す。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{at: string, participants: string[]}} input
 * @param {{now: string, newId: () => string}} context
 */
export function changeParticipants(taskRecord, input, context) {
  const active = activeInterval(taskRecord);
  return closeThenOpen(
    taskRecord,
    {
      at: input.at,
      operationLabel: '参加者変更',
      allowedStates: [TASK_STATE.WORKING, TASK_STATE.ON_BREAK],
      // 進行中区間が無ければ状態検査で弾かれるため、ここでの参照は安全である。
      nextType: active === null ? INTERVAL_TYPE.WORK : active.type,
      participantsFor: () => normalizeParticipants(input.participants),
    },
    context,
  );
}

/**
 * 区間を手動で追加する（仕様書8.4.11）。
 *
 * 状態を問わない。既存の区間と時間帯が重なってもよく、重複は警告にとどめる
 * （仕様書8.9.5）。
 *
 * `endAt` は必須である。仕様が未終了を許すのはボタン操作の場合だけであり
 * （仕様書8.4 補足1）、未終了区間を任意個作れると「進行中は高々1つ」という
 * 前提が崩れる。手動追加の目的は後からの実績修正なので、終了時刻が分かって
 * いる場合しか使わない（設計メモ §2.2）。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {{type: string, startAt: string, endAt: string, participants: string[]}} input
 * @param {{now: string, newId: () => string}} context
 */
export function addInterval(taskRecord, input, context) {
  const problems = new Problems();
  const typeValid = checkType(problems, input.type);
  const startValid = checkIso(problems, '開始日時', input.startAt);
  const participants = normalizeParticipants(input.participants);
  const participantsValid = typeValid
    ? checkParticipants(problems, input.type, participants)
    : false;

  let endValid = false;
  if (input.endAt === null || input.endAt === undefined) {
    problems.add(
      '終了日時',
      '手動追加では必須である。未終了の区間はボタン操作でのみ生じる（仕様書8.4 補足1）',
    );
  } else {
    endValid = checkIso(problems, '終了日時', input.endAt);
  }
  if (startValid && endValid) {
    checkOrder(problems, input.startAt, input.endAt);
  }
  if (!problems.ok) {
    return rejected(problems);
  }

  const created = buildInterval(
    {
      type: input.type,
      startAt: input.startAt,
      endAt: input.endAt,
      participants,
    },
    context,
  );
  return accepted(problems, [...taskRecord.intervals, created], { created });
}

/**
 * 既存の区間を編集する（仕様書8.4.5）。
 *
 * 渡した項目だけを差し替える。`intervalId` と `createdAt` は変えない。
 *
 * 終了済みの区間を未終了へ戻すことはできない。仕様書8.8.4 が求めるのは
 * 未終了区間へ終了時刻を補うことであり、その逆は「進行中は高々1つ」の前提を
 * 崩すだけである（設計メモ §2.2）。もともと未終了の区間は未終了のまま保存できる。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {string} intervalId
 * @param {{type?: string, startAt?: string, endAt?: string|null,
 *          participants?: string[]}} changes
 * @param {{now: string, newId: () => string}} context
 */
export function editInterval(taskRecord, intervalId, changes, context) {
  const problems = new Problems();
  const current = findInterval(taskRecord, intervalId);
  if (current === null) {
    problems.add('作業区間', `見つからない（${String(intervalId)}）`);
    return rejected(problems);
  }

  const type = changes.type ?? current.type;
  const startAt = changes.startAt ?? current.startAt;
  const participants =
    changes.participants === undefined
      ? [...current.participants]
      : normalizeParticipants(changes.participants);

  let endAt = current.endAt;
  if (changes.endAt !== undefined) {
    if (changes.endAt === null && !isOpenInterval(current)) {
      problems.add(
        '終了日時',
        '終了済みの区間を未終了へ戻すことはできない。誤りであれば区間を削除する',
      );
    } else {
      endAt = changes.endAt;
    }
  }

  const typeValid = checkType(problems, type);
  const startValid = checkIso(problems, '開始日時', startAt);
  if (typeValid) {
    checkParticipants(problems, type, participants);
  }
  const endValid = endAt === null ? true : checkIso(problems, '終了日時', endAt);
  if (startValid && endValid && endAt !== null) {
    checkOrder(problems, startAt, endAt);
  }
  if (!problems.ok) {
    return rejected(problems);
  }

  const updated = {
    ...current,
    type,
    startAt,
    endAt,
    participants,
    updatedAt: context.now,
  };
  const intervals = taskRecord.intervals.map((interval) =>
    interval.intervalId === intervalId ? updated : interval,
  );
  return accepted(problems, intervals, { updated });
}

/**
 * 区間を削除する（仕様書8.4.5、11章）。
 *
 * 削除は簡易変更履歴の記録対象であり、理由が必須である。理由の検証と履歴の
 * 組み立ては `src/domain/history.js` が持ち、削除と履歴の書き込みを1回の保存へ
 * まとめるのは `src/app/actions/intervalActions.js` である。ここは区間を取り
 * 除いた配列と、削除した区間そのものを返すだけにする。履歴の要約に元の内容が
 * 要るため、`removed` を返す。
 *
 * 重複の警告は出さない。削除で重複が増えることはなく、残りの重複を削除時に
 * 蒸し返しても利用者の判断材料にならない。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {string} intervalId
 * @returns {{ok: boolean, errors: string[], warnings: object[],
 *            intervals: object[]|null, removed?: object}}
 */
export function removeInterval(taskRecord, intervalId) {
  const problems = new Problems();
  const removed = findInterval(taskRecord, intervalId);
  if (removed === null) {
    problems.add('作業区間', `見つからない（${String(intervalId)}）`);
    return rejected(problems);
  }
  const intervals = taskRecord.intervals.filter(
    (interval) => interval.intervalId !== intervalId,
  );
  return { ok: true, errors: [], warnings: [], intervals, removed };
}

/**
 * 作業項目実績から区間を1件引く。
 *
 * @param {{intervals: object[]}} taskRecord
 * @param {string} intervalId
 * @returns {object|null}
 */
export function findInterval(taskRecord, intervalId) {
  return (
    taskRecord.intervals.find((interval) => interval.intervalId === intervalId) ?? null
  );
}
