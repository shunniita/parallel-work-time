/**
 * 利用者向けMarkdown説明書を、目次と章内リンクを持つ1冊のPDFへ変換する。
 *
 * Markdownは原本のまま残す。PowerShell 7標準の ConvertFrom-Markdown でHTMLへ
 * 変換し、既存のPlaywright/Chromiumで印刷するため、利用者側の実行環境には
 * 依存を増やさない。
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANUAL_DIR = join(ROOT, 'manual');
export const OUTPUT_DIR = join(ROOT, 'output', 'pdf');
export const OUTPUT_PDF = join(OUTPUT_DIR, 'parallel-work-time-manual.pdf');
export const TEMP_DIR = join(ROOT, 'tmp', 'pdfs');
export const TEMP_HTML = join(TEMP_DIR, 'parallel-work-time-manual.html');

export const DOCUMENTS = [
  { file: 'README.md', label: '説明書の入口' },
  { file: '01-getting-started.md', label: '1. はじめに' },
  { file: '02-guide.md', label: '2. 操作ガイド' },
  { file: '03-screens.md', label: '3. 画面リファレンス' },
  { file: '04-faq.md', label: '4. トラブルとFAQ' },
  { file: '05-browser-smoke-checklist.md', label: '5. ブラウザー動作確認' },
];

function documentId(file) {
  return `doc-${basename(file, '.md').toLowerCase()}`;
}

/** GitHub風の見出し断片。既存Markdownのリンク先を明示アンカーへ対応させる。 */
export function headingSlug(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}\-_]/gu, '');
}

export function collectHeadingAnchors(markdown, file) {
  const bySlug = new Map();
  const sequence = [];
  let index = 0;
  for (const match of markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    index += 1;
    const anchor = `${documentId(file)}-h${index}`;
    const slug = headingSlug(match[2]);
    if (!bySlug.has(slug)) {
      bySlug.set(slug, anchor);
    }
    sequence.push(anchor);
  }
  return { bySlug, sequence };
}

/**
 * 複数ファイルを結合してもリンクが働くよう、文書と見出しへ固有アンカーを振る。
 */
export function prepareMarkdown(markdown, file, anchorsByFile = new Map()) {
  const id = documentId(file);
  const currentAnchors = anchorsByFile.get(basename(file)) ?? collectHeadingAnchors(markdown, file);
  let headingIndex = 0;
  let prepared = markdown.replace(/^(#{1,6})\s+(.+)$/gm, (_line, hashes, heading) => {
    const anchor = currentAnchors.sequence[headingIndex];
    headingIndex += 1;
    return `<a id="${anchor}"></a>\n${hashes} ${heading}`;
  });

  prepared = prepared.replace(/\(([^)#]+\.md)(#[^)]+)?\)/g, (_match, target, fragment = '') => {
    const targetFile = basename(target);
    const targetId = documentId(targetFile);
    if (fragment === '') {
      return `(#${targetId})`;
    }
    const targetAnchor = anchorsByFile
      .get(targetFile)
      ?.bySlug.get(headingSlug(decodeURIComponent(fragment.slice(1))));
    return `(#${targetAnchor ?? targetId})`;
  });
  prepared = prepared.replace(/\(#([^)]+)\)/g, (_match, fragment) => {
    if (fragment.startsWith('doc-')) {
      return `(#${fragment})`;
    }
    return `(#${currentAnchors.bySlug.get(headingSlug(decodeURIComponent(fragment))) ?? id})`;
  });

  return `<a id="${id}"></a>\n${prepared}`;
}

function convertMarkdown(inputPath, outputPath) {
  execFileSync(
    'pwsh',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(ROOT, 'tools', 'convert-markdown.ps1'),
      '-InputPath',
      inputPath,
      '-OutputPath',
      outputPath,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

function fileUrl(path) {
  return pathToFileURL(path).href;
}

function manualHtml(chapters) {
  const toc = DOCUMENTS.map(
    ({ file, label }) => `<li><a href="#${documentId(file)}">${label}</a></li>`,
  ).join('\n');
  const imagesUrl = `${fileUrl(join(MANUAL_DIR, 'images'))}/`;
  const body = chapters
    .map(({ file, html }) => {
      const withImages = html.replaceAll('src="images/', `src="${imagesUrl}`);
      return `<section class="chapter chapter--${documentId(file)}">${withImages}</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>同時並行作業時間計測支援ツール 取扱説明書</title>
  <style>
    @page { size: A4; margin: 22mm 17mm 20mm; }
    * { box-sizing: border-box; }
    html { font-size: 10.5pt; }
    body {
      margin: 0;
      color: #172033;
      font-family: "BIZ UDPGothic", "Yu Gothic", "Noto Sans CJK JP", sans-serif;
      line-height: 1.75;
      overflow-wrap: anywhere;
    }
    a { color: #1f5ca8; text-decoration: none; }
    h1, h2, h3 { color: #102a56; line-height: 1.35; break-after: avoid; }
    h1 { margin: 0 0 8mm; padding-bottom: 3mm; border-bottom: 2px solid #2b64a3; font-size: 22pt; }
    h2 { margin: 9mm 0 3mm; font-size: 16pt; }
    h3 { margin: 6mm 0 2mm; font-size: 12.5pt; }
    p, ul, ol, table, blockquote, pre { margin: 0 0 4mm; }
    li { margin: 1.2mm 0; }
    code { font-family: Consolas, "BIZ UDGothic", monospace; font-size: 0.92em; }
    pre { padding: 4mm; border: 1px solid #ccd5e2; border-radius: 2mm; background: #f4f7fb; white-space: pre-wrap; }
    blockquote { margin-left: 0; padding: 3mm 4mm; border-left: 4px solid #d39b22; background: #fff7df; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; font-size: 9.2pt; break-inside: avoid; }
    th, td { padding: 2.2mm 2.5mm; border: 1px solid #b9c4d2; vertical-align: top; }
    th { background: #eaf0f8; text-align: left; }
    img { display: block; max-width: 100%; max-height: 205mm; margin: 4mm auto 6mm; object-fit: contain; break-inside: avoid; }
    hr { margin: 10mm 0; border: 0; border-top: 1px solid #b9c4d2; }
    .cover { min-height: 230mm; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; }
    .cover h1 { border: 0; font-size: 25pt; }
    .cover p { color: #526075; font-size: 12pt; }
    .toc { break-after: page; }
    .toc ol { padding-left: 7mm; font-size: 12pt; }
    .toc li { margin: 3mm 0; }
    .chapter { break-before: page; }
    .chapter--doc-readme { break-before: auto; }
    .chapter--doc-readme > h1:first-of-type { display: none; }
    .chapter a[id] { display: block; position: relative; top: -4mm; visibility: hidden; }
  </style>
</head>
<body>
  <section class="cover">
    <h1>同時並行作業時間計測支援ツール</h1>
    <p>取扱説明書</p>
    <p>対象バージョン: v0.1.0</p>
  </section>
  <nav class="toc">
    <h1>目次</h1>
    <ol>${toc}</ol>
  </nav>
  ${body}
</body>
</html>`;
}

function normalizePdfDates(path) {
  const original = readFileSync(path);
  const latin1 = original.toString('latin1');
  const normalized = latin1.replace(
    /D:\d{14}[+-]\d{2}'\d{2}'/g,
    "D:20000101000000+00'00'",
  );
  writeFileSync(path, Buffer.from(normalized, 'latin1'));
}

export async function buildManualPdf() {
  rmSync(TEMP_DIR, { recursive: true, force: true });
  mkdirSync(TEMP_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const anchorsByFile = new Map(
    DOCUMENTS.map(({ file }) => {
      const markdown = readFileSync(join(MANUAL_DIR, file), 'utf8');
      return [file, collectHeadingAnchors(markdown, file)];
    }),
  );
  const chapters = [];
  for (const document of DOCUMENTS) {
    const source = join(MANUAL_DIR, document.file);
    const stem = basename(document.file, '.md');
    const preparedPath = join(TEMP_DIR, `${stem}.md`);
    const fragmentPath = join(TEMP_DIR, `${stem}.html`);
    writeFileSync(
      preparedPath,
      prepareMarkdown(readFileSync(source, 'utf8'), document.file, anchorsByFile),
    );
    convertMarkdown(preparedPath, fragmentPath);
    chapters.push({ file: document.file, html: readFileSync(fragmentPath, 'utf8') });
  }

  writeFileSync(TEMP_HTML, manualHtml(chapters));

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(fileUrl(TEMP_HTML), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: OUTPUT_PDF,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="width:100%;font-size:8px;color:#657086;text-align:center;">' +
        '同時並行作業時間計測支援ツール 取扱説明書</div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#657086;text-align:center;">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '22mm', right: '17mm', bottom: '20mm', left: '17mm' },
      outline: true,
      tagged: true,
    });
  } finally {
    await browser.close();
  }

  normalizePdfDates(OUTPUT_PDF);
  const pdf = readFileSync(OUTPUT_PDF);
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || pdf.length < 50_000) {
    throw new Error('生成した取扱説明書PDFが正しい形式または大きさではありません');
  }
  console.log(`取扱説明書PDFを作成しました: ${relative(ROOT, OUTPUT_PDF)}`);
  console.log(`ページ確認用HTML: ${relative(ROOT, TEMP_HTML)}`);
  return OUTPUT_PDF;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildManualPdf();
}
