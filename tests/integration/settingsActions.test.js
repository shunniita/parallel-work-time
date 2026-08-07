import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  exportData,
  importData,
  updateSettings,
} from '../../src/app/actions/settingsActions.js';
import { createPersistence } from '../../src/app/persistence.js';
import { ValidationError } from '../../src/app/errors.js';
import {
  MAX_LONG_RUNNING_THRESHOLD_HOURS,
  MAX_RETENTION_DAYS,
} from '../../src/config.js';
import { toIsoSecond } from '../../src/domain/datetime.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';

const FIXED_NOW = new Date(2026, 7, 1, 12, 34, 56);

describe('設定・JSON入出力アクション', () => {
  let adapter;
  let deps;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.initialize();
    deps = {
      adapter,
      persistence: createPersistence(adapter, { now: () => FIXED_NOW }),
    };
  });

  it('保持期間と未終了しきい値を保存する', async () => {
    const result = await updateSettings(deps, {
      retentionDays: 45,
      longRunningThresholdHours: 8,
    });

    expect(result.settings).toMatchObject({ retentionDays: 45, longRunningThresholdHours: 8 });
    expect((await adapter.loadAll()).settings).toEqual(result.settings);
  });

  it('1未満や整数でない設定を保存しない', async () => {
    const before = await adapter.loadAll();

    await expect(updateSettings(deps, {
      retentionDays: 0,
      longRunningThresholdHours: 1.5,
    })).rejects.toBeInstanceOf(ValidationError);
    expect(await adapter.loadAll()).toEqual(before);
  });

  describe('上限を超える設定を保存しない（レビュー指摘 S10-5）', () => {
    // 日時の加算へそのまま入る値なので、範囲を超えると加算結果が NaN になり、
    // 保存済みの設定が原因でアーカイブ画面が開けなくなる。
    it.each([
      ['保持期間', { retentionDays: MAX_RETENTION_DAYS + 1, longRunningThresholdHours: 12 }],
      ['保持期間の指数表記', { retentionDays: 1e20, longRunningThresholdHours: 12 }],
      [
        'しきい値',
        { retentionDays: 30, longRunningThresholdHours: MAX_LONG_RUNNING_THRESHOLD_HOURS + 1 },
      ],
      ['安全整数を超える値', { retentionDays: 2 ** 53, longRunningThresholdHours: 12 }],
    ])('%s', async (_label, input) => {
      const before = await adapter.loadAll();

      await expect(updateSettings(deps, input)).rejects.toBeInstanceOf(ValidationError);
      expect(await adapter.loadAll()).toEqual(before);
    });

    it('上限ちょうどは保存できる', async () => {
      const result = await updateSettings(deps, {
        retentionDays: MAX_RETENTION_DAYS,
        longRunningThresholdHours: MAX_LONG_RUNNING_THRESHOLD_HOURS,
      });

      expect(result.settings.retentionDays).toBe(MAX_RETENTION_DAYS);
    });

    it('拒否の理由に上限値を書く', async () => {
      const error = await updateSettings(deps, {
        retentionDays: 1e20,
        longRunningThresholdHours: 12,
      }).catch((caught) => caught);

      expect(error.message).toContain(String(MAX_RETENTION_DAYS));
    });
  });

  it('全データをダウンロードし最終エクスポート日時を記録する', async () => {
    const download = vi.fn(() => ({ filename: 'backup.json' }));
    const result = await exportData(deps, { now: () => FIXED_NOW, download });

    expect(download).toHaveBeenCalledOnce();
    const payload = download.mock.calls[0][0];
    expect(payload).toMatchObject({
      schemaVersion: 1,
      exportedAt: toIsoSecond(FIXED_NOW),
      settings: { lastExportedAt: toIsoSecond(FIXED_NOW) },
    });
    expect(result.payload).toEqual(payload);
    expect((await adapter.loadAll()).settings.lastExportedAt).toBe(payload.exportedAt);
  });

  it('インポート後のデータセットを返す', async () => {
    const payload = await adapter.exportAll({ exportedAt: '2026-08-01T12:00:00+09:00' });
    payload.settings.retentionDays = 99;

    const result = await importData(deps, payload);

    expect(result.dataset.settings.retentionDays).toBe(99);
    expect((await adapter.loadAll()).settings.retentionDays).toBe(99);
  });
});
