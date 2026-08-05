/**
 * 配布するソースに紛れ込んではいけない文字の検査。
 *
 * Step 7 で `directEntryOps.js` の文字列リテラルへ NUL バイトが1個入り込み、
 * Git がファイルをバイナリと判定して差分を出さなくなっていた（レビュー指摘
 * S7-3）。NUL はエディタ上でも空白に見え、テストも普通に通るため、混入しても
 * 誰も気づけない。機械的に見張る。
 *
 * 対象は配布物に入るファイル（`index.html` と `src/`、実装計画4.3）に絞る。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** 混入すると差分が読めなくなる、あるいは表示が壊れる文字。 */
const FORBIDDEN = [
  { name: 'NUL', code: 0x00 },
  { name: 'BS', code: 0x08 },
  { name: 'VT', code: 0x0b },
  { name: 'FF', code: 0x0c },
  { name: 'ESC', code: 0x1b },
];

/**
 * ディレクトリ配下のファイルを再帰的に集める。
 *
 * @param {string} dir
 * @param {(name: string) => boolean} accept
 * @returns {string[]}
 */
function collect(dir, accept) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return collect(path, accept);
    }
    return accept(name) ? [path] : [];
  });
}

const files = [
  'index.html',
  ...collect('src', (name) => /\.(js|css|html)$/.test(name)),
];

describe('配布ソースの文字', () => {
  it('検査対象を取りこぼしていない', () => {
    // 集め方を間違えて0件になっても気づけるようにする。
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(join('src', 'domain', 'directEntryOps.js'));
  });

  it.each(FORBIDDEN)('制御文字 $name を含まない', ({ code }) => {
    const character = String.fromCharCode(code);
    const offenders = files.filter((path) => readFileSync(path, 'utf8').includes(character));

    expect(offenders).toEqual([]);
  });
});
