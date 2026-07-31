/**
 * 入力検証（仕様書8.9）。
 *
 * 純関数のみ。検証結果は `{ok, errors}` で返し、保存するかどうかは
 * 呼び出し側（`src/app/actions/`）が決める。エラーの表記は
 * `src/domain/schema.js` と揃え、「場所: 説明」の形にする。画面はこの文字列を
 * そのまま表示できる。
 *
 * 本モジュールは各Stepで必要になった検証を足していく。Step 4 の時点では
 * 作業テンプレートの下書きのみを扱う。実装計画 Step 11 で 8.9.1〜8.9.9 の
 * 総点検を行う。
 */

/**
 * 検証結果を集める入れ物。
 */
class Problems {
  constructor() {
    this.errors = [];
  }

  /**
   * @param {string} path 例: `tasks[2].name`
   * @param {string} message
   */
  add(path, message) {
    this.errors.push(`${path}: ${message}`);
  }

  get ok() {
    return this.errors.length === 0;
  }

  toResult() {
    return { ok: this.ok, errors: this.errors };
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
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

  if (!isNonEmptyString(draft.targetType)) {
    problems.add('対象種別', '必須項目である');
  }
  if (!isNonEmptyString(draft.variant)) {
    problems.add('バリエーション', '必須項目である');
  }

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
    if (!isNonEmptyString(task.name)) {
      problems.add(`${path}の名称`, '必須項目である');
    }
    // 外部項目コードは未設定を許す。転記時の欠落は集計画面で警告する（8.7.4）。
    if (
      task.externalCode !== null &&
      task.externalCode !== undefined &&
      typeof task.externalCode !== 'string'
    ) {
      problems.add(`${path}の外部項目コード`, '文字列または未設定である必要がある');
    }
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
