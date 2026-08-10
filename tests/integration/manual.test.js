/** 利用者向け説明書のリンクと画像が配布前に壊れていないことを確かめる。 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const MANUAL_DIR = join(ROOT, 'manual');
const DOCUMENTS = [
  join(ROOT, 'README.md'),
  ...readdirSync(MANUAL_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(MANUAL_DIR, name)),
];

function localTargets(markdownPath) {
  const markdown = readFileSync(markdownPath, 'utf8');
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => target !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .map((target) => resolve(dirname(markdownPath), decodeURIComponent(target)));
}

describe('利用者向け説明書', () => {
  it('開発READMEでも利用者向けの保存案内を開発情報より先に示す', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

    expect(readme.indexOf('## 説明書')).toBeLessThan(readme.indexOf('## データの保存'));
    expect(readme.indexOf('## データの保存')).toBeLessThan(
      readme.indexOf('## 開発者向け情報'),
    );
  });

  it('相対リンクと画像の参照先が存在する', () => {
    const missing = DOCUMENTS.flatMap((document) =>
      localTargets(document)
        .filter((target) => !existsSync(target))
        .map((target) => `${document}: ${target}`),
    );

    expect(missing).toEqual([]);
  });

  it('掲載画像が空ファイルではない', () => {
    const images = readdirSync(join(MANUAL_DIR, 'images'))
      .filter((name) => name.endsWith('.png'))
      .map((name) => join(MANUAL_DIR, 'images', name));
    const referencedImages = new Set(
      DOCUMENTS.flatMap(localTargets).filter((target) => target.endsWith('.png')),
    );

    expect(images.length).toBeGreaterThan(0);
    expect(images.filter((image) => statSync(image).size === 0)).toEqual([]);
    expect(images.filter((image) => !referencedImages.has(image))).toEqual([]);
  });
});
