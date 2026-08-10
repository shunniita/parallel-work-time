/**
 * 保存の直列化と排他区間の結合テスト（仕様書9.1、9.4）。
 *
 * `run()` が守るのは保存1回ぶんである。「退避してから全置換」のように利用者から
 * 1つに見える操作が2回の保存でできている場合は `runExclusive()` を使う。
 * その境界が実際に割り込みを防ぐかを、遅延を挟んだ操作列で確かめる。
 */

import { describe, expect, it, vi } from 'vitest';

import { createPersistence } from '../../src/app/persistence.js';
import { SCHEMA_VERSION, createDefaultSettings } from '../../src/config.js';
import { MemoryAdapter } from '../../src/storage/MemoryAdapter.js';
import { ENTITY_TYPE } from '../../src/storage/StorageAdapter.js';
import { taskTemplate } from '../fixtures/builders.js';

const FIXED_NOW = new Date('2026-08-08T12:00:00+09:00');

/** 手で解決できる Promise。 */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 初期化済みのアダプターと保存窓口。 */
async function setup() {
  const adapter = new MemoryAdapter();
  await adapter.initialize();
  const persistence = createPersistence(adapter, { now: () => FIXED_NOW });
  return { adapter, persistence };
}

/** テンプレートを1件足す保存計画。 */
function addTemplate(adapter, templateId) {
  return async () => ({
    write: () =>
      adapter.saveEntity(ENTITY_TYPE.TASK_TEMPLATES, taskTemplate({ templateId })),
  });
}

describe('createPersistence', () => {
  describe('run() の直列化', () => {
    it('積んだ順に実行する', async () => {
      const { adapter, persistence } = await setup();
      const order = [];

      const first = persistence.run(async () => {
        order.push('plan-1');
        return {
          write: async () => {
            order.push('write-1');
          },
        };
      });
      const second = persistence.run(async () => {
        order.push('plan-2');
        return {
          write: async () => {
            order.push('write-2');
          },
        };
      });
      await Promise.all([first, second]);

      expect(order).toEqual(['plan-1', 'write-1', 'plan-2', 'write-2']);
      expect(adapter).toBeDefined();
    });

    it('前の操作が失敗しても次は実行する', async () => {
      const { adapter, persistence } = await setup();

      const failure = persistence
        .run(async () => ({
          write: async () => {
            throw new Error('書き込み失敗');
          },
        }))
        .catch((error) => error);
      const success = persistence.run(addTemplate(adapter, 'template-after-failure'));

      expect(await failure).toBeInstanceOf(Error);
      await success;
      expect((await adapter.loadAll()).taskTemplates).toHaveLength(1);
    });
  });

  describe('runExclusive() の排他区間（敵対的レビュー GAR-1）', () => {
    it('区間の途中で積まれた保存は、区間の後に実行される', async () => {
      // 退避JSONを取った後・全置換の前に別の保存が入り込むと、その内容は退避にも
      // 置換後にも残らない。区間を握っているあいだ外の保存を待たせる。
      const { adapter, persistence } = await setup();
      const gate = deferred();
      const order = [];

      const exclusive = persistence.runExclusive(async ({ run }) => {
        order.push('exclusive-start');
        await run(async () => ({
          write: async () => {
            order.push('backup');
          },
        }));
        // 退避の直後、破壊的操作の前に外から保存が積まれる状況を作る。
        await gate.promise;
        await run(async () => ({
          write: async () => {
            order.push('replace');
          },
        }));
        order.push('exclusive-end');
      });

      const interrupting = persistence.run(async () => {
        order.push('interrupting-plan');
        return {
          write: async () => {
            order.push('interrupting-write');
          },
        };
      });

      gate.resolve();
      await Promise.all([exclusive, interrupting]);

      expect(order).toEqual([
        'exclusive-start',
        'backup',
        'replace',
        'exclusive-end',
        'interrupting-plan',
        'interrupting-write',
      ]);
    });

    it('割り込んだ保存は失われず、置換後の内容へ載る', async () => {
      // 退避と全置換の隙間へ積まれた保存が、どちらにも残らないことを防ぐ
      // （反例 ADV-01）。成功したのにどこにも無い書き込みを作らない。
      const { adapter, persistence } = await setup();
      const gate = deferred();
      let backupTemplates = null;

      const replaced = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: '2026-08-08T12:00:00+09:00',
        settings: createDefaultSettings(),
        taskTemplates: [],
        projectGroups: [],
        workRuns: [],
        changeHistory: [],
      };

      const destructive = persistence.runExclusive(async ({ run }) => {
        // 退避（エクスポート相当）。
        await run(async () => ({
          write: async () => {
            const payload = await adapter.exportAll({ exportedAt: '2026-08-08T12:00:00+09:00' });
            backupTemplates = payload.taskTemplates.length;
          },
        }));
        await gate.promise;
        // 全置換。
        await run(async () => ({ write: () => adapter.importAll(replaced) }));
      });

      const interrupting = persistence.run(addTemplate(adapter, 'template-interrupting'));

      gate.resolve();
      await Promise.all([destructive, interrupting]);

      // 退避時点では存在しなかったが、置換後に載っている。
      expect(backupTemplates).toBe(0);
      const { taskTemplates } = await adapter.loadAll();
      expect(taskTemplates.map((template) => template.templateId)).toEqual([
        'template-interrupting',
      ]);
    });

    it('区間内の失敗は呼び出し側へ投げ返す', async () => {
      const { persistence } = await setup();

      const error = await persistence
        .runExclusive(async ({ run }) => {
          await run(async () => ({
            write: async () => {
              throw new Error('退避に失敗');
            },
          }));
          throw new Error('ここへは来ない');
        })
        .catch((caught) => caught);

      expect(error.message).toBe('退避に失敗');
    });

    it('区間が失敗しても後続の保存は動く', async () => {
      const { adapter, persistence } = await setup();

      const failed = persistence
        .runExclusive(async () => {
          throw new Error('区間の失敗');
        })
        .catch((caught) => caught);
      const next = persistence.run(addTemplate(adapter, 'template-next'));

      expect(await failed).toBeInstanceOf(Error);
      await next;
      expect((await adapter.loadAll()).taskTemplates).toHaveLength(1);
    });

    it('区間内の run は最新のデータセットを受け取る', async () => {
      const { adapter, persistence } = await setup();
      await persistence.run(addTemplate(adapter, 'template-existing'));
      const seen = vi.fn();

      await persistence.runExclusive(async ({ run }) => {
        await run(async (dataset) => {
          seen(dataset.taskTemplates.length);
          return { write: async () => {} };
        });
      });

      expect(seen).toHaveBeenCalledWith(1);
    });
  });
});
