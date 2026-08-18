import { describe, expect, it } from 'vitest';

import { assertRunEffortWithinRange } from '../../src/app/actions/taskTarget.js';
import { MAX_EFFORT_SECONDS } from '../../src/config.js';
import { directEntry, taskRecord, workRun } from '../fixtures/builders.js';

function runWithTaskTotals(...totals) {
  return workRun({
    tasks: totals.map((seconds) =>
      taskRecord({ directEntries: [directEntry(seconds)] }),
    ),
  });
}

describe('assertRunEffortWithinRange()', () => {
  it('実施回合計が上限ちょうどなら通す', () => {
    expect(() => assertRunEffortWithinRange(runWithTaskTotals(MAX_EFFORT_SECONDS)))
      .not.toThrow();
  });

  it('各作業項目が上限内でも実施回合計が超えれば拒否する（過去のレビュー指摘）', () => {
    const halfPlusOne = MAX_EFFORT_SECONDS / 2 + 1;
    expect(() => assertRunEffortWithinRange(runWithTaskTotals(halfPlusOne, halfPlusOne)))
      .toThrow(/実施回.*合計工数が上限/);
  });
});
