import { describe, expect, it, vi } from 'vitest';

import { runDestructiveAction } from '../../src/io/safetyExport.js';

describe('runDestructiveAction（仕様書9.4）', () => {
  it('退避を選ぶとダウンロード完了後に破壊的操作を行う', async () => {
    const order = [];
    const result = await runDestructiveAction({
      backup: true,
      exportData: vi.fn(async () => { order.push('backup'); }),
      destructiveAction: vi.fn(async () => { order.push('replace'); return 'done'; }),
    });

    expect(order).toEqual(['backup', 'replace']);
    expect(result).toEqual({ executed: true, backedUp: true, value: 'done' });
  });

  it('退避なしの確認前は破壊的操作を呼ばない', async () => {
    const destructiveAction = vi.fn();
    const result = await runDestructiveAction({
      backup: false,
      confirmedWithoutBackup: false,
      exportData: vi.fn(),
      destructiveAction,
    });

    expect(result.executed).toBe(false);
    expect(destructiveAction).not.toHaveBeenCalled();
  });

  it('取り消せない確認後は退避なしでも続行できる', async () => {
    const exportData = vi.fn();
    const destructiveAction = vi.fn(async () => 'done');
    const result = await runDestructiveAction({
      backup: false,
      confirmedWithoutBackup: true,
      exportData,
      destructiveAction,
    });

    expect(exportData).not.toHaveBeenCalled();
    expect(destructiveAction).toHaveBeenCalledOnce();
    expect(result.backedUp).toBe(false);
  });
});
