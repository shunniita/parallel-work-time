/**
 * Windows向けローカル起動機能の配布契約（仕様書5.1.3、5.1.5）。
 *
 * 開発用のNodeサーバーで代用せず、Windows 11に標準搭載される
 * Windows PowerShell 5.1とCMDを実際に起動して確かめる。
 */

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WINDOWS_ROOT = process.env.SystemRoot ?? String.raw`C:\Windows`;
const POWERSHELL = join(
  WINDOWS_ROOT,
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const CMD = join(WINDOWS_ROOT, 'System32', 'cmd.exe');
const READY = /PWT_SERVER_READY (http:\/\/127\.0\.0\.1:\d+\/)/;

function waitForExit(child, timeout = 5000) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error('プロセスが終了しませんでした')), timeout);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

function waitForMarker(child, pattern, timeout = 10000) {
  return new Promise((resolveMarker, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`起動メッセージを確認できませんでした: ${output}`));
    }, timeout);

    const receive = (chunk) => {
      output += chunk.toString('utf8');
      const match = output.match(pattern);
      if (match !== null) {
        clearTimeout(timer);
        resolveMarker({ match, output });
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!pattern.test(output)) {
        clearTimeout(timer);
        reject(new Error(`起動前に終了しました (${code}): ${output}`));
      }
    });
  });
}

async function startPowerShellServer(root, ...extraArgs) {
  const child = spawn(
    POWERSHELL,
    [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(root, '_local-server.ps1'),
      '-NoBrowser',
      ...extraArgs,
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const { match } = await waitForMarker(child, READY);
  return { child, url: match[1] };
}

function rawRequest(port, request) {
  return new Promise((resolveResponse, reject) => {
    let response = '';
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.write(request));
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      response += chunk;
    });
    socket.on('end', () => resolveResponse(response));
    socket.on('error', reject);
  });
}

describe.runIf(process.platform === 'win32')('Windowsローカル起動機能', () => {
  let tempRoot;
  let appRoot;
  let running;

  beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pwt-launcher-'));
    appRoot = join(tempRoot, '日本語 を含む配布フォルダー');
    mkdirSync(appRoot);
    copyFileSync(join(ROOT, 'start-local.cmd'), join(appRoot, 'start-local.cmd'));
    copyFileSync(join(ROOT, '_local-server.ps1'), join(appRoot, '_local-server.ps1'));
    writeFileSync(join(appRoot, 'index.html'), '<!doctype html><title>配布テスト</title>');
    writeFileSync(join(appRoot, 'app.js'), 'export const ready = true;');
    writeFileSync(join(appRoot, 'data.json'), '{"ready":true}');
    writeFileSync(join(appRoot, 'manual.md'), '# manual');
    writeFileSync(join(appRoot, 'blocked.exe'), 'not executable');
    writeFileSync(join(tempRoot, 'secret.txt'), 'outside root');
    running = await startPowerShellServer(appRoot, '-Port', '0');
  }, 15000);

  afterAll(async () => {
    if (running?.child.exitCode === null) {
      running.child.kill();
      await waitForExit(running.child).catch(() => undefined);
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('日本語・空白を含む場所から既知の形式だけをGET/HEADで配信する', async () => {
    const html = await fetch(running.url);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await html.text()).toContain('配布テスト');

    const script = await fetch(new URL('app.js', running.url));
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const markdown = await fetch(new URL('manual.md', running.url));
    expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8');

    const head = await fetch(new URL('data.json', running.url), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
    expect(await head.text()).toBe('');
  });

  it('配布フォルダー外・未知の形式・GET/HEAD以外を拒否する', async () => {
    const port = Number(new URL(running.url).port);
    const traversal = await rawRequest(
      port,
      'GET /%2e%2e/secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
    );
    expect(traversal).toContain('HTTP/1.1 403 Forbidden');
    expect(traversal).not.toContain('outside root');

    expect((await fetch(new URL('blocked.exe', running.url))).status).toBe(415);
    expect((await fetch(running.url, { method: 'POST' })).status).toBe(405);
  });

  it('同じポートが使用中なら自動変更せず、理由を示して終了する', async () => {
    const port = new URL(running.url).port;
    const child = spawn(
      POWERSHELL,
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(appRoot, '_local-server.ps1'),
        '-NoBrowser',
        '-Port',
        port,
      ],
      { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const { output } = await waitForMarker(child, new RegExp(`PWT_PORT_IN_USE ${port}`));
    expect(await waitForExit(child)).toBe(2);
    expect(output).toContain(`PWT_PORT_IN_USE ${port}`);
    expect((await fetch(running.url)).status).toBe(200);
  });

  it('start-local.cmdをダブルクリック相当の経路で起動できる', async () => {
    const child = spawn(
      CMD,
      ['/d', '/c', join(appRoot, 'start-local.cmd'), '-Port', '0', '-NoBrowser', '-Once'],
      { cwd: tempRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const { match } = await waitForMarker(child, READY);
    expect((await fetch(match[1])).status).toBe(200);
    expect(await waitForExit(child)).toBe(0);
  });

  it('利用者にPythonやNode.jsのインストールを要求しない', () => {
    const cmd = readFileSync(join(ROOT, 'start-local.cmd'), 'utf8').toLowerCase();
    expect(cmd).toContain('powershell.exe');
    expect(cmd).not.toContain('python');
    expect(cmd).not.toContain('node');
  });
});
