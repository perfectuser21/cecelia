/**
 * zip-validator.js — ZIP 硬校验（无外部 zip 库依赖）
 * 使用纯 Node.js Buffer API 解析 ZIP 二进制格式
 *
 * ZIP 格式参考：
 * - Local file header: PK\x03\x04 (signature 0x04034b50)
 * - Central directory header: PK\x01\x02 (signature 0x02014b50)
 * - End of central directory: PK\x05\x06 (signature 0x06054b50)
 */

const MAX_UNZIP_MB = () => parseInt(process.env.MAX_UNZIP_MB || '50', 10);
const MAX_COMPRESS_RATIO = () => parseInt(process.env.MAX_COMPRESS_RATIO || '100', 10);
const MAX_ZIP_FILES = () => parseInt(process.env.MAX_ZIP_FILES || '2000', 10);

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/**
 * 检测路径穿越攻击
 * @param {string} filePath
 * @returns {boolean} true 表示危险路径
 */
export function detectPathTraversal(filePath) {
  if (!filePath) return false;
  // 绝对路径
  if (filePath.startsWith('/')) return true;
  // 路径穿越
  if (filePath.includes('../') || filePath.startsWith('..')) return true;
  // Windows 路径穿越
  if (filePath.includes('..\\') || filePath.startsWith('..')) return true;
  return false;
}

/**
 * 解析 ZIP 文件条目（从本地文件头列表）
 * @param {Buffer} buf
 * @returns {{ entries: Array<{name: string, compressedSize: number, uncompressedSize: number}> }}
 */
function parseZipEntries(buf) {
  const entries = [];
  let offset = 0;

  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);

    if (sig === LOCAL_FILE_HEADER_SIG) {
      // Local file header layout:
      // 0  4  signature (0x04034b50)
      // 4  2  version needed
      // 6  2  general purpose bit flag
      // 8  2  compression method
      // 10 2  last mod time
      // 12 2  last mod date
      // 14 4  crc-32
      // 18 4  compressed size
      // 22 4  uncompressed size
      // 26 2  file name length
      // 28 2  extra field length
      // 30 n  file name
      // 30+n m extra field
      // 30+n+m  file data

      if (offset + 30 > buf.length) break;

      const compressedSize = buf.readUInt32LE(offset + 18);
      const uncompressedSize = buf.readUInt32LE(offset + 22);
      const fileNameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);

      if (offset + 30 + fileNameLen > buf.length) break;

      const fileName = buf.slice(offset + 30, offset + 30 + fileNameLen).toString('utf8');

      entries.push({ name: fileName, compressedSize, uncompressedSize });

      // Advance past this entry
      offset += 30 + fileNameLen + extraLen + compressedSize;
    } else if (sig === CENTRAL_DIR_SIG || sig === EOCD_SIG) {
      // End of local file entries
      break;
    } else {
      // Unknown structure — advance byte by byte looking for next sig
      offset++;
    }
  }

  return entries;
}

/**
 * 验证 ZIP Buffer
 * @param {Buffer} buf
 * @returns {Promise<{ entries: Array, skillMd: string }>}
 * @throws Error with code: invalid_zip | skill_md_missing | skill_md_multiple | path_traversal | too_large | compress_ratio | too_many_files
 */
export async function validateZip(buf) {
  // 1. 魔数检查 — ZIP local file header 或 empty zip (EOCD only)
  if (!buf || buf.length < 4) {
    const err = new Error('invalid_zip: buffer too small');
    err.code = 'invalid_zip';
    throw err;
  }

  const sig = buf.readUInt32LE(0);
  // Valid if starts with local file header OR end-of-central-directory (empty zip)
  if (sig !== LOCAL_FILE_HEADER_SIG && sig !== EOCD_SIG) {
    const err = new Error('invalid_zip: bad magic bytes');
    err.code = 'invalid_zip';
    throw err;
  }

  // Parse entries
  const entries = parseZipEntries(buf);

  // 2. 文件数量检查
  if (entries.length > MAX_ZIP_FILES()) {
    const err = new Error(`too_many_files: ${entries.length} > ${MAX_ZIP_FILES()}`);
    err.code = 'too_many_files';
    throw err;
  }

  // 3. 解压大小 + 压缩比检查
  const maxUnzipBytes = MAX_UNZIP_MB() * 1024 * 1024;
  let totalUncompressed = 0;
  let totalCompressed = buf.length;

  for (const entry of entries) {
    // 路径穿越检查
    if (detectPathTraversal(entry.name)) {
      const err = new Error(`path_traversal: ${entry.name}`);
      err.code = 'path_traversal';
      throw err;
    }

    totalUncompressed += entry.uncompressedSize;

    if (totalUncompressed > maxUnzipBytes) {
      const err = new Error(`too_large: uncompressed size exceeds ${MAX_UNZIP_MB()}MB`);
      err.code = 'too_large';
      throw err;
    }
  }

  // 压缩比检查（只有有实际内容时检查）
  if (totalCompressed > 0 && totalUncompressed > 0) {
    const ratio = totalUncompressed / totalCompressed;
    if (ratio > MAX_COMPRESS_RATIO()) {
      const err = new Error(`compress_ratio: ratio ${ratio.toFixed(1)} > ${MAX_COMPRESS_RATIO()}`);
      err.code = 'compress_ratio';
      throw err;
    }
  }

  // 4. SKILL.md 存在且唯一
  const skillMdEntries = entries.filter(e => {
    const name = e.name;
    // Match SKILL.md at root or any level
    const parts = name.split('/');
    return parts[parts.length - 1] === 'SKILL.md';
  });

  if (skillMdEntries.length === 0) {
    const err = new Error('skill_md_missing: no SKILL.md found in zip');
    err.code = 'skill_md_missing';
    throw err;
  }

  if (skillMdEntries.length > 1) {
    const err = new Error('skill_md_multiple: more than one SKILL.md found');
    err.code = 'skill_md_multiple';
    throw err;
  }

  return { entries, skillMd: skillMdEntries[0].name };
}
