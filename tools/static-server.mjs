/**
 * 開発・テスト用の静的配信サーバー。
 *
 * 仕様書5.1.3 は HTTP または HTTPS での配信を前提とし、`file://` を動作保証外と
 * する。E2E も手元確認も、このサーバー経由で行う。
 *
 * Node の標準モジュールのみで書く。配布物には含めない（実装計画4.3）ため、
 * アプリ本体の「外部依存禁止」（仕様書5.1.4）とは別枠の開発時ツールである。
 *
 *   node tools/static-server.mjs [--port 4173] [--root .]
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  }),
);

function parseArgs(argv) {
  const options = { port: Number(process.env.PORT ?? 4173), root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port' && argv[index + 1] !== undefined) {
      options.port = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--root' && argv[index + 1] !== undefined) {
      options.root = resolve(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

/**
 * 要求URLからパス部分を取り出してデコードする。
 *
 * `/%` のような不正シーケンスで `decodeURIComponent` は `URIError` を投げる。
 * async ハンドラ内で素通しすると unhandled rejection になりプロセスごと落ちる
 * （E2E 実行中なら残り全部が巻き添えになる）ため、ここで捕まえて 400 に落とす。
 *
 * @param {string} urlPath
 * @returns {string|null} URLエンコードが不正な場合は null
 */
function decodeUrlPath(urlPath) {
  try {
    return decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
}

/**
 * デコード済みのパスをルート配下の実ファイルへ解決する。
 *
 * `..` を含む要求でルート外へ出られないよう、正規化後の絶対パスがルートで
 * 始まることを確認する。
 *
 * @param {string} root
 * @param {string} decodedPath
 * @returns {string|null} ルート外を指す場合は null
 */
function resolveWithinRoot(root, decodedPath) {
  const relative = normalize(decodedPath).replace(/^([/\\])+/, '');
  const absolute = resolve(join(root, relative));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    return null;
  }
  return absolute;
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    // 開発中に古いモジュールが残らないようにする。
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

export function createStaticServer(root) {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'GET と HEAD のみ対応する');
      return;
    }

    const decodedPath = decodeUrlPath(request.url ?? '/');
    if (decodedPath === null) {
      send(response, 400, 'URLのエンコードが不正');
      return;
    }

    const target = resolveWithinRoot(root, decodedPath);
    if (target === null) {
      send(response, 403, 'ルート外は配信しない');
      return;
    }

    let filePath = target;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        filePath = join(filePath, 'index.html');
        await stat(filePath);
      }
    } catch {
      send(response, 404, `見つからない: ${request.url}`);
      return;
    }

    const contentType = MIME_TYPES.get(extname(filePath).toLowerCase());
    if (contentType === undefined) {
      // 未知の拡張子は配信しない。取り違えて実行されるより明確に失敗させる。
      send(response, 415, `配信対象外の拡張子: ${extname(filePath)}`);
      return;
    }

    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  });
}

// 直接起動されたときだけ待ち受ける。読み込むだけでポートを掴むと、
// `createStaticServer` を単体テストから使えない。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port, root } = parseArgs(process.argv.slice(2));
  const server = createStaticServer(root);
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`静的配信を開始した: http://127.0.0.1:${port}/ （root: ${root}）\n`);
  });
}
