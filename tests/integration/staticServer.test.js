/**
 * 開発・テスト用の静的配信サーバーの配信境界。
 *
 * 配布物には含まれない開発時ツールだが（`tools/static-server.mjs`）、E2Eも手元
 * 確認もこのサーバー越しに行う。ルート外を配信しないことは、テストがテスト自身の
 * 前提として頼っている性質である。
 *
 * 実際に待ち受けて HTTP で叩く。`resolveWithinRoot` を直接呼ぶ形にすると、
 * 「関数は null を返すが応答は 200」のような繋ぎ間違いを見逃す。
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStaticServer } from '../../tools/static-server.mjs';

/**
 * 木の作り。ルートを基準ディレクトリの1段下へ置く。
 *
 * ```text
 * base/
 * ├─ secret.html   ← ルート外。`/../secret.html` がちょうど届く位置
 * └─ public/       ← 配信ルート
 *    └─ index.html
 * ```
 *
 * ルートを一時ディレクトリ直下にすると、`..` の指す先に何も無いため、ガードが
 * 無くても404になる。それでは境界を確かめたことにならない。
 */
let base;
let root;
let server;

/**
 * パスをそのまま送る。
 *
 * `fetch()` へ相対パスを渡すと `new URL()` が `..` を解決してしまい、サーバーへ
 * 届く前に traversal が消える。生のパスを載せるため、行を組み立てて送る。
 */
async function request(rawPath) {
  const { connect } = await import('node:net');
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = connect(server.address().port, '127.0.0.1', () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      raw += chunk;
    });
    socket.on('end', () => {
      const status = Number(raw.slice(9, 12));
      const body = raw.slice(raw.indexOf('\r\n\r\n') + 4);
      resolveRequest({ status, body });
    });
    socket.on('error', rejectRequest);
  });
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'pwt-static-'));
  root = join(base, 'public');
  mkdirSync(root);
  // 目印は応答本文と紛れない語にする。拒否時の文言（「ルート外は配信しない」）を
  // 判定に使うと、正しく拒否できていても本文に語が現れて取り違える。
  writeFileSync(join(root, 'index.html'), '<!doctype html>SERVED-FROM-ROOT', 'utf8');
  writeFileSync(join(base, 'secret.html'), '<!doctype html>SECRET-PAYLOAD', 'utf8');

  server = createStaticServer(root);
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
});

afterAll(async () => {
  await new Promise((closed) => server.close(closed));
  rmSync(base, { recursive: true, force: true });
});

describe('静的配信サーバーの配信境界', () => {
  it('ルート直下のファイルを配信する', async () => {
    const response = await request('/index.html');

    expect(response.status).toBe(200);
    expect(response.body).toContain('SERVED-FROM-ROOT');
  });

  it('ディレクトリ要求は index.html を返す', async () => {
    expect((await request('/')).body).toContain('SERVED-FROM-ROOT');
  });

  it('`..` でルート外へ出られない', async () => {
    const response = await request('/../secret.html');

    expect(response.status).not.toBe(200);
    expect(response.body).not.toContain('SECRET-PAYLOAD');
  });

  it('エンコードした `..` でもルート外へ出られない', async () => {
    const response = await request('/%2e%2e/%2e%2e/etc/passwd');

    expect(response.status).not.toBe(200);
  });

  it('先頭の連続した区切りを削ってもルート外へ出られない', async () => {
    expect((await request('//../secret.html')).status).not.toBe(200);
  });

  it('未知の拡張子は配信しない', async () => {
    writeFileSync(join(root, 'note.bin'), 'binary', 'utf8');

    expect((await request('/note.bin')).status).toBe(415);
  });

  it('GET と HEAD 以外を拒否する', async () => {
    const { connect } = await import('node:net');
    const status = await new Promise((resolveStatus) => {
      const socket = connect(server.address().port, '127.0.0.1', () => {
        socket.write('POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
      });
      let raw = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        raw += chunk;
      });
      socket.on('end', () => resolveStatus(Number(raw.slice(9, 12))));
    });

    expect(status).toBe(405);
  });

  /**
   * リンクの実体がルート外を指す場合。
   *
   * パス文字列の上ではルート配下に見えるため、実体を確かめない実装は素通しする。
   *
   * ジャンクションで張る。Windows でファイルのシンボリックリンクを作るには開発者
   * モードか管理者権限が要り、通常の実行では `EPERM` になる。ジャンクションなら
   * 権限なしで作れて、実体の解決も同じ経路を通る。POSIX では型指定が無視され、
   * 通常のシンボリックリンクになる。
   */
  it('ルート内のリンクからルート外の実体を読めない', async () => {
    const outside = join(base, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.html'), '<!doctype html>SECRET-PAYLOAD', 'utf8');
    // 作れない環境があれば、黙って通さずここで気づけるようにする。境界の検査が
    // 実行されないまま緑になるのは、検査が無いのと変わらない。
    symlinkSync(outside, join(root, 'escape'), 'junction');

    const response = await request('/escape/secret.html');

    expect(response.status).toBe(403);
    expect(response.body).not.toContain('SECRET-PAYLOAD');
  });
});
