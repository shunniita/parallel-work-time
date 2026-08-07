/** 破壊的操作前の共通退避フロー（仕様書9.4）。 */

/**
 * 退避の有無を確定した後で破壊的操作を実行する。
 *
 * `backup: false` は、画面が「取り消せない」ことをもう一度確認した場合だけ通す。
 * Step 10の削除操作もこの関数を再利用する。
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
