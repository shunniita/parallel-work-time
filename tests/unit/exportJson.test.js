import { describe, expect, it, vi } from 'vitest';

import { downloadExport, exportFileName, serializeExport } from '../../src/io/exportJson.js';

describe('JSONエクスポート', () => {
  it('仕様書9.2のファイル名を作る', () => {
    expect(exportFileName(new Date(2026, 7, 1, 9, 8, 7))).toBe(
      'parallel-work-time_20260801-090807.json',
    );
  });

  it('読みやすいJSONと末尾改行を作る', () => {
    expect(serializeExport({ schemaVersion: 1 })).toBe('{\n  "schemaVersion": 1\n}\n');
  });

  it('Blob URLを一時リンクからダウンロードして後始末する', () => {
    const anchor = { click: vi.fn(), remove: vi.fn(), hidden: false };
    const documentRef = {
      body: { append: vi.fn() },
      createElement: vi.fn(() => anchor),
    };
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    class BlobCtor {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options.type;
      }
    }

    const result = downloadExport({ schemaVersion: 1 }, {
      date: new Date(2026, 7, 1, 9, 8, 7),
      documentRef,
      BlobCtor,
      createObjectURL,
      revokeObjectURL,
    });

    expect(result.filename).toBe('parallel-work-time_20260801-090807.json');
    expect(anchor.download).toBe(result.filename);
    expect(anchor.href).toBe('blob:test');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
