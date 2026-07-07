/**
 * zip 构造工厂 — 用于合同测试
 * 生成各种合法/非法 zip 文件的 Buffer
 */

import JSZip from 'jszip';

/**
 * 创建一个合法的 zip Buffer（含 SKILL.md，无路径穿越，在大小限制内）
 */
export async function makeValidZipBuffer({ seed = 'default' } = {}) {
  const zip = new JSZip();
  zip.file('SKILL.md', `# Skill\n\nSeed: ${seed}\n\n## 功能描述\n测试 skill`);
  zip.file('README.md', '# Test Skill Package');
  zip.file('src/index.js', 'console.log("hello skill");');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * 创建魔数错误的文件（非 zip）
 */
export function makeZipWithBadMagic() {
  return Buffer.from('this is not a zip file at all');
}

/**
 * 创建缺少 SKILL.md 的 zip
 */
export async function makeZipWithNoSkillMd() {
  const zip = new JSZip();
  zip.file('README.md', '# No SKILL.md here');
  zip.file('src/index.js', 'console.log("no skill md");');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * 创建含多个 SKILL.md 的 zip
 */
export async function makeZipWithMultipleSkillMd() {
  const zip = new JSZip();
  zip.file('SKILL.md', '# First SKILL.md');
  zip.file('sub/SKILL.md', '# Second SKILL.md');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * 创建含路径穿越的 zip
 */
export async function makeZipWithPathTraversal() {
  const zip = new JSZip();
  zip.file('SKILL.md', '# Skill');
  // 注意：jszip 会清理路径，所以直接写 entry；实际 zip 二进制需要手动构造
  // 这里通过 Buffer 方式模拟包含 ../ 的 entry name
  const normalZip = await zip.generateAsync({ type: 'nodebuffer' });

  // 在 zip 数据中注入路径穿越标记（用于测试服务端检测）
  // 真实场景中需要构造二进制 zip entry，这里返回带特殊标记的 buffer
  // 实际测试中应使用专门的 zip bomb/traversal 构造工具
  return Buffer.concat([
    normalZip,
    Buffer.from('\x00../../../etc/passwd\x00'),
  ]);
}

/**
 * 创建超过文件数限制的 zip
 */
export async function makeZipExceedingFileCount(count = 2001) {
  const zip = new JSZip();
  zip.file('SKILL.md', '# Skill');
  for (let i = 0; i < count; i++) {
    zip.file(`files/file-${i.toString().padStart(5, '0')}.txt`, `content ${i}`);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * 创建压缩比过高的 zip（zip bomb 类型）
 * 内容全是重复字节，极高压缩比
 */
export async function makeHighCompressionRatioZip() {
  const zip = new JSZip();
  zip.file('SKILL.md', '# Skill');
  // 大量重复内容 → 高压缩比
  const largeContent = 'A'.repeat(5 * 1024 * 1024); // 5MB 重复内容
  zip.file('large.txt', largeContent);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
