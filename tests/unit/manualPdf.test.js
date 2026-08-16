import { describe, expect, it } from 'vitest';

import {
  collectHeadingAnchors,
  headingSlug,
  prepareMarkdown,
} from '../../tools/build-manual.mjs';

describe('取扱説明書PDFのMarkdown前処理', () => {
  it('日本語見出しをリンク照合用の断片へ変換する', () => {
    expect(headingSlug('start-local.cmdで起動できない')).toBe(
      'start-localcmdで起動できない',
    );
    expect(headingSlug('9. バックアップを取る')).toBe('9-バックアップを取る');
  });

  it('PDF内部の見出しIDには短いASCIIだけを使う', () => {
    const markdown = '# トラブルとFAQ\n\n## 起動できない\n';
    const anchors = new Map([
      ['04-faq.md', collectHeadingAnchors(markdown, '04-faq.md')],
    ]);

    const prepared = prepareMarkdown(markdown, '04-faq.md', anchors);

    expect(prepared).toContain('<a id="doc-04-faq-h1"></a>');
    expect(prepared).toContain('<a id="doc-04-faq-h2"></a>');
    expect(prepared).not.toMatch(/id="[^"]*[ぁ-んァ-ヶ一-龠]/);
  });

  it('別ファイルの見出しリンクを対応するASCII IDへつなぐ', () => {
    const source = '# はじめに\n\n[起動できない場合](04-faq.md#起動できない)\n';
    const target = '# FAQ\n\n## 起動できない\n';
    const anchors = new Map([
      ['01-getting-started.md', collectHeadingAnchors(source, '01-getting-started.md')],
      ['04-faq.md', collectHeadingAnchors(target, '04-faq.md')],
    ]);

    expect(prepareMarkdown(source, '01-getting-started.md', anchors)).toContain(
      '[起動できない場合](#doc-04-faq-h2)',
    );
  });
});
