/**
 * クリップボードへの書き出し（仕様書8.7.7）。
 *
 * 転記値をタブ区切りで渡す。文字列の組み立ては `domain/aggregate.js` の
 * `buildTransferText()` が持ち、ここは「渡す」ことだけを持つ。
 *
 * ## 2経路を用意する理由
 *
 * `navigator.clipboard.writeText()` は安全なコンテキスト（HTTPS または
 * localhost）でしか使えない。本ツールは HTTP 配信も想定しており（仕様書5.1.3）、
 * 社内の素の HTTP なホストへ置くと `navigator.clipboard` 自体が存在しない。
 * その場合に何も起きないと、利用者は「コピーできたのかどうか」が分からない。
 *
 * 代替は `document.execCommand('copy')` である。非推奨だが、現在も主要ブラウザで
 * 動き、外部ライブラリを増やさずに済む（仕様書5.1.4）。どちらも使えない場合は
 * 失敗として返し、画面が「手で選択してコピーしてください」と案内できるようにする。
 *
 * 例外にせず `{ok, reason}` で返す。コピーの失敗は記録の失敗ではなく、利用者が
 * 別の手段で回避できる事柄である。
 */

/**
 * テキストをクリップボードへ書き出す。
 *
 * `deps` はキーの有無で判定する。`??` で既定値へ落とすと、`{clipboard: undefined}`
 * が「差し替えていない」と区別できず、「クリップボードが存在しない環境」を
 * テストから作れない。
 *
 * @param {string} text
 * @param {{clipboard?: object, document?: Document}} [deps] テスト用の差し替え口
 * @returns {Promise<{ok: boolean, method: string|null, reason: string|null}>}
 */
export async function writeToClipboard(text, deps = {}) {
  const clipboard = 'clipboard' in deps ? deps.clipboard : globalThis.navigator?.clipboard;
  const doc = 'document' in deps ? deps.document : globalThis.document;

  if (text === '') {
    return { ok: false, method: null, reason: 'コピーする内容がありません。' };
  }

  if (clipboard !== undefined && clipboard !== null) {
    try {
      await clipboard.writeText(text);
      return { ok: true, method: 'clipboard', reason: null };
    } catch {
      // 権限を拒否された場合などは、下の代替へ落とす。
    }
  }

  const fallback = copyWithExecCommand(text, doc);
  if (fallback) {
    return { ok: true, method: 'execCommand', reason: null };
  }

  return {
    ok: false,
    method: null,
    reason:
      'この環境ではクリップボードへ書き込めません。表の値を選択してコピーしてください。' +
      '（HTTPS または localhost での配信が必要です）',
  };
}

/**
 * `document.execCommand('copy')` で書き出す。
 *
 * 画面外の `textarea` へ入れて選択し、コピーしてから取り除く。`position: fixed`
 * と `opacity: 0` にするのは、選択の瞬間に画面がスクロールしたり内容が見えたり
 * しないようにするためである。
 *
 * @param {string} text
 * @param {Document} doc
 * @returns {boolean} 成功したか
 */
function copyWithExecCommand(text, doc) {
  if (doc === undefined || doc === null || typeof doc.execCommand !== 'function') {
    return false;
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  doc.body.append(area);
  try {
    area.select();
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
