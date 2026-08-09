/**
 * 取り込むデータの業務的整合性（仕様書9.3、レビュー指摘 C-10）。
 *
 * `schema.js` は1件ずつの**構造**を見る（型・必須キー・値の形）。ここは複数の
 * レコードにまたがる**関係**を見る。両者を分けるのは、見る対象が違うためである。
 * 構造検証は1件で完結するが、こちらは全体を並べないと判断できない。
 *
 * ## なぜ取り込み時に見るのか
 *
 * 通常の操作経路は、アクション層がこれらの不変条件を守っている。案件IDの一意性は
 * `validateProjectIdAvailable`、終了日時の前後は `intervalOps`、状態と中身の整合は
 * `transferActions` が受け持つ。
 *
 * 取り込み（9.3）だけがこの経路を通らない。JSONは手で編集でき、別の版のツールが
 * 書いたものかもしれない。ここを素通しすると、**画面からは作れない状態**が保存
 * され、その後の操作が説明のつかない振る舞いをする。
 *
 * ## 拒否するものと通すもの
 *
 * 「後から画面で直せるか」で分けた。直せないものは拒否し、直せるものは通す。
 * 全置換（9.3）である以上、取り込んだ後に直すしかないためである。
 *
 * | 例 | 扱い | 理由 |
 * | -- | ---- | ---- |
 * | 案件IDの重複 | 拒否 | 一意制約（8.2.6）。保存層も拒むため取り込めない |
 * | 主キーの重複 | 拒否 | 後勝ちで黙って消える。どちらが残ったか利用者に分からない |
 * | 存在しない参照 | 拒否 | 画面から親を選び直す手段が無い |
 * | `endAt < startAt` | 拒否 | 工数が0秒へ丸められ、欠落に気づけない（8.9.3） |
 * | 転記済みwith未終了区間 | 拒否 | 画面から到達しない状態（7章、S8-1） |
 * | 参加者の重複・空白名 | 拒否 | 人数を掛けるため工数が水増しされる（8.6.1、GAR-2） |
 * | 状態日時の前後が逆 | 拒否 | 保持期間の起算が狂う（10.2、GAR-3） |
 * | 区間の重複 | 通す | 警告にとどめる決まり（8.9.5）。画面でも保存できる |
 * | 累計が総予定数を超える | 通す | 警告して続行できる決まり（8.9.7） |
 * | 外部項目コード未設定 | 通す | 許される（8.7.4 は警告のみ） |
 *
 * ## 黙って正規化しない
 *
 * 通常入力は参加者名の前後空白を落とし、完全一致の重複を1つへまとめる
 * （`participants.normalizeParticipants`）。取り込みで同じ正規化を黙って行うと、
 * 利用者は「読み込ませた内容と保存された内容が違う」ことに気づけない。全置換で
 * ある以上、直す機会は取り込み前にしかない。場所と理由を添えて拒否する。
 */

import { MAX_EFFORT_SECONDS } from '../config.js';
import { compareIso } from './datetime.js';
import {
  INTERVAL_TYPE,
  isEffortWithinRange,
  isOpenInterval,
  taskTotalSeconds,
} from './effort.js';
import { HISTORY_ENTITY_BY_OP } from './history.js';
import { normalizeParticipants } from './participants.js';
import { Problems } from './problems.js';
import { RUN_STATUS, validateImportPayload } from './schema.js';
import { normalizeProjectId } from './projectId.js';

/**
 * 取り込むJSONを構造と整合性の両面から確かめる（仕様書9.3）。
 *
 * 保存アダプターの `importAll()` はこれを呼ぶ。構造検証（`schema.js`）を通って
 * から関係を見る。形が壊れたまま関係を調べても、読み取れない値についての指摘が
 * 並ぶだけで利用者の役に立たない。
 *
 * この統合の入口を `schema.js` ではなくこちらへ置くのは、依存の向きを一方向に
 * 保つためである（`integrity.js` → `schema.js`）。逆にすると循環参照になる。
 *
 * @param {unknown} payload
 * @returns {{ok: boolean, schemaMismatch: boolean, errors: string[]}}
 */
export function validateImport(payload) {
  const structure = validateImportPayload(payload);
  if (!structure.ok) {
    return structure;
  }
  const integrity = validateImportIntegrity(payload);
  return { ok: integrity.ok, schemaMismatch: false, errors: integrity.errors };
}

/**
 * 取り込むデータの整合性を確かめる。
 *
 * `schema.js` の構造検証を通った payload を渡す。構造が壊れている場合はそちらが
 * 先に弾くため、ここでは形が整っている前提で関係だけを見る。
 *
 * @param {object} payload エクスポートJSONと同じ形
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateImportIntegrity(payload) {
  const problems = new Problems();

  const templates = payload.taskTemplates ?? [];
  const groups = payload.projectGroups ?? [];
  const runs = payload.workRuns ?? [];
  const history = payload.changeHistory ?? [];

  checkUniqueKeys(problems, templates, 'templateId', 'taskTemplates', '作業テンプレート');
  checkUniqueKeys(problems, groups, 'projectGroupId', 'projectGroups', '案件グループ');
  checkUniqueKeys(problems, runs, 'runId', 'workRuns', '実施回');
  checkUniqueKeys(problems, history, 'historyId', 'changeHistory', '変更履歴');

  checkProjectIdUnique(problems, groups);
  checkTemplateActiveVersions(problems, templates);
  checkTemplateSeriesVersions(problems, templates);
  checkNestedIdentifiers(problems, templates, runs);
  checkRunReferences(problems, runs, groups, templates);
  checkRunContents(problems, runs);
  checkHistoryConsistency(problems, history);

  return { ok: problems.ok, errors: problems.errors };
}

/**
 * 主キーが重複していないか。
 *
 * 重複したまま取り込むと、保存層の `put` が後勝ちで上書きし、どちらが残ったのか
 * 利用者には分からない。件数が減ったことにも気づけない。
 */
function checkUniqueKeys(problems, items, key, path, label) {
  const seen = new Set();
  items.forEach((item, index) => {
    const value = item?.[key];
    if (typeof value !== 'string') {
      return;
    }
    if (seen.has(value)) {
      problems.add(`${path}[${index}].${key}`, `${label}の識別子が重複している（${value}）`);
      return;
    }
    seen.add(value);
  });
}

/**
 * 案件IDが一意か（仕様書8.2.6）。
 *
 * 保存層も一意索引で拒むが（`IndexedDbAdapter`）、そちらは `ConstraintError` に
 * なるだけで、どの案件IDが衝突したのかを利用者へ示せない。ここで先に見る。
 * 比較は登録時と同じ正規化（前後空白の除去）を通す。
 */
function checkProjectIdUnique(problems, groups) {
  const seen = new Map();
  groups.forEach((group, index) => {
    const projectId = normalizeProjectId(group?.projectId);
    if (projectId === '') {
      return;
    }
    if (seen.has(projectId)) {
      problems.add(
        `projectGroups[${index}].projectId`,
        `案件IDが重複している（${projectId}）。案件IDは一意である（仕様書8.2.6）`,
      );
      return;
    }
    seen.set(projectId, index);
  });
}

/**
 * 対象種別×バリエーションの有効版が1つを超えていないか（仕様書8.1.1、6.3）。
 *
 * 有効版が2つあると、実施回作成時にどちらから生成されるかが決まらない。
 */
function checkTemplateActiveVersions(problems, templates) {
  const activeByKey = new Map();
  templates.forEach((template, index) => {
    if (template?.active !== true) {
      return;
    }
    const key = `${template.targetType} / ${template.variant}`;
    if (activeByKey.has(key)) {
      problems.add(
        `taskTemplates[${index}]`,
        `${key} の有効版が2つ以上ある。有効版は1つである（仕様書8.1.1）`,
      );
      return;
    }
    activeByKey.set(key, index);
  });
}

/** 同一系列の版番号は一意である（仕様書6.3、レビュー指摘 C-10）。 */
function checkTemplateSeriesVersions(problems, templates) {
  const versionsBySeries = new Map();
  templates.forEach((template, index) => {
    const seriesId = template?.templateSeriesId;
    const version = template?.version;
    if (typeof seriesId !== 'string' || !Number.isInteger(version)) {
      return;
    }
    const versions = versionsBySeries.get(seriesId) ?? new Set();
    if (versions.has(version)) {
      problems.add(
        `taskTemplates[${index}].version`,
        `同一系列の版番号が重複している（${seriesId} / 版${version}）`,
      );
      return;
    }
    versions.add(version);
    versionsBySeries.set(seriesId, versions);
  });
}

/**
 * 入れ子の識別子が曖昧にならないことを確かめる。
 *
 * テンプレートの `taskDefinitionId` は版をまたいで引き継ぐため、全体ではなく
 * テンプレート1版の中だけで一意とする。実績側の識別子は変更履歴の `targetId`
 * からも使われるため、データセット全体で一意にする。
 *
 * 実施回の中でも `taskDefinitionId` は一意である。実施回はテンプレート1版の
 * 作業項目定義を1件ずつ複製して作るため（`templateInstantiate.js`）、同じ定義が
 * 2行並ぶ実施回は通常の生成経路では作れない。取り込んでしまうと、集計・転記の
 * 一覧へ同じ作業項目が2行現れ、どちらへ工数を記録したのかが利用者に分からなく
 * なる。`taskRecordId` の全体一意性では防げない（別の実績IDを振れば通る）。
 */
function checkNestedIdentifiers(problems, templates, runs) {
  templates.forEach((template, templateIndex) => {
    checkUniqueNestedKeys(
      problems,
      template?.tasks ?? [],
      'taskDefinitionId',
      `taskTemplates[${templateIndex}].tasks`,
      '作業項目定義',
    );
  });

  runs.forEach((run, runIndex) => {
    checkUniqueNestedKeys(
      problems,
      run?.tasks ?? [],
      'taskDefinitionId',
      `workRuns[${runIndex}].tasks`,
      '作業項目定義',
    );
  });

  const taskIds = new Set();
  const intervalIds = new Set();
  const entryIds = new Set();
  runs.forEach((run, runIndex) => {
    (run?.tasks ?? []).forEach((task, taskIndex) => {
      checkGlobalNestedKey(
        problems,
        taskIds,
        task?.taskRecordId,
        `workRuns[${runIndex}].tasks[${taskIndex}].taskRecordId`,
        '作業項目実績',
      );
      (task?.intervals ?? []).forEach((interval, intervalIndex) => {
        checkGlobalNestedKey(
          problems,
          intervalIds,
          interval?.intervalId,
          `workRuns[${runIndex}].tasks[${taskIndex}].intervals[${intervalIndex}].intervalId`,
          '作業区間',
        );
      });
      (task?.directEntries ?? []).forEach((entry, entryIndex) => {
        checkGlobalNestedKey(
          problems,
          entryIds,
          entry?.entryId,
          `workRuns[${runIndex}].tasks[${taskIndex}].directEntries[${entryIndex}].entryId`,
          '直接入力',
        );
      });
    });
  });
}

function checkUniqueNestedKeys(problems, items, key, path, label) {
  const seen = new Set();
  items.forEach((item, index) => {
    const value = item?.[key];
    if (typeof value !== 'string') {
      return;
    }
    if (seen.has(value)) {
      problems.add(`${path}[${index}].${key}`, `${label}の識別子が重複している（${value}）`);
      return;
    }
    seen.add(value);
  });
}

function checkGlobalNestedKey(problems, seen, value, path, label) {
  if (typeof value !== 'string') {
    return;
  }
  if (seen.has(value)) {
    problems.add(path, `${label}の識別子が重複している（${value}）`);
    return;
  }
  seen.add(value);
}

/**
 * 実施回が指す親が存在するか。
 *
 * 親を失った実施回は、ツリーにも案件詳細にも現れない。数量の累計にも入らないため、
 * 取り込んだのに見えないデータになる。
 *
 * テンプレートは版を保持するので（6.3）、`templateId` は旧版でも構わない。存在
 * しない `templateId` だけを拒む。
 */
function checkRunReferences(problems, runs, groups, templates) {
  const groupIds = new Set(groups.map((group) => group?.projectGroupId));
  const templatesById = new Map(templates.map((template) => [template?.templateId, template]));

  runs.forEach((run, index) => {
    if (!groupIds.has(run?.projectGroupId)) {
      problems.add(
        `workRuns[${index}].projectGroupId`,
        `案件グループが見つからない（${String(run?.projectGroupId)}）`,
      );
    }
    const template = templatesById.get(run?.templateId);
    if (run?.templateId !== undefined && template === undefined) {
      problems.add(
        `workRuns[${index}].templateId`,
        `作業テンプレートが見つからない（${String(run.templateId)}）`,
      );
      return;
    }
    if (template !== undefined && run?.templateVersion !== template.version) {
      problems.add(
        `workRuns[${index}].templateVersion`,
        `参照するテンプレートの版と一致しない（${String(run?.templateVersion)} / ${String(template.version)}）`,
      );
    }

    const definitionIds = new Set((template?.tasks ?? []).map((task) => task?.taskDefinitionId));
    (run?.tasks ?? []).forEach((task, taskIndex) => {
      if (!definitionIds.has(task?.taskDefinitionId)) {
        problems.add(
          `workRuns[${index}].tasks[${taskIndex}].taskDefinitionId`,
          `参照するテンプレートに作業項目定義が見つからない（${String(task?.taskDefinitionId)}）`,
        );
      }
    });
  });
}

/**
 * 変更履歴の対象種別と操作が対応しているか。
 *
 * `targetId` の現在存在は要求しない。削除履歴は削除済みの区間・直接入力・実施回・
 * 案件を指すため、参照先が無いこと自体が正常である。`statusReverted` の対象も後から
 * 実施回ごと削除されうる。履歴は現行レコードへの外部キーではなく、削除前の要約を
 * 保持する記録として扱う（仕様書11章）。
 */
function checkHistoryConsistency(problems, history) {
  history.forEach((entry, index) => {
    // 対応表は `history.js` が持つ。書き込みと取り込みで通る履歴が変わらない
    // ようにするためである（レビュー指摘 SOL-2）。
    const expected = HISTORY_ENTITY_BY_OP[entry?.operation];
    if (expected !== undefined && entry?.entityType !== expected) {
      problems.add(
        `changeHistory[${index}].entityType`,
        `${entry.operation} の対象種別は ${expected} である`,
      );
    }
  });
}

/**
 * 実施回の中身が状態と噛み合っているか。
 */
function checkRunContents(problems, runs) {
  runs.forEach((run, index) => {
    const path = `workRuns[${index}]`;
    checkIntervalOrder(problems, run, path);
    checkParticipants(problems, run, path);
    checkStatusConsistency(problems, run, path);
    checkTimestampOrder(problems, run, path);
    checkEffortRange(problems, run, path);
  });
}

/**
 * 派生する合計工数が厳密に扱える範囲か（仕様書8.6、8.9.12）。
 *
 * 1件ずつの値には上限があるが（`schema.js`）、合計には効かない。工数は
 * 「経過秒 × 参加者数」を足し合わせた値であり、区間数・作業項目数・参加者数が
 * それぞれ上限内でも、積と和を重ねれば安全整数を超える。超えた時点で加算は
 * 丸められ、集計値と転記値が厳密値から静かにずれる。
 *
 * 作業項目ごとに見てから実施回でも見る。どちらも利用者が数字を読む単位であり、
 * 作業項目単位で場所を示せると原因のレコードを特定できる。
 */
function checkEffortRange(problems, run, path) {
  let runTotal = 0;
  (run?.tasks ?? []).forEach((task, taskIndex) => {
    const total = taskTotalSeconds(task);
    if (!isEffortWithinRange(total)) {
      problems.add(
        `${path}.tasks[${taskIndex}]`,
        `合計工数が上限（${MAX_EFFORT_SECONDS}秒）を超える。` +
          '期間または参加者数が現実的な範囲を外れている（仕様書8.9.12）。',
      );
    }
    runTotal += total;
  });

  if (!isEffortWithinRange(runTotal)) {
    problems.add(
      path,
      `実施回の合計工数が上限（${MAX_EFFORT_SECONDS}秒）を超える（仕様書8.9.12）。`,
    );
  }
}

/**
 * 参加者一覧が通常入力と同じ意味になるか（仕様書8.6.1、8.9.4、GAR-2）。
 *
 * 工数は `participants.length` を人数として掛ける。同じ名前が2回入ったJSONは、
 * 1人の作業を2人分として計上する。1時間の区間が7,200秒になり、その値が分単位の
 * 切り上げと転記値まで伝播する。取り込みは通常入力の検証を通らないため、ここで
 * 拒む。
 *
 * 表記ゆれ（「甲」と「甲 太郎」）は判断しない。利用者へ委ねると決まっている
 * （仕様書8.9.9）。見るのは前後空白を落とした完全一致だけである。
 */
function checkParticipants(problems, run, path) {
  (run?.tasks ?? []).forEach((task, taskIndex) => {
    (task?.intervals ?? []).forEach((interval, intervalIndex) => {
      checkParticipantList(
        problems,
        interval?.participants,
        `${path}.tasks[${taskIndex}].intervals[${intervalIndex}].participants`,
        // 作業区間は0人を許さない（仕様書8.9.4）。休憩は0人でよい。
        interval?.type === INTERVAL_TYPE.WORK,
      );
    });
    (task?.directEntries ?? []).forEach((entry, entryIndex) => {
      // 直接入力の `seconds` は既に人数を含む（8.5.6）ため工数は水増しされないが、
      // 重複候補の判定（8.9.8）が参加者一覧の一致で行われるため、正規化前の値が
      // 残ると同じ組み合わせを別物として扱ってしまう。
      checkParticipantList(
        problems,
        entry?.participants,
        `${path}.tasks[${taskIndex}].directEntries[${entryIndex}].participants`,
        false,
      );
    });
  });
}

/**
 * 通常入力と同じ意味の参加者一覧かを、共有の正規化規則から導いて確かめる。
 *
 * 判定は `normalizeParticipants()` の結果との差で表す。規則を書き写すと、正規化を
 * 変えたときに取り込み検証だけが古い規則で残り、水増し（GAR-2）がそのクラスで
 * 復活する。何が落ちたかによって指摘の文言を分ける。
 *
 * @param {unknown} participants
 * @param {string} path
 * @param {boolean} requireAtLeastOne
 */
function checkParticipantList(problems, participants, path, requireAtLeastOne) {
  if (!Array.isArray(participants)) {
    // 構造検証（`schema.js`）が先に弾く。
    return;
  }
  // 文字列以外の要素は構造検証の担当である。ここで打ち切ると、同じ一覧に含まれる
  // 空白名・重複・0人の指摘まで一緒に消える。
  const names = participants.filter((name) => typeof name === 'string');
  const normalized = normalizeParticipants(names);

  const blankCount = names.filter((name) => name.trim() === '').length;
  // 正規化で減った件数のうち、空文字で説明できない差が重複である。
  const duplicated = names.length - blankCount > normalized.length;

  if (blankCount > 0) {
    problems.add(path, '空の参加者名が含まれている');
  }
  if (duplicated) {
    problems.add(path, '同じ参加者が重複している。人数として二重に数えられる（仕様書8.6.1）');
  }
  if (requireAtLeastOne && normalized.length === 0) {
    problems.add(path, '作業区間は参加者が1名以上必要である（仕様書8.9.4）');
  }
}

/**
 * 状態日時の前後関係（仕様書7.1、10.2、GAR-3）。
 *
 * 求めるのは通常操作が必ず満たす順序である。
 *
 * ```text
 * createdAt <= transferredAt <= archivedAt <= updatedAt
 * ```
 *
 * 保持期間は `archivedAt` を唯一の起算日とする（10.2）。作成前にアーカイブされた
 * ような到達不能な時系列を通すと、**保持期間を経過済みとして削除候補になる**。
 * 完全削除には確認が残るとはいえ、「保持期間内の記録を守る」という判定の根拠が
 * 成立しなくなる。
 *
 * 自動補正はしない。日時を書き換えると保持期間の意味そのものが変わるため、
 * 取り込む前に直してもらう。同秒は許す。
 *
 * 書き込み側は `runWriteTime()`（`writeClock.js`）でこの順序を保証する。時計が
 * 巻き戻っても、ツール自身が書いたエクスポートは必ずここを通る（A-11）。
 *
 * 鎖は隣接する組だけを見る。存在する値を順に比べれば残りは推移律で導けるうえ、
 * 日時が1つ壊れたときに同じ項目へ何件も指摘が並ばない。
 */
function checkTimestampOrder(problems, run, path) {
  const chain = [
    { key: 'createdAt', value: run?.createdAt, label: '作成日時' },
    { key: 'transferredAt', value: run?.transferredAt ?? null, label: '転記完了日時' },
    { key: 'archivedAt', value: run?.archivedAt ?? null, label: 'アーカイブ日時' },
    { key: 'updatedAt', value: run?.updatedAt, label: '更新日時' },
  ].filter((item) => typeof item.value === 'string');

  for (let index = 1; index < chain.length; index += 1) {
    const earlier = chain[index - 1];
    const later = chain[index];
    if (compareIso(later.value, earlier.value) < 0) {
      problems.add(`${path}.${later.key}`, `${later.label}が${earlier.label}より前である`);
    }
  }
}

/**
 * 終了日時が開始日時以降か（仕様書8.9.3）。
 *
 * 逆転した区間は `intervalEffortSeconds()` が0秒へ丸めるため、取り込んだ後に
 * 工数が静かに欠落する。画面の一覧にも「0分」としか出ず、誤りに気づけない。
 */
function checkIntervalOrder(problems, run, path) {
  (run?.tasks ?? []).forEach((task, taskIndex) => {
    (task?.intervals ?? []).forEach((interval, intervalIndex) => {
      if (interval?.endAt === null || interval?.endAt === undefined) {
        return;
      }
      if (compareIso(interval.endAt, interval.startAt) < 0) {
        problems.add(
          `${path}.tasks[${taskIndex}].intervals[${intervalIndex}].endAt`,
          '終了日時が開始日時より前である（仕様書8.9.3）',
        );
      }
    });
  });
}

/**
 * 状態と、その状態が意味する中身が噛み合っているか（仕様書7章）。
 *
 * 集計済み・転記済みは「未終了区間がない」状態である。アクション層はこの不変
 * 条件を守るが（S8-1 の対応）、取り込みはその経路を通らない。
 *
 * `transferredAt` も状態と対応させる。ただし見るのは**転記より手前の状態**だけで
 * ある。作業中・集計済みに転記完了日時があるのは筋が通らない（設計メモ
 * PWT-DESIGN-008 §2.8 で「戻したら消す」と決めた）。一方アーカイブは転記済みの
 * 後の状態なので、転記完了日時が残っていてよい（仕様書7.1、10.1）。
 */
function checkStatusConsistency(problems, run, path) {
  const status = run?.status;
  const openCount = (run?.tasks ?? []).reduce(
    (total, task) => total + (task?.intervals ?? []).filter(isOpenInterval).length,
    0,
  );

  // アーカイブも「転記済みの後」なので未終了区間を持たない。
  const requiresClosed =
    status === RUN_STATUS.AGGREGATED ||
    status === RUN_STATUS.TRANSFERRED ||
    status === RUN_STATUS.ARCHIVED;
  if (openCount > 0 && requiresClosed) {
    problems.add(
      `${path}.status`,
      `${status} でありながら未終了の作業区間が ${openCount} 件ある（仕様書7章）`,
    );
  }

  const transferredAt = run?.transferredAt ?? null;
  const beforeTransfer = status === RUN_STATUS.WORKING || status === RUN_STATUS.AGGREGATED;
  if (beforeTransfer && transferredAt !== null) {
    problems.add(
      `${path}.transferredAt`,
      `転記より手前の状態（${String(status)}）なのに転記完了日時がある`,
    );
  }
  if (status === RUN_STATUS.TRANSFERRED && transferredAt === null) {
    problems.add(`${path}.transferredAt`, '転記済みなのに転記完了日時が無い');
  }
  if (status === RUN_STATUS.ARCHIVED && transferredAt === null) {
    problems.add(`${path}.transferredAt`, 'アーカイブ済みなのに転記完了日時が無い');
  }

  const archivedAt = run?.archivedAt ?? null;
  if (status === RUN_STATUS.ARCHIVED && archivedAt === null) {
    problems.add(`${path}.archivedAt`, 'アーカイブ済みなのにアーカイブ日時が無い');
  }
  if (status !== RUN_STATUS.ARCHIVED && archivedAt !== null) {
    problems.add(`${path}.archivedAt`, `${String(status)} なのにアーカイブ日時がある`);
  }
}
