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
 * 含めるものは {@link CONTENTS} が唯一の正である。除外リストは持たない。新しい
 * 開発時ファイルが増えても、採用リストへ書かない限り配布物へは入らない。
 *
 * ## 成功はZIPができたことと同義にする
 *
 * ZIP は `tools/zip.mjs` が Node だけで書く。外部の圧縮コマンドを呼ばないため、
 * 「コマンドが無いので中断したが終了コードは0」という状態が起こらない。失敗は
 * 例外になり、そのまま非0終了になる。
 *
 * ## マニフェスト
 *
 * `dist/manifest.json` へ、配布物に含めた全ファイルの相対パス・大きさ・SHA-256 を
 * 書く。展開結果との照合に使う（公開チェックリスト4章）。ZIP の中には入れない。
 * 自分自身を記述できないうえ、配布物の中身を変えてしまう。
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createZip, extractZip } from './zip.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'dist');
export const STAGE_NAME = 'parallel-work-time';
export const STAGE_DIR = join(OUT_DIR, STAGE_NAME);
export const ZIP_PATH = join(OUT_DIR, `${STAGE_NAME}.zip`);
export const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');

/** 配布物へ含めるもの。ここに無いものは入らない。 */
export const CONTENTS = [
  'start-local.cmd',
  '_local-server.ps1',
  'local-settings.txt',
  'index.html',
  'src',
  'data',
  'licenses',
  'LICENSE',
  'README.md',
  'manual',
];

/**
 * 配布物のファイルを `dist/parallel-work-time/` へ写す。
 *
 * @returns {string} ステージングディレクトリ
 */
export function stage() {
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
  return STAGE_DIR;
}

/**
 * ディレクトリ配下のファイルを、ZIP のエントリ名（`/` 区切り）で列挙する。
 *
 * @param {string} directory
 * @param {string} prefix ZIP 内の先頭ディレクトリ名
 * @returns {{name: string, path: string}[]}
 */
export function listFiles(directory, prefix = STAGE_NAME) {
  const found = [];
  for (const dirent of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!dirent.isFile()) {
      continue;
    }
    const absolute = join(dirent.parentPath, dirent.name);
    const name = relative(directory, absolute).split(sep).join('/');
    found.push({ name: `${prefix}/${name}`, path: absolute });
  }
  return found.sort(compareFileNames);
}

export function compareFileNames(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * ステージングの内容からマニフェストを作る。
 *
 * @param {{name: string, path: string}[]} files
 */
function buildManifest(files) {
  return {
    name: STAGE_NAME,
    fileCount: files.length,
    files: files.map((file) => {
      return { path: file.name, bytes: file.data.length, sha256: sha256(file.data) };
    }),
  };
}

/**
 * 配布物一式（ステージング・ZIP・マニフェスト）を作る。
 *
 * 書き出したZIPは、その場で中央ディレクトリを読み直して件数と名前を確かめる。
 * 「ZIPファイルはできたが中身が読めない」状態で成功を返さないためである。
 *
 * @returns {{stageDir: string, zipPath: string, fileCount: number, zipSha256: string}}
 */
export function buildDistribution() {
  const stageDir = stage();
  const files = listFiles(stageDir).map((file) => ({
    ...file,
    // manifest と ZIP は同じスナップショットから作り、生成途中の変更を混ぜない。
    data: readFileSync(file.path),
  }));
  if (files.length === 0) {
    throw new Error('配布物に含めるファイルがありません');
  }

  const manifest = buildManifest(files);
  const zip = createZip(files.map((file) => ({ name: file.name, data: file.data })));
  writeFileSync(ZIP_PATH, zip);
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  verifyZip(zip, manifest);

  return {
    stageDir,
    zipPath: ZIP_PATH,
    fileCount: files.length,
    zipSha256: sha256(zip),
  };
}

/**
 * 書き出したZIPがマニフェストと一致することを確かめる。
 *
 * @param {Buffer} zip
 * @param {{fileCount: number, files: {path: string, bytes: number}[]}} manifest
 */
function verifyZip(zip, manifest) {
  const entries = extractZip(zip);
  if (entries.size !== manifest.fileCount) {
    throw new Error(
      `ZIPのエントリ数がマニフェストと一致しません: ${entries.size} / ${manifest.fileCount}`,
    );
  }
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  for (const [name, data] of entries) {
    if (!expected.has(name)) {
      throw new Error(`ZIPにマニフェスト外のエントリがあります: ${name}`);
    }
    const file = expected.get(name);
    if (file.bytes !== data.length || file.sha256 !== sha256(data)) {
      throw new Error(`ZIPのエントリ内容がマニフェストと一致しません: ${name}`);
    }
  }
}

function main() {
  // 段取りだけを求める呼び出し（E2E の配信元づくり）。ZIP を作る費用を払わない。
  if (process.argv.includes('--stage-only')) {
    const stageDir = stage();
    console.log(`配布ファイルを揃えました: ${stageDir}`);
    return;
  }

  const result = buildDistribution();
  console.log(`配布ZIPを作成しました: ${result.zipPath}`);
  console.log(`収録ファイル数: ${result.fileCount}`);
  console.log(`SHA-256: ${result.zipSha256}`);
  console.log(`マニフェスト: ${MANIFEST_PATH}`);
  console.log('Windows 11では、展開後に start-local.cmd をダブルクリックして起動できます。');
  console.log('ポートを変える場合は、起動前に local-settings.txt の数字を変更してください。');
}

// 直接実行されたときだけ組み立てる。試験は関数として呼ぶ。
export function isDirectExecution(argvPath, modulePath = fileURLToPath(import.meta.url)) {
  if (argvPath === undefined) {
    return false;
  }
  return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
}

if (isDirectExecution(process.argv[1])) {
  main();
}
