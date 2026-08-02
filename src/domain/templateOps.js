/**
 * 作業テンプレートの組み立てと改訂（仕様書8.1、6.3）。
 *
 * 純関数のみ。現在時刻と識別子は引数で受け取る。
 *
 * 版の扱いが要件である。改訂時は `templateSeriesId` を据え置いたまま
 * `templateId` を新規発行し、`version` を繰り上げる。旧版のレコードは削除せず
 * 保持し、`active` を false にすることで有効版から外す。同一の
 * 対象種別 × バリエーションに有効版は1つだけ存在する。
 *
 * 実施回作成時にはテンプレートの作業項目定義を値として複製するため、改訂しても
 * 既存の実施回は変化しない（仕様書8.1.4）。この不変性は複製する側
 * （Step 5 の `templateInstantiate.js`）で成立させ、本モジュールは常に
 * 新しいオブジェクトを返して元を書き換えないことで支える。
 */

/**
 * 下書きから版1のテンプレートを組む。
 *
 * @param {{targetType: string, variant: string, tasks: object[]}} draft
 * @param {{createdAt: string, templateSeriesId: string, templateId: string,
 *          newId: () => string}} context
 * @returns {object} TaskTemplate（仕様書6.3）
 */
export function buildTemplate(draft, context) {
  const { createdAt, templateSeriesId, templateId, newId } = context;
  return {
    templateSeriesId,
    templateId,
    targetType: draft.targetType.trim(),
    variant: draft.variant.trim(),
    version: 1,
    active: true,
    createdAt,
    tasks: normalizeTaskDefinitions(draft.tasks, newId),
  };
}

/**
 * 既存のテンプレートを改訂した新しい版を返す（仕様書8.1.3）。
 *
 * 対象種別とバリエーションは下書きで上書きできる。版系列の意味が変わるため
 * 通常は据え置くが、表記の誤りを直せるようにしてある。
 *
 * 版番号は `context.version` で受け取る。改訂元の版に1を足すだけでは、旧版から
 * 改訂したときに既存の版番号と重複する。系列内の最大版を知っているのは呼び出し
 * 側なので（{@link nextTemplateVersion}）、判断をそちらへ預ける。省略時は
 * 改訂元の次の版とする。
 *
 * @param {object} current 改訂元のテンプレート
 * @param {{targetType?: string, variant?: string, tasks: object[]}} draft
 * @param {{createdAt: string, templateId: string, version?: number,
 *          newId: () => string}} context
 * @returns {object} 新しい版の TaskTemplate
 */
export function reviseTemplate(current, draft, context) {
  const { createdAt, templateId, version, newId } = context;
  return {
    // 版系列の識別子は改訂しても変わらない（仕様書6.3）。
    templateSeriesId: current.templateSeriesId,
    templateId,
    targetType: (draft.targetType ?? current.targetType).trim(),
    variant: (draft.variant ?? current.variant).trim(),
    version: version ?? current.version + 1,
    active: true,
    createdAt,
    tasks: normalizeTaskDefinitions(draft.tasks, newId),
  };
}

/**
 * 版系列の次の版番号を返す（仕様書6.3）。
 *
 * 系列内の最大版に1を足す。改訂元が旧版であっても、既存の版番号と重複しない。
 *
 * @param {object[]} templates 全テンプレート（版を問わない）
 * @param {string} templateSeriesId
 * @returns {number}
 */
export function nextTemplateVersion(templates, templateSeriesId) {
  const versions = templates
    .filter((template) => template.templateSeriesId === templateSeriesId)
    .map((template) => (Number.isInteger(template.version) ? template.version : 0));
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

/**
 * 有効版から外したテンプレートを返す。レコード自体は保持する（仕様書6.3）。
 *
 * @param {object} template
 * @returns {object}
 */
export function deactivate(template) {
  return { ...template, active: false };
}

/**
 * 作業項目定義を保存できる形へ整える。
 *
 * `taskDefinitionId` は版をまたいで同一項目を追跡する識別子であり、改訂時も
 * 引き継ぐ（仕様書6.3）。画面で追加した行にはまだ識別子が無いため、その行だけ
 * 採番する。
 *
 * `order` は入力値をそのまま保存せず、表示順に並べ直したうえで1から振り直す。
 * 画面で番号を飛ばしたり重複させたりしても、保存後の並びが一意に定まる。
 *
 * @param {object[]} tasks
 * @param {() => string} newId
 * @returns {object[]}
 */
export function normalizeTaskDefinitions(tasks, newId) {
  return sortTaskDefinitions(tasks).map((task, index) => ({
    taskDefinitionId: task.taskDefinitionId ?? newId(),
    name: task.name.trim(),
    externalCode: normalizeExternalCode(task.externalCode),
    order: index + 1,
    active: task.active !== false,
  }));
}

/**
 * 外部項目コードを整える。未設定は null に寄せる（仕様書8.7.4）。
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeExternalCode(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 作業項目定義を表示順で並べ替えた新しい配列を返す。
 *
 * `order` が同値の場合は元の並びを保つ（安定ソート）。
 *
 * @param {object[]} tasks
 * @returns {object[]}
 */
export function sortTaskDefinitions(tasks) {
  return [...tasks].sort((left, right) => toOrderValue(left) - toOrderValue(right));
}

function toOrderValue(task) {
  // 表示順が未設定の行は末尾へ送る。画面で追加した直後の行が該当する。
  return Number.isFinite(task.order) ? task.order : Number.MAX_SAFE_INTEGER;
}

/**
 * 有効な作業項目定義を表示順で返す（仕様書8.1.5）。
 *
 * 無効化した項目は新規実施回へ生成しないため、Step 5 の実施回生成もこの関数を
 * 通す。テンプレート画面では無効な項目も編集対象として表示するので、画面側は
 * この関数を使わずに全項目を扱う。
 *
 * @param {{tasks: object[]}} template
 * @returns {object[]}
 */
export function activeTaskDefinitions(template) {
  return sortTaskDefinitions(template.tasks).filter((task) => task.active === true);
}

/**
 * 新しい行へ振る表示順を返す。
 *
 * @param {object[]} tasks
 * @returns {number}
 */
export function nextOrder(tasks) {
  const orders = tasks.map(toOrderValue).filter((order) => order !== Number.MAX_SAFE_INTEGER);
  return orders.length === 0 ? 1 : Math.max(...orders) + 1;
}

/**
 * テンプレートの一覧から有効版だけを取り出し、表示順に並べる。
 *
 * 保存層の `findTaskTemplates` は対象種別とバリエーションで引くが、一覧画面は
 * 全件を対象にするため、こちらで絞り込む。`active` は IndexedDB の索引へ
 * 含められないため（実装計画3.1）、絞り込みは常にメモリ上で行う。
 *
 * @param {object[]} templates
 * @returns {object[]}
 */
export function activeTemplates(templates) {
  return templates
    .filter((template) => template.active === true)
    .sort(
      (left, right) =>
        left.targetType.localeCompare(right.targetType, 'ja') ||
        left.variant.localeCompare(right.variant, 'ja'),
    );
}
