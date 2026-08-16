/**
 * 配布物の生成契約（仕様書14章、5.1.4、5.1.5、レビュー指摘 F12-02、F12-15、F12-23）。
 *
 * 「dist が成功した」と「有効なZIPができた」を同値にする。ZIP の存在・展開可能性・
 * 中身までをここで確かめ、E2E（`tests/e2e/distribution.spec.js`）は配信して動くこと
 * だけを見る。
 *
 * 収録物の判定は採用リスト（`CONTENTS`）との完全一致で行う。拒否リスト方式だと、
 * 新しい開発時ファイルが増えたときに名前を書き足し忘れて素通りする。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  CONTENT_MAPPINGS,
  CONTENTS,
  INTERNAL_DIR,
  MANUAL_PDF_DESTINATION,
  MANIFEST_PATH,
  ROOT,
  STAGE_DIR,
  STAGE_NAME,
  ZIP_PATH,
  buildDistribution,
  isDirectExecution,
  listFiles,
  sha256,
  stage,
} from '../../tools/build-dist.mjs';
import { createZip, extractZip, readZipEntries } from '../../tools/zip.mjs';

/**
 * 採用リスト配下でGitが管理しているファイルを、ZIPと同じ並びで返す。
 *
 * 期待値をここへ書き写さない。書き写すと、`src/` へファイルを1つ足すたびに
 * 試験も直すことになり、やがて「落ちたら期待値を合わせる」運用になる。
 *
 * @returns {string[]} リポジトリルートからの相対パス（`/` 区切り、名前順）
 */
function trackedSourceFiles() {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...CONTENTS], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return listed.split('\0').filter((line) => line !== '').sort();
}

function distributionPath(sourcePath) {
  const mapping = CONTENT_MAPPINGS.find(
    ({ source }) => sourcePath === source || sourcePath.startsWith(`${source}/`),
  );
  if (mapping === undefined) {
    throw new Error(`配布先が定義されていません: ${sourcePath}`);
  }
  return `${mapping.destination}${sourcePath.slice(mapping.source.length)}`;
}

function trackedFiles() {
  return trackedSourceFiles().map(distributionPath).sort();
}

function generatedFiles() {
  return CONTENT_MAPPINGS
    .filter(({ generated }) => generated === true)
    .map(({ destination }) => destination)
    .sort();
}

function localTargets(markdownPath) {
  const markdown = readFileSync(markdownPath, 'utf8');
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => target !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .map((target) => resolve(dirname(markdownPath), decodeURIComponent(target)));
}

describe('配布物の組み立て', () => {
  /** @type {{fileCount: number, zipSha256: string}} */
  let result;
  /** @type {Buffer} */
  let zip;
  /** @type {{fileCount: number, files: {path: string, bytes: number, sha256: string}[]}} */
  let manifest;

  // 取扱説明書PDFの生成（Chromium起動）を含むため、既定の10秒では足りない。
  beforeAll(() => {
    result = buildDistribution();
    zip = readFileSync(ZIP_PATH);
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  }, 120_000);

  it('ZIPとマニフェストを作る', () => {
    expect(existsSync(ZIP_PATH)).toBe(true);
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.zipSha256).toBe(sha256(zip));
  });

  it('収録するのは採用リストのものだけである（F12-15）', () => {
    // 除外すべきものを列挙するのではなく、置いたものが採用リストと一致することを
    // 断定する。新しい開発時ファイルが増えても自動的に落ちる。
    const rootEntries = CONTENT_MAPPINGS.map(({ destination }) => destination.split('/')[0]);
    expect(readdirSync(STAGE_DIR).sort()).toEqual([...new Set(rootEntries)].sort());
  });

  it('採用ディレクトリの配下まで、Git管理下のファイルと一致する（F12-31）', () => {
    // 直下の一致だけでは、`src/` や `data/` の中へ紛れたファイルを見つけられない。
    // 「配布物 = Git管理下の採用リスト配下」を断定すれば、作業ツリーに残った
    // エクスポートJSONや編集中の一時ファイルが混入した時点で落ちる。
    const tracked = trackedFiles();
    const staged = listFiles(STAGE_DIR).map((file) =>
      file.name.slice(`${STAGE_NAME}/`.length),
    );

    expect(staged).toEqual([...tracked, ...generatedFiles()].sort());
  });

  it('移動したファイルの内容は配布元と同一である', () => {
    for (const sourcePath of trackedSourceFiles()) {
      const stagedPath = join(STAGE_DIR, ...distributionPath(sourcePath).split('/'));
      expect(
        readFileSync(stagedPath).equals(readFileSync(join(ROOT, sourcePath))),
        `${sourcePath} の内容が移動時に変わった`,
      ).toBe(true);
    }
  });

  it('配布READMEの相対リンクは配布後の位置で機能する', () => {
    const readme = join(STAGE_DIR, 'README.md');
    const missing = localTargets(readme).filter((target) => !existsSync(target));

    expect(missing).toEqual([]);
  });

  it('ルート直下にPDFの取扱説明書を収録する', () => {
    const manual = readFileSync(join(STAGE_DIR, MANUAL_PDF_DESTINATION));

    expect(manual.subarray(0, 5).toString()).toBe('%PDF-');
    expect(manual.length).toBeGreaterThan(50_000);
  });

  it('配布READMEは利用者向け情報を先に示し、開発手順を含めない', () => {
    const readme = readFileSync(join(STAGE_DIR, 'README.md'), 'utf8');
    const headings = [
      '## まずはここだけ',
      '## 説明書',
      '## データを失わないために',
      '## ポート番号を変更する場合',
      '## 動作環境',
      '## フォルダーについて',
    ];
    const positions = headings.map((heading) => readme.indexOf(heading));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(readme).not.toContain('## 開発環境');
    expect(readme).not.toContain('## テスト');
    expect(readme).not.toContain('npm run');
  });

  it('展開すると全ファイルがマニフェストと一致する（F12-23）', () => {
    const extracted = extractZip(zip);

    expect(extracted.size).toBe(manifest.fileCount);
    for (const file of manifest.files) {
      const data = extracted.get(file.path);
      expect(data, `${file.path} が展開結果に無い`).toBeDefined();
      expect(data.length).toBe(file.bytes);
      expect(sha256(data)).toBe(file.sha256);
    }
  });

  it('マニフェストはステージングの実体と一致する', () => {
    const staged = listFiles(STAGE_DIR);

    expect(staged.map((file) => file.name)).toEqual(manifest.files.map((file) => file.path));
    for (const file of staged) {
      const entry = manifest.files.find((candidate) => candidate.path === file.name);
      expect(entry.sha256).toBe(sha256(readFileSync(file.path)));
    }
  });

  it('ZIP内のパス区切りはスラッシュで、先頭ディレクトリは1つである（F12-10）', () => {
    const names = readZipEntries(zip).map((entry) => entry.name);

    expect(names.every((name) => !name.includes('\\'))).toBe(true);
    expect(new Set(names.map((name) => name.split('/')[0]))).toEqual(new Set([STAGE_NAME]));
  });

  it('同じ入力からは同じバイト列を作る', () => {
    const again = buildDistribution();

    expect(again.zipSha256).toBe(result.zipSha256);
  });

});

describe('段取りのみの実行（F12-23）', () => {
  it('stage() はZIPを作らずに配信できる状態を作る', () => {
    stage();

    expect(existsSync(join(STAGE_DIR, INTERNAL_DIR, 'index.html'))).toBe(true);
    expect(existsSync(ZIP_PATH)).toBe(false);
  });
});

describe('直接実行の判定（F12-39）', () => {
  it.runIf(process.platform === 'win32')('junction 経由のスクリプトも直接実行と判定する', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'pwt-dist-junction-'));
    const junction = join(temporary, 'repository');
    try {
      symlinkSync(ROOT, junction, 'junction');
      expect(
        isDirectExecution(
          join(junction, 'tools', 'build-dist.mjs'),
          join(ROOT, 'tools', 'build-dist.mjs'),
        ),
      ).toBe(true);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

describe('ZIPの書き出し', () => {
  it('展開先の外へ出るエントリ名を拒む', () => {
    expect(() => createZip([{ name: '../escape.txt', data: Buffer.from('x') }])).toThrow();
    expect(() => createZip([{ name: '/absolute.txt', data: Buffer.from('x') }])).toThrow();
    expect(() => createZip([{ name: '', data: Buffer.from('x') }])).toThrow();
  });

  it('壊れたZIPは展開時に気づく', () => {
    const original = createZip([{ name: 'dir/a.txt', data: Buffer.from('こんにちは'.repeat(50)) }]);
    const broken = Buffer.from(original);
    // 圧縮データの先頭を書き換える。CRC-32 の検算で捕まる。
    broken[40] ^= 0xff;

    expect(() => extractZip(broken)).toThrow();
  });

  it('圧縮しても大きくなる入力は無圧縮で入れる', () => {
    const tiny = createZip([{ name: 'dir/a.txt', data: Buffer.from('a') }]);

    expect(extractZip(tiny).get('dir/a.txt').toString()).toBe('a');
  });

  it('空のZIPも読み書きできる', () => {
    expect(readZipEntries(createZip([]))).toEqual([]);
  });
});
