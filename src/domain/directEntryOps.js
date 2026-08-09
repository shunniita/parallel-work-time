/**
 * 工数直接入力の変換（仕様書8.5、8.9.8）。
 *
 * 追加・編集・削除の3操作を純関数として持つ。作業項目実績を書き換えず、変換後の
 * `directEntries` 配列を返す。保存は `src/app/actions/directEntryActions.js` が
 * 行う。区間の `intervalOps.js` と同じ形にそろえてある。
 *
 * ## 直接入力とは何か
 *
 * 計測し損ねた工数を後から足すための入口である。区間と違い、開始・終了の時刻を
 * 持たず、秒数そのものを記録する。決定的に違うのは **参加者数を掛けない** ことで
 * ある（仕様書8.5.6、8.6.6）。`seconds` は既に人数を含んだ総工数であり、
 * `participants` は「誰の分か」を後から照合するための補助情報にすぎない
 * （仕様書6.8）。掛けてしまうと二重計上になる。
 *
 * このため画面の見出しも「時間」ではなく「追加工数」「総工数（人×時間）」と
 * するよう仕様が定めている（仕様書8.5 補足）。
 *
 * ## 0秒を拒む理由
 *
 * 仕様書8.5.5 が明記するのは負値の禁止だけである。ただし0分0秒の直接入力は
 * 工数を1秒も足さず、備考だけが残る。分・秒の入力漏れである可能性が高いので、
 * 新規入力としては拒否する。
 *
 * 一方 `schema.js` のインポート検証は0秒を通したままにする（仕様書9.3）。
 * 読み込みは既存データを受け入れる側であり、書き込みより緩くてよい。両者で
 * 基準が違うのは意図したものである。
 *
 * ただし「取り込めるが直せない」レコードを作ってはならない。編集はレコード全体を
 * 検証するため、0秒を一律に拒むと、取り込んだ0秒レコードの備考や参加者だけを
 * 直すこともできなくなる（レビュー指摘 S7-2）。そこで編集では、**もともと0秒
 * だったものを0秒のまま保存する場合に限り**通す。1秒以上のものを0秒へ変える
 * ことは、新規入力と同じく拒む。
 *
 * ## 検証結果の形
 *
 * `{ok, errors, warnings, directEntries}` を返す。入れ物は `problems.js` を
 * `intervalOps.js` / `validation.js` と共有する。
 */

import {
  MAX_DIRECT_ENTRY_SECONDS,
  MAX_EFFORT_SECONDS,
  MAX_PARTICIPANTS,
} from '../config.js';
import { isEffortWithinRange, taskTotalSeconds } from './effort.js';
import { normalizeParticipants } from './participants.js';
import { Problems } from './problems.js';

/** 直接入力の検証で出る警告の種別。 */
export const DIRECT_ENTRY_WARNING = {
  /** 同一作業項目に同じ参加者・同じ秒数の直接入力がある（仕様書8.9.8）。 */
  DUPLICATE_CANDIDATE: 'directEntryDuplicate',
};

/**
 * 変換に失敗した結果を返す。
 *
 * @param {Problems} problems
 */
function rejected(problems) {
  return {
    ok: false,
    errors: problems.errors,
    warnings: problems.warnings,
    directEntries: null,
  };
}

/**
 * 変換結果を返す。合計工数が範囲外なら拒否へ倒す。
 *
 * @param {Problems} problems
 * @param {{intervals?: object[]}} taskRecord 変換前の作業項目実績
 * @param {object[]} directEntries 変換後の直接入力一覧
 * @param {object} [extra] `created` / `updated` などの補足
 */
function accepted(problems, taskRecord, directEntries, extra = {}) {
  // 合計工数の範囲は、変換後の一覧が揃ってからでないと判定できない
  // （仕様書8.9.12、`intervalOps.js` と同じ扱い）。
  const total = taskTotalSeconds({ ...taskRecord, directEntries });
  if (!isEffortWithinRange(total)) {
    problems.add(
      '追加工数',
      `作業項目の合計工数が上限（${MAX_EFFORT_SECONDS}秒）を超える（仕様書8.9.12）。`,
    );
    return rejected(problems);
  }
  return { ok: true, errors: [], warnings: problems.warnings, directEntries, ...extra };
}

/**
 * 追加工数の秒数を確かめる（仕様書8.5.1、8.5.5）。
 *
 * `allowZero` は「もともと0秒だったものを0秒のまま保存する」場合に立てる。
 * 0秒を新しく作ることは拒むが、既にある0秒レコードを editable でなくすると、
 * 備考や参加者だけを直す手段が無くなる（レビュー指摘 S7-2）。
 *
 * @param {Problems} problems
 * @param {unknown} seconds
 * @param {{allowZero?: boolean}} [options]
 * @returns {boolean}
 */
function checkSeconds(problems, seconds, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(seconds)) {
    problems.add('追加工数', '秒数は整数で指定する');
    return false;
  }
  if (seconds < 0) {
    problems.add('追加工数', '負の値は登録できない（仕様書8.5.5）');
    return false;
  }
  if (seconds === 0 && !allowZero) {
    problems.add('追加工数', '1秒以上を入力する');
    return false;
  }
  if (seconds > MAX_DIRECT_ENTRY_SECONDS) {
    problems.add('追加工数', `${MAX_DIRECT_ENTRY_SECONDS}秒（1年）以下で入力する`);
    return false;
  }
  return true;
}

/**
 * 備考を確かめる（仕様書8.5.4）。
 *
 * 必須である。直接入力は計測の裏づけが無い数字なので、後から根拠をたどれる
 * ようにする。前後空白だけの備考は未入力として扱う。
 *
 * @returns {boolean}
 */
function checkNote(problems, note) {
  if (typeof note !== 'string' || note.trim() === '') {
    problems.add('備考', '必須項目である（仕様書8.5.4）');
    return false;
  }
  return true;
}

/**
 * 参加者を確かめる。
 *
 * 0人を許す。人数を掛けない値なので、`work` 区間のように0人を禁じる理由
 * （仕様書8.9.4）が無い。誰の分か分からない計測漏れを、備考だけ添えて足せる
 * 必要がある。
 *
 * @returns {boolean}
 */
function checkParticipants(problems, participants) {
  if (participants === null) {
    problems.add('参加者', '文字列の配列で指定する');
    return false;
  }
  if (participants.length > MAX_PARTICIPANTS) {
    problems.add('参加者', `${MAX_PARTICIPANTS}名以下で指定する`);
    return false;
  }
  return true;
}

/**
 * 参加者一覧を比較用の1つの文字列にする。
 *
 * 並び順は問わない。「甲、乙」と「乙、甲」は同じ顔ぶれであり、入力した順で
 * 重複判定が変わるのは利用者から見て理解できない。
 *
 * 単純な区切り文字で連結しない。参加者名は自由入力であり（仕様書6.7）、区切りに
 * 選んだ文字は名前の中にも現れうる。空白区切りなら `['甲 太郎']` と
 * `['甲', '太郎']` が同じキーになり、別の顔ぶれを重複候補として警告してしまう。
 * `JSON.stringify` は要素の境界を引用符で表すため、この取り違えが起きない。
 *
 * 制御文字を区切りに使う手もあるが、採らない。ソースの上で空白と見分けが付かず、
 * NUL を含むファイルは Git がバイナリとして扱って差分を出さなくなる
 * （レビュー指摘 S7-3。実際にそうなっていた）。
 *
 * @param {string[]} participants
 * @returns {string}
 */
function participantsKey(participants) {
  return JSON.stringify([...participants].sort());
}

/**
 * 同一作業項目内の重複候補を探す（仕様書8.9.8）。
 *
 * 「同一作業項目、同一参加者、同一秒数」が条件である。備考は比べない。同じ
 * 工数を二度登録したとき、備考の書き方まで一致するとは限らないためである。
 *
 * 保存は止めない。別の日に偶然同じ工数を足すことはあり、判断は利用者に委ねる。
 *
 * @param {{directEntries: object[]}} taskRecord
 * @param {{seconds: number, participants: string[]}} candidate
 * @param {string|null} [excludeEntryId] 編集時に自分自身を除くためのID
 * @returns {object[]} 重複候補の直接入力
 */
export function findDuplicateCandidates(taskRecord, candidate, excludeEntryId = null) {
  const key = participantsKey(candidate.participants);
  return taskRecord.directEntries.filter(
    (entry) =>
      entry.entryId !== excludeEntryId &&
      entry.seconds === candidate.seconds &&
      participantsKey(entry.participants) === key,
  );
}

/**
 * 重複候補があれば警告を積む（仕様書8.9.8）。
 *
 * @param {Problems} problems
 * @param {{directEntries: object[]}} taskRecord
 * @param {{seconds: number, participants: string[]}} candidate
 * @param {string|null} excludeEntryId
 */
function addDuplicateWarning(problems, taskRecord, candidate, excludeEntryId) {
  const duplicates = findDuplicateCandidates(taskRecord, candidate, excludeEntryId);
  if (duplicates.length === 0) {
    return;
  }
  const who = candidate.participants.length === 0 ? 'なし' : candidate.participants.join('、');
  problems.warn(
    DIRECT_ENTRY_WARNING.DUPLICATE_CANDIDATE,
    '直接入力',
    `同じ参加者（${who}）・同じ追加工数（${formatSeconds(candidate.seconds)}）の記録が` +
      `既に ${duplicates.length} 件ある。二重登録でなければ、そのままでよい（仕様書8.9.8）。`,
  );
}

/**
 * 秒数を「n分n秒」の形にする。警告文と履歴の要約で使う。
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatSeconds(seconds) {
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

/**
 * 直接入力を1件作る。
 *
 * @param {{seconds: number, participants: string[], note: string}} draft
 * @param {{now: string, newId: () => string}} context
 * @returns {object}
 */
function buildDirectEntry(draft, context) {
  return {
    entryId: context.newId(),
    seconds: draft.seconds,
    participants: draft.participants,
    note: draft.note.trim(),
    createdAt: context.now,
    updatedAt: context.now,
  };
}

/**
 * 直接入力を追加する（仕様書8.5）。
 *
 * 作業項目の状態を問わない。未着手でも完了でも足せる（仕様書12.4 の対応表で
 * 直接入力が全状態で有効なのはこのためである）。計測し損ねた分を後から入れる
 * 操作なので、いま作業中かどうかとは関わりがない。
 *
 * @param {{directEntries: object[]}} taskRecord
 * @param {{seconds: number, participants: string[], note: string}} input
 * @param {{now: string, newId: () => string}} context
 * @returns {{ok: boolean, errors: string[], warnings: object[],
 *            directEntries: object[]|null, created?: object}}
 */
export function addDirectEntry(taskRecord, input, context) {
  const problems = new Problems();
  const secondsValid = checkSeconds(problems, input.seconds);
  const participants = normalizeParticipants(input.participants);
  const participantsValid = checkParticipants(problems, participants);
  checkNote(problems, input.note);

  if (!problems.ok) {
    return rejected(problems);
  }

  if (secondsValid && participantsValid) {
    addDuplicateWarning(problems, taskRecord, { seconds: input.seconds, participants }, null);
  }

  const created = buildDirectEntry(
    { seconds: input.seconds, participants, note: input.note },
    context,
  );
  return accepted(problems, taskRecord, [...taskRecord.directEntries, created], { created });
}

/**
 * 既存の直接入力を編集する（仕様書8.5）。
 *
 * 渡した項目だけを差し替える。`entryId` と `createdAt` は変えない。
 *
 * @param {{directEntries: object[]}} taskRecord
 * @param {string} entryId
 * @param {{seconds?: number, participants?: string[], note?: string}} changes
 * @param {{now: string}} context
 * @returns {{ok: boolean, errors: string[], warnings: object[],
 *            directEntries: object[]|null, updated?: object}}
 */
export function editDirectEntry(taskRecord, entryId, changes, context) {
  const problems = new Problems();
  const current = findDirectEntry(taskRecord, entryId);
  if (current === null) {
    problems.add('直接入力', `見つからない（${String(entryId)}）`);
    return rejected(problems);
  }

  const seconds = changes.seconds ?? current.seconds;
  const note = changes.note ?? current.note;
  const participants =
    changes.participants === undefined
      ? [...current.participants]
      : normalizeParticipants(changes.participants);

  // もともと0秒のレコードは、0秒のままなら保存できる。インポートは0秒を通す
  // ため（`schema.js`）、拒み切ると備考や参加者だけを直せなくなる（S7-2）。
  // 1秒以上のものを0秒へ変えることは、新規入力と同じく拒む。
  const secondsValid = checkSeconds(problems, seconds, { allowZero: current.seconds === 0 });
  const participantsValid = checkParticipants(problems, participants);
  checkNote(problems, note);

  if (!problems.ok) {
    return rejected(problems);
  }

  if (secondsValid && participantsValid) {
    // 自分自身は重複相手にならない。値を変えずに保存し直しただけで警告が
    // 出ると、利用者は消しようのない警告を見続けることになる。
    addDuplicateWarning(problems, taskRecord, { seconds, participants }, entryId);
  }

  const updated = {
    ...current,
    seconds,
    participants,
    note: note.trim(),
    updatedAt: context.now,
  };
  const directEntries = taskRecord.directEntries.map((entry) =>
    entry.entryId === entryId ? updated : entry,
  );
  return accepted(problems, taskRecord, directEntries, { updated });
}

/**
 * 直接入力を削除する（仕様書8.5、11章）。
 *
 * 削除は簡易変更履歴の記録対象であり、理由が必須である（仕様書11章）。理由の
 * 検証と履歴の組み立ては `history.js` が持ち、削除と履歴の書き込みを1回の保存へ
 * まとめるのは `src/app/actions/directEntryActions.js` である。ここは取り除いた
 * 配列と、削除した内容そのものを返すだけにする。履歴の要約に元の内容が要る
 * ため `removed` を返す。
 *
 * 重複の警告は出さない。削除で重複が増えることはない。
 *
 * @param {{directEntries: object[]}} taskRecord
 * @param {string} entryId
 * @returns {{ok: boolean, errors: string[], warnings: object[],
 *            directEntries: object[]|null, removed?: object}}
 */
export function removeDirectEntry(taskRecord, entryId) {
  const problems = new Problems();
  const removed = findDirectEntry(taskRecord, entryId);
  if (removed === null) {
    problems.add('直接入力', `見つからない（${String(entryId)}）`);
    return rejected(problems);
  }
  const directEntries = taskRecord.directEntries.filter((entry) => entry.entryId !== entryId);
  return { ok: true, errors: [], warnings: [], directEntries, removed };
}

/**
 * 作業項目実績から直接入力を1件引く。
 *
 * @param {{directEntries: object[]}} taskRecord
 * @param {string} entryId
 * @returns {object|null}
 */
export function findDirectEntry(taskRecord, entryId) {
  return taskRecord.directEntries.find((entry) => entry.entryId === entryId) ?? null;
}
