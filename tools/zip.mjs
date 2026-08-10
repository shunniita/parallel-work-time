/**
 * 最小のZIP書き出し（配布物の作成に使う）。
 *
 * ## OS の圧縮コマンドを呼ばない
 *
 * Node に ZIP 圧縮の公開APIは無いが、ZIP は deflate 生データと固定長ヘッダーの
 * 組み合わせであり、`node:zlib` だけで書ける。OS のコマンド（Windows の
 * `Compress-Archive`、その他の `zip`）へ委ねると、次の問題を同時に抱える。
 *
 * - コマンドが無い環境では配布物を作れない。実行時依存を増やさない方針
 *   （仕様書5.1.4）に対して、ビルド側だけ環境依存になる。
 * - パスをシェル文字列へ埋め込むため、アポストロフィや角括弧を含むパスで壊れる。
 * - Windows PowerShell 5.1 同梱の Microsoft.PowerShell.Archive 1.0.1.0 は、
 *   ZIP 内のパス区切りにバックスラッシュを書く。作成OSによって配布物の内部構造が
 *   変わり、Info-ZIP 系で展開すると階層にならない。
 *
 * 自分で書けば、区切りは常に `/`、失敗は例外、依存は Node だけになる。
 *
 * ## 出力を決定的にする
 *
 * 同じ入力からは常に同じバイト列を出す。日時は DOS の下限（1980-01-01 00:00）で
 * 固定し、エントリは名前順に並べる。配布ZIPの SHA-256 を公開して照合する運用
 * （公開チェックリスト6章）で、同じコミットから作り直したZIPが一致する。
 *
 * ## 対応範囲
 *
 * ZIP64 は扱わない。1ファイル4GiB、全体65,535エントリを超える入力は例外にする。
 * 本ツールの配布物（100ファイル未満・数百KB）に対して十分であり、静かに壊れた
 * ZIP を書くより失敗させる方がよい。
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** UTF-8 でファイル名を書くことを示す汎用フラグ（bit 11）。 */
const FLAG_UTF8 = 0x0800;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** DOS 日時の下限（1980-01-01 00:00:00）。決定的な出力のために固定する。 */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/**
 * ZIP を1つのバッファとして組み立てる。
 *
 * @param {{name: string, data: Buffer}[]} entries `name` は `/` 区切りの相対パス
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIPへ含められるのは ${MAX_ENTRIES} エントリまでです: ${entries.length}`);
  }
  // 並びを名前順に固定する。ディレクトリ走査の順序は環境で変わりうる。
  const sorted = [...entries].sort((left, right) => (left.name < right.name ? -1 : 1));

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of sorted) {
    assertEntryName(entry.name);
    if (entry.data.length > MAX_SIZE) {
      throw new Error(`ZIP64 が必要な大きさのファイルです: ${entry.name}`);
    }

    const nameBytes = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    // 圧縮して大きくなる入力（既に圧縮済み、極小）は無圧縮で入れる。
    const compressed = deflated.length < entry.data.length ? deflated : entry.data;
    const method = compressed === deflated ? METHOD_DEFLATE : METHOD_STORE;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4); // 展開に必要な版
    localHeader.writeUInt16LE(FLAG_UTF8, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // 拡張フィールドは持たない

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4); // 作成した版（MS-DOS 互換）
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(FLAG_UTF8, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // 拡張フィールド
    centralHeader.writeUInt16LE(0, 32); // コメント
    centralHeader.writeUInt16LE(0, 34); // 開始ディスク
    centralHeader.writeUInt16LE(0, 36); // 内部属性
    centralHeader.writeUInt32LE(0, 38); // 外部属性
    centralHeader.writeUInt32LE(offset, 42);

    localChunks.push(localHeader, nameBytes, compressed);
    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  const central = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4); // このディスクの番号
  eocd.writeUInt16LE(0, 6); // 中央ディレクトリの開始ディスク
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // コメント

  return Buffer.concat([...localChunks, central, eocd]);
}

/**
 * ZIP 内のエントリ名として使えるかを確かめる。
 *
 * 区切りは `/` に限る。絶対パスと `..` は、展開先の外へ書き出させる古典的な経路
 * （Zip Slip）なので、作る側でも通さない。
 *
 * @param {string} name
 */
function assertEntryName(name) {
  if (name === '' || name.includes('\\')) {
    throw new Error(`ZIPのエントリ名は / 区切りの相対パスにします: ${name}`);
  }
  const segments = name.split('/');
  if (name.startsWith('/') || segments.includes('..') || segments.includes('.')) {
    throw new Error(`ZIPのエントリ名に使えない要素が含まれています: ${name}`);
  }
}

/**
 * ZIP の中央ディレクトリを読み、エントリ名と大きさを返す。
 *
 * 展開はしない。作った配布物が「読み出せる形になっているか」「区切りが `/` か」
 * を、外部ツールへ頼らずに確かめるために使う。
 *
 * @param {Buffer} zip
 * @returns {{name: string, size: number, crc32: number, localHeaderOffset: number}[]}
 */
export function readZipEntries(zip) {
  const eocdOffset = findEocd(zip);
  const count = zip.readUInt16LE(eocdOffset + 10);
  let cursor = zip.readUInt32LE(eocdOffset + 16);

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('ZIPの中央ディレクトリを読み取れません');
    }
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    entries.push({
      name: zip.toString('utf8', cursor + 46, cursor + 46 + nameLength),
      size: zip.readUInt32LE(cursor + 24),
      crc32: zip.readUInt32LE(cursor + 16),
      localHeaderOffset: zip.readUInt32LE(cursor + 42),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * ZIP を展開し、エントリ名から中身への対応を返す。
 *
 * 各エントリの CRC-32 を検算する。「ファイルはできたが中身が壊れている」配布物を
 * 成功として扱わないための検査に使う。
 *
 * @param {Buffer} zip
 * @returns {Map<string, Buffer>}
 */
export function extractZip(zip) {
  const extracted = new Map();
  for (const entry of readZipEntries(zip)) {
    extracted.set(entry.name, readEntryData(zip, entry));
  }
  return extracted;
}

/**
 * 中央ディレクトリの1件からローカルヘッダーを辿り、中身を取り出す。
 *
 * @param {Buffer} zip
 * @param {{name: string, crc32: number}} entry
 * @returns {Buffer}
 */
function readEntryData(zip, entry) {
  const offset = entry.localHeaderOffset;
  if (zip.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`ZIPのローカルヘッダーを読み取れません: ${entry.name}`);
  }
  const method = zip.readUInt16LE(offset + 8);
  const compressedSize = zip.readUInt32LE(offset + 18);
  const nameLength = zip.readUInt16LE(offset + 26);
  const extraLength = zip.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const raw = zip.subarray(start, start + compressedSize);

  let data;
  if (method === METHOD_STORE) {
    data = Buffer.from(raw);
  } else if (method === METHOD_DEFLATE) {
    data = inflateRawSync(raw);
  } else {
    throw new Error(`未対応の圧縮方式です: ${entry.name}（${method}）`);
  }

  if (crc32(data) !== entry.crc32) {
    throw new Error(`ZIPのエントリが壊れています: ${entry.name}`);
  }
  return data;
}

/** EOCD は末尾にあり、コメントを持たない本ツールの出力では最後の22バイトである。 */
function findEocd(zip) {
  for (let offset = zip.length - 22; offset >= 0; offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('ZIPの終端レコードが見つかりません');
}
