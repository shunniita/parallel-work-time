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

  it('インラインHTMLを除いた語で断片を作る', () => {
    expect(headingSlug('<b>太字</b>の見出し')).toBe('太字の見出し');
  });

  // 入れ子や閉じ損ないでは、タグ名の一部が語として断片へ残ることがある。断片は
  // 見出しを引き当てるための照合キーなので、語が濁ること自体は許容する。保証する
  // のは記号を持ち出さないことだけで、それは最後の絞り込みが担う。
  it('崩れたタグを与えても断片へ記号を持ち出さない', () => {
    expect(headingSlug('<<b>b>見出し')).toBe('b見出し');
    expect(headingSlug('<script>alert(1)</script>見出し')).toBe('alert1見出し');
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
