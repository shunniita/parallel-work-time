/** 設定・JSON入出力のアプリケーション操作（仕様書9.2〜9.5、12.2）。 */

import {
  MAX_LONG_RUNNING_THRESHOLD_HOURS,
  MAX_RETENTION_DAYS,
  SCHEMA_VERSION,
  createDefaultSettings,
  isIntegerInRange,
} from '../../config.js';
import { toIsoSecond } from '../../domain/datetime.js';
import { downloadExport } from '../../io/exportJson.js';
import { ENTITY_TYPE } from '../../storage/StorageAdapter.js';
import { AppError, ValidationError } from '../errors.js';

function integerInRange(value, max, label) {
  if (!isIntegerInRange(value, max)) {
    throw new ValidationError([`${label}: 1以上 ${max} 以下の整数で入力してください`]);
  }
  return value;
}

/** 保持期間と未終了しきい値を保存する。 */
export async function updateSettings(deps, input) {
  const retentionDays = integerInRange(
    input.retentionDays,
    MAX_RETENTION_DAYS,
    '保持期間（日）',
  );
  const longRunningThresholdHours = integerInRange(
    input.longRunningThresholdHours,
    MAX_LONG_RUNNING_THRESHOLD_HOURS,
    '未終了しきい値（時間）',
  );

  const { dataset, value } = await deps.persistence.run(async (loaded) => {
    const current = loaded.settings ?? createDefaultSettings();
    const settings = {
      ...current,
      schemaVersion: SCHEMA_VERSION,
      retentionDays,
      longRunningThresholdHours,
    };
    return {
      write: () => deps.adapter.saveEntity(ENTITY_TYPE.SETTINGS, settings),
      value: settings,
    };
  });
  return { dataset, settings: value };
}

/**
 * 現在の全データをダウンロードし、最終エクスポート日時を設定へ記録する。
 *
 * ダウンロードが始まる前に日時だけ保存すると、ブラウザ側の失敗でも「実施済み」に
 * 見える。したがって同じ直列化区間でダウンロードを先に行い、その後に記録する。
 */
export async function exportData(deps, options = {}) {
  const date = options.now?.() ?? new Date();
  const exportedAt = toIsoSecond(date);
  const download = options.download ?? downloadExport;

  const { dataset, value } = await deps.persistence.run(async () => {
    // 保存先の公開契約 `exportAll()` を実際の出力経路でも使う。アダプター契約
    // テストと画面のエクスポートが別実装にならないようにするためである。
    const payload = await deps.adapter.exportAll({ exportedAt });
    const settings = {
      ...(payload.settings ?? createDefaultSettings()),
      schemaVersion: SCHEMA_VERSION,
      lastExportedAt: exportedAt,
    };
    payload.settings = settings;
    return {
      write: async () => {
        let file;
        try {
          file = download(payload, { date });
        } catch (error) {
          throw new AppError(
            `JSONファイルをダウンロードできませんでした（${error?.message ?? String(error)}）`,
          );
        }
        await deps.adapter.saveEntity(ENTITY_TYPE.SETTINGS, settings);
        return file;
      },
      value: { payload, exportedAt },
    };
  });
  return { dataset, ...value };
}

/** 検証済みJSONで全データを置き換える。保存入口でも再検証する。 */
export async function importData(deps, payload) {
  const { dataset } = await deps.persistence.run(async () => ({
    write: () => deps.adapter.importAll(payload),
  }));
  return { dataset };
}
