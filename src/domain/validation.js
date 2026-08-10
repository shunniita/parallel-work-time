/**
 * 入力検証（仕様書8.9）。
 *
 * 純関数のみ。検証結果は `{ok, errors}` で返し、保存するかどうかは
 * 呼び出し側（`src/app/actions/`）が決める。エラーの表記は
 * `src/domain/schema.js` と揃え、「場所: 説明」の形にする。画面はこの文字列を
 * そのまま表示できる。
 *
 * 本モジュールは各Stepで必要になった検証を足していく。実装計画 Step 11 で
 * 8.9.1〜8.9.9 の総点検を行う。
 *
 * 警告（`warnings`）と拒否（`errors`）を分ける。累計超過は警告し、確認後に
 * 続行できる（仕様書8.9.7）ため、保存を止める `errors` とは別に返す。警告は
 * 種別コードつきの `{code, path, message}` で返す（`problems.js`、D-15）。
 */

import { MAX_QUANTITY, MAX_TEXT_LENGTH, isIntegerInRange } from '../config.js';
import { normalizeProjectId } from './projectId.js';
import { isValidDateKey } from './datetime.js';
import { Problems } from './problems.js';
import { previewQuantity, previewTotalQuantity } from './quantity.js';

/** 本モジュールの検証で出る警告の種別。 */
export const VALIDATION_WARNING = {
  /** 今回数量の累計が総予定数を超える（仕様書8.9.7）。確認のうえ続行できる。 */
  QUANTITY_OVERFLOW: 'quantityOverflow',
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * 1以上の整数かどうか（仕様書8.9.2）。
 *
 * 文字列の `"50"` は受け付けない。画面側で数値へ変換する責務を明確にし、
 * 変換漏れを検証で捕まえる。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return isIntegerInRange(value, MAX_QUANTITY);
}

function checkRequiredText(problems, path, value) {
  if (!isNonEmptyString(value)) {
    problems.add(path, '必須項目である');
  } else if (value.trim().length > MAX_TEXT_LENGTH) {
    problems.add(path, `${MAX_TEXT_LENGTH}文字以下である必要がある`);
  }
}

function checkOptionalText(problems, path, value) {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    problems.add(path, '文字列または未設定である必要がある');
  } else if (typeof value === 'string' && value.trim().length > MAX_TEXT_LENGTH) {
    problems.add(path, `${MAX_TEXT_LENGTH}文字以下である必要がある`);
  }
}

/**
 * 作業テンプレートの下書きを検証する（仕様書8.1.1、8.1.2、8.9.1）。
 *
 * @param {unknown} draft
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateTemplateDraft(draft) {
  const problems = new Problems();

  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    problems.add('テンプレート', '入力内容を読み取れない');
    return problems.toResult();
  }

  checkRequiredText(problems, '対象種別', draft.targetType);
  checkRequiredText(problems, 'バリエーション', draft.variant);

  if (!Array.isArray(draft.tasks)) {
    problems.add('作業項目', '一覧を読み取れない');
    return problems.toResult();
  }
  if (draft.tasks.length === 0) {
    // 作業項目が無いテンプレートは実施回を生成できず、登録の意味がない。
    problems.add('作業項目', '1件以上必要である');
  }

  draft.tasks.forEach((task, index) => {
    const path = `作業項目${index + 1}`;
    if (task === null || typeof task !== 'object') {
      problems.add(path, '入力内容を読み取れない');
      return;
    }
    checkRequiredText(problems, `${path}の名称`, task.name);
    // 外部項目コードは未設定を許す。転記時の欠落は集計画面で警告する（8.7.4）。
    checkOptionalText(problems, `${path}の外部項目コード`, task.externalCode);
    if (task.order !== undefined && task.order !== null && !Number.isInteger(task.order)) {
      problems.add(`${path}の表示順`, '整数である必要がある');
    }
    if (task.active !== undefined && typeof task.active !== 'boolean') {
      problems.add(`${path}の有効状態`, '真偽値である必要がある');
    }
  });

  // 同一テンプレート内で作業項目名が重複すると、集計一覧で見分けられない。
  // 仕様は禁じていないため、表記ゆれと同様に登録は妨げない（8.9.9）。
  return problems.toResult();
}

/**
 * 同一の対象種別 × バリエーションに有効版が既にあるかを判定する（仕様書8.1.1）。
 *
 * 新規登録の可否に使う。改訂では版を繰り上げるためこの検査は行わない。
 *
 * @param {object[]} existingActiveTemplates
 * @param {{targetType: string, variant: string}} draft
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateTemplateIsNew(existingActiveTemplates, draft) {
  const problems = new Problems();
  const targetType = String(draft.targetType ?? '').trim();
  const variant = String(draft.variant ?? '').trim();

  const duplicate = existingActiveTemplates.find(
    (template) => template.targetType === targetType && template.variant === variant,
  );
  if (duplicate !== undefined) {
    problems.add(
      '対象種別とバリエーション',
      `${targetType} / ${variant} は版${duplicate.version}が既に登録されている。` +
        '内容を変える場合は改訂して保存する。',
    );
  }

  return problems.toResult();
}

/**
 * 案件グループの下書きを検証する（仕様書8.2.1、8.9.1、8.9.2）。
 *
 * 案件IDの重複は {@link validateProjectIdAvailable} が別に扱う。既存案件の
 * 内容を画面へ示す必要があり、返す情報の形が違うためである。
 *
 * @param {unknown} draft
 * @returns {{ok: boolean, errors: string[], warnings: object[]}}
 */
export function validateProjectGroupDraft(draft) {
  const problems = new Problems();

  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    problems.add('案件', '入力内容を読み取れない');
    return problems.toResult();
  }

  checkRequiredText(problems, '案件ID', draft.projectId);
  checkRequiredText(problems, '対象種別', draft.targetType);
  checkRequiredText(problems, 'バリエーション', draft.variant);
  if (!isPositiveInteger(draft.totalQuantity)) {
    problems.add('総予定数', `1以上 ${MAX_QUANTITY} 以下の整数である`);
  }

  return problems.toResult();
}

/**
 * 案件IDが未使用かどうかを検証する（仕様書8.2.6）。
 *
 * 案件IDは一意である。既存の案件IDで新規登録しようとした場合は登録を禁止し、
 * 何が登録済みかを示す。仕様が「その内容を示して登録を禁止する」と書いている
 * のは、利用者が既存IDを打ったときに自分の意図を確かめられるようにするためと
 * 読む。画面は返り値の `conflict` から対象種別・バリエーションを表示し、
 * 既存案件へ実施回を追加する導線を出す。
 *
 * 既存案件の対象種別・バリエーションを新しい入力で上書きしてはならない。
 * 実施回は作成時にテンプレートから作業項目を複製しており、後から案件の
 * 対象種別が変わると過去の実施回と食い違うためである。
 *
 * @param {object[]} existingGroups 保存済みの案件グループすべて
 * @param {string} projectId 入力された案件ID
 * @returns {{ok: boolean, errors: string[], warnings: object[], conflict: object|null}}
 */
export function validateProjectIdAvailable(existingGroups, projectId) {
  const problems = new Problems();
  const normalized = normalizeProjectId(projectId);

  const conflict =
    normalized === ''
      ? null
      : (existingGroups.find((group) => group.projectId === normalized) ?? null);

  if (conflict !== null) {
    problems.add(
      '案件ID',
      `${normalized} は既に登録されている（${conflict.targetType} / ${conflict.variant}）。` +
        '同じ案件の作業を続ける場合は、この案件へ実施回を追加する。',
    );
  }

  return problems.toResult({ conflict });
}

/**
 * 実施回の下書きを検証する（仕様書8.2.4、8.9.1、8.9.2、8.9.7）。
 *
 * 累計超過は警告のみとし、保存は止めない。確認後に続行できるという要件
 * （仕様書8.9.7）を、`errors` ではなく `warnings` へ入れることで表す。
 *
 * @param {unknown} draft `{workDate, runQuantity, excludedTaskDefinitionIds?}`
 * @param {{projectGroup: object, runs: object[], excludeRunId?: string|null,
 *          generatableCount?: number}} context
 * @returns {{ok: boolean, errors: string[], warnings: object[], preview: object|null}}
 */
export function validateRunDraft(draft, context) {
  const problems = new Problems();

  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    problems.add('実施回', '入力内容を読み取れない');
    return problems.toResult({ preview: null });
  }

  if (!isValidDateKey(draft.workDate)) {
    problems.add('作業日', 'YYYY-MM-DD 形式の日付である');
  }
  if (!isPositiveInteger(draft.runQuantity)) {
    problems.add('今回数量', `1以上 ${MAX_QUANTITY} 以下の整数である`);
  }

  // 作業項目を全部除外すると、工数を記録する対象が無い実施回ができてしまう。
  if (context.generatableCount !== undefined) {
    const excluded = draft.excludedTaskDefinitionIds ?? [];
    if (context.generatableCount - excluded.length <= 0) {
      problems.add('生成対象の作業項目', '1件以上を残す必要がある');
    }
  }

  let preview = null;
  if (isPositiveInteger(draft.runQuantity)) {
    preview = previewQuantity(context.projectGroup, context.runs, {
      runQuantity: draft.runQuantity,
      excludeRunId: context.excludeRunId ?? null,
    });
    if (preview.exceeded) {
      problems.warn(
        VALIDATION_WARNING.QUANTITY_OVERFLOW,
        '今回数量',
        `累計 ${preview.accumulated} が総予定数 ${context.projectGroup.totalQuantity} を ` +
          `${preview.overBy} 超える。確認のうえ続行できる。`,
      );
    }
  }

  return problems.toResult({ preview });
}

/**
 * 総予定数の修正を検証する（仕様書8.2.7、8.9.2、8.9.7）。
 *
 * 累計より小さい値へ修正すると超過状態になる。実施回追加時と同じ扱いで
 * 警告し、保存は止めない。
 *
 * @param {{runQuantity: number}[]} runs 当該案件グループの実施回すべて
 * @param {unknown} nextTotalQuantity
 * @returns {{ok: boolean, errors: string[], warnings: object[], preview: object|null}}
 */
export function validateTotalQuantityChange(runs, nextTotalQuantity) {
  const problems = new Problems();

  if (!isPositiveInteger(nextTotalQuantity)) {
    problems.add('総予定数', `1以上 ${MAX_QUANTITY} 以下の整数である`);
    return problems.toResult({ preview: null });
  }

  const preview = previewTotalQuantity(runs, nextTotalQuantity);
  if (preview.exceeded) {
    problems.warn(
      VALIDATION_WARNING.QUANTITY_OVERFLOW,
      '総予定数',
      `累計 ${preview.accumulated} が総予定数 ${nextTotalQuantity} を ` +
        `${preview.overBy} 超える。確認のうえ続行できる。`,
    );
  }

  return problems.toResult({ preview });
}
