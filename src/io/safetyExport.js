/**
 * 破壊的操作前の共通退避フロー（仕様書9.4）。
 *
 * ここが持つのは順序だけである。「退避してから壊す」であって逆ではない。
 *
 * 退避と破壊的操作を1つの排他区間へ入れるのは呼び出し側の役目である
 * （`main.js` の `runDestructive`）。この関数は排他を知らない。区間の中で使う
 * アクションも知らない。呼び出し側がクロージャで閉じてから渡すため、この共通
 * フローの公開契約は「退避する関数」と「壊す関数」の2つに収まる。
 */

/**
 * 退避の有無を確定した後で破壊的操作を実行する。
 *
 * `backup: false` は、画面が「取り消せない」ことをもう一度確認した場合だけ通す。
 *
 * @param {{backup: boolean, confirmedWithoutBackup?: boolean,
 *          exportData: () => Promise<unknown>,
 *          destructiveAction: () => Promise<unknown>}} options
 */
export async function runDestructiveAction({
  backup,
  confirmedWithoutBackup = false,
  exportData,
  destructiveAction,
}) {
  if (backup) {
    await exportData();
  } else if (!confirmedWithoutBackup) {
    return { executed: false, backedUp: false };
  }

  const value = await destructiveAction();
  return { executed: true, backedUp: backup, value };
}
