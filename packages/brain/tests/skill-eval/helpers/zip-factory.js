/**
 * zip 构造工厂 — 用于合同测试
 * 生成各种合法/非法 zip 文件的 Buffer
 *
 * 所有函数均为同步函数（测试代码中无 await 调用）
 */

import JSZip from 'jszip';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 预计算的合法 zip（含 SKILL.md），seed=default
const VALID_ZIP_BASE64_DEFAULT = 'UEsDBAoAAAAIAH2N51whw5CgNQAAADQAAAAIAAAAU0tJTEwubWRTVgjOzszJ4eIKTk1NsVJISU1LLM0p4eJSVlZ42jX/RfPeZ/39L/Zv4Hq2tfvF+qkKxSDFAFBLAwQKAAAACAB9jedcMz558RYAAAAUAAAACQAAAFJFQURNRS5tZFNWCEktLlEIzs7MyVEISEzOTkxPBQBQSwMECgAAAAAAfY3nXAAAAAAAAAAAAAAAAAQAAABzcmMvUEsDBAoAAAAIAH2N51xEheZqHQAAABsAAAAMAAAAc3JjL2luZGV4LmpzS87PK87PSdXLyU/XUMpIzcnJVyjOzszJUdK0BgBQSwECFAAKAAAACAB9jedcIcOQoDUAAAA0AAAACAAAAAAAAAAAAAAAAAAAAAAAU0tJTEwubWRQSwECFAAKAAAACAB9jedcMz558RYAAAAUAAAACQAAAAAAAAAAAAAAAABbAAAAUkVBRE1FLm1kUEsBAhQACgAAAAAAfY3nXAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAQAAAAmAAAAHNyYy9QSwECFAAKAAAACAB9jedcRIXmah0AAAAbAAAADAAAAAAAAAAAAAAAAAC6AAAAc3JjL2luZGV4LmpzUEsFBgAAAAAEAAQA2QAAAAEBAAAAAA==';

// 预计算的无 SKILL.md zip
const NO_SKILL_MD_ZIP_BASE64 = 'UEsDBAoAAAAIAKmN51yJeaQLFAAAABIAAAAJAAAAUkVBRE1FLm1kU1bwy1cI9vb08dHLTVHISC1KBQBQSwMECgAAAAAAqY3nXAAAAAAAAAAAAAAAAAQAAABzcmMvUEsDBAoAAAAIAKmN51x8MHlrHQAAABsAAAAMAAAAc3JjL2luZGV4LmpzS87PK87PSdXLyU/XUMrLVyjOzszJUchNUdK0BgBQSwECFAAKAAAACACpjedciXmkCxQAAAASAAAACQAAAAAAAAAAAAAAAAAAAAAAUkVBRE1FLm1kUEsBAhQACgAAAAAAqY3nXAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAQAAAAOwAAAHNyYy9QSwECFAAKAAAACACpjedcfDB5ax0AAAAbAAAADAAAAAAAAAAAAAAAAABdAAAAc3JjL2luZGV4LmpzUEsFBgAAAAADAAMAowAAAKQAAAAAAA==';

// 预计算的含多个 SKILL.md 的 zip
const MULTI_SKILL_MD_ZIP_BASE64 = 'UEsDBAoAAAAIAKmN51zjXRrpEgAAABAAAAAIAAAAU0tJTEwubWRTVnDLLCouUQj29vTx0ctNAQBQSwMECgAAAAAAqY3nXAAAAAAAAAAAAAAAAAQAAABzdWIvUEsDBAoAAAAIAKmN51xBVb/UEwAAABEAAAAMAAAAc3ViL1NLSUxMLm1kU1YITk3Oz0tRCPb29PHRy00BAFBLAQIUAAoAAAAIAKmN51zjXRrpEgAAABAAAAAIAAAAAAAAAAAAAAAAAAAAAABTS0lMTC5tZFBLAQIUAAoAAAAAAKmN51wAAAAAAAAAAAAAAAAEAAAAAAAAAAAAEAAAADgAAABzdWIvUEsBAhQACgAAAAgAqY3nXEFVv9QTAAAAEQAAAAwAAAAAAAAAAAAAAAAAWgAAAHN1Yi9TS0lMTC5tZFBLBQYAAAAAAwADAKIAAACXAAAAAAA=';

// 预计算的含路径穿越的 zip
const PATH_TRAVERSAL_ZIP_BASE64 = 'UEsDBAoAAAAAAKmN51wnxUs9BwAAAAcAAAAIAAAAU0tJTEwubWQjIFNraWxsUEsBAhQACgAAAAAAqY3nXCfFSz0HAAAABwAAAAgAAAAAAAAAAAAAAAAAAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAC0AAAAAAAAuLi8uLi8uLi9ldGMvcGFzc3dkAA==';

/**
 * 创建一个合法的 zip Buffer（含 SKILL.md，无路径穿越，在大小限制内）
 * 同步函数：直接返回 Buffer
 */
export function makeValidZipBuffer({ seed = 'default' } = {}) {
  const base = Buffer.from(VALID_ZIP_BASE64_DEFAULT, 'base64');
  if (seed === 'default') {
    return base;
  }
  // 非 default seed：附加 seed 数据使 hash 不同（仍然是合法 zip，附加在尾部不影响解析）
  const seedBuf = Buffer.from('\x00' + seed, 'utf8');
  return Buffer.concat([base, seedBuf]);
}

/**
 * 创建魔数错误的文件（非 zip）
 */
export function makeZipWithBadMagic() {
  return Buffer.from('this is not a zip file at all');
}

/**
 * 创建缺少 SKILL.md 的 zip（同步）
 */
export function makeZipWithNoSkillMd() {
  return Buffer.from(NO_SKILL_MD_ZIP_BASE64, 'base64');
}

/**
 * 创建含多个 SKILL.md 的 zip（同步）
 */
export function makeZipWithMultipleSkillMd() {
  return Buffer.from(MULTI_SKILL_MD_ZIP_BASE64, 'base64');
}

/**
 * 创建含路径穿越的 zip（同步）
 */
export function makeZipWithPathTraversal() {
  return Buffer.from(PATH_TRAVERSAL_ZIP_BASE64, 'base64');
}

/**
 * 创建超过文件数限制的 zip（同步，从预生成 fixture 读取）
 */
export function makeZipExceedingFileCount(_count = 2001) {
  // 使用预生成的 fixture 文件（含 2001 个文件）
  const fixturePath = join(__dirname, '../fixtures/exceed-2001-files.zip');
  return readFileSync(fixturePath);
}

/**
 * 创建压缩比过高的 zip（zip bomb 类型）
 * 内容全是重复字节，极高压缩比
 * 注意：此函数是 async 的，测试中使用 await 调用
 */
export async function makeHighCompressionRatioZip() {
  const zip = new JSZip();
  zip.file('SKILL.md', '# Skill');
  // 大量重复内容 → 高压缩比
  const largeContent = 'A'.repeat(5 * 1024 * 1024); // 5MB 重复内容
  zip.file('large.txt', largeContent);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
