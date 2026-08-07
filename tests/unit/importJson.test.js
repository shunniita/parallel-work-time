import { describe, expect, it } from 'vitest';

import { createDefaultSettings, SCHEMA_VERSION } from '../../src/config.js';
import { ValidationError } from '../../src/app/errors.js';
import { readImportFile } from '../../src/io/importJson.js';

function payload() {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: '2026-08-01T12:00:00+09:00',
    settings: createDefaultSettings(),
    taskTemplates: [],
    projectGroups: [],
    workRuns: [],
    changeHistory: [],
  };
}

describe('readImportFile', () => {
  it('妥当なJSONファイルを読む', async () => {
    const value = payload();
    await expect(readImportFile({ text: async () => JSON.stringify(value) })).resolves.toEqual(value);
  });

  it('JSON構文エラーを利用者向け検証エラーにする', async () => {
    const error = await readImportFile({ text: async () => '{' }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.errors.join('\n')).toContain('JSONとして読み取れません');
  });

  it('スキーマ不一致を確認画面の前に拒否する', async () => {
    const value = { ...payload(), schemaVersion: SCHEMA_VERSION + 1 };
    const error = await readImportFile({ text: async () => JSON.stringify(value) }).catch(
      (caught) => caught,
    );
    expect(error.errors.join('\n')).toContain('schemaVersion');
  });
});
