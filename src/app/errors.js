/**
 * アプリ層が投げる例外。
 *
 * アクションの実装ファイルではなくここへ置く。アクションが増えるたびに
 * 「別のアクションから例外クラスを import する」形が生まれ、循環 import の芽に
 * なるためである（実際 `projectActions` は `templateActions` から
 * `ValidationError` を取り込んでいた）。
 *
 * 階層は `AppError` を根に一本化する。「利用者に見せる想定の失敗」と「想定外の
 * 不具合」を `instanceof AppError` で区別できるようにするためで、画面は前者だけ
 * を文言としてそのまま出す。
 *
 * 保存層の `StorageError`（`src/storage/StorageAdapter.js`）はここに含めない。
 * 保存領域の問題と入力の問題は画面での扱いが違う。
 */

import { warningMessages } from '../domain/problems.js';

/**
 * 利用者へ見せる想定のアプリ層の失敗。
 *
 * これを継承しない例外は不具合として扱い、画面は「保存: …」の形で素の文言を出す。
 */
export class AppError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * 入力検証で保存を拒否したことを表す例外。
 *
 * 入力を保持したまま直させたい種類の失敗である。
 */
export class ValidationError extends AppError {
  /**
   * @param {string[]} errors 「場所: 説明」形式
   */
  constructor(errors) {
    super(errors.join(' / '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * 案件IDが既に使われていることを表す例外（仕様書8.2.6）。
 *
 * 単なる検証エラーと分けてある。画面は既存案件の対象種別・バリエーションを示し、
 * その案件へ実施回を追加する導線を出す必要があるため、`conflict` を運ぶ。
 */
export class ProjectIdConflictError extends ValidationError {
  /**
   * @param {string[]} errors
   * @param {object} conflict 既存の案件グループ
   */
  constructor(errors, conflict) {
    super(errors);
    this.name = 'ProjectIdConflictError';
    this.conflict = conflict;
  }
}

/**
 * 累計が総予定数を超えることを表す例外（仕様書8.9.7）。
 *
 * 保存を禁止する意味ではない。確認を求めるための差し戻しであり、画面が
 * `confirmedOverflow: true` を付けて呼び直せば保存される。`ValidationError` を
 * 継承しないのはそのためで、入力が誤っているわけではない。
 */
export class QuantityOverflowError extends AppError {
  /**
   * @param {{code: string, path: string, message: string}[]} warnings
   *   `validateRunDraft` などが返す種別コードつきの警告（`domain/problems.js`）
   * @param {object} preview `previewQuantity` の結果
   */
  constructor(warnings, preview) {
    super(warningMessages(warnings).join(' / '));
    this.name = 'QuantityOverflowError';
    this.warnings = warnings;
    this.preview = preview;
  }
}

/**
 * 集計済みの実施回で未終了区間を生じる操作を差し戻す例外（仕様書7.1）。
 *
 * 保存を禁止する意味ではない。`QuantityOverflowError` と同じく確認を求めるための
 * 差し戻しであり、画面が `confirmedResume: true` を付けて呼び直せば、実施回を
 * 作業中へ戻したうえで保存される。入力が誤っているわけではないので
 * `ValidationError` を継承しない。
 *
 * 集計済みは「未終了区間がない」状態である（仕様書7章）。作業を再開すればその
 * 前提は崩れるため、状態を作業中へ戻す必要がある。ただし集計済み→作業中は
 * 利用者の確認操作によると定められており（7.1）、黙って戻すことはできない。
 * そのため「確認を取ってから、状態変更と区間生成を一緒に行う」形にしている。
 */
export class ResumeConfirmationRequiredError extends AppError {
  /**
   * @param {string} message
   * @param {string} runId
   */
  constructor(message, runId) {
    super(message);
    this.name = 'ResumeConfirmationRequiredError';
    this.runId = runId;
  }
}

/**
 * 状態が許さない操作を拒否したことを表す例外（仕様書7.2）。
 *
 * 転記済み・アーカイブの実施回は閲覧のみで、記録も数量も変更できない。入力の
 * 誤りではなく操作の対象が悪いので、`ValidationError` とは分けて扱う。
 *
 * 判定そのものは `src/domain/runStatus.js` にある。どのアクションがこのガードを
 * 持つかの規約も同モジュールへ書いてある。
 */
export class RunNotEditableError extends AppError {
  /**
   * @param {string} message
   * @param {string} status 実施回の現在状態
   */
  constructor(message, status) {
    super(message);
    this.name = 'RunNotEditableError';
    this.status = status;
  }
}

/**
 * 画面へ出す文言の一覧へ直す。
 *
 * 各ビューの catch 節が同じ分岐を書き写すのを避ける。呼び出し側は、専用の扱いが
 * 要る例外（`ProjectIdConflictError` / `QuantityOverflowError`）を先に捌いてから
 * これを呼ぶ。
 *
 * @param {unknown} error
 * @returns {string[]}
 */
export function toErrorMessages(error) {
  if (error instanceof ValidationError) {
    return error.errors;
  }
  if (error instanceof AppError) {
    return [error.message];
  }
  return [`保存: ${error?.message ?? String(error)}`];
}
