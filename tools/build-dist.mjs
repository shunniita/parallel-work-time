/**
 * 配布ZIPを組み立てる（仕様書14章、5.1.5）。
 *
 * ビルド工程は持たない。実行時に必要なファイルを選んで写し、ZIPへまとめるだけ
 * である。変換も最小化もしないので、展開した中身はリポジトリのものと同一になる。
 *
 * ## 開発時ツールを入れない
 *
 * `tools/`、`tests/`、`docs/`、`node_modules/`、`package.json` は含めない。
 * 実行時の依存を増やさない方針（5.1.4）に対して、配布物へ開発時の依存が紛れると
 * 「何が要るのか」が読み取れなくなる。
 *
 * ## ZIP は Node の標準機能だけで作らない
 *
 * Node に ZIP 圧縮の標準APIは無い。外部ライブラリを足さずに済ませるため、OS の
 * 標準機能（Windows は PowerShell の `Compress-Archive`、その他は `zip`）を使う。
 * 見つからない場合は、写したディレクトリだけを残して手順を案内する。
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'dist');
const STAGE_NAME = 'parallel-work-time';
const STAGE_DIR = join(OUT_DIR, STAGE_NAME);
const ZIP_PATH = join(OUT_DIR, `${STAGE_NAME}.zip`);

/** 配布物へ含めるもの。ここに無いものは入らない。 */
const CONTENTS = ['index.html', 'src', 'data', 'licenses', 'LICENSE', 'README.md'];

function stage() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });

  const missing = [];
  for (const entry of CONTENTS) {
    const from = join(ROOT, entry);
    if (!existsSync(from)) {
      missing.push(entry);
      continue;
    }
    cpSync(from, join(STAGE_DIR, entry), { recursive: true });
  }
  if (missing.length > 0) {
    throw new Error(`配布物に必要なファイルが見つかりません: ${missing.join(', ')}`);
  }
}

/**
 * ZIP へまとめる。
 *
 * @returns {boolean} 圧縮できたか
 */
function compress() {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${STAGE_DIR}' -DestinationPath '${ZIP_PATH}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    return result.status === 0;
  }
  const result = spawnSync('zip', ['-rq', ZIP_PATH, STAGE_NAME], {
    cwd: OUT_DIR,
    stdio: 'inherit',
  });
  return result.status === 0;
}

stage();
if (compress()) {
  console.log(`配布ZIPを作成しました: ${ZIP_PATH}`);
} else {
  console.log(
    `ファイルは ${STAGE_DIR} へ揃えました。` +
      'ZIP 圧縮コマンドが見つからないため、このディレクトリを手元の方法で圧縮してください。',
  );
}
console.log(
  '展開後は file:// で開かず、静的配信サーバーで配信してください（仕様書5.1.3）。',
);
